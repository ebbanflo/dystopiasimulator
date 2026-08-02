/* =============================================================================
 * factions.js — The four fixed factions, their per-playthrough procedural
 * starting state, and the lightweight rules-based faction AI (feature 8).
 *
 * IDENTITY IS FIXED. Every playthrough has exactly these four founding powers,
 * with the same names, crests, sector affinities, and rank ladders. What varies
 * per run is STATE: who is winning, who is corrupt, who is suppressing
 * elections, and who currently controls which region's resources.
 *
 * The AI is deliberately a small set of NAMED rules per faction, each of which
 * is a readable if/then. There is no hidden global scoring function.
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * FACTION SKELETON (fixed identity)
 * ------------------------------------------------------------------------- */
const FACTION_DEFS = [
  {
    id: 'concord',
    name: 'THE CONCORD OF WELLS',
    short: 'CONCORD',
    crest: '◈',            // ◈
    sector: 'water',
    creed: 'Water is a contract. Contracts are enforced.',
    blurb:
      'A technocratic water cartel grown out of the old municipal utility ' +
      'boards. Runs desalination, aquifer metering, and the ration ledgers. ' +
      'Obsessed with paperwork; will kill you over a paragraph.',
    rankTitles: [
      'Ledger Hand',      // 0
      'Meter Warden',     // 1
      'Line Adjudicator', // 2
      'Aquifer Steward',  // 3
      'Contract Justice', // 4
      'First Hydrarch',   // 5
    ],
    /* Baseline temperament, nudged procedurally at world-gen. */
    base: { power: 55, corruption: 40, militancy: 30, legalism: 85 },
  },
  {
    id: 'marshals',
    name: 'THE GRID MARSHALS',
    short: 'MARSHALS',
    crest: '▲',            // ▲
    sector: 'energy',
    creed: 'The lights stay on. Everything else is negotiable.',
    blurb:
      'A paramilitary utility company. Started as substation security, ended ' +
      'as the only body in the country with a functioning chain of command. ' +
      'Answers questions with convoys.',
    rankTitles: [
      'Splice Hand',
      'Line Marshal',
      'Substation Captain',
      'Corridor Colonel',
      'Grid Commandant',
      'Marshal General',
    ],
    base: { power: 62, corruption: 30, militancy: 85, legalism: 35 },
  },
  {
    id: 'greenline',
    name: 'THE GREENLINE SYNDICATE',
    short: 'GREENLINE',
    crest: '⬢',            // ⬢
    sector: 'food',
    creed: 'Nobody starves in our shadow. Nobody leaves it, either.',
    blurb:
      'Half agricultural cooperative, half protection racket. Controls the ' +
      'protein stacks and seed vaults, and the calorie boards that decide ' +
      'which districts eat this quarter.',
    rankTitles: [
      'Stack Picker',
      'Vault Keeper',
      'Calorie Broker',
      'Harvest Boss',
      'Syndic',
      'Grand Syndic',
    ],
    base: { power: 50, corruption: 65, militancy: 45, legalism: 40 },
  },
  {
    id: 'remnant',
    name: 'THE CIVIL REMNANT',
    short: 'REMNANT',
    crest: '✚',            // ✚
    sector: 'civil',
    creed: 'There was a republic. There is a filing system. It is the same thing.',
    blurb:
      'What is left of the federal apparatus: a walled municipality, a ' +
      'printing press, an election bureau, and an archive nobody is allowed ' +
      'to read. Trades in legitimacy because it has nothing else.',
    rankTitles: [
      'Clerk of Record',
      'Deputy Registrar',
      'Commissioner',
      'Bureau Director',
      'Under-Secretary',
      'Provisional Chair',
    ],
    base: { power: 44, corruption: 55, militancy: 20, legalism: 95 },
  },
];

/* Player-founded factions get this rank ladder (feature 6). */
const PLAYER_FACTION_RANK_TITLES = [
  'Signatory',
  'Enforcer',
  'Lieutenant',
  'Captain',
  'Second',
  'Founder',
];

const PLAYER_FACTION_CRESTS = ['✦', '◆', '✹', '●', '✧'];

/* ---------------------------------------------------------------------------
 * WORLD GENERATION — procedural *state* only.
 * ------------------------------------------------------------------------- */

/* Procedural history seeds, used for the dossier's "PRIOR DECADE" section. */
const HISTORY_EVENTS = [
  '{A} broke the {R} strike with live rounds. The dead are still uncounted.',
  '{A} and {B} signed the {R} Accords, then both violated them inside a year.',
  'The {R} aquifer failed. {A} was blamed. {A} blamed the weather.',
  '{A} annexed three {R} substations during a blackout and never gave them back.',
  'An election in {R} was annulled by {A} for "irregularities in the count".',
  '{A} bought the {R} calorie board outright. The minutes were published as fiction.',
  'A {B} convoy was ambushed in {R}. {A} denies involvement in writing.',
  '{A} executed its own {R} leadership on corruption charges. Nobody believed them.',
  'Famine in {R} killed a district. {A} shipped grain, then invoiced the survivors.',
  '{A} declared {R} a special administrative zone. The zone has no exit permits.',
];

function generateFactionState(def, regions) {
  const jitter = (v, spread) => clamp(Math.round(v + RNG.float(-spread, spread)), 0, 100);
  return {
    id: def.id,
    def: def,
    isPlayerFaction: false,
    defunct: false,

    power: jitter(def.base.power, 18),
    corruption: jitter(def.base.corruption, 25),
    militancy: jitter(def.base.militancy, 15),
    legalism: jitter(def.base.legalism, 10),

    /* Per-playthrough political posture (feature 1). */
    suppressingElections: false,   // assigned below, exactly 0-2 factions
    ascendant: false,              // the current "winning" faction
    unrestPressure: RNG.int(0, 25),

    /* Region control: regionId -> 0..100 share of that region. */
    control: {},

    /* Relations toward other factions: -100 hostile .. +100 allied. */
    relations: {},

    /* Toward the player specifically. */
    playerHostility: 0,            // 0..100; >=60 means active retaliation
    playerDebt: 0,                 // favors owed to the player; spent on gifts

    /* Bookkeeping for AI narration. */
    lastRuleFired: null,
    memberIds: [],
  };
}

function initWorldFactions(regions) {
  const factions = {};
  for (const def of FACTION_DEFS) {
    factions[def.id] = generateFactionState(def, regions);
  }

  /* --- Distribute region control procedurally --- */
  for (const region of regions) {
    /* Each region is split among 2-4 factions; the rest is "unaligned". */
    const contenders = RNG.sample(FACTION_DEFS.map(d => d.id), RNG.int(2, 4));
    let remaining = 100;
    contenders.forEach((fid, i) => {
      const isLast = i === contenders.length - 1;
      const share = isLast
        ? Math.max(0, remaining - RNG.int(0, 20))
        : RNG.int(8, Math.max(9, Math.floor(remaining / 2)));
      factions[fid].control[region.id] = share;
      remaining -= share;
    });
    for (const def of FACTION_DEFS) {
      if (factions[def.id].control[region.id] === undefined) {
        factions[def.id].control[region.id] = 0;
      }
    }
  }

  /* --- Relations: mostly frosty, one ally pair, one blood feud --- */
  for (const a of FACTION_DEFS) {
    for (const b of FACTION_DEFS) {
      if (a.id === b.id) continue;
      factions[a.id].relations[b.id] = RNG.int(-35, 15);
    }
  }
  const ids = FACTION_DEFS.map(d => d.id);
  const allyPair = RNG.sample(ids, 2);
  factions[allyPair[0]].relations[allyPair[1]] = RNG.int(35, 65);
  factions[allyPair[1]].relations[allyPair[0]] = RNG.int(35, 65);
  const feudPair = RNG.sample(ids.filter(i => !allyPair.includes(i)).concat(RNG.sample(ids, 1)), 2);
  if (feudPair.length === 2 && feudPair[0] !== feudPair[1]) {
    factions[feudPair[0]].relations[feudPair[1]] = RNG.int(-95, -70);
    factions[feudPair[1]].relations[feudPair[0]] = RNG.int(-95, -70);
  }

  /* --- Election suppression: 1-2 factions this run (feature 1) --- */
  const suppressors = RNG.sample(ids, RNG.int(1, 2));
  for (const sid of suppressors) factions[sid].suppressingElections = true;

  /* --- Ascendancy: whoever has the highest power gets flagged --- */
  recomputeAscendancy(factions);

  return factions;
}

function recomputeAscendancy(factions) {
  let best = null;
  for (const f of Object.values(factions)) {
    if (f.defunct) { f.ascendant = false; continue; }
    f.ascendant = false;
    if (!best || f.power > best.power) best = f;
  }
  if (best) best.ascendant = true;
}

function generateProceduralHistory(factions, regions, count) {
  const out = [];
  const ids = Object.keys(factions);
  const used = new Set();
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const tmpl = RNG.pick(HISTORY_EVENTS);
    const pair = RNG.sample(ids, 2);
    const region = RNG.pick(regions);
    const line = tmpl
      .replace(/\{A\}/g, factions[pair[0]].def.name)
      .replace(/\{B\}/g, factions[pair[1]].def.name)
      .replace(/\{R\}/g, region.name);
    if (used.has(line)) continue;
    used.add(line);
    out.push({ year: 0, text: line });
  }
  /* Assign ascending years across the prior decade. */
  const startYear = CONFIG.START_YEAR - out.length - 1;
  out.forEach((e, i) => { e.year = startYear + i; });
  return out;
}

/* ---------------------------------------------------------------------------
 * FACTION AI (feature 8)
 *
 * Universal rules run for every faction. Each faction then has its own small
 * set of named signature rules. Rules fire at most once per week, in order,
 * and each returns a short log line (or null when it does not apply).
 *
 * Signature: rule.run(faction, world) -> string|null
 *   world = { factions, regions, player, state }
 * ------------------------------------------------------------------------- */

function totalControl(faction) {
  let t = 0;
  for (const k in faction.control) t += faction.control[k];
  return t;
}

function strongestRegionFor(faction) {
  let best = null;
  for (const rid in faction.control) {
    if (!best || faction.control[rid] > faction.control[best]) best = rid;
  }
  return best;
}

function weakestHeldRegionFor(faction) {
  let worst = null;
  for (const rid in faction.control) {
    if (faction.control[rid] <= 0) continue;
    if (!worst || faction.control[rid] < faction.control[worst]) worst = rid;
  }
  return worst;
}

function regionName(regions, rid) {
  const r = regions.find(x => x.id === rid);
  return r ? r.name : rid;
}

/* Move `amount` of control in `rid` from `loser` to `winner`. */
function transferControl(winner, loser, rid, amount) {
  const take = Math.min(amount, loser.control[rid] || 0);
  if (take <= 0) return 0;
  loser.control[rid] -= take;
  winner.control[rid] = (winner.control[rid] || 0) + take;
  return take;
}

const UNIVERSAL_RULES = [
  {
    name: 'RESOURCE MASS',
    desc: 'Power drifts toward whoever physically holds the most resource control.',
    run(f, world) {
      const total = totalControl(f);
      const target = clamp(Math.round(total / (world.regions.length * 1.0)), 0, 100);
      const delta = clamp(Math.round((target - f.power) * 0.18), -4, 4);
      if (delta === 0) return null;
      f.power = clamp(f.power + delta, 0, 100);
      return delta > 0
        ? `${f.def.short} consolidates holdings (+${delta} power).`
        : `${f.def.short} bleeds influence (${delta} power).`;
    },
  },
  {
    name: 'ROT',
    desc: 'High corruption slowly eats power; low corruption slowly accrues it.',
    run(f) {
      if (f.corruption > 70 && RNG.chance(0.35)) {
        f.power = clamp(f.power - 2, 0, 100);
        return `${f.def.short} loses another cell to embezzlement (-2 power).`;
      }
      if (f.corruption < 25 && RNG.chance(0.25)) {
        f.power = clamp(f.power + 1, 0, 100);
        return `${f.def.short} publishes clean books; recruitment ticks up (+1 power).`;
      }
      return null;
    },
  },
  {
    name: 'BORDER FRICTION',
    desc: 'Rivals (relations < -30) contest each other for turf where they overlap.',
    run(f, world) {
      const rivals = Object.values(world.factions).filter(o =>
        o.id !== f.id && !o.defunct && (f.relations[o.id] ?? 0) < -30);
      if (!rivals.length) return null;
      const rival = RNG.pick(rivals);
      const contested = world.regions.filter(r =>
        (f.control[r.id] || 0) > 4 && (rival.control[r.id] || 0) > 4);
      if (!contested.length) return null;
      if (!RNG.chance(0.4)) return null;
      const region = RNG.pick(contested);
      /* Militancy decides who takes ground. */
      const fRoll = f.militancy + RNG.int(0, 40);
      const rRoll = rival.militancy + RNG.int(0, 40);
      const amount = RNG.int(2, 6);
      if (fRoll >= rRoll) {
        const took = transferControl(f, rival, region.id, amount);
        if (!took) return null;
        f.relations[rival.id] = clamp((f.relations[rival.id] || 0) - 4, -100, 100);
        rival.relations[f.id] = clamp((rival.relations[f.id] || 0) - 8, -100, 100);
        return `${f.def.short} takes ${took} points of ${region.name} from ${rival.def.short} by force.`;
      }
      const took = transferControl(rival, f, region.id, amount);
      if (!took) return null;
      return `${rival.def.short} pushes ${f.def.short} out of ${took} points of ${region.name}.`;
    },
  },
  {
    name: 'RETALIATION',
    desc: 'Hostility toward the player converts into concrete reprisals.',
    run(f, world) {
      if (f.playerHostility < 60) {
        if (f.playerHostility > 0) f.playerHostility = clamp(f.playerHostility - 1, 0, 100);
        return null;
      }
      if (!RNG.chance(0.45)) return null;
      const p = world.player;
      /* Reprisal scales with the faction's militancy. */
      if (f.militancy > 60 && p.territory > 0) {
        const lost = Math.min(p.territory, RNG.int(2, 5));
        p.territory -= lost;
        f.playerHostility = clamp(f.playerHostility - 12, 0, 100);
        return `${f.def.short} raiders burn ${lost} points of your holdings.`;
      }
      const fine = RNG.int(400, 1600);
      p.money -= fine;
      f.playerHostility = clamp(f.playerHostility - 10, 0, 100);
      return `${f.def.short} levies ${fine}cr against you through intermediaries.`;
    },
  },
  {
    name: 'GRATITUDE',
    desc: 'Favors owed to the player are eventually paid out.',
    run(f, world) {
      if (f.playerDebt < 2) return null;
      if (!RNG.chance(0.4)) return null;
      f.playerDebt -= 2;
      const p = world.player;
      if (RNG.chance(0.5)) {
        const gift = RNG.int(300, 1400);
        p.money += gift;
        return `${f.def.short} quietly settles a favor: ${gift}cr.`;
      }
      p.reputation[f.id] = clamp((p.reputation[f.id] || 0) + 3, CONFIG.MIN_REPUTATION, CONFIG.MAX_REPUTATION);
      return `${f.def.short} puts your name in a good column (+3 standing).`;
    },
  },
];

/* Signature rules, keyed by faction id. Small, named, explicit. */
const FACTION_RULES = {
  concord: [
    {
      name: 'CONTRACT ENFORCEMENT',
      desc: 'Concord converts legalism into control in regions it already meters.',
      run(f, world) {
        if (!RNG.chance(0.3)) return null;
        const rid = strongestRegionFor(f);
        if (!rid || (f.control[rid] || 0) < 15) return null;
        const victim = Object.values(world.factions).find(o =>
          o.id !== f.id && !o.defunct && (o.control[rid] || 0) > 3);
        if (!victim) return null;
        const took = transferControl(f, victim, rid, RNG.int(1, 3));
        if (!took) return null;
        return `CONCORD wins a water-rights arbitration in ${regionName(world.regions, rid)}; ${victim.def.short} forfeits ${took}.`;
      },
    },
    {
      name: 'DROUGHT LEVERAGE',
      desc: 'When unrest is high, Concord throttles supply instead of fighting.',
      run(f, world) {
        if (f.unrestPressure < 40 || !RNG.chance(0.35)) return null;
        f.unrestPressure = clamp(f.unrestPressure - 15, 0, 100);
        f.power = clamp(f.power + 2, 0, 100);
        for (const o of Object.values(world.factions)) {
          if (o.id === f.id || o.defunct) continue;
          o.relations[f.id] = clamp((o.relations[f.id] || 0) - 3, -100, 100);
        }
        return 'CONCORD throttles ration lines to break a strike (+2 power, everyone resents it).';
      },
    },
    {
      name: 'AUDIT PURGE',
      desc: 'If corruption passes 70, Concord purges its own and resets it hard.',
      run(f) {
        if (f.corruption <= 70 || !RNG.chance(0.4)) return null;
        f.corruption = clamp(f.corruption - RNG.int(15, 30), 0, 100);
        f.power = clamp(f.power - 3, 0, 100);
        return 'CONCORD audits itself. Three Stewards are hanged from the intake tower.';
      },
    },
  ],

  marshals: [
    {
      name: 'CONVOY DOCTRINE',
      desc: 'High militancy is spent seizing turf from the weakest neighbor.',
      run(f, world) {
        if (f.militancy < 55 || !RNG.chance(0.4)) return null;
        const targets = Object.values(world.factions)
          .filter(o => o.id !== f.id && !o.defunct && totalControl(o) > 0)
          .sort((a, b) => a.power - b.power);
        if (!targets.length) return null;
        const target = targets[0];
        const rid = weakestHeldRegionFor(target);
        if (!rid) return null;
        const took = transferControl(f, target, rid, RNG.int(2, 6));
        if (!took) return null;
        target.relations[f.id] = clamp((target.relations[f.id] || 0) - 12, -100, 100);
        return `MARSHALS roll a convoy into ${regionName(world.regions, rid)}; ${target.def.short} loses ${took}.`;
      },
    },
    {
      name: 'BLACKOUT LEVER',
      desc: 'Marshals punish factions they dislike by cutting their power feed.',
      run(f, world) {
        const enemies = Object.values(world.factions).filter(o =>
          o.id !== f.id && !o.defunct && (f.relations[o.id] ?? 0) < -20);
        if (!enemies.length || !RNG.chance(0.3)) return null;
        const e = RNG.pick(enemies);
        e.power = clamp(e.power - RNG.int(2, 5), 0, 100);
        e.unrestPressure = clamp(e.unrestPressure + 8, 0, 100);
        return `MARSHALS blackout ${e.def.short} districts. Their generators are older than their leadership.`;
      },
    },
    {
      name: 'CHAIN OF COMMAND',
      desc: 'Marshals never tolerate their own corruption above 50 for long.',
      run(f) {
        if (f.corruption <= 50 || !RNG.chance(0.5)) return null;
        f.corruption = clamp(f.corruption - RNG.int(8, 18), 0, 100);
        f.militancy = clamp(f.militancy + 3, 0, 100);
        return 'MARSHALS run a field tribunal. Discipline restored the usual way.';
      },
    },
  ],

  greenline: [
    {
      name: 'CALORIE LEVERAGE',
      desc: 'Greenline buys territory instead of taking it, when corrupt enough.',
      run(f, world) {
        if (f.corruption < 45 || !RNG.chance(0.35)) return null;
        const seller = Object.values(world.factions).find(o =>
          o.id !== f.id && !o.defunct && (f.relations[o.id] ?? 0) > -40 && totalControl(o) > 10);
        if (!seller) return null;
        const rid = weakestHeldRegionFor(seller);
        if (!rid) return null;
        const took = transferControl(f, seller, rid, RNG.int(1, 4));
        if (!took) return null;
        seller.relations[f.id] = clamp((seller.relations[f.id] || 0) + 4, -100, 100);
        return `GREENLINE buys ${took} points of ${regionName(world.regions, rid)} from ${seller.def.short} in grain futures.`;
      },
    },
    {
      name: 'FAMINE PRESSURE',
      desc: 'If Greenline power drops, it manufactures a shortage to be needed again.',
      run(f, world) {
        if (f.power > 40 || !RNG.chance(0.4)) return null;
        f.power = clamp(f.power + RNG.int(2, 5), 0, 100);
        for (const o of Object.values(world.factions)) {
          if (o.defunct || o.id === f.id) continue;
          o.unrestPressure = clamp(o.unrestPressure + RNG.int(3, 9), 0, 100);
        }
        return 'GREENLINE holds back a harvest. Queues lengthen everywhere; the Syndicate is needed again.';
      },
    },
    {
      name: 'FAMILY DEBTS',
      desc: 'Greenline remembers help longer than the others do.',
      run(f, world) {
        if (f.playerDebt <= 0 || !RNG.chance(0.3)) return null;
        f.playerDebt -= 1;
        world.player.reputation[f.id] = clamp(
          (world.player.reputation[f.id] || 0) + 2,
          CONFIG.MIN_REPUTATION, CONFIG.MAX_REPUTATION);
        return 'GREENLINE sends a crate to your door with no invoice (+2 standing).';
      },
    },
  ],

  remnant: [
    {
      name: 'PAPER LEGITIMACY',
      desc: 'The Remnant gains power from any faction that tolerates elections.',
      run(f, world) {
        if (!RNG.chance(0.35)) return null;
        const tolerant = Object.values(world.factions).filter(o =>
          o.id !== f.id && !o.defunct && !o.suppressingElections);
        if (!tolerant.length) return null;
        f.power = clamp(f.power + 1 + Math.floor(tolerant.length / 2), 0, 100);
        return `REMNANT certifies ballots in ${tolerant.length} jurisdictions and calls it a mandate.`;
      },
    },
    {
      name: 'ANNULMENT',
      desc: 'If the Remnant is losing badly, it starts suppressing elections itself.',
      run(f) {
        if (f.power > 30 || f.suppressingElections || !RNG.chance(0.5)) return null;
        f.suppressingElections = true;
        f.corruption = clamp(f.corruption + 12, 0, 100);
        return 'REMNANT annuls the Palisade count "pending review". The review has no end date.';
      },
    },
    {
      name: 'PATRONAGE',
      desc: 'The Remnant allies with whoever is currently ascendant.',
      run(f, world) {
        const winner = Object.values(world.factions).find(o => o.ascendant && o.id !== f.id && !o.defunct);
        if (!winner || !RNG.chance(0.3)) return null;
        f.relations[winner.id] = clamp((f.relations[winner.id] || 0) + 8, -100, 100);
        winner.relations[f.id] = clamp((winner.relations[f.id] || 0) + 5, -100, 100);
        return `REMNANT drafts a recognition instrument favoring ${winner.def.short}.`;
      },
    },
  ],
};

/* Player-founded factions get a compact rule set of their own so the world
 * keeps simulating them when the player is not personally acting. */
const PLAYER_FACTION_RULES = [
  {
    name: 'YOUNG BLOOD',
    desc: 'A new faction grows fast where its founder holds ground, or withers.',
    run(f, world) {
      const p = world.player;
      if (p.territory >= 15 && RNG.chance(0.4)) {
        f.power = clamp(f.power + RNG.int(1, 3), 0, 100);
        return `${f.def.short} recruits off the strength of your holdings.`;
      }
      if (p.territory < 6 && RNG.chance(0.35)) {
        f.power = clamp(f.power - RNG.int(1, 3), 0, 100);
        return `${f.def.short} loses members; there is nothing to hold.`;
      }
      return null;
    },
  },
  {
    name: 'EVERY HAND AGAINST',
    desc: 'Established factions instinctively bleed a new one.',
    run(f, world) {
      const olds = Object.values(world.factions).filter(o =>
        !o.isPlayerFaction && !o.defunct && (o.relations[f.id] ?? 0) < 0);
      if (!olds.length || !RNG.chance(0.35)) return null;
      const o = RNG.pick(olds);
      const rid = weakestHeldRegionFor(f);
      if (!rid) {
        f.power = clamp(f.power - 1, 0, 100);
        return `${o.def.short} squeezes ${f.def.short} out of the supply queues.`;
      }
      const took = transferControl(o, f, rid, RNG.int(1, 4));
      if (!took) return null;
      return `${o.def.short} claws back ${took} points of ${regionName(world.regions, rid)} from ${f.def.short}.`;
    },
  },
];

/* Run one week of faction AI. Returns an array of log lines. */
function runFactionAI(world) {
  const lines = [];
  for (const f of Object.values(world.factions)) {
    if (f.defunct) continue;
    f.lastRuleFired = null;

    const ruleSet = f.isPlayerFaction
      ? PLAYER_FACTION_RULES
      : (FACTION_RULES[f.id] || []);

    /* Universal rules first, then signature rules; at most 2 lines per faction
     * per week so the report stays readable. */
    let emitted = 0;
    for (const rule of UNIVERSAL_RULES.concat(ruleSet)) {
      if (emitted >= 2) break;
      const line = rule.run(f, world);
      if (line) {
        lines.push({ rule: rule.name, faction: f.id, text: line });
        f.lastRuleFired = rule.name;
        emitted++;
      }
    }

    /* Unrest naturally builds under scarcity and decays under stability. */
    f.unrestPressure = clamp(
      f.unrestPressure + (f.corruption > 60 ? RNG.int(0, 3) : RNG.int(-2, 1)),
      0, 100);
  }
  recomputeAscendancy(world.factions);
  return lines;
}
