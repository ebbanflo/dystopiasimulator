/* =============================================================================
 * game.js — Core state, stat mutation helpers, action resolution, the weekly
 * turn loop, and every end-state check.
 *
 * IN-MEMORY ONLY. There is no save. Reloading the page is the end of the world.
 *
 * A TURN IS ONE WEEK (see config.js). The sequence per turn is:
 *   1. Player takes exactly one ACTION (or resolves a blocking incident first)
 *   2. Economy tick (wages, upkeep, heat decay)
 *   3. Faction AI tick (factions.js rules)
 *   4. NPC churn tick (npcs.js)
 *   5. Random incident roll (events.js) — may block the next turn on a choice
 *   6. End-state checks (death, arrest, faction collapse, irrelevance)
 * ========================================================================= */

const STATE = {
  started: false,
  week: 1,
  seed: 0,
  regions: REGIONS,
  factions: {},
  npcs: [],
  history: [],
  log: [],              // [{week, kind, text}]
  pendingIncident: null,// blocks actions until a choice is made
  gameOver: false,
  gameOverReason: null,
  player: null,
  playerFactionCount: 0,
  _incidentFaction: null,
  _incidentNPC: null,
};

/* ---------------------------------------------------------------------------
 * LOGGING
 * ------------------------------------------------------------------------- */
function log(state, text, kind) {
  state.log.push({ week: state.week, kind: kind || 'plain', text: text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

function logAll(state, lines, kind) {
  for (const l of (lines || [])) log(state, l, kind);
}

/* ---------------------------------------------------------------------------
 * STAT HELPERS — every stat change in the game goes through these.
 * ------------------------------------------------------------------------- */
function addMoney(state, amount) {
  state.player.money = Math.round(state.player.money + amount);
}

function addRep(state, factionId, amount) {
  if (!factionId) return;
  const p = state.player;
  p.reputation[factionId] = clamp(
    (p.reputation[factionId] || 0) + amount,
    CONFIG.MIN_REPUTATION, CONFIG.MAX_REPUTATION);
}

function addTerritory(state, amount) {
  state.player.territory = clamp(state.player.territory + amount, 0, CONFIG.MAX_TERRITORY);
}

function addHeat(state, amount) {
  state.player.heat = clamp(state.player.heat + amount, 0, 100);
}

function addSpecialization(state, spec) {
  if (!state.player.specializations.includes(spec)) {
    state.player.specializations.push(spec);
  }
}

function dominantFactionInRegion(state, regionId, excludeId) {
  let best = null;
  for (const f of Object.values(state.factions)) {
    if (f.defunct || f.id === excludeId) continue;
    if (!best || (f.control[regionId] || 0) > (best.control[regionId] || 0)) best = f;
  }
  return (best && (best.control[regionId] || 0) > 0) ? best : null;
}

/* ---------------------------------------------------------------------------
 * NEW GAME
 * ------------------------------------------------------------------------- */
function newGame(seed) {
  STATE.seed = RNG.reseed(seed);
  STATE.week = 1;
  STATE.factions = initWorldFactions(REGIONS);
  STATE.npcs = generateAllNPCs(STATE.factions);
  STATE.history = generateProceduralHistory(STATE.factions, REGIONS, 8);
  STATE.log = [];
  STATE.pendingIncident = null;
  STATE.gameOver = false;
  STATE.gameOverReason = null;
  STATE.started = false;
  STATE.playerFactionCount = 0;

  /* Starting region is assigned randomly; sector choice is then constrained
   * by what that region actually runs (feature 2). */
  const region = RNG.pick(REGIONS);

  const reputation = {};
  for (const fid in STATE.factions) reputation[fid] = CONFIG.START_REPUTATION;

  STATE.player = {
    name: 'UNREGISTERED',
    regionId: region.id,
    sector: null,             // chosen at start
    money: CONFIG.START_MONEY,
    territory: CONFIG.START_TERRITORY,
    reputation: reputation,   // PER-FACTION, never global (feature 3)
    heat: 0,
    factionId: null,          // starts unaffiliated — see config.js design note
    rankIndex: null,
    priorFactions: [],        // [{id, rankIndex, week}]
    ownFactionId: null,
    specializations: [],
    creations: [],
    alive: true,
    exiled: false,            // permanently barred from re-joining anything
    imprisonedWeeks: 0,
    weeksIrrelevant: 0,
    causeOfDeath: null,
  };

  return STATE;
}

function startGame(sectorId) {
  STATE.player.sector = sectorId;
  STATE.started = true;
  const region = REGIONS.find(r => r.id === STATE.player.regionId);
  log(STATE, `CASE FILE ${STATE.seed.toString(16).toUpperCase()} OPENED.`, 'sys');
  log(STATE, `Subject registered in ${region.name} as ${SECTORS[sectorId].jobTitle.toLowerCase()}.`, 'sys');
  log(STATE, 'No affiliation. No holdings. No standing. Week 1.', 'sys');
  return STATE;
}

/* ---------------------------------------------------------------------------
 * DATE FORMATTING
 * ------------------------------------------------------------------------- */
function dateString(state) {
  const week = state.week;
  const year = CONFIG.START_YEAR + Math.floor((week - 1) / CONFIG.WEEKS_PER_YEAR);
  const w = ((week - 1) % CONFIG.WEEKS_PER_YEAR) + 1;
  return `WK ${String(w).padStart(2, '0')} / ${year}`;
}

/* ---------------------------------------------------------------------------
 * AFFILIATION
 * ------------------------------------------------------------------------- */

/* Odds a faction accepts the player at the bottom rank. */
function joinOdds(state, factionId) {
  const f = state.factions[factionId];
  const rep = state.player.reputation[factionId] || 0;
  const regionalPresence = (f.control[state.player.regionId] || 0);
  const sectorMatch = f.def.sector === state.player.sector ? 0.18 : 0;
  const hostility = f.playerHostility * 0.006;
  return clamp(0.35 + rep * 0.005 + regionalPresence * 0.004 + sectorMatch - hostility, 0.05, 0.95);
}

function joinFaction(state, factionId) {
  const f = state.factions[factionId];
  const p = state.player;
  const odds = joinOdds(state, factionId);
  if (!RNG.chance(odds)) {
    addRep(state, factionId, -2);
    return { ok: false, lines: [
      `${f.def.name} declines your petition. You are not useful enough to be worth feeding.`,
    ] };
  }
  p.factionId = factionId;
  p.rankIndex = 0;
  addRep(state, factionId, 5);
  return { ok: true, lines: [
    `You are entered on the rolls of ${f.def.name} as ${f.def.rankTitles[0]}.`,
    `"${f.def.creed}"`,
  ] };
}

/* Returning to a faction you once served (feature 7). The faction has been
 * evolving on its own clock the whole time — nothing is preserved for you,
 * and your old seat has a hostile occupant. */
function returnToFaction(state, factionId) {
  const p = state.player;
  const f = state.factions[factionId];
  if (p.exiled) {
    return { ok: false, lines: ['You are on an exile list. No flag will take you.'] };
  }
  const prior = p.priorFactions.find(x => x.id === factionId);
  const rep = p.reputation[factionId] || 0;
  const odds = clamp(0.30 + rep * 0.006 - f.playerHostility * 0.007, 0.03, 0.9);

  if (!RNG.chance(odds)) {
    addRep(state, factionId, -5);
    f.playerHostility = clamp(f.playerHostility + 8, 0, 100);
    return { ok: false, lines: [
      `${f.def.name} reads your file back to you and shows you the door.`,
      'You are worth less to them than the paper you cost.',
    ] };
  }

  /* Re-entry rank: you come back below where you left, scaled by standing. */
  const oldRank = prior ? prior.rankIndex : 0;
  let newRank = 0;
  if (rep >= 60) newRank = Math.max(0, oldRank - 1);
  else if (rep >= 30) newRank = Math.max(0, oldRank - 2);
  else newRank = 0;
  /* Never above a rank whose reputation requirement you no longer meet. */
  while (newRank > 0 && rep < RANK_REP_REQ[newRank]) newRank--;

  p.factionId = factionId;
  p.rankIndex = newRank;

  const lines = [
    `${f.def.name} takes you back at ${f.def.rankTitles[newRank]}.`,
  ];

  /* The rival who filled your seat is still there and still hates you. */
  const rival = state.npcs.find(n =>
    n.alive && n.isRival && n.factionId === factionId);
  if (rival) {
    lines.push(`${rival.name} holds your former seat as ${f.def.rankTitles[rival.rankIndex]}. ` +
               'They greet you by your full name, twice.');
  }
  lines.push(`In your absence: ${f.def.short} sits at ${f.power} power, ${f.corruption} corruption` +
             `${f.suppressingElections ? ', and has stopped counting ballots' : ''}.`);
  return { ok: true, lines: lines };
}

/* Leaving a faction (feature 9: real death probability, not flavor). */
function abandonFaction(state, verb) {
  const p = state.player;
  const f = state.factions[p.factionId];
  const lines = [];

  p.priorFactions = p.priorFactions.filter(x => x.id !== f.id);
  p.priorFactions.push({ id: f.id, rankIndex: p.rankIndex, week: state.week });

  /* Somebody takes your chair, and hates you (feature 7). */
  if (!f.isPlayerFaction) {
    const successor = installSuccessor(state, f.id, p.rankIndex);
    lines.push(`${successor.name} is installed in your seat before the week is out.`);
  }

  f.playerHostility = clamp(f.playerHostility + 30, 0, 100);
  addRep(state, f.id, -15);
  p.factionId = null;
  p.rankIndex = null;

  lines.unshift(`You have ${verb} ${f.def.name}.`);

  /* THE TRIBALISM CHECK — stated probability, rolled for real. */
  const deathChance = CONFIG.FACTION_ABANDON_DEATH_CHANCE + (f.militancy * 0.0015);
  lines.push(`[HUNT CHECK: ${Math.round(deathChance * 100)}%]`);
  if (RNG.chance(deathChance)) {
    killPlayer(state, `killed by ${f.def.name} enforcers eleven days after leaving`);
    lines.push(`${f.def.short} does not accept resignations.`);
    return { ok: false, lines: lines };
  }
  lines.push('You are not followed. This week.');
  return { ok: true, lines: lines };
}

/* ---------------------------------------------------------------------------
 * CORRUPT ACTIONS (feature 5)
 * ------------------------------------------------------------------------- */

function bribeCost(target) {
  return 600 + target.rankIndex * 900;
}

function bribeOdds(state, target) {
  const rep = state.player.reputation[state.player.factionId] || 0;
  const base = 0.35
    + target.corruptionTaste * 0.0035
    + target.trait.bribeMod
    + rep * 0.0018
    - target.rankIndex * 0.04;
  return clamp(base, 0.03, 0.92);
}

function resolveBribe(state, targetId) {
  const p = state.player;
  const target = npcById(state, targetId);
  if (!target || !target.alive) return { ok: false, lines: ['That name is no longer available.'] };
  const cost = bribeCost(target);
  if (p.money < cost) return { ok: false, lines: [`You cannot cover ${cost}cr.`] };

  addMoney(state, -cost);
  const f = state.factions[p.factionId];
  const odds = bribeOdds(state, target);

  if (RNG.chance(odds)) {
    const rep = RNG.int(5, 9) + target.rankIndex;
    addRep(state, p.factionId, rep);
    addTerritory(state, RNG.chance(0.5) ? 1 : 0);
    addHeat(state, 7);
    target.corruptionTaste = clamp(target.corruptionTaste + 6, 0, 100);
    target.loyalty = clamp(target.loyalty - 5, 0, 100);
    f.corruption = clamp(f.corruption + 2, 0, 100);
    addSpecialization(state, 'bribery');
    return { ok: true, lines: [
      `${target.name} takes ${cost}cr and signs what you put in front of them.`,
      `+${rep} standing. They will take money from you again.`,
    ] };
  }

  /* Failure table for bribery: refusal, refusal+report, or a sting. */
  const roll = RNG.next();
  addHeat(state, 12);
  if (roll < 0.45) {
    addRep(state, p.factionId, -4);
    return { ok: false, lines: [
      `${target.name} keeps the money and does nothing. -4 standing.`,
      target.trait.id === 'ideologue' ? 'You were told they could not be bought.' : 'You were, evidently, not the first.',
    ] };
  }
  if (roll < 0.80) {
    addRep(state, p.factionId, -9);
    f.playerHostility = clamp(f.playerHostility + 15, 0, 100);
    target.grudge = clamp(target.grudge + 20, 0, 100);
    return { ok: false, lines: [
      `${target.name} reports the approach in writing. -9 standing.`,
      `${f.def.short} internal security opens a file with your name on the cover.`,
    ] };
  }
  addRep(state, p.factionId, -14);
  addHeat(state, 20);
  p.imprisonedWeeks = RNG.int(2, 4);
  return { ok: false, lines: [
    'It was a sting. The room had three witnesses and a recorder.',
    `You spend ${p.imprisonedWeeks} weeks in a holding block. -14 standing.`,
  ] };
}

function blackmailOdds(state, target) {
  const rep = state.player.reputation[state.player.factionId] || 0;
  return clamp(
    0.30
    + target.corruptionTaste * 0.0030
    + (target.trait.id === 'compromised' ? 0.20 : 0)
    + (state.player.territory * 0.004)
    + rep * 0.0012
    - target.rankIndex * 0.05
    - (target.trait.id === 'paranoid' ? 0.12 : 0),
    0.03, 0.90);
}

function resolveBlackmail(state, targetId) {
  const p = state.player;
  const target = npcById(state, targetId);
  if (!target || !target.alive) return { ok: false, lines: ['That name is no longer available.'] };
  const cost = 300;
  if (p.money < cost) return { ok: false, lines: ['You cannot fund the surveillance.'] };
  addMoney(state, -cost);
  const f = state.factions[p.factionId];
  const odds = blackmailOdds(state, target);
  addHeat(state, 6);

  if (RNG.chance(odds)) {
    const rep = RNG.int(6, 11) + target.rankIndex;
    addRep(state, p.factionId, rep);
    addMoney(state, RNG.int(200, 900));
    target.grudge = clamp(target.grudge + 35, 0, 100);
    target.loyalty = clamp(target.loyalty - 15, 0, 100);
    addSpecialization(state, 'blackmail');
    return { ok: true, lines: [
      `You find the thing ${target.name} did in ${CONFIG.START_YEAR - RNG.int(2, 9)} and put it on the table.`,
      `They do what you ask. +${rep} standing. They will hate you for the rest of their life.`,
    ] };
  }

  const roll = RNG.next();
  if (roll < 0.5) {
    addRep(state, p.factionId, -6);
    target.grudge = clamp(target.grudge + 25, 0, 100);
    return { ok: false, lines: [
      `There is nothing on ${target.name}, or nothing you can reach.`,
      'They learn you were looking. -6 standing.',
    ] };
  }
  addRep(state, p.factionId, -12);
  addHeat(state, 15);
  f.playerHostility = clamp(f.playerHostility + 20, 0, 100);
  target.grudge = clamp(target.grudge + 45, 0, 100);
  if (target.trait.id === 'brutal' && RNG.chance(0.25)) {
    killPlayer(state, `killed by ${target.name} for attempted blackmail`);
    return { ok: false, lines: [
      `${target.name} does not report it. ${target.name} handles it.`,
    ] };
  }
  return { ok: false, lines: [
    `${target.name} turns the file around and reads it to the room. -12 standing.`,
    'You are now the one with something to hide.',
  ] };
}

/* --- ASSASSINATION ------------------------------------------------------- *
 * Cost, odds, and a REAL failure table (feature 5). Nothing hand-waved.
 * ----------------------------------------------------------------------- */
function assassinationCost(state, target) {
  const gap = Math.max(1, target.rankIndex - state.player.rankIndex);
  return CONFIG.ASSASSINATION_BASE_COST + gap * CONFIG.ASSASSINATION_COST_PER_RANK;
}

function assassinationOdds(state, target) {
  const p = state.player;
  const gap = Math.max(0, target.rankIndex - p.rankIndex);
  const rep = p.reputation[p.factionId] || 0;
  const odds =
    CONFIG.ASSASSINATION_BASE_CHANCE
    - gap * CONFIG.ASSASSINATION_RANK_GAP_PENALTY
    + rep * CONFIG.ASSASSINATION_REP_BONUS
    + p.territory * CONFIG.ASSASSINATION_TERRITORY_BONUS
    + target.trait.killMod
    - p.heat * 0.0015
    + (p.specializations.includes('muscle') ? 0.05 : 0);
  return clamp(odds, CONFIG.ASSASSINATION_MIN_CHANCE, CONFIG.ASSASSINATION_MAX_CHANCE);
}

/* FAILURE TABLE — rolled on a failed attempt, weighted by how far above you
 * the target sat. Every outcome is implemented:
 *   1. BOTCHED     — target survives, suspects nothing concrete
 *   2. TRACED      — reputation collapse + faction hostility
 *   3. IMPRISONED  — 3-8 weeks of lost turns, heavy standing loss
 *   4. EXPELLED    — thrown out of the faction, barred from returning to it
 *   5. KILLED      — the target's people get to you first. Permadeath.
 */
function assassinationFailure(state, target) {
  const p = state.player;
  const f = state.factions[p.factionId];
  const gap = Math.max(0, target.rankIndex - p.rankIndex);
  const table = [
    { id: 'botched',    w: 30 },
    { id: 'traced',     w: 26 },
    { id: 'imprisoned', w: 18 + gap * 2 },
    { id: 'expelled',   w: 14 + gap * 3 },
    { id: 'killed',     w: 8 + gap * 6 + (target.trait.id === 'brutal' ? 10 : 0) },
  ];
  const pickResult = RNG.weighted(table).id;
  target.grudge = clamp(target.grudge + 50, 0, 100);
  target.loyalty = clamp(target.loyalty + 10, 0, 100);

  switch (pickResult) {
    case 'botched':
      addHeat(state, 15);
      addRep(state, f.id, -3);
      return { lines: [
        `The attempt fails. ${target.name} walks away from it and does not know why.`,
        'Your contractor does not come back for the second payment. -3 standing.',
      ] };

    case 'traced':
      addHeat(state, 30);
      addRep(state, f.id, -20);
      f.playerHostility = clamp(f.playerHostility + 40, 0, 100);
      return { lines: [
        `The attempt fails and is traced to a courier who names you inside a day.`,
        `-20 standing. ${f.def.short} security now treats you as an internal threat.`,
      ] };

    case 'imprisoned':
      p.imprisonedWeeks = RNG.int(3, 8);
      addHeat(state, 25);
      addRep(state, f.id, -15);
      addTerritory(state, -Math.min(p.territory, RNG.int(2, 5)));
      return { lines: [
        `You are taken at a checkpoint with the weapon still in the vehicle.`,
        `${p.imprisonedWeeks} weeks in a holding block. -15 standing, and your wards are reassigned.`,
      ] };

    case 'expelled': {
      addRep(state, f.id, -30);
      f.playerHostility = clamp(f.playerHostility + 50, 0, 100);
      p.priorFactions = p.priorFactions.filter(x => x.id !== f.id);
      const installed = installSuccessor(state, f.id, p.rankIndex);
      p.factionId = null;
      p.rankIndex = null;
      /* Expelled for attempted murder = permanently barred from THAT faction.
       * Tracked by simply never adding it to priorFactions. */
      return { lines: [
        `A tribunal sits for ninety minutes. You are struck from the rolls of ${f.def.name}.`,
        `${installed.name} takes your seat. You will not be readmitted.`,
        '-30 standing. You are unaffiliated.',
      ] };
    }

    case 'killed':
    default:
      killPlayer(state, `killed by ${target.name}'s security after a failed assassination attempt`);
      return { lines: [
        `${target.name} was expecting it.`,
        'They were expecting it for three weeks.',
      ] };
  }
}

function resolveAssassination(state, targetId) {
  const p = state.player;
  const target = npcById(state, targetId);
  if (!target || !target.alive) return { ok: false, lines: ['That name is no longer available.'] };
  const cost = assassinationCost(state, target);
  if (p.money < cost) return { ok: false, lines: [`You cannot cover ${cost}cr in contractor fees.`] };

  addMoney(state, -cost);
  addHeat(state, CONFIG.ASSASSINATION_HEAT);
  const f = state.factions[p.factionId];
  const odds = assassinationOdds(state, target);

  if (!RNG.chance(odds)) {
    const fail = assassinationFailure(state, target);
    return { ok: false, lines: [`[ATTEMPT ON ${target.name.toUpperCase()} — FAILED]`].concat(fail.lines) };
  }

  /* SUCCESS: the target actually dies, the slot vacates, promotions cascade. */
  const lines = [`[ATTEMPT ON ${target.name.toUpperCase()} — SUCCESSFUL]`];
  lines.push.apply(lines, killNPC(state, target));
  addSpecialization(state, 'wetwork');

  /* Beloved targets cost you standing even when nobody can prove it. */
  if (target.trait.id === 'beloved') {
    addRep(state, f.id, -6);
    lines.push(`${target.name} was liked. The faction mourns loudly. -6 standing.`);
  }

  /* Suspicion roll: even a success can put you under a cloud. */
  if (RNG.chance(clamp(0.20 + p.heat * 0.003, 0, 0.6))) {
    addRep(state, f.id, -8);
    f.playerHostility = clamp(f.playerHostility + 15, 0, 100);
    lines.push('Nobody proves anything. Everybody assumes it. -8 standing.');
  } else {
    addRep(state, f.id, RNG.int(2, 6));
    lines.push('The killing reads as factional business. Your standing is untouched, or slightly improved.');
  }

  /* If the vacancy is now at the rank directly above you, you may move up. */
  if (target.rankIndex === p.rankIndex + 1) {
    const occupants = npcsOfFaction(state, f.id).filter(n => n.rankIndex === target.rankIndex);
    if (occupants.length < RANK_POPULATION[target.rankIndex] &&
        (p.reputation[f.id] || 0) >= RANK_REP_REQ[target.rankIndex]) {
      p.rankIndex = target.rankIndex;
      addTerritory(state, 2);
      lines.push(`The seat is empty and you are standing next to it. You are now ${f.def.rankTitles[p.rankIndex]}. +2 territory.`);
    } else {
      lines.push('The seat is open. You do not yet have the standing to sit in it.');
    }
  }

  f.corruption = clamp(f.corruption + 3, 0, 100);
  f.power = clamp(f.power - 2, 0, 100);
  return { ok: true, lines: lines };
}

/* ---------------------------------------------------------------------------
 * FACTION FOUNDING (feature 6)
 * ------------------------------------------------------------------------- */
function canFoundFaction(state) {
  const p = state.player;
  if (!p.factionId) return { ok: false, reason: 'You must be inside a faction to split one.' };
  if (p.ownFactionId) return { ok: false, reason: 'You have already raised a flag.' };
  if (p.rankIndex < CONFIG.FOUND_MIN_RANK_INDEX) {
    return { ok: false, reason: `Requires rank ${CONFIG.FOUND_MIN_RANK_INDEX}+ (you are ${p.rankIndex}).` };
  }
  const rep = p.reputation[p.factionId] || 0;
  const missing = [];
  if (p.money < CONFIG.FOUND_MONEY_REQ) missing.push(`${CONFIG.FOUND_MONEY_REQ - p.money}cr more`);
  if (rep < CONFIG.FOUND_REPUTATION_REQ) missing.push(`${CONFIG.FOUND_REPUTATION_REQ - rep} more standing`);
  if (p.territory < CONFIG.FOUND_TERRITORY_REQ) missing.push(`${CONFIG.FOUND_TERRITORY_REQ - p.territory} more territory`);
  if (missing.length) return { ok: false, reason: 'Need ' + missing.join(', ') + '.' };
  return { ok: true, reason: 'All thresholds met.' };
}

function foundFaction(state, name) {
  const p = state.player;
  const gate = canFoundFaction(state);
  if (!gate.ok) return { ok: false, lines: [gate.reason] };

  const oldFactionId = p.factionId;
  const oldFaction = state.factions[oldFactionId];
  addMoney(state, -CONFIG.FOUND_COST_MONEY);

  const cleanName = (name || '').trim().toUpperCase() || 'THE UNNAMED COMPACT';
  const newId = 'player_faction_' + (++state.playerFactionCount);

  const def = {
    id: newId,
    name: cleanName,
    short: cleanName.split(/\s+/).slice(-1)[0],
    crest: PLAYER_FACTION_CRESTS[(state.playerFactionCount - 1) % PLAYER_FACTION_CRESTS.length],
    sector: p.sector,
    creed: 'Raised by one person who was nobody twenty months ago.',
    blurb: 'A splinter faction founded on the personal holdings, specializations, ' +
           'and paperwork of its founder.',
    rankTitles: PLAYER_FACTION_RANK_TITLES.slice(),
    base: { power: CONFIG.PLAYER_FACTION_START_POWER, corruption: 20, militancy: 40, legalism: 40 },
  };

  const f = generateFactionState(def, state.regions);
  f.isPlayerFaction = true;
  f.power = CONFIG.PLAYER_FACTION_START_POWER;
  f.corruption = clamp(20 + (p.specializations.includes('embezzlement') ? 20 : 0), 0, 100);
  f.militancy = clamp(35 + (p.specializations.includes('wetwork') ? 25 : 0) + (p.specializations.includes('muscle') ? 15 : 0), 0, 100);
  f.legalism = clamp(30 + (p.specializations.includes('legislative') ? 35 : 0), 0, 100);
  f.suppressingElections = false;
  f.unrestPressure = 10;

  /* INHERITANCE: specializations, creations, and earned assets carry over. */
  f.inherited = {
    specializations: p.specializations.slice(),
    creations: p.creations.slice(),
    territoryAtFounding: p.territory,
  };
  /* Territory the player holds becomes the faction's control in their region. */
  for (const r of state.regions) f.control[r.id] = 0;
  f.control[p.regionId] = Math.min(p.territory, 100);
  if (oldFaction.control[p.regionId]) {
    oldFaction.control[p.regionId] = clamp(oldFaction.control[p.regionId] - Math.floor(p.territory / 2), 0, 100);
  }

  /* Relations: everybody dislikes a new flag; your old faction hates it. */
  for (const other of Object.values(state.factions)) {
    if (other.defunct) continue;
    const hostile = other.id === oldFactionId ? RNG.int(-90, -60) : RNG.int(-45, -5);
    f.relations[other.id] = hostile;
    other.relations[f.id] = other.id === oldFactionId ? RNG.int(-95, -70) : RNG.int(-50, -10);
  }
  oldFaction.playerHostility = clamp(oldFaction.playerHostility + 45, 0, 100);

  state.factions[newId] = f;
  if (!state.player.reputation[newId]) state.player.reputation[newId] = 75;

  /* Record the departure and install a hostile successor in the old seat. */
  p.priorFactions = p.priorFactions.filter(x => x.id !== oldFactionId);
  p.priorFactions.push({ id: oldFactionId, rankIndex: p.rankIndex, week: state.week });
  const successor = installSuccessor(state, oldFactionId, p.rankIndex);

  /* PER-MEMBER DEFECTION ROLLS — not all-or-nothing (feature 6). */
  const defect = rollDefections(state, oldFactionId, f);
  f.power = clamp(f.power + defect.moved.length * 2, 0, 100);

  p.factionId = newId;
  p.ownFactionId = newId;
  p.rankIndex = RANK_COUNT - 1;   // Founder
  addRep(state, oldFactionId, -25);

  const lines = [
    `${cleanName} is founded in ${REGIONS.find(r => r.id === p.regionId).name}. Crest: ${f.crest || def.crest}`,
    `${CONFIG.FOUND_COST_MONEY}cr spent standing it up.`,
    `Inherited: ${p.specializations.length ? p.specializations.join(', ') : 'no specializations'}; ` +
      `${p.creations.length} instrument(s) of record; ${p.territory} territory.`,
    `DEFECTION ROLLS AGAINST ${oldFaction.def.name}: ${defect.moved.length} followed you, ${defect.stayed} stayed.`,
  ];
  if (defect.moved.length) {
    lines.push('Followed: ' + defect.moved.map(n => n.name).join(', ') + '.');
  }
  lines.push(`${successor.name} takes your old seat and calls you a traitor in writing.`);
  return { ok: true, lines: lines };
}

/* Collapse of the player's own faction (feature 9). */
function checkPlayerFactionCollapse(state) {
  const p = state.player;
  if (!p.ownFactionId) return [];
  const f = state.factions[p.ownFactionId];
  if (!f || f.defunct) return [];
  if (f.power > CONFIG.PLAYER_FACTION_FAIL_POWER) return [];

  const lines = [
    `${f.def.name} HAS COLLAPSED. Power fell to ${f.power}.`,
    'The remaining members scatter or are absorbed.',
  ];
  f.defunct = true;

  /* Survivors get absorbed by whoever is strongest. */
  const absorber = Object.values(state.factions)
    .filter(o => !o.defunct && !o.isPlayerFaction)
    .sort((a, b) => b.power - a.power)[0];
  for (const npc of npcsOfFaction(state, f.id)) {
    if (absorber) {
      npc.factionId = absorber.id;
      npc.rankIndex = Math.max(0, npc.rankIndex - 1);
    } else {
      npc.alive = false;
    }
  }
  if (absorber) lines.push(`${absorber.def.short} absorbs what is left of them.`);

  if (p.factionId === f.id) {
    p.factionId = null;
    p.rankIndex = null;
  }
  p.ownFactionId = null;
  p.territory = Math.floor(p.territory / 3);

  /* THE TRIBALISM CHECK — a stated probability, rolled for real. */
  const chance = CONFIG.FACTION_FAILURE_DEATH_CHANCE;
  lines.push(`[HUNT CHECK ON FACTION FAILURE: ${Math.round(chance * 100)}%]`);
  if (RNG.chance(chance)) {
    killPlayer(state, `hunted down in the collapse of ${f.def.name}`);
    lines.push('Everyone you ever crossed knew where you slept.');
  } else {
    lines.push('You get out with a third of your holdings and no flag.');
  }
  return lines;
}

/* ---------------------------------------------------------------------------
 * END STATES
 * ------------------------------------------------------------------------- */
function killPlayer(state, cause) {
  state.player.alive = false;
  state.player.causeOfDeath = cause;
  state.gameOver = true;
  state.gameOverReason = 'DECEASED — ' + cause + '.';
}

function endByIrrelevance(state) {
  state.gameOver = true;
  state.gameOverReason =
    'POLITICALLY IRRELEVANT — no faction, no holdings, no money, for ' +
    CONFIG.IRRELEVANCE_WEEKS + ' consecutive weeks. ' +
    'You are alive. Nobody with power will ever say your name again.';
}

/* ---------------------------------------------------------------------------
 * THE WEEKLY TICK
 * ------------------------------------------------------------------------- */
function economyTick(state) {
  const p = state.player;
  const lines = [];
  const s = SECTORS[p.sector];

  /* Wages only if you actually worked/held ground — territory pays either way. */
  const wage = p.imprisonedWeeks > 0 ? 0 : Math.round(CONFIG.BASE_WEEKLY_WAGE * s.wageMod * 0.5);
  const holdings = Math.round(p.territory * CONFIG.WAGE_PER_TERRITORY);
  const upkeep = Math.round(CONFIG.WEEKLY_UPKEEP_BASE + p.territory * CONFIG.WEEKLY_UPKEEP_PER_TERRITORY);
  const net = wage + holdings - upkeep;
  addMoney(state, net);
  lines.push(`LEDGER: retainer ${wage}cr + holdings ${holdings}cr − upkeep ${upkeep}cr = ${net >= 0 ? '+' : ''}${net}cr.`);

  addHeat(state, -CONFIG.HEAT_DECAY_PER_WEEK);

  if (p.money < CONFIG.DESTITUTION_LIMIT) {
    lines.push('CREDITORS: you are past the line where people stop sending letters.');
    if (RNG.chance(0.25)) {
      killPlayer(state, 'killed over debt in a stairwell in ' +
        REGIONS.find(r => r.id === p.regionId).name);
    } else {
      const lost = Math.min(p.territory, RNG.int(1, 3));
      addTerritory(state, -lost);
      addMoney(state, 500);
      lines.push(`They take ${lost} territory against the debt and leave you breathing.`);
    }
  }
  return lines;
}

function heatTick(state) {
  const p = state.player;
  const lines = [];
  if (p.heat >= CONFIG.HEAT_ARREST_THRESHOLD && RNG.chance(CONFIG.HEAT_ARREST_CHANCE)) {
    p.imprisonedWeeks = RNG.int(2, 5);
    addHeat(state, -35);
    lines.push(`DETENTION: you are picked up at a checkpoint. ${p.imprisonedWeeks} weeks held without charge.`);
  }
  return lines;
}

function relevanceTick(state) {
  const p = state.player;
  if (!p.factionId && p.territory <= 0 && p.money < CONFIG.IRRELEVANCE_MAX_MONEY) {
    p.weeksIrrelevant++;
    if (p.weeksIrrelevant >= CONFIG.IRRELEVANCE_WEEKS) {
      endByIrrelevance(state);
      return [`You have been nobody for ${p.weeksIrrelevant} weeks.`];
    }
    if (p.weeksIrrelevant % 6 === 0) {
      return [`RELEVANCE WARNING: ${p.weeksIrrelevant}/${CONFIG.IRRELEVANCE_WEEKS} weeks without standing.`];
    }
  } else {
    p.weeksIrrelevant = 0;
  }
  return [];
}

/* Advance one week. Called after the player's action resolves. */
function advanceWeek(state) {
  if (state.gameOver) return;
  const p = state.player;

  logAll(state, economyTick(state), 'econ');
  if (state.gameOver) return;

  logAll(state, heatTick(state), 'warn');

  const world = { factions: state.factions, regions: state.regions, player: p, state: state };
  const aiLines = runFactionAI(world);
  for (const l of aiLines) log(state, l.text, 'ai');

  logAll(state, tickNPCs(state), 'ai');

  logAll(state, checkPlayerFactionCollapse(state), 'warn');
  if (state.gameOver) return;

  logAll(state, relevanceTick(state), 'warn');
  if (state.gameOver) return;

  /* Incident roll — may block the next turn on a choice. */
  const inc = rollIncident(state);
  if (inc) {
    const body = typeof inc.body === 'function' ? inc.body(state) : inc.body;
    if (inc.choices) {
      state.pendingIncident = { id: inc.id, title: inc.title, body: body, choices: inc.choices };
    } else {
      log(state, `${inc.title}: ${body}`, 'incident');
      logAll(state, inc.auto(state), 'incident');
    }
  }

  state.week++;

  if (p.imprisonedWeeks > 0) {
    p.imprisonedWeeks--;
    if (p.imprisonedWeeks === 0) log(state, 'You are released. Nobody explains why, either time.', 'sys');
  }
}

/* Player takes an action, then the week turns. */
function takeAction(state, actionId, payload) {
  if (state.gameOver || state.pendingIncident) return null;
  const p = state.player;

  if (p.imprisonedWeeks > 0) {
    log(state, `Held. ${p.imprisonedWeeks} week(s) remaining. Nothing to do but wait.`, 'warn');
    advanceWeek(state);
    return { ok: false, lines: [] };
  }

  const action = ACTIONS.find(a => a.id === actionId);
  if (!action || !action.available(state)) return null;

  if (action.cost && p.money < action.cost) {
    log(state, `Insufficient funds: ${action.label} requires ${action.cost}cr.`, 'warn');
    return { ok: false, lines: [], noTurn: true };
  }

  log(state, `>> ${action.label}`, 'action');
  let result;
  switch (actionId) {
    case 'assassinate': result = resolveAssassination(state, payload); break;
    case 'bribe':       result = resolveBribe(state, payload); break;
    case 'blackmail':   result = resolveBlackmail(state, payload); break;
    case 'petition_join': result = joinFaction(state, payload); break;
    case 'return_faction': result = returnToFaction(state, payload); break;
    case 'found_faction': result = foundFaction(state, payload); break;
    default:            result = action.resolve(state); break;
  }
  logAll(state, result.lines, result.ok ? 'good' : 'bad');

  if (!state.gameOver) advanceWeek(state);
  return result;
}

/* Resolve a blocking incident choice, which does NOT consume the week — the
 * incident already happened at the end of the previous week. */
function resolveIncidentChoice(state, index) {
  if (!state.pendingIncident) return;
  const inc = state.pendingIncident;
  log(state, `${inc.title}: ${inc.body}`, 'incident');
  const choice = inc.choices[index];
  log(state, `>> ${choice.label}`, 'action');
  const lines = choice.outcome(state) || [];
  logAll(state, lines, 'incident');
  state.pendingIncident = null;
}
