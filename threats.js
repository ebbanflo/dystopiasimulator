/* =============================================================================
 * threats.js — THE WORLD HITS BACK.
 *
 * Climbing by corruption used to be one-directional: the player could bribe,
 * blackmail and kill their way upward and the only risk was their own failure
 * roll. This module makes the hierarchy reciprocal. Every week, three sources
 * independently roll to see whether somebody moves against the player:
 *
 *   1. GRUDGE      — a named NPC the player wronged (survived blackmail, was
 *                    bribed then betrayed, survived an assassination attempt).
 *   2. FACTION     — an organisation whose hostility toward the player is high
 *                    enough to sanction a hit rather than a fine.
 *   3. RANK ENVY   — the people directly below the player, who want the seat
 *                    the player is sitting in. The higher you climb, the more
 *                    of them there are.
 *
 * An attempt is not automatically fatal: it resolves on a survival roll shaped
 * by territory (people watching your door), money (better doors), the
 * attacker's rank, and the player's heat.
 * ========================================================================= */

/* Flavour tables for how an attempt actually arrives. */
const ATTEMPT_METHODS = [
  { id: 'shooter',  setup: 'A shooter is waiting in the stairwell of your building.' },
  { id: 'car',      setup: 'A vehicle with no plates mounts the kerb as you cross the depot yard.' },
  { id: 'poison',   setup: 'The water in your billet tastes wrong four minutes before you feel it.' },
  { id: 'knife',    setup: 'Someone walks into you in a ration queue and you feel the blade before the shove.' },
  { id: 'device',   setup: 'A device is wired to the underside of your vehicle. It is not a good device.' },
  { id: 'ambush',   setup: 'Three men are standing in the road where three men have no reason to stand.' },
  { id: 'sniper',   setup: 'The window behind you comes apart before you hear the shot.' },
  { id: 'fire',     setup: 'Your billet door is chained from the outside and the stairwell is already burning.' },
];

const SURVIVAL_FLAVOUR = [
  'You are somewhere else that night, for no reason you can take credit for.',
  'They are early, and being early is the same as being wrong.',
  'One of your people sees it coming and does not survive seeing it.',
  'It goes wrong for them in a way that leaves a great deal of evidence.',
  'You are faster than a man who has never had to be fast.',
  'The device is badly wired. The person who wired it is found a week later.',
];

/* Survival odds for an attempt from an attacker at `attackerRank`. */
function threatSurvivalOdds(state, attackerRank) {
  const p = state.player;
  return clamp(
    CONFIG.THREAT_SURVIVE_BASE
    + p.territory * CONFIG.THREAT_SURVIVE_PER_TERRITORY
    + Math.max(0, p.money / 10000) * CONFIG.THREAT_SURVIVE_PER_10K
    - (attackerRank || 0) * CONFIG.THREAT_SURVIVE_RANK_PENALTY
    - p.heat * 0.0012,
    CONFIG.THREAT_SURVIVE_MIN, CONFIG.THREAT_SURVIVE_MAX);
}

/* Resolve one attempt. `source` describes who sent it. Returns log lines. */
function resolveAttempt(state, source) {
  const p = state.player;
  const method = RNG.pick(ATTEMPT_METHODS);
  const lines = [];
  const odds = threatSurvivalOdds(state, source.rank);

  lines.push('[ATTEMPT ON YOUR LIFE — ' + source.label.toUpperCase() + ']');
  lines.push(method.setup);
  lines.push(`[SURVIVAL CHECK: ${Math.round(odds * 100)}%]`);

  if (!RNG.chance(odds)) {
    killPlayer(state, source.deathCause);
    return lines;
  }

  lines.push(RNG.pick(SURVIVAL_FLAVOUR));
  state.weekFlags.attacked = true;

  /* Surviving is expensive. Something is always paid. */
  const roll = RNG.next();
  if (roll < 0.35) {
    const cost = RNG.int(400, 2200);
    addMoney(state, -cost);
    lines.push(`Clinic fees, a new billet, and two people who need paying off: ${cost}cr.`);
  } else if (roll < 0.60 && p.territory > 0) {
    const lost = Math.min(p.territory, RNG.int(1, 4));
    addTerritory(state, -lost);
    lines.push(`You go to ground for six days. ${lost} of your wards are taken while you are gone.`);
  } else if (roll < 0.80) {
    p.imprisonedWeeks = Math.max(p.imprisonedWeeks, RNG.int(1, 2));
    addHeat(state, 8);
    lines.push('You are held "for your own protection" while the incident is filed. Nobody files it.');
  } else {
    addHeat(state, 12);
    lines.push('You survive it publicly, which is worse. Everyone now knows you are worth killing.');
  }

  /* Identification: sometimes you learn who paid for it. That is leverage. */
  if (source.npc && RNG.chance(0.55)) {
    source.npc.grudge = clamp(source.npc.grudge + 15, 0, 100);
    source.npc.exposed = true;
    lines.push(`The courier talks. ${source.npc.name} paid for it, and now knows you know.`);
  } else if (source.faction && RNG.chance(0.5)) {
    lines.push(`It was ${source.faction.def.short} money. They will not admit it and do not need to.`);
  } else {
    lines.push('You never learn who paid for it. That is the ordinary case.');
  }

  /* The attacker occasionally dies in the attempt, which clears the threat. */
  if (source.npc && RNG.chance(0.15)) {
    lines.push(`${source.npc.name} was closer to it than they should have been.`);
    lines.push.apply(lines, killNPC(state, source.npc));
  }
  return lines;
}

/* --- The three sources, rolled independently each week ------------------- */

function grudgeThreat(state) {
  /* Anyone alive who hates the player enough to spend money on it. */
  const holders = state.npcs.filter(n =>
    n.alive && n.grudge >= CONFIG.THREAT_GRUDGE_MIN);
  if (!holders.length) return null;

  /* The angriest person is the most likely mover, but not the only one. */
  const npc = RNG.weighted(holders.map(n => ({ w: n.grudge - CONFIG.THREAT_GRUDGE_MIN + 1, npc: n }))).npc;
  const chance = clamp(
    npc.grudge * CONFIG.THREAT_GRUDGE_SCALE + state.player.heat * CONFIG.THREAT_HEAT_SCALE,
    0, CONFIG.THREAT_MAX_WEEKLY_CHANCE);
  if (!RNG.chance(chance)) return null;

  const f = state.factions[npc.factionId];
  return {
    label: 'personal',
    rank: npc.rankIndex,
    npc: npc,
    deathCause: `killed on the order of ${npc.name}${f ? ' of ' + f.def.short : ''}`,
  };
}

function factionThreat(state) {
  const hostile = Object.values(state.factions).filter(f =>
    !f.defunct && f.playerHostility >= CONFIG.THREAT_FACTION_MIN_HOSTILITY);
  if (!hostile.length) return null;

  const f = RNG.weighted(hostile.map(x => ({ w: x.playerHostility, f: x }))).f;
  /* Militant organisations reach for this option sooner. */
  const chance = clamp(
    f.playerHostility * CONFIG.THREAT_FACTION_SCALE * (0.6 + f.militancy / 100)
    + state.player.heat * CONFIG.THREAT_HEAT_SCALE,
    0, CONFIG.THREAT_MAX_WEEKLY_CHANCE);
  if (!RNG.chance(chance)) return null;

  return {
    label: f.def.short + ' sanction',
    rank: 3,
    faction: f,
    deathCause: `killed by ${f.def.name} on a standing sanction`,
  };
}

function rankEnvyThreat(state) {
  const p = state.player;
  if (!p.factionId || p.rankIndex === null || p.rankIndex < 2) return null;
  const below = npcsOfFaction(state, p.factionId)
    .filter(n => n.rankIndex === p.rankIndex - 1 || n.rankIndex === p.rankIndex);
  if (!below.length) return null;

  /* Corrupt factions promote by removal; disciplined ones do it on paper. */
  const f = state.factions[p.factionId];
  const chance = clamp(
    p.rankIndex * CONFIG.THREAT_RANK_ENVY_BASE * (0.5 + f.corruption / 100)
    + p.heat * CONFIG.THREAT_HEAT_SCALE * 0.5,
    0, CONFIG.THREAT_MAX_WEEKLY_CHANCE);
  if (!RNG.chance(chance)) return null;

  /* The least loyal candidate is the one who moves. */
  const npc = below.sort((a, b) => a.loyalty - b.loyalty)[0];
  npc.grudge = clamp(npc.grudge + 20, 0, 100);
  return {
    label: 'internal',
    rank: npc.rankIndex,
    npc: npc,
    deathCause: `killed by ${npc.name}, who wanted the seat`,
  };
}

/* Run all three sources for the week. At most ONE attempt lands per week —
 * the world is dangerous, not absurd. Returns log lines. */
function threatTick(state) {
  if (!state.player.alive || state.gameOver) return [];
  /* You cannot be reached in a holding block; the attempt waits for you. */
  if (state.player.imprisonedWeeks > 0) return [];

  const sources = [grudgeThreat(state), factionThreat(state), rankEnvyThreat(state)]
    .filter(Boolean);
  if (!sources.length) return [];

  const chosen = RNG.pick(sources);
  return resolveAttempt(state, chosen);
}

/* Early-warning signals: cheap, atmospheric, and occasionally accurate.
 * Fires on weeks where an attempt did NOT happen but pressure is building. */
function threatWarning(state) {
  const p = state.player;
  if (!p.alive) return null;
  const maxGrudge = state.npcs.reduce((m, n) =>
    (n.alive && n.grudge > m) ? n.grudge : m, 0);
  const maxHostility = Object.values(state.factions).reduce((m, f) =>
    (!f.defunct && f.playerHostility > m) ? f.playerHostility : m, 0);
  const pressure = Math.max(maxGrudge, maxHostility);
  if (pressure < 40 || !RNG.chance(0.14)) return null;

  return RNG.pick([
    'The same vehicle has been parked on your street four nights running.',
    'A woman you do not know asks your neighbour which floor you live on.',
    'Your name is mispronounced by a stranger who then apologises too much.',
    'Someone has been through your billet. Nothing is missing, which is the point.',
    'A courier delivers an envelope containing a photograph of your front door.',
    'Two of your people do not come in this week and do not answer.',
    'The line boss stops talking when you enter and starts again when you leave.',
  ]);
}
