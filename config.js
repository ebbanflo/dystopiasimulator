/* =============================================================================
 * config.js — Tunables, world skeleton constants, and the numeric thresholds
 * referenced by the rest of the simulation.
 *
 * DESIGN NOTE (feature 2, documented choice):
 * The player ALWAYS starts unaffiliated (factionId === null, rank === null).
 * This was chosen over "lowest-rank entry into the locally dominant faction"
 * because it keeps a single consistent code path: joining a faction is an
 * ordinary in-game action with its own cost/roll, so the tutorial-ish first
 * turns and any later re-join use exactly the same resolution logic. Starting
 * inside a faction would have required a second, special-cased entry path.
 *
 * A TURN is ONE WEEK of in-game time. The calendar starts on week 1 of the
 * year 2051. Faction AI, income, upkeep, and heat decay all tick per week.
 * ========================================================================= */

const CONFIG = {
  /* ---- Build stamp -------------------------------------------------------
   * Shown in the briefing header and the game header so it is always obvious
   * which build is actually loaded. If this does not match the ?v= number on
   * the script tags in index.html, the browser is serving cached assets.
   * BUMP THIS AND THE ?v= VALUES TOGETHER whenever assets change.
   * --------------------------------------------------------------------- */
  BUILD: 'B2',

  /* ---- Time ---- */
  START_YEAR: 2051,
  WEEKS_PER_YEAR: 52,

  /* ---- Player starting stats (feature 2: everything at zero) ---- */
  START_MONEY: 0,
  START_TERRITORY: 0,
  START_REPUTATION: 0,

  /* ---- Stat ceilings, used for meter scaling ---- */
  MAX_REPUTATION: 100,
  MIN_REPUTATION: -100,
  MAX_TERRITORY: 100,
  MONEY_METER_CEILING: 50000, // meter caps visually here; money itself is uncapped

  /* ---- Weekly economy ---- */
  BASE_WEEKLY_WAGE: 180,          // sector job pay before modifiers
  WAGE_PER_TERRITORY: 26,         // extra weekly income per point of territory
  WEEKLY_UPKEEP_BASE: 90,         // food/water/filtration costs
  WEEKLY_UPKEEP_PER_TERRITORY: 11,// holding turf costs money
  DESTITUTION_LIMIT: -2500,       // below this, creditors/enforcers come for you

  /* ---- Heat: how badly the authorities/faction security want you ---- */
  HEAT_DECAY_PER_WEEK: 3,
  HEAT_ARREST_THRESHOLD: 70,      // above this, a weekly arrest roll happens
  HEAT_ARREST_CHANCE: 0.22,

  /* ---- FACTION FOUNDING THRESHOLDS (feature 6) --------------------------
   * All three must be met simultaneously, plus the reputation figure is with
   * the player's CURRENT faction (you found a faction by splitting one, not
   * by shouting into the void). These numbers are deliberately reachable in
   * roughly 60-100 weeks of focused play.
   * ------------------------------------------------------------------- */
  FOUND_MONEY_REQ: 25000,
  FOUND_REPUTATION_REQ: 60,
  FOUND_TERRITORY_REQ: 20,
  FOUND_COST_MONEY: 15000,        // spent on founding; the rest is your war chest
  FOUND_MIN_RANK_INDEX: 2,        // must be at least this deep in a hierarchy

  /* ---- Defection rolls when founding (per-member, feature 6) ---- */
  DEFECT_BASE_CHANCE: 0.05,
  DEFECT_REP_SCALE: 0.006,        // + this per point of player rep with old faction
  DEFECT_RANK_PENALTY: 0.045,     // - this per rank the member is ABOVE the player
  DEFECT_MAX_CHANCE: 0.72,

  /* ---- Player-faction health (feature 9) ---- */
  PLAYER_FACTION_START_POWER: 12,
  PLAYER_FACTION_FAIL_POWER: 4,   // at/below this, the faction is collapsing
  /* Tribalism: when your own faction fails or you abandon it, you are hunted. */
  FACTION_FAILURE_DEATH_CHANCE: 0.35,
  FACTION_ABANDON_DEATH_CHANCE: 0.20,

  /* ---- Assassination (feature 5) ---- */
  ASSASSINATION_BASE_COST: 1800,      // + per-rank scaling, see game.js
  ASSASSINATION_COST_PER_RANK: 1400,
  ASSASSINATION_BASE_CHANCE: 0.62,
  ASSASSINATION_RANK_GAP_PENALTY: 0.11, // per rank the target is above you
  ASSASSINATION_REP_BONUS: 0.0018,      // per point of rep with the faction
  ASSASSINATION_TERRITORY_BONUS: 0.004, // per point of territory (muscle/eyes)
  ASSASSINATION_MIN_CHANCE: 0.06,
  ASSASSINATION_MAX_CHANCE: 0.88,
  ASSASSINATION_HEAT: 26,

  /* ---- Relevance / soft loss (the non-death ending) ---- */
  IRRELEVANCE_WEEKS: 26,          // weeks spent with no faction, no territory,
  IRRELEVANCE_MAX_MONEY: 1200,    // and under this much money => you fade out
};

/* ---------------------------------------------------------------------------
 * RANKS — shared ladder shape across all factions. Each faction supplies its
 * own rank *titles* (see factions.js); the index is what the math uses.
 * ------------------------------------------------------------------------- */
const RANK_COUNT = 6;

/* Reputation required (with that faction) to hold each rank index. */
const RANK_REP_REQ = [0, 12, 28, 48, 70, 88];

/* ---------------------------------------------------------------------------
 * REGIONS — fixed skeleton, identical every playthrough. Only the *state*
 * (who controls what) is procedural. `sectors` limits the player's opening
 * job choice (feature 2).
 * ------------------------------------------------------------------------- */
const REGIONS = [
  {
    id: 'saltline',
    name: 'THE SALTLINE',
    blurb: 'Desalination shelf on the drowned Gulf coast. Brine stink, ' +
           'company scrip, and a pump strike every other season.',
    sectors: ['water', 'food'],
    baseTerritory: 34,
  },
  {
    id: 'ashfork',
    name: 'ASHFORK BASIN',
    blurb: 'Burned interior rangeland running on salvaged solar and diesel. ' +
           'Nobody here has seen a functioning court in eleven years.',
    sectors: ['energy', 'food'],
    baseTerritory: 28,
  },
  {
    id: 'kestrel',
    name: 'KESTREL CORRIDOR',
    blurb: 'The old northeast rail spine. Grid substations, checkpoint tolls, ' +
           'and the last three newspapers in the country.',
    sectors: ['energy', 'water'],
    baseTerritory: 41,
  },
  {
    id: 'greatlow',
    name: 'THE GREAT LOW',
    blurb: 'Subsided farmland below the levee line. Vertical-stack protein ' +
           'houses lit twenty hours a day, guarded like banks.',
    sectors: ['food', 'water'],
    baseTerritory: 37,
  },
  {
    id: 'obsidian',
    name: 'OBSIDIAN REACH',
    blurb: 'High desert geothermal and lithium claims. Every road is a ' +
           'private road. Every private road has a gun on it.',
    sectors: ['energy', 'water'],
    baseTerritory: 25,
  },
  {
    id: 'palisade',
    name: 'PALISADE MUNICIPALITY',
    blurb: 'A walled administrative city that still prints ballots. ' +
           'Whether they are counted is a matter of opinion.',
    sectors: ['water', 'energy', 'food'],
    baseTerritory: 46,
  },
];

const SECTORS = {
  water: {
    id: 'water',
    name: 'WATER',
    jobTitle: 'Pump-line hand',
    blurb: 'Filtration, reclamation, and the rationing queues.',
    wageMod: 1.0,
  },
  energy: {
    id: 'energy',
    name: 'ENERGY',
    jobTitle: 'Grid splicer',
    blurb: 'Substations, panel farms, and cable that is worth killing over.',
    wageMod: 1.15,
  },
  food: {
    id: 'food',
    name: 'FOOD',
    jobTitle: 'Stack-house picker',
    blurb: 'Protein stacks, seed vaults, and calorie allocation boards.',
    wageMod: 0.9,
  },
};
