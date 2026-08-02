/* =============================================================================
 * incidents.js — THE WEEKLY INCIDENT LIBRARY.
 *
 * Each entry has:
 *   id     unique key
 *   w      selection weight
 *   when   (state) => boolean — gate on faction, rank, money, heat, etc.
 *   title  header shown on the decision screen
 *   body   string or (state) => string
 *   and EITHER
 *   choices  [{ label, outcome(state) -> [lines] }]   (blocks the turn)
 *   OR
 *   auto     (state) => [lines]                       (resolves silently)
 *
 * BONUS_CHOICES at the bottom are extra options that attach to an incident at
 * random when their condition is met — so the same incident does not present
 * the same menu twice. That is deliberate: the player should occasionally find
 * an angle they did not have last time, and never be able to assume the menu.
 * ========================================================================= */

const INCIDENTS = [

  /* ======================= SCARCITY / SUBSISTENCE ======================== */
  {
    id: 'ration_cut', w: 10, when: () => true,
    title: 'RATION REVISION',
    body: () => 'The allocation board revises the weekly draw downward. Everyone in ' +
                'your block is short, and everyone in your block knows you have work.',
    choices: [
      { label: 'Share your draw', outcome(state) {
        addMoney(state, -RNG.int(150, 400));
        if (RNG.chance(0.5)) addTerritory(state, 1);
        if (state.player.factionId) addRep(state, state.player.factionId, 2);
        return ['You go short for a week. The block remembers it, which is a kind of currency.'];
      } },
      { label: 'Keep it', outcome(state) {
        addMoney(state, RNG.int(80, 220));
        if (state.player.factionId) addRep(state, state.player.factionId, -2);
        return ['You eat. The stairwell goes quiet when you use it.'];
      } },
      { label: 'Sell the surplus at queue prices', outcome(state) {
        addMoney(state, RNG.int(300, 700));
        addHeat(state, 8);
        if (state.player.factionId) addRep(state, state.player.factionId, -4);
        return ['Good money. Somebody films you doing it.'];
      } },
    ],
  },

  {
    id: 'water_out', w: 7, when: () => true,
    title: 'SUPPLY INTERRUPTION',
    body: () => 'The block main runs dry at 06:00 and is still dry at 22:00. ' +
                'Four hundred people are now your problem, or somebody else\'s.',
    choices: [
      { label: 'Organise a bucket line to the depot', outcome(state) {
        addTerritory(state, RNG.chance(0.6) ? 1 : 0);
        addMoney(state, -RNG.int(50, 200));
        return ['Eleven hours of hauling. By the end of it people are asking you what to do next.'];
      } },
      { label: 'Buy tanker water and resell it at cost', outcome(state) {
        const cost = RNG.int(300, 800);
        addMoney(state, -cost);
        addTerritory(state, 1);
        if (state.player.factionId) addRep(state, state.player.factionId, 3);
        return [`You front ${cost}cr and take no margin. This is noticed by people who take margin.`];
      } },
      { label: 'Buy tanker water and resell it at three times cost', outcome(state) {
        addMoney(state, RNG.int(700, 1800));
        addHeat(state, 10);
        if (state.player.factionId) addRep(state, state.player.factionId, -5);
        return ['You clear good money. A man spits at your feet and you let him.'];
      } },
    ],
  },

  {
    id: 'shakedown', w: 7, when: (s) => s.player.money > 800,
    title: 'SHAKEDOWN',
    body: () => 'Four people you half-recognise are waiting at your door with a number in mind.',
    choices: [
      { label: 'Pay', outcome(state) {
        const amt = Math.min(Math.max(state.player.money, 0), RNG.int(400, 1400));
        addMoney(state, -amt);
        return [`You pay ${amt}cr. They will come back. Everyone knows they will come back.`];
      } },
      { label: 'Fight', outcome(state) {
        if (RNG.chance(0.45 + state.player.territory * 0.01)) {
          addTerritory(state, 1);
          return ['Your people arrive first. The street watches. +1 territory.'];
        }
        addMoney(state, -RNG.int(200, 700));
        if (state.player.territory > 0) addTerritory(state, -1);
        if (RNG.chance(0.06)) {
          killPlayer(state, 'beaten to death in a stairwell over eleven hundred credits');
          return ['It goes badly.'];
        }
        return ['It goes badly. You lose money, standing on the block, and a tooth.'];
      } },
    ],
  },

  {
    id: 'debt_collector', w: 5, when: (s) => s.player.money < 0,
    title: 'COLLECTION',
    body: () => 'A polite man with a ledger explains what he is authorised to do ' +
                'if the arrears are not cleared this month. He is not exaggerating.',
    choices: [
      { label: 'Sign the extended terms', outcome(state) {
        addMoney(state, 1200);
        state.player.heat = clamp(state.player.heat + 4, 0, 100);
        return ['You sign. The rate is obscene and the paper is enforceable by people with rifles.'];
      } },
      { label: 'Sign your wards over as security', outcome(state) {
        const lost = Math.min(state.player.territory, RNG.int(2, 5));
        addTerritory(state, -lost);
        addMoney(state, 2400);
        return [`${lost} wards go on the paper as collateral. You do not get them back cheaply.`];
      } },
      { label: 'Tell him to come back with more men', outcome(state) {
        if (RNG.chance(0.5)) {
          return ['He leaves. He will be back with more men, and they will be worse.'];
        }
        addMoney(state, -RNG.int(200, 500));
        if (RNG.chance(0.08)) {
          killPlayer(state, 'killed by debt collectors who took the invitation literally');
          return ['He took the invitation literally.'];
        }
        return ['They break two of your fingers as a scheduling note.'];
      } },
    ],
  },

  /* ============================= FACTION LIFE ============================= */
  {
    id: 'approach', w: 8, when: (s) => !!s.player.factionId,
    title: 'AN APPROACH',
    body(state) {
      const others = Object.values(state.factions).filter(f =>
        f.id !== state.player.factionId && !f.defunct);
      const f = RNG.pick(others);
      state._incidentFaction = f.id;
      return `A ${f.def.name} intermediary finds you outside the depot. They are not ` +
             'recruiting. They want one small thing, and they are willing to pay for it.';
    },
    choices: [
      { label: 'Take the money and do it', outcome(state) {
        const f = state.factions[state._incidentFaction];
        const pay = RNG.int(600, 1800);
        addMoney(state, pay);
        addRep(state, f.id, RNG.int(4, 8));
        f.playerDebt += 1;
        addRep(state, state.player.factionId, -RNG.int(2, 6));
        state.factions[state.player.factionId].playerHostility += 6;
        return [`${pay}cr, and ${f.def.short} owes you a favour. Your own people suspect something.`];
      } },
      { label: 'Refuse and report it', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addRep(state, state.player.factionId, RNG.int(3, 7));
        addRep(state, f.id, -RNG.int(3, 8));
        f.playerHostility = clamp(f.playerHostility + 12, 0, 100);
        return [`You hand the name to your own security. ${f.def.short} will not forget it.`];
      } },
      { label: 'Walk away without answering',
        outcome: () => ['You keep walking. Nothing changes, which is its own choice.'] },
    ],
  },

  {
    id: 'loyalty_oath', w: 6, when: (s) => !!s.player.factionId && s.player.rankIndex >= 1,
    title: 'LOYALTY REVIEW',
    body(state) {
      const f = state.factions[state.player.factionId];
      return `${f.def.short} is running loyalty interviews. Yours is on Thursday. ` +
             'The questions are not about loyalty; they are about who you know.';
    },
    choices: [
      { label: 'Answer everything honestly', outcome(state) {
        const f = state.factions[state.player.factionId];
        addRep(state, f.id, RNG.int(2, 6));
        addHeat(state, -6);
        return ['You give them a true account. It is duller than they hoped, which is the best outcome.'];
      } },
      { label: 'Give up a colleague to look useful', outcome(state) {
        const f = state.factions[state.player.factionId];
        const peers = npcsOfFaction(state, f.id).filter(n => n.rankIndex <= state.player.rankIndex);
        addRep(state, f.id, RNG.int(6, 11));
        if (peers.length) {
          const victim = RNG.pick(peers);
          victim.grudge = clamp(victim.grudge + 40, 0, 100);
          victim.loyalty = clamp(victim.loyalty - 20, 0, 100);
          return [`You name ${victim.name}. They are taken in on Friday and released on Monday.`,
                  'They know exactly who named them.'];
        }
        return ['You name somebody junior enough not to matter.'];
      } },
      { label: 'Refuse to attend', outcome(state) {
        const f = state.factions[state.player.factionId];
        addRep(state, f.id, -RNG.int(5, 10));
        f.playerHostility = clamp(f.playerHostility + 10, 0, 100);
        return ['Non-attendance is recorded. Non-attendance is always recorded.'];
      } },
    ],
  },

  {
    id: 'purge', w: 5, when: (s) => {
      const f = s.player.factionId ? s.factions[s.player.factionId] : null;
      return !!f && f.corruption > 55;
    },
    title: 'INTERNAL PURGE',
    body(state) {
      const f = state.factions[state.player.factionId];
      return `${f.def.short} has begun removing people. Not dismissing — removing. ` +
             'Three names went in the first tranche and none of them saw it coming.';
    },
    choices: [
      { label: 'Keep your head down', outcome(state) {
        const f = state.factions[state.player.factionId];
        if (RNG.chance(0.2)) {
          addRep(state, f.id, -RNG.int(4, 9));
          return ['Silence is read as guilt by people looking for guilt. Your name goes on a second list.'];
        }
        return ['The tranche passes over you. You do not sleep well for a fortnight.'];
      } },
      { label: 'Volunteer for the review board', outcome(state) {
        const f = state.factions[state.player.factionId];
        const targets = npcsOfFaction(state, f.id).filter(n => n.rankIndex >= state.player.rankIndex);
        addRep(state, f.id, RNG.int(7, 13));
        addHeat(state, 6);
        if (targets.length) {
          const victim = RNG.pick(targets);
          victim.grudge = clamp(victim.grudge + 55, 0, 100);
          const lines = [`You sit on the board that removes ${victim.name}.`];
          if (RNG.chance(0.4)) {
            lines.push.apply(lines, killNPC(state, victim));
          } else {
            lines.push(`${victim.name} survives the process and remembers the seating plan.`);
          }
          return lines;
        }
        return ['You sit on the board. There is nobody left to remove but the furniture.'];
      } },
      { label: 'Warn the people about to be removed', outcome(state) {
        const f = state.factions[state.player.factionId];
        const friends = npcsOfFaction(state, f.id);
        if (friends.length) {
          const saved = RNG.pick(friends);
          saved.loyalty = clamp(saved.loyalty - 25, 0, 100);
          saved.grudge = 0;
          f.playerHostility = clamp(f.playerHostility + 14, 0, 100);
          addRep(state, f.id, -RNG.int(3, 8));
          return [`${saved.name} is out of the district before the knock comes.`,
                  'Somebody will eventually work out who warned them.'];
        }
        return ['There is nobody left to warn.'];
      } },
    ],
  },

  {
    id: 'rival_move', w: 7,
    when: (s) => s.npcs.some(n => n.alive && n.isRival && n.factionId === s.player.factionId),
    title: 'THE RIVAL MOVES',
    body(state) {
      const rival = state.npcs.find(n => n.alive && n.isRival && n.factionId === state.player.factionId);
      state._incidentNPC = rival ? rival.id : null;
      return rival
        ? `${rival.name}, who holds the seat you once did, has spent the week talking ` +
          'about you in rooms you are not invited to.'
        : 'A rival moves against you.';
    },
    choices: [
      { label: 'Answer it politically', outcome(state) {
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
      } },
      { label: 'Ignore it', outcome(state) {
        const rival = npcById(state, state._incidentNPC);
        if (rival) rival.grudge = clamp(rival.grudge + 12, 0, 100);
        addRep(state, state.player.factionId, -2);
        return ['You let it stand. It hardens into fact by the weekend.'];
      } },
      { label: 'Offer them a truce', outcome(state) {
        const rival = npcById(state, state._incidentNPC);
        if (!rival) return ['The moment passes.'];
        if (RNG.chance(0.35)) {
          rival.grudge = clamp(rival.grudge - 30, 0, 100);
          return [`You meet ${rival.name} somewhere neutral. It holds. For now.`];
        }
        rival.grudge = clamp(rival.grudge + 15, 0, 100);
        return [`${rival.name} takes the offer as an admission of weakness, and files it.`];
      } },
    ],
  },

  {
    id: 'opportunity', w: 5, when: (s) => !!s.player.factionId && s.player.rankIndex >= 2,
    title: 'A SEAT COMES OPEN',
    body: () => 'A vacancy above you has appeared without your help, and there is a ' +
                'short window in which it can be spoken for.',
    choices: [
      { label: 'Move on it hard', outcome(state) {
        const p = state.player;
        const odds = clamp(0.35 + repWith(state, p.factionId) * 0.004, 0.1, 0.8);
        addMoney(state, -Math.min(Math.max(p.money, 0), 800));
        if (RNG.chance(odds) && p.rankIndex < RANK_COUNT - 1) {
          p.rankIndex += 1;
          addTerritory(state, 2);
          return [`You are confirmed as ${playerRankTitle(state)}. +2 territory.`];
        }
        addRep(state, p.factionId, -4);
        return ['Someone with better patronage takes it. -4 standing, and 800cr of favours wasted.'];
      } },
      { label: 'Back someone else and bank the favour', outcome(state) {
        addRep(state, state.player.factionId, RNG.int(3, 6));
        state.factions[state.player.factionId].playerDebt += 2;
        return ['You put your weight behind a colleague. They remember. For now.'];
      } },
    ],
  },

  {
    id: 'defection_offer', w: 4, when: (s) => !!s.player.factionId && s.player.rankIndex >= 2,
    title: 'AN OFFER OF A DIFFERENT FLAG',
    body(state) {
      const others = Object.values(state.factions).filter(f =>
        f.id !== state.player.factionId && !f.defunct);
      const f = RNG.pick(others);
      state._incidentFaction = f.id;
      return `${f.def.name} sends somebody senior to ask, in a roundabout way, what it ` +
             'would take to move you across.';
    },
    choices: [
      { label: 'Name a price and take it seriously', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addRep(state, f.id, RNG.int(8, 15));
        addMoney(state, RNG.int(500, 2000));
        addRep(state, state.player.factionId, -RNG.int(3, 7));
        return [`${f.def.short} pays a retainer against a future you have not agreed to yet.`];
      } },
      { label: 'Report the approach to your own leadership', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addRep(state, state.player.factionId, RNG.int(5, 10));
        f.playerHostility = clamp(f.playerHostility + 18, 0, 100);
        return ['Your loyalty is noted in writing, which is the only place it counts.'];
      } },
      { label: 'Say nothing to anyone',
        outcome: () => ['You keep it to yourself. Options are worth more unspent.'] },
    ],
  },

  /* ============================ HEAT / THE LAW =========================== */
  {
    id: 'audit', w: 6, when: (s) => s.player.heat > 30,
    title: 'FILE REVIEW',
    body: () => 'Someone has pulled your file and read all of it, including the parts ' +
                'you assumed nobody had bothered to write down.',
    choices: [
      { label: 'Pay the review closed', outcome(state) {
        const fine = RNG.int(400, 1500);
        addMoney(state, -fine);
        addHeat(state, -18);
        return [`${fine}cr closes the review. Cheaper than the alternative, as intended.`];
      } },
      { label: 'Let it run', outcome(state) {
        if (RNG.chance(0.4)) {
          addHeat(state, 12);
          return ['The review stays open and grows a second volume.'];
        }
        addHeat(state, -8);
        return ['The reviewer is reassigned to something more urgent. The file goes back in the drawer.'];
      } },
    ],
  },

  {
    id: 'informant', w: 5, when: (s) => s.player.heat > 20,
    title: 'AN INFORMANT IN THE BLOCK',
    body: () => 'Somebody on your block is reporting movements. You have a fairly ' +
                'good idea who, and no proof at all.',
    choices: [
      { label: 'Feed them something false', outcome(state) {
        if (RNG.chance(0.6)) {
          addHeat(state, -14);
          return ['You give them a week of fiction. It goes upward and wastes somebody\'s month.'];
        }
        addHeat(state, 8);
        return ['They were smarter than that, or better supervised.'];
      } },
      { label: 'Buy them', outcome(state) {
        const cost = RNG.int(300, 900);
        addMoney(state, -cost);
        addHeat(state, -10);
        return [`${cost}cr buys you a friendly informant, which is better than no informant.`];
      } },
      { label: 'Deal with them', outcome(state) {
        addHeat(state, 15);
        if (RNG.chance(0.7)) {
          addTerritory(state, RNG.chance(0.3) ? 1 : 0);
          return ['The reporting stops. The block understands why, and is quieter with you now.'];
        }
        addHeat(state, 10);
        return ['You get the wrong person. The reporting continues, and now includes this.'];
      } },
    ],
  },

  {
    id: 'checkpoint', w: 6, when: () => true,
    title: 'CHECKPOINT',
    body: () => 'A new checkpoint has gone up between your billet and your work, ' +
                'manned by people with no obvious authority and a great deal of equipment.',
    choices: [
      { label: 'Pay the toll daily', outcome(state) {
        addMoney(state, -RNG.int(150, 450));
        return ['You pay it every morning like a tax, because it is one.'];
      } },
      { label: 'Take the long route', outcome(state) {
        addMoney(state, -RNG.int(40, 120));
        return ['Two extra hours a day. Your week disappears into walking.'];
      } },
      { label: 'Argue the legality of it', outcome(state) {
        if (RNG.chance(0.3)) {
          if (state.player.factionId) addRep(state, state.player.factionId, 3);
          return ['You cite an instrument at them and they fold. Somebody in the queue applauds.'];
        }
        addHeat(state, 10);
        addMoney(state, -RNG.int(100, 400));
        return ['They hold you for six hours and lose your papers on purpose.'];
      } },
    ],
  },

  /* ============================ WORLD EVENTS ============================= */
  {
    id: 'blackout', w: 6, when: () => true,
    title: 'CORRIDOR BLACKOUT',
    body: () => 'The grid drops for nine days. Pumps stop. Stacks warm. The relays go ' +
                'silent and rumour fills the gap.',
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
    id: 'flood', w: 5, when: () => true,
    title: 'INTRUSION EVENT',
    body: () => 'Saltwater comes up through the substructure again. The maps are ' +
                'twenty years out of date and nobody is redrawing them.',
    auto(state) {
      if (state.player.territory > 0 && RNG.chance(0.5)) {
        const lost = Math.min(state.player.territory, RNG.int(1, 3));
        addTerritory(state, -lost);
        return [`Two of your wards are under a metre of brine. -${lost} territory.`];
      }
      const cost = RNG.int(100, 400);
      addMoney(state, -cost);
      return [`Pumping and filtration cost you ${cost}cr this week.`];
    },
  },

  {
    id: 'heat_dome', w: 4, when: () => true,
    title: 'HEAT DOME',
    body: () => 'Eleven consecutive days above survivable wet-bulb. The clinics stop ' +
                'counting at four hundred.',
    auto(state) {
      const cost = RNG.int(200, 700);
      addMoney(state, -cost);
      for (const f of Object.values(state.factions)) {
        if (!f.defunct) f.unrestPressure = clamp(f.unrestPressure + RNG.int(3, 10), 0, 100);
      }
      return [`Cooling and water cost you ${cost}cr.`,
              'The district loses people it will not replace.'];
    },
  },

  {
    id: 'epidemic', w: 4, when: () => true,
    title: 'FEVER SEASON',
    body: () => 'Something is moving through the low blocks. The clinic has three ' +
                'antibiotics and a waiting list of nine hundred.',
    choices: [
      { label: 'Fund the clinic', outcome(state) {
        const cost = Math.min(Math.max(state.player.money, 0), RNG.int(600, 1800));
        addMoney(state, -cost);
        addTerritory(state, RNG.chance(0.6) ? 2 : 1);
        if (state.player.factionId) addRep(state, state.player.factionId, 4);
        return [`${cost}cr to the clinic. People who would have died do not, and they know your name.`];
      } },
      { label: 'Buy the stock and hold it', outcome(state) {
        addMoney(state, RNG.int(800, 2400));
        addHeat(state, 12);
        if (state.player.factionId) addRep(state, state.player.factionId, -7);
        return ['You corner the supply and sell it at what the market will bear. It bears a great deal.'];
      } },
      { label: 'Stay out of it', outcome(state) {
        if (RNG.chance(0.25)) {
          state.player.imprisonedWeeks = Math.max(state.player.imprisonedWeeks, 1);
          return ['You catch it yourself. A week goes by that you do not remember.'];
        }
        return ['It burns through the low blocks and stops two streets short of yours.'];
      } },
    ],
  },

  {
    id: 'strike', w: 5, when: () => true,
    title: 'SECTOR STRIKE',
    body(state) {
      return `The ${SECTORS[state.player.sector].name.toLowerCase()} workers have stopped. ` +
             'Not a negotiation — a stoppage. Both sides are waiting to see who moves.';
    },
    choices: [
      { label: 'Stand with the line', outcome(state) {
        addMoney(state, -RNG.int(200, 500));
        addTerritory(state, RNG.chance(0.55) ? 2 : 1);
        if (state.player.factionId) {
          const f = state.factions[state.player.factionId];
          f.unrestPressure = clamp(f.unrestPressure + 8, 0, 100);
          addRep(state, f.id, f.legalism > 60 ? -4 : 4);
        }
        return ['You lose a week of pay and gain something that does not fit on a ledger.'];
      } },
      { label: 'Cross it', outcome(state) {
        addMoney(state, RNG.int(400, 900));
        if (state.player.territory > 0) addTerritory(state, -1);
        if (state.player.factionId) addRep(state, state.player.factionId, 3);
        return ['You work. Management notices. So does everyone else, permanently.'];
      } },
      { label: 'Broker between the two', outcome(state) {
        const odds = clamp(0.35 + repWith(state, state.player.factionId) * 0.004, 0.1, 0.8);
        if (RNG.chance(odds)) {
          if (state.player.factionId) addRep(state, state.player.factionId, RNG.int(6, 11));
          addTerritory(state, 1);
          return ['You put a deal together that neither side likes and both sides sign.'];
        }
        if (state.player.factionId) addRep(state, state.player.factionId, -5);
        return ['You end up trusted by nobody, which is the ordinary fate of brokers.'];
      } },
    ],
  },

  {
    id: 'convoy_ambush', w: 4, when: () => true,
    title: 'CONVOY AMBUSHED',
    body(state) {
      const live = Object.values(state.factions).filter(f => !f.defunct);
      const f = RNG.pick(live);
      state._incidentFaction = f.id;
      return `A ${f.def.short} convoy is hit on the district road. The wreck is still ` +
             'burning and the cargo is still in it.';
    },
    choices: [
      { label: 'Strip the wreck', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addMoney(state, RNG.int(700, 2200));
        addHeat(state, 14);
        addRep(state, f.id, -RNG.int(3, 8));
        f.playerHostility = clamp(f.playerHostility + 12, 0, 100);
        return ['You take what will fit in a handcart. So does everyone else.'];
      } },
      { label: 'Secure it and call it in', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addRep(state, f.id, RNG.int(5, 10));
        f.playerDebt += 1;
        return [`You hold the site until ${f.def.short} arrives. They take note of who did that.`];
      } },
      { label: 'Pull the driver out first', outcome(state) {
        const f = state.factions[state._incidentFaction];
        if (RNG.chance(0.6)) {
          addRep(state, f.id, RNG.int(7, 13));
          f.playerDebt += 2;
          return ['The driver lives. Drivers talk, and this one talks about you.'];
        }
        return ['The driver does not live. You carry them out anyway, which is seen.'];
      } },
    ],
  },

  {
    id: 'refugees', w: 5, when: () => true,
    title: 'ARRIVALS',
    body: () => 'Two hundred people arrive from a district that no longer supports ' +
                'habitation. They have papers for a place that does not exist.',
    choices: [
      { label: 'Find them space in your wards', outcome(state) {
        addMoney(state, -RNG.int(200, 700));
        addTerritory(state, RNG.chance(0.5) ? 1 : 0);
        if (state.player.factionId) addRep(state, state.player.factionId, 2);
        return ['You take them in. In six months some of them will work for you.'];
      } },
      { label: 'Sell them papers', outcome(state) {
        addMoney(state, RNG.int(600, 1600));
        addHeat(state, 12);
        return ['Forged district papers at eight hundred a sheet. They pay because there is no alternative.'];
      } },
      { label: 'Turn them back at the line', outcome(state) {
        if (state.player.factionId) {
          const f = state.factions[state.player.factionId];
          addRep(state, f.id, f.legalism > 60 ? 4 : 1);
        }
        return ['They go somewhere else. Everyone in the queue watches you decide it.'];
      } },
    ],
  },

  {
    id: 'election_week', w: 5, when: (s) => Object.values(s.factions).some(f => !f.defunct && !f.suppressingElections),
    title: 'A COUNT IS HELD',
    body(state) {
      const f = RNG.pick(Object.values(state.factions).filter(x => !x.defunct && !x.suppressingElections));
      state._incidentFaction = f.id;
      return `${f.def.name} is holding an actual count in your district. Turnout will ` +
             'be low and the result will be contested regardless.';
    },
    choices: [
      { label: 'Turn out your wards for it', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addRep(state, f.id, RNG.int(4, 9));
        addTerritory(state, RNG.chance(0.4) ? 1 : 0);
        return [`Your blocks vote in a bloc. ${f.def.short} notices the size of the bloc.`];
      } },
      { label: 'Sell the bloc to the highest bidder', outcome(state) {
        addMoney(state, RNG.int(700, 2200));
        addHeat(state, 9);
        if (state.player.factionId) addRep(state, state.player.factionId, -3);
        return ['Four hundred votes, delivered and paid for. This is how it is done everywhere.'];
      } },
      { label: 'Spoil it', outcome(state) {
        const f = state.factions[state._incidentFaction];
        f.playerHostility = clamp(f.playerHostility + 15, 0, 100);
        addRep(state, f.id, -RNG.int(4, 9));
        f.unrestPressure = clamp(f.unrestPressure + 10, 0, 100);
        return ['The count is annulled on irregularities you personally manufactured.'];
      } },
    ],
  },

  /* ========================== PERSONAL / QUIET =========================== */
  {
    id: 'old_friend', w: 5, when: () => true,
    title: 'SOMEONE FROM BEFORE',
    body: () => 'Somebody you knew before any of this finds you at the depot gate. ' +
                'They are not doing well and they are not asking yet.',
    choices: [
      { label: 'Give them money', outcome(state) {
        addMoney(state, -RNG.int(200, 800));
        return ['You give them what you have on you. They do not thank you, which is fair.'];
      } },
      { label: 'Give them work', outcome(state) {
        addMoney(state, -RNG.int(100, 300));
        addTerritory(state, RNG.chance(0.35) ? 1 : 0);
        return ['You put them on a ward. They are competent and grateful and that is worth something.'];
      } },
      { label: 'Tell them you cannot help', outcome(state) {
        if (RNG.chance(0.3)) addHeat(state, 4);
        return ['You say no. They take it well, which is worse than if they had not.'];
      } },
    ],
  },

  {
    id: 'letter', w: 4, when: () => true,
    title: 'CORRESPONDENCE',
    body: () => 'A letter arrives, actual paper, from an address in a district that ' +
                'was evacuated four years ago. It is addressed to you by your full name.',
    choices: [
      { label: 'Read it', outcome(state) {
        return [RNG.pick([
          'It is from somebody who thinks you are somebody else. You read all of it anyway.',
          'It is a list of names. Eleven of them. Two you recognise.',
          'It is an invoice for a service you did not receive, dated next year.',
          'It is a page of a ledger with your ward numbers on it, and no explanation.',
          'It is blank except for a district stamp. The stamp is real.',
        ])];
      } },
      { label: 'Burn it unread', outcome(state) {
        addHeat(state, -3);
        return ['You burn it in the sink. You think about it for a month.'];
      } },
      { label: 'Take it to your faction', outcome(state) {
        if (!state.player.factionId) return ['You have no faction to take it to. You keep it.'];
        addRep(state, state.player.factionId, RNG.int(1, 4));
        addHeat(state, 3);
        return ['They keep the letter and do not tell you what was in it.'];
      } },
    ],
  },

  {
    id: 'archive_find', w: 3, when: () => true,
    title: 'A FIND',
    body: () => 'Clearing a flooded substructure, somebody turns up a sealed crate of ' +
                'pre-collapse administrative records. Nobody knows what is in it yet.',
    choices: [
      { label: 'Sell it to the Remnant', outcome(state) {
        const rem = state.factions['remnant'];
        addMoney(state, RNG.int(900, 2600));
        if (rem && !rem.defunct) { addRep(state, 'remnant', RNG.int(4, 9)); rem.playerDebt += 1; }
        return ['The Civil Remnant pays properly for paper. It is the only thing they pay properly for.'];
      } },
      { label: 'Read it first', outcome(state) {
        addSpecialization(state, 'archivist');
        addMoney(state, RNG.int(200, 700));
        return ['Property deeds, ward boundaries, and the names of people who owned this district.',
                'You now know things about your own ground that your superiors do not.'];
      } },
      { label: 'Burn it', outcome(state) {
        addHeat(state, -8);
        for (const f of Object.values(state.factions)) {
          if (!f.defunct) f.playerHostility = clamp(f.playerHostility - 3, 0, 100);
        }
        return ['Some records are safer as ash. Several people are quietly relieved.'];
      } },
    ],
  },

  {
    id: 'sabotage_offer', w: 4, when: (s) => s.player.rankIndex !== null && s.player.rankIndex >= 1,
    title: 'AN OFFER OF SABOTAGE',
    body(state) {
      const others = Object.values(state.factions).filter(f =>
        f.id !== state.player.factionId && !f.defunct);
      const f = RNG.pick(others);
      state._incidentFaction = f.id;
      return `Somebody offers you a great deal of money to make a ${f.def.short} ` +
             'installation stop working for a fortnight. They have already paid the deposit.';
    },
    choices: [
      { label: 'Do it', outcome(state) {
        const f = state.factions[state._incidentFaction];
        if (RNG.chance(clamp(0.55 + state.player.territory * 0.006, 0.2, 0.85))) {
          addMoney(state, RNG.int(1500, 4000));
          f.power = clamp(f.power - RNG.int(2, 5), 0, 100);
          f.playerHostility = clamp(f.playerHostility + 10, 0, 100);
          addHeat(state, 16);
          addSpecialization(state, 'sabotage');
          return ['It goes dark for sixteen days. Nobody can prove anything, but the deposit clears.'];
        }
        addHeat(state, 28);
        f.playerHostility = clamp(f.playerHostility + 35, 0, 100);
        addMoney(state, -RNG.int(200, 800));
        return ['You are seen leaving. Not identified — seen. That is enough to start with.'];
      } },
      { label: 'Return the deposit', outcome(state) {
        return ['You give the money back, which almost nobody does, and is remembered as strange.'];
      } },
      { label: 'Keep the deposit and do nothing', outcome(state) {
        addMoney(state, RNG.int(400, 1200));
        addHeat(state, 6);
        if (RNG.chance(0.4)) {
          const npcs = state.npcs.filter(n => n.alive);
          if (npcs.length) {
            const angry = RNG.pick(npcs);
            angry.grudge = clamp(angry.grudge + 45, 0, 100);
            return ['You keep it. Whoever fronted it works out who kept it.',
                    `${angry.name} is asking about you by name.`];
          }
        }
        return ['You keep it. Nothing happens. Nothing has happened yet.'];
      } },
    ],
  },

  {
    id: 'ward_dispute', w: 5, when: (s) => s.player.territory >= 3,
    title: 'WARD DISPUTE',
    body: () => 'Two of your wards are in a dispute over a generator, a stairwell, and ' +
                'about forty years of grievance. They are waiting for you to rule on it.',
    choices: [
      { label: 'Rule for the larger ward', outcome(state) {
        addTerritory(state, RNG.chance(0.5) ? 1 : 0);
        return ['You rule with the numbers. The smaller ward remembers that you did.'];
      } },
      { label: 'Rule for the smaller ward', outcome(state) {
        if (state.player.factionId) addRep(state, state.player.factionId, 2);
        return ['You rule against the numbers. It costs you nothing this week.'];
      } },
      { label: 'Refuse to rule', outcome(state) {
        addTerritory(state, -1);
        return ['You send them away to settle it themselves. They settle it with a fire.'];
      } },
      { label: 'Take the generator yourself', outcome(state) {
        addMoney(state, RNG.int(400, 1100));
        addTerritory(state, -1);
        return ['You take the generator and the dispute ends immediately, as does the goodwill.'];
      } },
    ],
  },

  {
    id: 'protege', w: 4, when: (s) => s.player.rankIndex !== null && s.player.rankIndex >= 2,
    title: 'SOMEBODY WANTS TO LEARN',
    body: () => 'A young operator has attached themselves to you and is asking the ' +
                'kind of questions that mean they intend to do this properly.',
    choices: [
      { label: 'Teach them', outcome(state) {
        const f = state.factions[state.player.factionId];
        if (f) {
          const usedNames = new Set(state.npcs.map(n => n.name));
          const npc = makeNPC(f.id, Math.max(0, state.player.rankIndex - 1), usedNames);
          npc.loyalty = RNG.int(70, 98);
          npc.note = 'Trained by you personally.';
          state.npcs.push(npc);
          f.memberIds.push(npc.id);
          addRep(state, f.id, 2);
          return [`${npc.name} becomes yours in the way that matters. High loyalty.`];
        }
        return ['You teach them what you know, which takes an afternoon.'];
      } },
      { label: 'Use them and tell them nothing', outcome(state) {
        addMoney(state, RNG.int(200, 700));
        return ['They do your legwork for a month. They learn nothing and resent that eventually.'];
      } },
      { label: 'Send them away', outcome(state) {
        return ['You tell them to find honest work. There is none, and you both know it.'];
      } },
    ],
  },

  {
    id: 'press', w: 4, when: (s) => s.player.rankIndex !== null && s.player.rankIndex >= 2,
    title: 'A JOURNALIST',
    body: () => 'One of the four remaining newspapers wants to talk to you about ' +
                'allocation in your district. They already have documents.',
    choices: [
      { label: 'Talk to them on the record', outcome(state) {
        if (state.player.factionId) {
          const f = state.factions[state.player.factionId];
          addRep(state, f.id, f.legalism > 60 ? 5 : -6);
          f.playerHostility = clamp(f.playerHostility + (f.legalism > 60 ? 0 : 12), 0, 100);
        }
        addTerritory(state, RNG.chance(0.4) ? 1 : 0);
        return ['Your name is in print, spelled correctly, attached to your own words.',
                'This is either the beginning of something or the end of something.'];
      } },
      { label: 'Give them somebody else', outcome(state) {
        const pool = state.player.factionId ? npcsOfFaction(state, state.player.factionId) : [];
        if (pool.length) {
          const victim = RNG.pick(pool);
          victim.grudge = clamp(victim.grudge + 35, 0, 100);
          addHeat(state, -6);
          return [`The story runs with ${victim.name}'s name in the headline instead of yours.`];
        }
        return ['You give them a name. It is not a name that matters.'];
      } },
      { label: 'Have the documents taken', outcome(state) {
        addHeat(state, 18);
        if (RNG.chance(0.65)) return ['The documents are recovered. The journalist is not seen again in this district.'];
        return ['The attempt fails and the story now has a second half.'];
      } },
    ],
  },

  {
    id: 'own_faction_crisis', w: 6, when: (s) => !!s.player.ownFactionId,
    title: 'YOUR PEOPLE WANT ANSWERS',
    body(state) {
      const f = state.factions[state.player.ownFactionId];
      return `${f.def.name} has gone four weeks without a clear direction. Your ` +
             'lieutenants are asking what it is you actually intend to do.';
    },
    choices: [
      { label: 'Spend money to hold them', outcome(state) {
        const f = state.factions[state.player.ownFactionId];
        const cost = Math.min(Math.max(state.player.money, 0), RNG.int(1200, 3500));
        addMoney(state, -cost);
        f.power = clamp(f.power + RNG.int(3, 7), 0, 100);
        return [`${cost}cr in wages, weapons and promises. It holds.`];
      } },
      { label: 'Give them a war to fight', outcome(state) {
        const f = state.factions[state.player.ownFactionId];
        const enemies = Object.values(state.factions).filter(o => !o.defunct && o.id !== f.id);
        f.power = clamp(f.power + RNG.int(2, 5), 0, 100);
        f.militancy = clamp(f.militancy + 12, 0, 100);
        if (enemies.length) {
          const e = RNG.pick(enemies);
          e.playerHostility = clamp(e.playerHostility + 25, 0, 100);
          f.relations[e.id] = clamp((f.relations[e.id] || 0) - 30, -100, 100);
          e.relations[f.id] = clamp((e.relations[f.id] || 0) - 30, -100, 100);
          return [`You point them at ${e.def.short}. Purpose restored, at the usual price.`];
        }
        return ['You point them at the horizon and they go.'];
      } },
      { label: 'Tell them the truth', outcome(state) {
        const f = state.factions[state.player.ownFactionId];
        if (RNG.chance(0.45)) {
          f.power = clamp(f.power + 2, 0, 100);
          return ['You tell them you do not know yet. Some of them respect it. Some leave.'];
        }
        f.power = clamp(f.power - RNG.int(2, 6), 0, 100);
        return ['Honesty costs you a third of your strength inside a fortnight.'];
      } },
    ],
  },

  {
    id: 'faction_summit', w: 4, when: (s) => !!s.player.factionId && s.player.rankIndex >= 3,
    title: 'A SUMMIT',
    body(state) {
      const others = Object.values(state.factions).filter(f =>
        f.id !== state.player.factionId && !f.defunct);
      const f = RNG.pick(others);
      state._incidentFaction = f.id;
      return `You are sent to negotiate with ${f.def.name} over a boundary nobody has ` +
             'agreed on since before the collapse. You are sent alone.';
    },
    choices: [
      { label: 'Negotiate in good faith', outcome(state) {
        const f = state.factions[state._incidentFaction];
        const own = state.factions[state.player.factionId];
        f.relations[own.id] = clamp((f.relations[own.id] || 0) + 15, -100, 100);
        own.relations[f.id] = clamp((own.relations[f.id] || 0) + 15, -100, 100);
        addRep(state, own.id, RNG.int(4, 8));
        addRep(state, f.id, RNG.int(3, 7));
        return ['A boundary is agreed. It will hold for perhaps two years, which is a long time now.'];
      } },
      { label: 'Sell your own side out quietly', outcome(state) {
        const f = state.factions[state._incidentFaction];
        addMoney(state, RNG.int(2000, 6000));
        addRep(state, f.id, RNG.int(8, 15));
        addRep(state, state.player.factionId, -RNG.int(6, 12));
        f.playerDebt += 2;
        return ['You give away three streets that were not yours to give. The payment is immediate.'];
      } },
      { label: 'Sabotage the talks', outcome(state) {
        const f = state.factions[state._incidentFaction];
        const own = state.factions[state.player.factionId];
        f.relations[own.id] = clamp((f.relations[own.id] || 0) - 25, -100, 100);
        own.militancy = clamp(own.militancy + 8, 0, 100);
        addRep(state, own.id, own.militancy > 60 ? RNG.int(3, 8) : -RNG.int(2, 6));
        return ['The talks collapse in ninety minutes. Somebody wanted that, and now owes you.'];
      } },
    ],
  },

  {
    id: 'windfall', w: 3, when: () => true,
    title: 'AN UNEXPECTED SUM',
    body: () => 'Money arrives in an account you had forgotten you controlled, from a ' +
                'source that does not resolve to anybody.',
    choices: [
      { label: 'Spend it immediately', outcome(state) {
        const amt = RNG.int(800, 3000);
        addMoney(state, amt);
        return [`${amt}cr, spent before anyone can ask about it. This is the correct move.`];
      } },
      { label: 'Trace where it came from', outcome(state) {
        if (RNG.chance(0.4)) {
          const npcs = state.npcs.filter(n => n.alive);
          const from = npcs.length ? RNG.pick(npcs) : null;
          addMoney(state, RNG.int(400, 1500));
          if (from) {
            from.corruptionTaste = clamp(from.corruptionTaste + 15, 0, 100);
            return [`It came through ${from.name}. They wanted you to be able to find that out.`];
          }
        }
        addMoney(state, RNG.int(400, 1500));
        addHeat(state, 6);
        return ['The trail ends at a shell ward in a district with no people in it.'];
      } },
      { label: 'Refuse it and report it', outcome(state) {
        if (state.player.factionId) addRep(state, state.player.factionId, RNG.int(3, 8));
        addHeat(state, -10);
        return ['You hand it over untouched. Everyone assumes you kept some. You did not.'];
      } },
    ],
  },

  /* --- Auto-resolving colour with small mechanical bite ------------------- */
  {
    id: 'promotion_freeze', w: 4, when: (s) => !!s.player.factionId,
    title: 'ESTABLISHMENT FREEZE',
    body(state) {
      const f = state.factions[state.player.factionId];
      return `${f.def.short} freezes all appointments pending a structural review.`;
    },
    auto(state) {
      const f = state.factions[state.player.factionId];
      f.corruption = clamp(f.corruption + RNG.int(1, 4), 0, 100);
      return ['Nobody is promoted this month. Two people are promoted anyway, quietly.'];
    },
  },

  {
    id: 'market_swing', w: 5, when: () => true,
    title: 'MARKET MOVEMENT',
    body: () => 'The grey market moves against everybody at once, for reasons nobody in ' +
                'the district is positioned to understand.',
    auto(state) {
      const swing = RNG.int(-600, 900);
      addMoney(state, swing);
      return [swing >= 0
        ? `Scrip revalues in your favour. +${swing}cr.`
        : `Scrip revalues against you. ${swing}cr.`];
    },
  },

  {
    id: 'quiet', w: 26, when: () => true,
    title: null,          // drawn from QUIET_TITLES at resolve time
    quiet: true,          // handled specially: pure ambient world texture
  },
];

/* =============================================================================
 * BONUS CHOICES — extra options that attach to an incident AT RANDOM.
 *
 * Each has a condition and an independent chance. Up to two are appended to
 * any incident that offers choices, so the option list is never fully
 * predictable: the same event can present an angle this time that it did not
 * present last time.
 * ========================================================================= */
const BONUS_CHOICES = [
  {
    id: 'muscle', chance: 0.22,
    cond: (s) => s.player.territory >= 8,
    label: 'Bring your own people to it',
    outcome(state) {
      if (RNG.chance(clamp(0.5 + state.player.territory * 0.008, 0.2, 0.9))) {
        addTerritory(state, 1);
        if (state.player.factionId) addRep(state, state.player.factionId, 2);
        return ['You arrive with thirty people and the situation resolves itself on sight.'];
      }
      addTerritory(state, -1);
      addHeat(state, 8);
      return ['You arrive with thirty people and it becomes a different, worse situation.'];
    },
  },
  {
    id: 'buyout', chance: 0.22,
    cond: (s) => s.player.money >= 2500,
    label: 'Pay somebody else to make it go away',
    outcome(state) {
      const cost = RNG.int(900, 2400);
      addMoney(state, -cost);
      addHeat(state, -4);
      return [`${cost}cr and a phone call. You never learn what was actually done.`];
    },
  },
  {
    id: 'leverage', chance: 0.28,
    cond: (s) => s.player.specializations.includes('blackmail'),
    label: 'Use what you know about someone involved',
    outcome(state) {
      const pool = state.npcs.filter(n => n.alive && n.factionId === state.player.factionId);
      if (!pool.length) return ['There is nobody here you have anything on.'];
      const target = RNG.pick(pool);
      if (RNG.chance(0.65)) {
        if (state.player.factionId) addRep(state, state.player.factionId, RNG.int(3, 7));
        target.grudge = clamp(target.grudge + 25, 0, 100);
        return [`You mention ${target.name}'s arrangement in ${CONFIG.START_YEAR - RNG.int(2, 8)}. The matter closes.`];
      }
      target.grudge = clamp(target.grudge + 40, 0, 100);
      addHeat(state, 10);
      return [`${target.name} calls the bluff, loudly, in front of people who matter.`];
    },
  },
  {
    id: 'legal', chance: 0.25,
    cond: (s) => s.player.specializations.includes('legislative'),
    label: 'Cite an instrument at them',
    outcome(state) {
      if (RNG.chance(0.6)) {
        if (state.player.factionId) addRep(state, state.player.factionId, RNG.int(2, 6));
        return ['You read the relevant paragraph aloud twice. Paperwork still terrifies people.'];
      }
      return ['The instrument does not cover this and you are told so by somebody who wrote it.'];
    },
  },
  {
    id: 'faction_call', chance: 0.20,
    cond: (s) => !!s.player.factionId && s.player.rankIndex >= 2,
    label: 'Escalate it to your faction',
    outcome(state) {
      const f = state.factions[state.player.factionId];
      if (RNG.chance(0.55)) {
        f.playerDebt = Math.max(0, f.playerDebt - 1);
        return [`${f.def.short} sends people. The matter is handled in the way ${f.def.short} handles things.`];
      }
      addRep(state, f.id, -3);
      return ['You are told, at length, that this is beneath the organisation and beneath you.'];
    },
  },
  {
    id: 'wetwork', chance: 0.16,
    cond: (s) => s.player.specializations.includes('wetwork') && s.player.money >= 1200,
    label: 'Handle it permanently',
    outcome(state) {
      addMoney(state, -RNG.int(800, 1800));
      addHeat(state, 20);
      if (RNG.chance(0.7)) {
        if (state.player.factionId) {
          const f = state.factions[state.player.factionId];
          f.corruption = clamp(f.corruption + 2, 0, 100);
        }
        return ['It stops being a problem on Tuesday. Nobody raises it again.'];
      }
      addHeat(state, 15);
      const pool = state.npcs.filter(n => n.alive);
      if (pool.length) {
        const witness = RNG.pick(pool);
        witness.grudge = clamp(witness.grudge + 45, 0, 100);
        return ['It is done badly and seen being done.',
                `${witness.name} was there, and has not said anything yet.`];
      }
      return ['It is done badly and seen being done.'];
    },
  },
  {
    id: 'walk', chance: 0.18,
    cond: () => true,
    label: 'Have nothing to do with any of it',
    outcome(state) {
      addHeat(state, -5);
      return [RNG.pick([
        'You go home. The week closes over it like water.',
        'You decline to be involved and are not asked twice.',
        'You are somewhere else when it happens, deliberately.',
      ])];
    },
  },
  {
    id: 'archive', chance: 0.20,
    cond: (s) => s.player.specializations.includes('archivist'),
    label: 'Check it against the old records',
    outcome(state) {
      if (RNG.chance(0.6)) {
        addMoney(state, RNG.int(300, 1100));
        return ['The pre-collapse deed says something entirely different, and you are the only one holding it.'];
      }
      return ['The records for this ward were lost in the same flood as everything else.'];
    },
  },
];

/* Attach 0-2 random bonus choices to an incident's menu. */
function withBonusChoices(state, choices) {
  const out = choices.slice();
  const eligible = BONUS_CHOICES.filter(b => {
    try { return b.cond(state) && RNG.chance(b.chance); } catch (e) { return false; }
  });
  for (const b of RNG.shuffle(eligible).slice(0, 2)) {
    out.push({ label: b.label, outcome: b.outcome, bonus: true });
  }
  return out;
}
