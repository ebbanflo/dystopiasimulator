/* =============================================================================
 * flavor.js — AMBIENT WORLD TEXTURE.
 *
 * Lines in this file have NO MECHANICAL EFFECT. They exist so that an ordinary
 * week still reads like a place: the queues, the weather, the radio, the
 * rumours, the small cruelties of a country that is still administratively
 * alive and materially dead. One to three of these are drawn per quiet week.
 *
 * TOKENS, substituted at draw time by ambientLine():
 *   {F}   a random faction's full name        {FS}  a random faction's short name
 *   {F2}  a second, different faction (short) {R}   a random region name
 *   {HR}  the player's home region name       {SEC} the player's sector name
 *   {NPC} a random living named NPC           {YR}  the current in-game year
 * ========================================================================= */

/* --- The street: queues, blocks, ordinary people ------------------------- */
const AMBIENT_STREET = [
  'A man in the ration queue has been reading the same page of the same book for three weeks.',
  'Children on your block have invented a game about checkpoint inspections. They are very good at it.',
  'The stairwell light is fixed. Nobody knows who fixed it. Everyone is suspicious of it.',
  'Somebody has chalked the old federal seal on a wall in {HR}. By evening it has been washed off.',
  'A woman sells filtered water by the cup and will not say where the filter came from.',
  'Two families in your building have merged households to halve the draw. It is happening everywhere.',
  'A funeral passes without a body. The body is in {R} and will not be released.',
  'The barber on the corner takes payment in amperes now. Everyone accepts this as normal.',
  'Someone has painted over the block number. Deliveries stop for four days.',
  'A queue forms outside a shuttered dispensary and does not disperse until midnight.',
  'The man who used to run the district archive now sells his shoes at the depot gate.',
  'A wedding is held in the pump yard because it is the only floor that is dry.',
  'Your neighbour has started keeping chickens on the roof. The roof was not designed for chickens.',
  'Nobody in the building has seen the landlord in two years. Rent is still collected.',
  'A boy runs messages between three blocks for a fee and has better intelligence than most factions.',
];

/* --- Infrastructure: the failing physical country ------------------------ */
const AMBIENT_INFRA = [
  'The {HR} pressure main is patched with a section of fire hose and a prayer.',
  'A substation in {R} runs at forty percent and has done for six years.',
  'The desalination shelf logs another shutdown. The log is not read by anyone.',
  'A convoy of water tankers goes east through the night and does not come back west.',
  'Someone has been stealing copper from the relay masts again. The relays get quieter every year.',
  'The {HR} levee is inspected by a man with a clipboard who does not write anything down.',
  'A vertical stack house in {R} loses its lighting for nine hours. The loss is measured in tonnes.',
  'The old interstate is being taken up for scrap, one mile at a time, by nobody in particular.',
  'A wind array in {R} spins with three of its eleven turbines. Nobody can source the rest.',
  'The city runs its pumps at night when the draw is cheap and floods the low blocks by morning.',
  'A borehole in {HR} comes up dry. The map still says it is a well.',
  'Filtration membranes are now counterfeited well enough that the counterfeits have brand loyalty.',
  'The rail spine carries freight three days a week. It used to be seven. Nobody announced the change.',
];

/* --- Politics: factions being factions ---------------------------------- */
const AMBIENT_POLITICS = [
  '{F} issues a statement about {R}. It is four thousand words long and says nothing.',
  '{FS} and {F2} hold talks. Both sides describe them afterwards as constructive.',
  'A {FS} officer is photographed at a {F2} function. Both organisations deny the photograph.',
  '{F} announces a new allocation instrument. It reallocates nothing to nobody.',
  'An election is scheduled in {R}. It has been scheduled four times.',
  '{FS} publishes a casualty figure for {R}. Independent counts put it at six times higher.',
  'A commission of inquiry into the {R} shortages is announced, staffed, and never convened.',
  '{F} renames a district after one of its own dead. The residents keep using the old name.',
  'Somebody leaks {FS} internal minutes. They are duller than anyone hoped and worse than anyone feared.',
  '{NPC} is promoted, demoted, and promoted again inside a single fortnight.',
  '{FS} declares a week of remembrance. Attendance is compulsory for anyone on their payroll.',
  'A treaty between {FS} and {F2} is signed in {R}. Neither delegation shakes hands.',
  'The {FS} legal bureau rules that a shortage is not a shortage if it was budgeted for.',
  'A former {FS} officer publishes a memoir. It is withdrawn within a week and is now worth money.',
];

/* --- Climate: the thing that actually ended the country ------------------ */
const AMBIENT_CLIMATE = [
  'Forty-one days above the wet-bulb threshold this year. The record was set last year.',
  'The rain, when it comes, comes sideways and all at once, and then not again for a season.',
  'Salt is showing in the soil at {R}. Nothing anyone plants there will come up next year.',
  'Dust off the interior turns the sun brown at three in the afternoon.',
  'The night temperature does not drop. People sleep on roofs and stairwells and pump housings.',
  'A grey rain falls for two hours and everybody stands in it.',
  'The tide takes another quarter-metre of the {HR} approach road.',
  'Fire season now runs eleven months. The twelfth month is called the break.',
  'Snow is reported somewhere north and is treated as a rumour.',
  'The mosquito line moved north again. So did the fever with it.',
];

/* --- Media, culture, rumour --------------------------------------------- */
const AMBIENT_MEDIA = [
  'The relay plays an old broadcast by mistake. For ten minutes the country sounds like {YR} minus twenty.',
  'A preacher on the pirate band says the collapse was a judgement. His audience grows every year.',
  'Someone is printing an actual newspaper in {R}. Four pages, weekly, mostly obituaries.',
  'A song about the {R} strike is banned by {FS}, which makes it the only song anybody sings.',
  'The state archive releases records from before the collapse. They are almost entirely receipts.',
  'A rumour goes around that the coast is being resettled. It is not. It goes around anyway.',
  'Two men argue about pre-collapse football for six hours and neither can remember who won.',
  'A film is screened in the depot on a sheet. It is a comedy. Nobody laughs at the same parts.',
  'The public band carries nine hours of {FS} procedural announcements and one hour of weather.',
  'Somebody has restored a pre-collapse arcade cabinet. There is a queue for it every evening.',
  'A teacher holds classes in a stairwell for anyone who turns up. Thirty children turn up.',
];

/* --- Crime and the ordinary violence of scarcity ------------------------- */
const AMBIENT_CRIME = [
  'A body is found at the {HR} outfall. It is logged as an industrial accident.',
  'Someone is running counterfeit ration chits and running them well.',
  'A {FS} patrol shakes down a delivery crew in broad daylight and nobody stops walking.',
  'Two crews fight over a generator in {R}. The generator is destroyed in the fighting.',
  'A protection racket in your district raises its rate and calls the raise a levy.',
  'The clinic reports its third break-in this month. They were after the antibiotics, again.',
  'A man is beaten at the checkpoint for having the wrong district on his papers.',
  '{NPC} is said to have had someone killed. It is said quietly, and only once.',
  'A stolen tanker is found burned out on the {R} road, empty.',
  'Someone informs on their own block for a week of extra draw. Everyone knows who.',
];

/* --- Sector-specific colour, keyed to the player's job ------------------- */
const AMBIENT_SECTOR = {
  water: [
    'The intake screens come up full of jellyfish for the fourth time this month.',
    'A pressure test fails and is signed off as passed by somebody two grades above you.',
    'The brine outfall has killed everything within a kilometre. This is in the permit.',
    'You spend a day walking a line looking for a leak you can hear but cannot find.',
    'A ration meter is found bypassed with a length of garden hose and a great deal of nerve.',
  ],
  energy: [
    'A splice you made two years ago is still holding. You check it anyway.',
    'Somebody has tapped the feeder upstream. The load numbers have not made sense for months.',
    'A transformer fails with a sound like a door closing on a very large room.',
    'You climb a pylon at four in the morning because that is when the load is low enough.',
    'The panel farm loses another two hundred cells to dust and nobody schedules a clean.',
  ],
  food: [
    'The stack house smells of ammonia and everyone has stopped mentioning it.',
    'A whole tier of protein is condemned and quietly re-graded instead of destroyed.',
    'The seed vault requisition is denied for the third quarter running.',
    'You pick for eleven hours and the tally at the end is short by a number nobody will explain.',
    'A calorie board memo reclassifies your district. Nobody will say in which direction.',
  ],
};

/* Assemble the master pool with weights so no single register dominates. */
const AMBIENT_POOLS = [
  { w: 22, lines: AMBIENT_STREET },
  { w: 18, lines: AMBIENT_INFRA },
  { w: 20, lines: AMBIENT_POLITICS },
  { w: 12, lines: AMBIENT_CLIMATE },
  { w: 14, lines: AMBIENT_MEDIA },
  { w: 14, lines: AMBIENT_CRIME },
];

/* Titles for a week in which nothing consequential happened. */
const QUIET_TITLES = [
  'NOTHING IN PARTICULAR',
  'ROUTINE WEEK',
  'NO INCIDENT OF RECORD',
  'ORDINARY BUSINESS',
  'FILED WITHOUT COMMENT',
  'WEEK ENDS',
  'UNREMARKABLE',
  'NO ACTION TAKEN',
  'STATUS UNCHANGED',
  'THE USUAL',
];

/* --- Token substitution -------------------------------------------------- */
function ambientLine(state, template) {
  const live = Object.values(state.factions).filter(f => !f.defunct);
  const pair = live.length >= 2 ? RNG.sample(live, 2) : [live[0], live[0]];
  const region = RNG.pick(state.regions);
  const home = state.regions.find(r => r.id === state.player.regionId);
  const npcs = state.npcs.filter(n => n.alive);
  const npc = npcs.length ? RNG.pick(npcs) : null;
  const year = CONFIG.START_YEAR + Math.floor((state.week - 1) / CONFIG.WEEKS_PER_YEAR);

  return template
    .replace(/\{F\}/g, pair[0] ? pair[0].def.name : 'THE STATE')
    .replace(/\{FS\}/g, pair[0] ? pair[0].def.short : 'THE STATE')
    .replace(/\{F2\}/g, pair[1] ? pair[1].def.short : 'THE STATE')
    .replace(/\{R\}/g, region.name)
    .replace(/\{HR\}/g, home ? home.name : region.name)
    .replace(/\{SEC\}/g, state.player.sector ? SECTORS[state.player.sector].name : 'THE SECTOR')
    .replace(/\{NPC\}/g, npc ? npc.name : 'a mid-ranking officer')
    .replace(/\{YR\}/g, String(year));
}

/* Draw 1-3 ambient lines for a quiet week, without repeating within the draw.
 * The player's own sector is over-represented, because it is their life. */
function drawAmbient(state) {
  const count = RNG.weighted([{ w: 30, n: 1 }, { w: 45, n: 2 }, { w: 25, n: 3 }]).n;
  const out = [];
  const seen = new Set();
  let guard = 0;

  while (out.length < count && guard++ < 40) {
    let template;
    if (state.player.sector && RNG.chance(0.3)) {
      template = RNG.pick(AMBIENT_SECTOR[state.player.sector]);
    } else {
      template = RNG.pick(RNG.weighted(AMBIENT_POOLS).lines);
    }
    if (seen.has(template)) continue;
    seen.add(template);
    out.push(ambientLine(state, template));
  }
  return out;
}
