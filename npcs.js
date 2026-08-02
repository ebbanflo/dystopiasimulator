/* =============================================================================
 * npcs.js — Named faction members, the per-faction hierarchy, and the churn
 * that happens when someone above you dies, defects, or is promoted.
 *
 * Every faction is populated with a real roster of named NPCs at fixed rank
 * indices. Assassination (feature 5) targets ENTRIES IN THIS ROSTER, not an
 * abstraction, and a successful kill actually vacates that slot and promotes
 * whoever is underneath.
 * ========================================================================= */

const NPC_FIRST = [
  'Ori', 'Mara', 'Delph', 'Sana', 'Kesh', 'Ivo', 'Tamsin', 'Rue', 'Callas',
  'Nadi', 'Juno', 'Ezra', 'Halbe', 'Wren', 'Osric', 'Tallow', 'Maud', 'Fen',
  'Corin', 'Adaeze', 'Sol', 'Petra', 'Bram', 'Nkechi', 'Vasa', 'Iker', 'Roone',
  'Lise', 'Otho', 'Yara', 'Dov', 'Marisol', 'Quen', 'Absalom', 'Tirza', 'Nils',
];

const NPC_LAST = [
  'Ferrand', 'Okonjo', 'Vance', 'Delacroix', 'Rask', 'Ibarra', 'Chen-Mott',
  'Halloway', 'Odum', 'Krayle', 'Sisk', 'Adeyemi', 'Voss', 'Pryor', 'Mattingly',
  'Enrile', 'Duquesne', 'Barrow', 'Nakashima', 'Vint', 'Salas', 'Oyelaran',
  'Trent', 'Kovic', 'Ashgrove', 'Bell-Hastings', 'Moreno', 'Strand', 'Uche',
  'Dray', 'Pell', 'Kirtland', 'Sombra', 'Wexley', 'Ngo', 'Farro',
];

const NPC_TRAITS = [
  { id: 'paranoid',   label: 'Paranoid',    note: 'Sleeps in a different bed every night. Harder to kill.',        killMod: -0.14, bribeMod: -0.10 },
  { id: 'greedy',     label: 'Greedy',      note: 'Has never refused money on principle.',                          killMod: 0.00,  bribeMod: 0.22 },
  { id: 'beloved',    label: 'Beloved',     note: 'Killing them costs you standing across the faction.',            killMod: -0.04, bribeMod: -0.05 },
  { id: 'brutal',     label: 'Brutal',      note: 'Retaliates disproportionately. Failure against them is worse.',  killMod: -0.06, bribeMod: -0.12 },
  { id: 'sloppy',     label: 'Sloppy',      note: 'Drinks with strangers. Easy to reach.',                          killMod: 0.15,  bribeMod: 0.06 },
  { id: 'ideologue',  label: 'Ideologue',   note: 'Cannot be bought at any price.',                                 killMod: 0.02,  bribeMod: -0.40 },
  { id: 'compromised',label: 'Compromised', note: 'Already has something to hide.',                                 killMod: 0.05,  bribeMod: 0.18 },
  { id: 'guarded',    label: 'Guarded',     note: 'Never travels without four rifles.',                             killMod: -0.18, bribeMod: 0.00 },
];

let NPC_ID_COUNTER = 1;

function makeNPC(factionId, rankIndex, usedNames) {
  let name;
  let guard = 0;
  do {
    name = RNG.pick(NPC_FIRST) + ' ' + RNG.pick(NPC_LAST);
    guard++;
  } while (usedNames.has(name) && guard < 60);
  usedNames.add(name);

  return {
    id: 'npc' + (NPC_ID_COUNTER++),
    name: name,
    factionId: factionId,
    rankIndex: rankIndex,
    trait: RNG.pick(NPC_TRAITS),
    loyalty: RNG.int(25, 90),        // resistance to defecting with the player
    corruptionTaste: RNG.int(0, 100),// willingness to engage in bribery
    alive: true,
    isRival: false,                  // hostile successor (feature 7)
    grudge: 0,                       // toward the player, 0..100
    note: null,                      // one-line procedural detail
  };
}

/* How many NPCs sit at each rank index (0 = bottom). Pyramid-shaped. */
const RANK_POPULATION = [5, 4, 3, 3, 2, 1];

function generateHierarchy(faction, usedNames) {
  const roster = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    for (let i = 0; i < RANK_POPULATION[r]; i++) {
      roster.push(makeNPC(faction.id, r, usedNames));
    }
  }
  return roster;
}

function generateAllNPCs(factions) {
  const usedNames = new Set();
  let all = [];
  for (const f of Object.values(factions)) {
    const roster = generateHierarchy(f, usedNames);
    f.memberIds = roster.map(n => n.id);
    all = all.concat(roster);
  }
  return all;
}

/* --- Queries ------------------------------------------------------------- */

function npcsOfFaction(state, factionId, opts) {
  const o = opts || {};
  return state.npcs.filter(n =>
    n.factionId === factionId &&
    (o.includeDead ? true : n.alive));
}

function npcById(state, id) {
  return state.npcs.find(n => n.id === id) || null;
}

/* Everyone in the player's faction ranked strictly above them — the legal
 * target pool for assassination (feature 5). */
function assassinationTargets(state) {
  const p = state.player;
  if (!p.factionId || p.rankIndex === null) return [];
  return npcsOfFaction(state, p.factionId)
    .filter(n => n.rankIndex > p.rankIndex)
    .sort((a, b) => a.rankIndex - b.rankIndex || a.name.localeCompare(b.name));
}

/* Bribery/blackmail can target anyone at or above the player in their faction. */
function corruptionTargets(state) {
  const p = state.player;
  if (!p.factionId || p.rankIndex === null) return [];
  return npcsOfFaction(state, p.factionId)
    .filter(n => n.rankIndex >= p.rankIndex)
    .sort((a, b) => a.rankIndex - b.rankIndex || a.name.localeCompare(b.name));
}

/* --- Mutations ----------------------------------------------------------- */

/* Kill an NPC and cascade a promotion into the vacancy. Returns log lines. */
function killNPC(state, npc) {
  const lines = [];
  npc.alive = false;
  lines.push(`${npc.name} is dead.`);

  /* Promote the highest-loyalty survivor from the rank directly below. */
  if (npc.rankIndex > 0) {
    const below = npcsOfFaction(state, npc.factionId)
      .filter(n => n.rankIndex === npc.rankIndex - 1)
      .sort((a, b) => b.loyalty - a.loyalty);
    if (below.length) {
      const promoted = below[0];
      promoted.rankIndex = npc.rankIndex;
      lines.push(`${promoted.name} is elevated into the vacancy.`);
    }
  }
  return lines;
}

/* Someone fills the player's old seat and hates them for coming back
 * (feature 7). Called when the player leaves a faction. */
function installSuccessor(state, factionId, rankIndex) {
  const usedNames = new Set(state.npcs.map(n => n.name));
  const successor = makeNPC(factionId, rankIndex, usedNames);
  successor.isRival = true;
  successor.grudge = RNG.int(45, 80);
  successor.loyalty = RNG.int(60, 95);
  successor.note = 'Holds the seat you vacated. Considers you a problem to be filed.';
  state.npcs.push(successor);
  const f = state.factions[factionId];
  if (f) f.memberIds.push(successor.id);
  return successor;
}

/* Per-member defection roll when the player founds a faction (feature 6).
 * Deliberately NOT all-or-nothing: every member is rolled individually. */
function rollDefections(state, oldFactionId, newFaction) {
  const p = state.player;
  const rep = p.reputation[oldFactionId] || 0;
  const results = { moved: [], stayed: 0 };
  const pool = npcsOfFaction(state, oldFactionId);

  for (const npc of pool) {
    let chance = CONFIG.DEFECT_BASE_CHANCE + (rep * CONFIG.DEFECT_REP_SCALE);
    const rankGap = npc.rankIndex - (p.rankIndex === null ? 0 : p.rankIndex);
    if (rankGap > 0) chance -= rankGap * CONFIG.DEFECT_RANK_PENALTY;
    /* Loyalty to the old flag is the main brake. */
    chance -= (npc.loyalty - 50) * 0.004;
    if (npc.isRival) chance = 0;              // your rival never follows you
    chance = clamp(chance, 0, CONFIG.DEFECT_MAX_CHANCE);

    if (RNG.chance(chance)) {
      npc.factionId = newFaction.id;
      /* Rank is preserved but capped just under the player (Founder = 5). */
      npc.rankIndex = Math.min(npc.rankIndex, RANK_COUNT - 2);
      npc.loyalty = clamp(npc.loyalty + 10, 0, 100);
      results.moved.push(npc);
    } else {
      results.stayed++;
    }
  }

  const oldF = state.factions[oldFactionId];
  if (oldF) {
    oldF.memberIds = oldF.memberIds.filter(id => {
      const n = npcById(state, id);
      return n && n.factionId === oldFactionId;
    });
    /* Losing bodies costs the old faction real power. */
    oldF.power = clamp(oldF.power - Math.min(20, results.moved.length * 2), 0, 100);
  }
  newFaction.memberIds = results.moved.map(n => n.id);

  return results;
}

/* Weekly NPC churn: rivals nurse grudges, the ambitious jockey, some die of
 * the ordinary causes of a collapsed country. */
function tickNPCs(state) {
  const lines = [];
  for (const npc of state.npcs) {
    if (!npc.alive) continue;

    if (npc.isRival && RNG.chance(0.08)) {
      npc.grudge = clamp(npc.grudge + RNG.int(1, 5), 0, 100);
    }

    /* Attrition: the higher you sit, the more people want your seat. */
    const attrition = 0.0015 + npc.rankIndex * 0.0009;
    if (RNG.chance(attrition)) {
      const cause = RNG.pick([
        'found in a drainage channel',
        'killed in a checkpoint dispute',
        'dead of a fever the clinics stopped treating',
        'shot by their own escort',
        'lost with a convoy that never arrived',
      ]);
      lines.push(`${npc.name} (${state.factions[npc.factionId] ? state.factions[npc.factionId].def.short : '???'}) — ${cause}.`);
      lines.push.apply(lines, killNPC(state, npc));
    }
  }
  return lines;
}
