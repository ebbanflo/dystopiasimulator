/* =============================================================================
 * events.js — Everything the player can DO on a turn, plus the random weekly
 * incidents that happen TO them.
 *
 * ACTIONS are filtered per turn by faction, rank, sector, region and stats
 * (feature 10). Each action declares its cost, its success probability
 * function, and its payoff/consequence tables inline — no hidden math.
 *
 * Helpers used here (addMoney/addRep/addTerritory/addHeat/…) are defined in
 * game.js and are safe to reference because actions only run at click time.
 * ========================================================================= */

/* --- Shared probability helper: reputation makes you effective ------------ */
function repWith(state, factionId) {
  if (!factionId) return 0;
  return state.player.reputation[factionId] || 0;
}

function playerRankTitle(state) {
  const p = state.player;
  if (!p.factionId || p.rankIndex === null) return 'UNAFFILIATED';
  const f = state.factions[p.factionId];
  return f.def.rankTitles[p.rankIndex];
}

/* Success odds for legitimate work: base + rep scaling, capped. */
function legitOdds(state, base, repScale, extra) {
  const rep = repWith(state, state.player.factionId);
  const heatPenalty = state.player.heat * 0.002;
  return clamp(base + rep * repScale + (extra || 0) - heatPenalty, 0.05, 0.95);
}

/* =============================================================================
 * ACTION LIST
 * ========================================================================= */
const ACTIONS = [

  /* ---------------------------------------------------------------------- *
   * SECTOR WORK — always available, the floor of the economy.
   * ---------------------------------------------------------------------- */
  {
    id: 'work_shift',
    category: 'work',
    label: 'WORK THE SECTOR',
    desc(state) {
      const s = SECTORS[state.player.sector];
      return `Pull a full week as a ${s.jobTitle.toLowerCase()}. Dull, legal, and it pays.`;
    },
    cost: 0,
    available() { return true; },
    hint(state) {
      const s = SECTORS[state.player.sector];
      const pay = Math.round(CONFIG.BASE_WEEKLY_WAGE * s.wageMod * 1.6);
      return `~${pay}cr, no risk, no standing gained.`;
    },
    resolve(state) {
      const s = SECTORS[state.player.sector];
      const pay = Math.round(CONFIG.BASE_WEEKLY_WAGE * s.wageMod * RNG.float(1.3, 1.9));
      addMoney(state, pay);
      addHeat(state, -4);
      return {
        ok: true,
        lines: [`You work the week out. ${pay}cr, minus what the line boss skims.`],
      };
    },
  },

  {
    id: 'scrounge',
    category: 'work',
    label: 'SCROUNGE & RESELL',
    desc: () => 'Strip salvage off dead infrastructure and move it through a grey market. ' +
                'Better money than the job. Someone always notices.',
    cost: 0,
    available() { return true; },
    hint: () => '55% for 400-1100cr. Failure costs a fine and attention.',
    resolve(state) {
      if (RNG.chance(0.55)) {
        const take = RNG.int(400, 1100);
        addMoney(state, take);
        addHeat(state, 6);
        return { ok: true, lines: [`You move the salvage clean. ${take}cr.`] };
      }
      const fine = RNG.int(200, 600);
      addMoney(state, -fine);
      addHeat(state, 12);
      return { ok: false, lines: [`A patrol works you over and takes ${fine}cr. Your name goes in a book.`] };
    },
  },

  /* ---------------------------------------------------------------------- *
   * AFFILIATION
   * ---------------------------------------------------------------------- */
  {
    id: 'petition_join',
    category: 'faction',
    label: 'PETITION A FACTION',
    desc: () => 'Present yourself for the lowest rank of a faction operating in your region. ' +
                'They will want to know what you are good for.',
    cost: 0,
    available(state) { return !state.player.factionId && !state.player.exiled; },
    hint: () => 'Opens the affiliation roster. Odds depend on your standing with them.',
    opensPanel: 'join',
  },

  {
    id: 'leave_faction',
    category: 'faction',
    label: 'WALK AWAY',
    desc: () => 'Cut ties and disappear into the sector work. Nobody forgives it, ' +
                'and the tribe you left may come looking (feature 9 death check).',
    cost: 0,
    available(state) { return !!state.player.factionId; },
    hint() { return `${Math.round(CONFIG.FACTION_ABANDON_DEATH_CHANCE * 100)}% chance they kill you rather than let you go.`; },
    resolve(state) {
      return abandonFaction(state, 'walked away from');
    },
  },

  /* ---------------------------------------------------------------------- *
   * LEGITIMATE CLIMB (feature 4)
   * ---------------------------------------------------------------------- */
  {
    id: 'organize_protest',
    category: 'legit',
    label: 'ORGANIZE A PROTEST',
    desc: () => 'Shut a distribution point down for a day and make it the faction\'s ' +
                'grievance instead of yours.',
    cost: 250,
    available(state) { return !!state.player.factionId; },
    hint(state) {
      return `${Math.round(legitOdds(state, 0.48, 0.0035) * 100)}% → +6..10 standing, +1 territory. ` +
             'Failure: dispersal, standing loss, heat.';
    },
    resolve(state) {
      const p = state.player;
      const odds = legitOdds(state, 0.48, 0.0035);
      addMoney(state, -250);
      if (RNG.chance(odds)) {
        const rep = RNG.int(6, 10);
        addRep(state, p.factionId, rep);
        addTerritory(state, 1);
        addHeat(state, 5);
        state.factions[p.factionId].unrestPressure = clamp(
          state.factions[p.factionId].unrestPressure + 5, 0, 100);
        return { ok: true, lines: [
          `Six hundred people stand in a ration queue and refuse to move.`,
          `${state.factions[p.factionId].def.short} takes the credit and gives you ${rep} standing. +1 territory.`,
        ] };
      }
      addRep(state, p.factionId, -4);
      addHeat(state, 14);
      return { ok: false, lines: [
        'Marshal auxiliaries break it up in forty minutes.',
        'Your faction disowns the action. -4 standing, and your file thickens.',
      ] };
    },
  },

  {
    id: 'draft_ordinance',
    category: 'legit',
    label: 'DRAFT AN ORDINANCE',
    desc: () => 'Write a binding allocation instrument — this country\'s surviving ' +
                'equivalent of legislation — and get it stamped.',
    cost: 700,
    available(state) { return !!state.player.factionId && state.player.rankIndex >= 1; },
    hint(state) {
      return `${Math.round(legitOdds(state, 0.40, 0.004) * 100)}% → +9..14 standing, permanent creation on record. ` +
             'Failure: money gone, minor standing loss.';
    },
    resolve(state) {
      const p = state.player;
      const odds = legitOdds(state, 0.40, 0.004);
      addMoney(state, -700);
      if (RNG.chance(odds)) {
        const rep = RNG.int(9, 14);
        addRep(state, p.factionId, rep);
        const title = RNG.pick([
          'the Standing Ration Instrument',
          'the Substation Tenure Act',
          'the Reclamation Priority Order',
          'the Calorie Board Reform Instrument',
          'the Checkpoint Toll Abolition Order',
        ]);
        p.creations.push({ type: 'ordinance', title: title, week: state.week, factionId: p.factionId });
        addSpecialization(state, 'legislative');
        return { ok: true, lines: [
          `You draft ${title} and walk it through three committees personally.`,
          `It is stamped, sealed, and enforced within the week. +${rep} standing.`,
        ] };
      }
      addRep(state, p.factionId, -3);
      return { ok: false, lines: [
        'The instrument dies in committee. Two of the signatures were sold to someone else first.',
        '-3 standing. The drafting fee is not refundable.',
      ] };
    },
  },

  {
    id: 'public_campaign',
    category: 'legit',
    label: 'PUBLIC CAMPAIGN',
    desc: () => 'Buy airtime on the last working broadcast relays and put your face ' +
                'in front of a hundred thousand people.',
    cost: 1500,
    available(state) { return !!state.player.factionId && state.player.rankIndex >= 1; },
    hint(state) {
      return `${Math.round(legitOdds(state, 0.44, 0.0032) * 100)}% → +8..13 standing with your faction, ` +
             'small standing gain with everyone else. Failure: humiliation.';
    },
    resolve(state) {
      const p = state.player;
      const odds = legitOdds(state, 0.44, 0.0032);
      addMoney(state, -1500);
      if (RNG.chance(odds)) {
        const rep = RNG.int(8, 13);
        addRep(state, p.factionId, rep);
        for (const fid in state.factions) {
          if (fid === p.factionId) continue;
          addRep(state, fid, RNG.int(0, 2));
        }
        addTerritory(state, 1);
        addSpecialization(state, 'oratory');
        return { ok: true, lines: [
          'Your face runs on every relay in the corridor for four nights.',
          `Recognition is not power, but it converts. +${rep} standing, +1 territory.`,
        ] };
      }
      addRep(state, p.factionId, -5);
      return { ok: false, lines: [
        'A rival buys the following slot and spends it on your bank records.',
        '-5 standing. The relays keep the money.',
      ] };
    },
  },

  {
    id: 'organize_ward',
    category: 'legit',
    label: 'ORGANIZE A WARD',
    desc: () => 'Take responsibility for a block: water queue, generator schedule, ' +
                'and the arguments. Slow, real territory.',
    cost: 900,
    available(state) { return !!state.player.factionId; },
    hint(state) {
      return `${Math.round(legitOdds(state, 0.55, 0.0025) * 100)}% → +2..4 territory, +3 standing.`;
    },
    resolve(state) {
      const p = state.player;
      const odds = legitOdds(state, 0.55, 0.0025);
      addMoney(state, -900);
      if (RNG.chance(odds)) {
        const terr = RNG.int(2, 4);
        addTerritory(state, terr);
        addRep(state, p.factionId, 3);
        addSpecialization(state, 'organizing');
        return { ok: true, lines: [
          `The ward runs on your schedule now. +${terr} territory, +3 standing.`,
        ] };
      }
      return { ok: false, lines: [
        'Another organizer got there in the spring. You are told, politely, to leave.',
      ] };
    },
  },

  {
    id: 'petition_promotion',
    category: 'legit',
    label: 'PETITION FOR PROMOTION',
    desc: () => 'Formally request elevation to the next rank. You need the standing ' +
                'to back it and a vacancy to fill.',
    cost: 0,
    available(state) {
      const p = state.player;
      if (!p.factionId || p.rankIndex === null) return false;
      return p.rankIndex < RANK_COUNT - 1;
    },
    hint(state) {
      const p = state.player;
      const need = RANK_REP_REQ[p.rankIndex + 1];
      const have = repWith(state, p.factionId);
      const f = state.factions[p.factionId];
      return `Requires ${need} standing (you have ${have}) for ${f.def.rankTitles[p.rankIndex + 1]}.`;
    },
    resolve(state) {
      const p = state.player;
      const nextRank = p.rankIndex + 1;
      const need = RANK_REP_REQ[nextRank];
      const have = repWith(state, p.factionId);
      const f = state.factions[p.factionId];
      if (have < need) {
        addRep(state, p.factionId, -2);
        return { ok: false, lines: [
          `You ask for ${f.def.rankTitles[nextRank]} with ${have} standing. The room laughs.`,
          '-2 standing for wasting a session.',
        ] };
      }
      /* A promotion needs room at the top: the tier above must not be full. */
      const above = npcsOfFaction(state, p.factionId).filter(n => n.rankIndex === nextRank);
      const capacity = RANK_POPULATION[nextRank];
      if (above.length >= capacity) {
        return { ok: false, lines: [
          `There is no seat at ${f.def.rankTitles[nextRank]}. ${above.length} of ${capacity} chairs are occupied.`,
          'Someone would have to leave it. One way or another.',
        ] };
      }
      p.rankIndex = nextRank;
      addTerritory(state, 2);
      return { ok: true, lines: [
        `You are confirmed as ${f.def.rankTitles[nextRank]} of ${f.def.name}.`,
        'Two wards are transferred to your name. +2 territory.',
      ] };
    },
  },

  /* ---------------------------------------------------------------------- *
   * CORRUPT CLIMB (feature 5)
   * ---------------------------------------------------------------------- */
  {
    id: 'bribe',
    category: 'corrupt',
    label: 'BRIBE AN OFFICER',
    desc: () => 'Put money in the right hand and let it buy you a signature, ' +
                'a vote, or a blind eye.',
    cost: 0,
    available(state) { return !!state.player.factionId && corruptionTargets(state).length > 0; },
    hint: () => 'Select a target. Cost scales with their rank. Greedy targets are cheap; ideologues cannot be bought.',
    opensPanel: 'bribe',
  },

  {
    id: 'blackmail',
    category: 'corrupt',
    label: 'BLACKMAIL',
    desc: () => 'Spend a week building a file on someone above you, then use it. ' +
                'Cheaper than bribery. Makes a permanent enemy.',
    cost: 0,
    available(state) { return !!state.player.factionId && corruptionTargets(state).length > 0; },
    hint: () => 'Select a target. Success takes their standing and gives it to you; failure hands them the file.',
    opensPanel: 'blackmail',
  },

  {
    id: 'assassinate',
    category: 'corrupt',
    label: 'ASSASSINATION',
    desc: () => 'Remove a specific named superior from the hierarchy so their seat ' +
                'becomes available. There is no undoing this.',
    cost: 0,
    available(state) { return !!state.player.factionId && assassinationTargets(state).length > 0; },
    hint: () => 'Select a target from your own faction, ranked above you. Failure table is real and includes death.',
    opensPanel: 'assassinate',
  },

  {
    id: 'skim_funds',
    category: 'corrupt',
    label: 'SKIM FACTION FUNDS',
    desc: () => 'Divert allocation credits through a ward account that does not exist. ' +
                'Fast money, and the books remember.',
    cost: 0,
    available(state) { return !!state.player.factionId && state.player.rankIndex >= 1; },
    hint(state) {
      const take = 900 + state.player.rankIndex * 1100;
      return `~60% for ~${take}cr. Failure: -12 standing, heavy heat, and the faction turns on you.`;
    },
    resolve(state) {
      const p = state.player;
      const f = state.factions[p.factionId];
      /* Corrupt factions notice less. */
      const odds = clamp(0.50 + f.corruption * 0.0030 - p.heat * 0.002, 0.15, 0.85);
      if (RNG.chance(odds)) {
        const take = RNG.int(900, 900 + p.rankIndex * 1600);
        addMoney(state, take);
        addHeat(state, 9);
        f.corruption = clamp(f.corruption + 2, 0, 100);
        addSpecialization(state, 'embezzlement');
        return { ok: true, lines: [
          `${take}cr moves through a ward that has no houses in it.`,
          'The ledger balances. Nobody reads the ledger.',
        ] };
      }
      addRep(state, p.factionId, -12);
      addHeat(state, 22);
      f.playerHostility = clamp(f.playerHostility + 25, 0, 100);
      return { ok: false, lines: [
        'An auditor with nothing better to do walks the ward and finds no houses.',
        '-12 standing. Your own faction opens a file on you.',
      ] };
    },
  },

  /* ---------------------------------------------------------------------- *
   * TERRITORY / MONEY
   * ---------------------------------------------------------------------- */
  {
    id: 'seize_turf',
    category: 'corrupt',
    label: 'SEIZE TURF',
    desc: () => 'Put armed people on a block that belongs to somebody else and ' +
                'keep them there.',
    cost: 1200,
    available(state) { return !!state.player.factionId && state.player.rankIndex >= 1; },
    hint(state) {
      const odds = clamp(0.42 + state.player.territory * 0.006, 0.1, 0.8);
      return `${Math.round(odds * 100)}% → +3..6 territory. Failure: casualties, money lost, retaliation.`;
    },
    resolve(state) {
      const p = state.player;
      addMoney(state, -1200);
      const odds = clamp(0.42 + p.territory * 0.006, 0.1, 0.8);
      /* Whoever holds the most of your region is the one you are stealing from. */
      const victim = dominantFactionInRegion(state, p.regionId, p.factionId);
      if (RNG.chance(odds)) {
        const terr = RNG.int(3, 6);
        addTerritory(state, terr);
        addHeat(state, 10);
        if (victim) {
          victim.control[p.regionId] = clamp((victim.control[p.regionId] || 0) - terr, 0, 100);
          victim.playerHostility = clamp(victim.playerHostility + 18, 0, 100);
          addRep(state, victim.id, -6);
        }
        addSpecialization(state, 'muscle');
        return { ok: true, lines: [
          `The block is yours by Thursday. +${terr} territory.`,
          victim ? `${victim.def.short} lost it, and knows exactly who took it.` : 'Nobody claimed it. Nobody will now.',
        ] };
      }
      addHeat(state, 14);
      if (victim) victim.playerHostility = clamp(victim.playerHostility + 22, 0, 100);
      const lost = Math.min(p.territory, RNG.int(0, 2));
      if (lost) addTerritory(state, -lost);
      return { ok: false, lines: [
        'They were waiting. Two of your people do not come back.',
        victim ? `${victim.def.short} holds the block and adds you to a list.` : 'The block holds.',
        lost ? `You lose ${lost} territory covering the retreat.` : 'You keep what you had, barely.',
      ] };
    },
  },

  {
    id: 'lay_low',
    category: 'work',
    label: 'LIE LOW',
    desc: () => 'Change beds, change names, stay off the relays for a week.',
    cost: 0,
    available() { return true; },
    hint: () => '-20 heat, small money loss, no progress.',
    resolve(state) {
      addHeat(state, -20);
      addMoney(state, -RNG.int(50, 200));
      return { ok: true, lines: ['A quiet week. The file cools. Nothing else happens.'] };
    },
  },

  /* ---------------------------------------------------------------------- *
   * FACTION FOUNDING & RETURN (features 6 and 7)
   * ---------------------------------------------------------------------- */
  {
    id: 'found_faction',
    category: 'special',
    label: 'FOUND YOUR OWN FACTION',
    desc: () => 'Break from your faction and raise your own flag. Your ordinances, ' +
                'your specializations, your money and your wards come with you. ' +
                'Some of your people might too.',
    cost: CONFIG.FOUND_COST_MONEY,
    available(state) { return canFoundFaction(state).ok; },
    hint(state) {
      const c = canFoundFaction(state);
      return c.ok
        ? `Costs ${CONFIG.FOUND_COST_MONEY}cr. Every member of your old faction is rolled individually to follow you.`
        : c.reason;
    },
    opensPanel: 'found',
  },

  {
    id: 'return_faction',
    category: 'special',
    label: 'RETURN TO A PRIOR FACTION',
    desc: () => 'Go back to a flag you once carried. They have not stood still, ' +
                'and your old seat has an occupant who would rather you had died.',
    cost: 0,
    available(state) {
      return !state.player.factionId &&
             state.player.priorFactions.length > 0 &&
             !state.player.exiled;
    },
    hint: () => 'Opens the return roster. Acceptance depends on your remaining standing there.',
    opensPanel: 'return',
  },
];

/* Actions the player can take this turn, in menu order. */
function availableActions(state) {
  if (!state.player.alive) return [];
  return ACTIONS.filter(a => {
    try { return a.available(state); } catch (e) { return false; }
  });
}

/* =============================================================================
 * RANDOM WEEKLY INCIDENTS
 *
 * Each has a weight, a condition, and either an automatic effect or a set of
 * choices. Choices BLOCK the next turn until resolved (see game.js).
 * ========================================================================= */
const INCIDENTS = [
  {
    id: 'ration_cut',
    w: 10,
    when: () => true,
    title: 'RATION REVISION',
    body: () => 'The allocation board revises the weekly draw downward. Everyone in ' +
                'your block is short, and everyone in your block knows you have a job.',
    choices: [
      {
        label: 'Share your draw',
        outcome(state) {
          addMoney(state, -RNG.int(150, 400));
          addTerritory(state, RNG.chance(0.5) ? 1 : 0);
          if (state.player.factionId) addRep(state, state.player.factionId, 2);
          return ['You go short for a week. The block remembers it.'];
        },
      },
      {
        label: 'Keep it',
        outcome(state) {
          addMoney(state, RNG.int(80, 220));
          if (state.player.factionId) addRep(state, state.player.factionId, -2);
          return ['You eat. The stairwell goes quiet when you use it.'];
        },
      },
      {
        label: 'Sell the surplus at queue prices',
        outcome(state) {
          addMoney(state, RNG.int(300, 700));
          addHeat(state, 8);
          if (state.player.factionId) addRep(state, state.player.factionId, -4);
          return ['Good money. Somebody films you doing it.'];
        },
      },
    ],
  },

  {
    id: 'approach',
    w: 8,
    when: (state) => !!state.player.factionId,
    title: 'AN APPROACH',
    body(state) {
      const others = Object.values(state.factions).filter(f =>
        f.id !== state.player.factionId && !f.defunct);
      const f = RNG.pick(others);
      state._incidentFaction = f.id;
      return `A ${f.def.name} intermediary finds you outside the depot. They are ` +
             `not recruiting. They want one small thing, and they are willing to pay.`;
    },
    choices: [
      {
        label: 'Take the money and do it',
        outcome(state) {
          const f = state.factions[state._incidentFaction];
          const pay = RNG.int(600, 1800);
          addMoney(state, pay);
          addRep(state, f.id, RNG.int(4, 8));
          f.playerDebt += 1;
          addRep(state, state.player.factionId, -RNG.int(2, 6));
          state.factions[state.player.factionId].playerHostility += 6;
          return [`${pay}cr, and ${f.def.short} owes you a favor. Your own people suspect something.`];
        },
      },
      {
        label: 'Refuse and report it',
        outcome(state) {
          const f = state.factions[state._incidentFaction];
          addRep(state, state.player.factionId, RNG.int(3, 7));
          addRep(state, f.id, -RNG.int(3, 8));
          f.playerHostility = clamp(f.playerHostility + 12, 0, 100);
          return [`You hand the name to your own security. ${f.def.short} will not forget.`];
        },
      },
      { label: 'Walk away without answering', outcome: () => ['You keep walking. Nothing changes, which is its own choice.'] },
    ],
  },

  {
    id: 'shakedown',
    w: 7,
    when: (state) => state.player.money > 800,
    title: 'SHAKEDOWN',
    body: () => 'Four people you half-recognize are waiting at your door with a ' +
                'number in mind.',
    choices: [
      {
        label: 'Pay',
        outcome(state) {
          const amt = Math.min(state.player.money, RNG.int(400, 1400));
          addMoney(state, -amt);
          return [`You pay ${amt}cr. They will come back. Everyone knows they will come back.`];
        },
      },
      {
        label: 'Fight',
        outcome(state) {
          if (RNG.chance(0.45 + state.player.territory * 0.01)) {
            addTerritory(state, 1);
            return ['Your people arrive first. The street watches. +1 territory.'];
          }
          addMoney(state, -RNG.int(200, 700));
          addTerritory(state, state.player.territory > 0 ? -1 : 0);
          if (RNG.chance(0.06)) {
            killPlayer(state, 'beaten to death in a stairwell over eleven hundred credits');
            return ['It goes badly.'];
          }
          return ['It goes badly. You lose money, standing on the block, and a tooth.'];
        },
      },
    ],
  },

  {
    id: 'blackout',
    w: 6,
    when: () => true,
    title: 'CORRIDOR BLACKOUT',
    body: () => 'The grid drops for nine days. Pumps stop. Stacks warm. The relays go silent ' +
                'and rumor fills the gap.',
    auto(state) {
      const loss = RNG.int(100, 500);
      addMoney(state, -loss);
      for (const f of Object.values(state.factions)) {
        if (f.defunct) continue;
        f.unrestPressure = clamp(f.unrestPressure + RNG.int(4, 12), 0, 100);
      }
      return [`Nine dark days. ${loss}cr of spoilage and bought water. Unrest climbs everywhere.`];
    },
  },

  {
    id: 'audit',
    w: 5,
    when: (state) => state.player.heat > 30,
    title: 'FILE REVIEW',
    body: () => 'Someone has pulled your file and read all of it.',
    auto(state) {
      if (RNG.chance(0.4)) {
        const fine = RNG.int(300, 1200);
        addMoney(state, -fine);
        addHeat(state, -10);
        return [`A fine of ${fine}cr closes the review. Cheaper than the alternative.`];
      }
      addHeat(state, 10);
      return ['The review stays open. Two names in it are yours.'];
    },
  },

  {
    id: 'rival_move',
    w: 6,
    when: (state) => state.npcs.some(n => n.alive && n.isRival && n.factionId === state.player.factionId),
    title: 'THE RIVAL MOVES',
    body(state) {
      const rival = state.npcs.find(n => n.alive && n.isRival && n.factionId === state.player.factionId);
      state._incidentNPC = rival ? rival.id : null;
      return rival
        ? `${rival.name}, who holds the seat you once did, has spent the week ` +
          `talking about you in rooms you are not invited to.`
        : 'A rival moves against you.';
    },
    choices: [
      {
        label: 'Answer it politically',
        outcome(state) {
          const rival = npcById(state, state._incidentNPC);
          if (!rival) return ['The moment passes.'];
          if (RNG.chance(clamp(0.45 + repWith(state, state.player.factionId) * 0.003, 0.1, 0.85))) {
            addRep(state, state.player.factionId, 4);
            rival.grudge = clamp(rival.grudge + 5, 0, 100);
            return [`You answer ${rival.name} in open session and win the room. +4 standing.`];
          }
          addRep(state, state.player.factionId, -5);
          rival.grudge = clamp(rival.grudge + 8, 0, 100);
          return [`${rival.name} was better prepared. -5 standing.`];
        },
      },
      {
        label: 'Ignore it',
        outcome(state) {
          const rival = npcById(state, state._incidentNPC);
          if (rival) rival.grudge = clamp(rival.grudge + 12, 0, 100);
          addRep(state, state.player.factionId, -2);
          return ['You let it stand. It hardens into fact by the weekend.'];
        },
      },
    ],
  },

  {
    id: 'flood',
    w: 4,
    when: () => true,
    title: 'INTRUSION EVENT',
    body: () => 'Saltwater comes up through the substructure again. The maps are ' +
                'twenty years out of date and nobody is redrawing them.',
    auto(state) {
      if (state.player.territory > 0 && RNG.chance(0.5)) {
        const lost = Math.min(state.player.territory, RNG.int(1, 3));
        addTerritory(state, -lost);
        return [`Two of your wards are under a meter of brine. -${lost} territory.`];
      }
      const cost = RNG.int(100, 400);
      addMoney(state, -cost);
      return [`Pumping and filtration cost you ${cost}cr this week.`];
    },
  },

  {
    id: 'quiet',
    w: 12,
    when: () => true,
    title: 'NOTHING IN PARTICULAR',
    body: () => 'A week passes. The queues move. Someone is shot at the checkpoint ' +
                'and it is not you and nobody writes it down.',
    auto: () => ['No incident of record.'],
  },

  {
    id: 'opportunity',
    w: 5,
    when: (state) => !!state.player.factionId && state.player.rankIndex >= 2,
    title: 'A SEAT COMES OPEN',
    body: () => 'A vacancy above you has appeared without your help, and there is ' +
                'a short window in which it can be spoken for.',
    choices: [
      {
        label: 'Move on it hard',
        outcome(state) {
          const p = state.player;
          const odds = clamp(0.35 + repWith(state, p.factionId) * 0.004, 0.1, 0.8);
          addMoney(state, -Math.min(state.player.money, 800));
          if (RNG.chance(odds) && p.rankIndex < RANK_COUNT - 1) {
            p.rankIndex += 1;
            addTerritory(state, 2);
            return [`You are confirmed as ${playerRankTitle(state)}. +2 territory.`];
          }
          addRep(state, p.factionId, -4);
          return ['Someone with better patronage takes it. -4 standing, and 800cr of favors wasted.'];
        },
      },
      {
        label: 'Back someone else and bank the favor',
        outcome(state) {
          const p = state.player;
          addRep(state, p.factionId, RNG.int(3, 6));
          state.factions[p.factionId].playerDebt += 2;
          return ['You put your weight behind a colleague. They remember. For now.'];
        },
      },
    ],
  },
];

function rollIncident(state) {
  const pool = INCIDENTS.filter(i => {
    try { return i.when(state); } catch (e) { return false; }
  });
  if (!pool.length) return null;
  return RNG.weighted(pool.map(i => Object.assign({ w: i.w }, { inc: i }))).inc;
}
