/* =============================================================================
 * ui.js — Rendering and input. Terminal/dossier presentation over STATE.
 *
 * No framework, no templating library. Everything is built with DOM calls or
 * assembled strings that are inserted with textContent where the content is
 * player-supplied (faction names), so nothing user-typed is ever parsed as HTML.
 * ========================================================================= */

const UI = {
  tab: 'ops',
  targetPanel: null,   // 'assassinate' | 'bribe' | 'blackmail' | 'join' | 'return' | 'found'
};

function $(id) { return document.getElementById(id); }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function crestOf(faction) {
  return faction.def.crest;
}

/* ---------------------------------------------------------------------------
 * BOOT / SETUP SCREEN
 * ------------------------------------------------------------------------- */
function renderSetup() {
  const region = REGIONS.find(r => r.id === STATE.player.regionId);
  const root = $('screen-setup');
  root.innerHTML = '';

  const head = el('div', 'setup-head');
  head.appendChild(el('h1', null, 'CONTINUITY OF GOVERNMENT'));
  head.appendChild(el('div', 'subtitle',
    'A SURVIVAL RECORD // ' + CONFIG.START_YEAR + ' // CASE FILE ' +
    STATE.seed.toString(16).toUpperCase()));
  root.appendChild(head);

  const brief = el('div', 'panel');
  brief.appendChild(el('div', 'panel-title', 'SITUATION'));
  brief.appendChild(el('p', 'body',
    'The heat came first, then the water, then the food. There was no war worth ' +
    'the name — the grid simply stopped reaching most of the country, and the ' +
    'parts of the state that could still pay people kept them. Four powers hold ' +
    'what is left. All of them are armed. All of them are corrupt in their own ' +
    'idiom. There is no ending to this record except your death or your ' +
    'irrelevance.'));
  root.appendChild(brief);

  const hist = el('div', 'panel');
  hist.appendChild(el('div', 'panel-title', 'PRIOR DECADE — ABSTRACT'));
  for (const h of STATE.history) {
    const line = el('div', 'hist-line');
    line.appendChild(el('span', 'hist-year', h.year + ' '));
    line.appendChild(el('span', null, h.text));
    hist.appendChild(line);
  }
  root.appendChild(hist);

  const assign = el('div', 'panel');
  assign.appendChild(el('div', 'panel-title', 'ASSIGNED REGION'));
  const rn = el('div', 'region-name', region.name);
  assign.appendChild(rn);
  assign.appendChild(el('p', 'body', region.blurb));
  assign.appendChild(el('p', 'dim',
    'You have no money, no standing with any faction, no territory, and no ' +
    'affiliation. Choose the work you can get here.'));
  root.appendChild(assign);

  const choose = el('div', 'panel');
  choose.appendChild(el('div', 'panel-title', 'SELECT SECTOR'));
  const grid = el('div', 'sector-grid');
  for (const sid of region.sectors) {
    const s = SECTORS[sid];
    const card = el('button', 'sector-card');
    card.appendChild(el('div', 'sector-name', s.name));
    card.appendChild(el('div', 'sector-job', s.jobTitle));
    card.appendChild(el('div', 'sector-blurb', s.blurb));
    card.appendChild(el('div', 'sector-wage', 'Wage index ' + s.wageMod.toFixed(2)));
    card.addEventListener('click', () => {
      startGame(sid);
      $('screen-setup').classList.add('hidden');
      $('screen-game').classList.remove('hidden');
      render();
    });
    grid.appendChild(card);
  }
  choose.appendChild(grid);
  root.appendChild(choose);

  const reroll = el('button', 'ghost-btn', 'REASSIGN REGION (new case file)');
  reroll.addEventListener('click', () => { newGame(); renderSetup(); });
  root.appendChild(reroll);
}

/* ---------------------------------------------------------------------------
 * METERS
 * ------------------------------------------------------------------------- */
function meter(label, value, max, cls, valueLabel) {
  const wrap = el('div', 'meter');
  const top = el('div', 'meter-top');
  top.appendChild(el('span', 'meter-label', label));
  top.appendChild(el('span', 'meter-value', valueLabel !== undefined ? valueLabel : String(value)));
  wrap.appendChild(top);
  const bar = el('div', 'bar');
  const fill = el('div', 'bar-fill ' + (cls || ''));
  const pct = clamp((value / max) * 100, 0, 100);
  fill.style.width = pct.toFixed(1) + '%';
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

/* Reputation meters run -100..+100 with a centre line. */
function repMeter(faction, value) {
  const wrap = el('div', 'meter rep-meter');
  const top = el('div', 'meter-top');
  const lbl = el('span', 'meter-label');
  lbl.appendChild(el('span', 'crest', crestOf(faction) + ' '));
  lbl.appendChild(document.createTextNode(faction.def.short));
  top.appendChild(lbl);
  top.appendChild(el('span', 'meter-value', (value > 0 ? '+' : '') + value));
  wrap.appendChild(top);

  const bar = el('div', 'bar bar-centered');
  const zero = el('div', 'bar-zero');
  bar.appendChild(zero);
  const fill = el('div', 'bar-fill ' + (value >= 0 ? 'good-fill' : 'bad-fill'));
  const half = Math.abs(value) / CONFIG.MAX_REPUTATION * 50;
  if (value >= 0) { fill.style.left = '50%'; fill.style.width = half + '%'; }
  else { fill.style.left = (50 - half) + '%'; fill.style.width = half + '%'; }
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

/* ---------------------------------------------------------------------------
 * STATUS COLUMN
 * ------------------------------------------------------------------------- */
function renderStatus() {
  const p = STATE.player;
  const root = $('status');
  root.innerHTML = '';

  const region = REGIONS.find(r => r.id === p.regionId);
  const faction = p.factionId ? STATE.factions[p.factionId] : null;

  const idBlock = el('div', 'panel');
  idBlock.appendChild(el('div', 'panel-title', 'SUBJECT'));
  const rows = [
    ['DATE', dateString(STATE)],
    ['REGION', region.name],
    ['SECTOR', SECTORS[p.sector].name],
    ['FLAG', faction ? faction.def.name : '— UNAFFILIATED —'],
    ['RANK', playerRankTitle(STATE)],
    ['STATUS', !p.alive ? 'DECEASED'
      : p.imprisonedWeeks > 0 ? ('HELD — ' + p.imprisonedWeeks + 'wk')
      : 'AT LIBERTY'],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v', v));
    idBlock.appendChild(r);
  }
  root.appendChild(idBlock);

  const stats = el('div', 'panel');
  stats.appendChild(el('div', 'panel-title', 'RESOURCES'));
  stats.appendChild(meter('MONEY', p.money, CONFIG.MONEY_METER_CEILING, 'money-fill', p.money + 'cr'));
  stats.appendChild(meter('TERRITORY', p.territory, CONFIG.MAX_TERRITORY, 'terr-fill', p.territory + '/' + CONFIG.MAX_TERRITORY));
  stats.appendChild(meter('HEAT', p.heat, 100, 'heat-fill', p.heat + '/100'));
  root.appendChild(stats);

  const reps = el('div', 'panel');
  reps.appendChild(el('div', 'panel-title', 'STANDING (PER FACTION)'));
  for (const f of Object.values(STATE.factions)) {
    if (f.defunct) continue;
    reps.appendChild(repMeter(f, p.reputation[f.id] || 0));
  }
  root.appendChild(reps);

  const found = el('div', 'panel');
  found.appendChild(el('div', 'panel-title', 'FOUNDING THRESHOLD'));
  const gate = canFoundFaction(STATE);
  const rep = p.factionId ? (p.reputation[p.factionId] || 0) : 0;
  const req = [
    ['MONEY', p.money, CONFIG.FOUND_MONEY_REQ],
    ['STANDING', rep, CONFIG.FOUND_REPUTATION_REQ],
    ['TERRITORY', p.territory, CONFIG.FOUND_TERRITORY_REQ],
  ];
  for (const [k, have, need] of req) {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    const v = el('span', 'v ' + (have >= need ? 'ok' : 'no'), have + ' / ' + need);
    r.appendChild(v);
    found.appendChild(r);
  }
  found.appendChild(el('div', 'dim small', gate.ok ? 'ALL THRESHOLDS MET.' : gate.reason));
  root.appendChild(found);

  if (p.specializations.length) {
    const sp = el('div', 'panel');
    sp.appendChild(el('div', 'panel-title', 'SPECIALIZATIONS'));
    sp.appendChild(el('div', 'tags', p.specializations.join(' · ')));
    root.appendChild(sp);
  }

  if (p.creations.length) {
    const cr = el('div', 'panel');
    cr.appendChild(el('div', 'panel-title', 'INSTRUMENTS OF RECORD'));
    for (const c of p.creations) {
      cr.appendChild(el('div', 'small', `WK${c.week}: ${c.title}`));
    }
    root.appendChild(cr);
  }
}

/* ---------------------------------------------------------------------------
 * MAIN PANEL — TABS
 * ------------------------------------------------------------------------- */
function renderTabs() {
  const root = $('tabs');
  root.innerHTML = '';
  const tabs = [
    ['ops', 'OPERATIONS'],
    ['factions', 'FACTIONS'],
    ['hierarchy', 'HIERARCHY'],
    ['history', 'ARCHIVE'],
  ];
  for (const [id, label] of tabs) {
    const b = el('button', 'tab' + (UI.tab === id ? ' active' : ''), label);
    b.addEventListener('click', () => { UI.tab = id; UI.targetPanel = null; render(); });
    root.appendChild(b);
  }
}

function renderOps() {
  const root = $('main-panel');
  const p = STATE.player;

  if (STATE.gameOver) {
    const over = el('div', 'panel gameover');
    over.appendChild(el('div', 'panel-title', 'RECORD CLOSED'));
    over.appendChild(el('p', 'body', STATE.gameOverReason));
    over.appendChild(el('p', 'dim',
      `Survived ${STATE.week} weeks. ` +
      `Final holdings: ${p.money}cr, ${p.territory} territory, ` +
      `${p.creations.length} instrument(s) of record.`));
    const again = el('button', 'primary-btn', 'OPEN A NEW CASE FILE');
    again.addEventListener('click', () => {
      newGame();
      $('screen-game').classList.add('hidden');
      $('screen-setup').classList.remove('hidden');
      UI.tab = 'ops'; UI.targetPanel = null;
      renderSetup();
    });
    over.appendChild(again);
    root.appendChild(over);
    return;
  }

  /* A blocking incident takes precedence over the action menu. */
  if (STATE.pendingIncident) {
    const inc = STATE.pendingIncident;
    const box = el('div', 'panel incident');
    box.appendChild(el('div', 'panel-title', 'INCIDENT — ' + inc.title));
    box.appendChild(el('p', 'body', inc.body));
    const list = el('div', 'action-list');
    inc.choices.forEach((c, i) => {
      const b = el('button', 'action-btn');
      b.appendChild(el('div', 'action-label', c.label));
      b.addEventListener('click', () => { resolveIncidentChoice(STATE, i); render(); });
      list.appendChild(b);
    });
    box.appendChild(list);
    root.appendChild(box);
    return;
  }

  if (UI.targetPanel) { renderTargetPanel(root); return; }

  if (p.imprisonedWeeks > 0) {
    const box = el('div', 'panel');
    box.appendChild(el('div', 'panel-title', 'IN CUSTODY'));
    box.appendChild(el('p', 'body',
      `You are being held. ${p.imprisonedWeeks} week(s) remaining. ` +
      'The world does not stop while you are inside it.'));
    const b = el('button', 'primary-btn', 'SERVE A WEEK');
    /* takeAction() handles the custody case itself and turns the week. */
    b.addEventListener('click', () => { takeAction(STATE, '__wait__'); render(); });
    box.appendChild(b);
    root.appendChild(box);
    return;
  }

  const box = el('div', 'panel');
  box.appendChild(el('div', 'panel-title', 'AVAILABLE ACTIONS — ' + dateString(STATE)));
  const list = el('div', 'action-list');

  const cats = [
    ['work', 'SUBSISTENCE'],
    ['faction', 'AFFILIATION'],
    ['legit', 'LEGITIMATE'],
    ['corrupt', 'CORRUPT'],
    ['special', 'SCHISM'],
  ];
  const actions = availableActions(STATE);
  for (const [cat, header] of cats) {
    const group = actions.filter(a => a.category === cat);
    if (!group.length) continue;
    list.appendChild(el('div', 'cat-header cat-' + cat, header));
    for (const a of group) {
      const b = el('button', 'action-btn cat-' + cat);
      const head = el('div', 'action-head');
      head.appendChild(el('span', 'action-label', a.label));
      if (a.cost) head.appendChild(el('span', 'action-cost', a.cost + 'cr'));
      b.appendChild(head);
      b.appendChild(el('div', 'action-desc',
        typeof a.desc === 'function' ? a.desc(STATE) : a.desc));
      b.appendChild(el('div', 'action-hint',
        typeof a.hint === 'function' ? a.hint(STATE) : (a.hint || '')));
      if (a.cost && p.money < a.cost) {
        b.classList.add('disabled');
        b.disabled = true;
      }
      b.addEventListener('click', () => {
        if (a.opensPanel) { UI.targetPanel = a.opensPanel; render(); return; }
        takeAction(STATE, a.id);
        render();
      });
      list.appendChild(b);
    }
  }
  box.appendChild(list);
  root.appendChild(box);
}

/* --- Target selection panels (assassination, bribery, blackmail, etc.) ---- */
function renderTargetPanel(root) {
  const p = STATE.player;
  const panel = UI.targetPanel;
  const box = el('div', 'panel');

  const back = el('button', 'ghost-btn', '‹ BACK TO ACTIONS');
  back.addEventListener('click', () => { UI.targetPanel = null; render(); });

  if (panel === 'join' || panel === 'return') {
    const isReturn = panel === 'return';
    box.appendChild(el('div', 'panel-title', isReturn ? 'RETURN — PRIOR FLAGS' : 'PETITION — AVAILABLE FLAGS'));
    box.appendChild(el('p', 'dim', isReturn
      ? 'These factions have continued evolving since you left. Your old seat is occupied.'
      : 'Acceptance depends on your standing, their presence in your region, and your sector.'));
    const list = el('div', 'action-list');

    const candidates = isReturn
      ? p.priorFactions.map(x => STATE.factions[x.id]).filter(f => f && !f.defunct)
      : Object.values(STATE.factions).filter(f => !f.defunct);

    if (!candidates.length) box.appendChild(el('div', 'dim', 'No flags available to you.'));

    for (const f of candidates) {
      const odds = isReturn
        ? clamp(0.30 + (p.reputation[f.id] || 0) * 0.006 - f.playerHostility * 0.007, 0.03, 0.9)
        : joinOdds(STATE, f.id);
      const b = el('button', 'action-btn');
      const head = el('div', 'action-head');
      const lbl = el('span', 'action-label');
      lbl.appendChild(el('span', 'crest', crestOf(f) + ' '));
      lbl.appendChild(document.createTextNode(f.def.name));
      head.appendChild(lbl);
      head.appendChild(el('span', 'action-cost', Math.round(odds * 100) + '%'));
      b.appendChild(head);
      b.appendChild(el('div', 'action-desc', f.def.blurb));
      b.appendChild(el('div', 'action-hint',
        `Power ${f.power} · Corruption ${f.corruption} · Militancy ${f.militancy} · ` +
        `Regional presence ${f.control[p.regionId] || 0} · Hostility to you ${f.playerHostility}` +
        (f.suppressingElections ? ' · SUPPRESSING ELECTIONS' : '')));
      b.addEventListener('click', () => {
        takeAction(STATE, isReturn ? 'return_faction' : 'petition_join', f.id);
        UI.targetPanel = null;
        render();
      });
      list.appendChild(b);
    }
    box.appendChild(list);
    box.appendChild(back);
    root.appendChild(box);
    return;
  }

  if (panel === 'found') {
    box.appendChild(el('div', 'panel-title', 'SCHISM — FOUND A FACTION'));
    const gate = canFoundFaction(STATE);
    box.appendChild(el('p', 'body',
      'Your money, wards, specializations and instruments of record transfer to ' +
      'the new flag. Every member of your current faction is rolled individually ' +
      'to see whether they follow you. Your old faction will treat this as ' +
      'desertion, permanently.'));
    box.appendChild(el('div', 'dim small',
      `Cost: ${CONFIG.FOUND_COST_MONEY}cr. Requirements: ${CONFIG.FOUND_MONEY_REQ}cr / ` +
      `${CONFIG.FOUND_REPUTATION_REQ} standing / ${CONFIG.FOUND_TERRITORY_REQ} territory / ` +
      `rank ${CONFIG.FOUND_MIN_RANK_INDEX}+.`));

    const input = el('input', 'name-input');
    input.type = 'text';
    input.maxLength = 40;
    input.placeholder = 'NAME YOUR FACTION';
    box.appendChild(input);

    const go = el('button', 'primary-btn', gate.ok ? 'RAISE THE FLAG' : gate.reason);
    go.disabled = !gate.ok;
    if (!gate.ok) go.classList.add('disabled');
    go.addEventListener('click', () => {
      takeAction(STATE, 'found_faction', input.value);
      UI.targetPanel = null;
      render();
    });
    box.appendChild(go);
    box.appendChild(back);
    root.appendChild(box);
    return;
  }

  /* NPC-targeting panels. */
  const titles = {
    assassinate: 'TARGET SELECTION — ASSASSINATION',
    bribe: 'TARGET SELECTION — BRIBERY',
    blackmail: 'TARGET SELECTION — BLACKMAIL',
  };
  box.appendChild(el('div', 'panel-title', titles[panel]));
  const faction = STATE.factions[p.factionId];
  const targets = panel === 'assassinate' ? assassinationTargets(STATE) : corruptionTargets(STATE);

  if (panel === 'assassinate') {
    box.appendChild(el('p', 'dim',
      'Only members of your own faction ranked above you can be targeted. ' +
      'Failure resolves on a five-entry table: botched, traced, imprisoned, ' +
      'expelled, or killed.'));
  }

  const list = el('div', 'action-list');
  if (!targets.length) list.appendChild(el('div', 'dim', 'No valid targets.'));

  for (const t of targets) {
    const cost = panel === 'assassinate' ? assassinationCost(STATE, t)
      : panel === 'bribe' ? bribeCost(t) : 300;
    const odds = panel === 'assassinate' ? assassinationOdds(STATE, t)
      : panel === 'bribe' ? bribeOdds(STATE, t) : blackmailOdds(STATE, t);
    const b = el('button', 'action-btn cat-corrupt');
    const head = el('div', 'action-head');
    const lbl = el('span', 'action-label', t.name);
    head.appendChild(lbl);
    head.appendChild(el('span', 'action-cost',
      Math.round(odds * 100) + '% · ' + cost + 'cr'));
    b.appendChild(head);
    b.appendChild(el('div', 'action-desc',
      faction.def.rankTitles[t.rankIndex] + ' (rank ' + t.rankIndex + ')' +
      (t.isRival ? ' — YOUR RIVAL' : '')));
    b.appendChild(el('div', 'action-hint',
      t.trait.label + ': ' + t.trait.note +
      (t.note ? ' ' + t.note : '') +
      (t.grudge > 20 ? ' [Grudge ' + t.grudge + ']' : '')));
    if (p.money < cost) { b.classList.add('disabled'); b.disabled = true; }
    b.addEventListener('click', () => {
      takeAction(STATE, panel, t.id);
      UI.targetPanel = null;
      render();
    });
    list.appendChild(b);
  }
  box.appendChild(list);
  box.appendChild(back);
  root.appendChild(box);
}

/* --- FACTIONS TAB -------------------------------------------------------- */
function renderFactions() {
  const root = $('main-panel');
  const p = STATE.player;
  for (const f of Object.values(STATE.factions)) {
    const box = el('div', 'panel faction-card' + (f.defunct ? ' defunct' : ''));
    const head = el('div', 'faction-head');
    head.appendChild(el('span', 'crest big', crestOf(f)));
    const namewrap = el('div', 'faction-names');
    namewrap.appendChild(el('div', 'faction-name', f.def.name));
    namewrap.appendChild(el('div', 'faction-creed', '"' + f.def.creed + '"'));
    head.appendChild(namewrap);
    const flags = el('div', 'faction-flags');
    if (f.defunct) flags.appendChild(el('span', 'flag bad', 'DEFUNCT'));
    if (f.ascendant) flags.appendChild(el('span', 'flag good', 'ASCENDANT'));
    if (f.suppressingElections) flags.appendChild(el('span', 'flag bad', 'ELECTIONS SUPPRESSED'));
    if (f.corruption > 65) flags.appendChild(el('span', 'flag bad', 'DEEPLY CORRUPT'));
    if (f.isPlayerFaction) flags.appendChild(el('span', 'flag good', 'YOUR FLAG'));
    if (f.id === p.factionId) flags.appendChild(el('span', 'flag good', 'AFFILIATED'));
    if (f.playerHostility >= 60) flags.appendChild(el('span', 'flag bad', 'HOSTILE TO YOU'));
    head.appendChild(flags);
    box.appendChild(head);

    box.appendChild(el('p', 'body small', f.def.blurb));

    const meters = el('div', 'meter-row');
    meters.appendChild(meter('POWER', f.power, 100, 'power-fill', String(f.power)));
    meters.appendChild(meter('CORRUPTION', f.corruption, 100, 'corr-fill', String(f.corruption)));
    meters.appendChild(meter('MILITANCY', f.militancy, 100, 'mil-fill', String(f.militancy)));
    meters.appendChild(meter('UNREST', f.unrestPressure, 100, 'heat-fill', String(f.unrestPressure)));
    box.appendChild(meters);

    /* Region control table. */
    const ctrl = el('div', 'control-grid');
    for (const r of REGIONS) {
      const c = f.control[r.id] || 0;
      const row = el('div', 'kv');
      row.appendChild(el('span', 'k', r.name));
      row.appendChild(el('span', 'v' + (c > 0 ? '' : ' dim'), String(c)));
      ctrl.appendChild(row);
    }
    box.appendChild(ctrl);

    /* Relations. */
    const rel = el('div', 'small dim');
    const parts = [];
    for (const oid in f.relations) {
      const o = STATE.factions[oid];
      if (!o || o.defunct) continue;
      parts.push(o.def.short + ' ' + (f.relations[oid] > 0 ? '+' : '') + f.relations[oid]);
    }
    rel.textContent = 'RELATIONS: ' + (parts.join(' | ') || 'none');
    box.appendChild(rel);

    if (f.lastRuleFired) {
      box.appendChild(el('div', 'small rule-tag', 'LAST RULE FIRED: ' + f.lastRuleFired));
    }
    root.appendChild(box);
  }

  /* Rule reference so the AI is legible rather than opaque. */
  const ref = el('div', 'panel');
  ref.appendChild(el('div', 'panel-title', 'FACTION AI — RULE REFERENCE'));
  ref.appendChild(el('div', 'small dim', 'UNIVERSAL (all factions):'));
  for (const r of UNIVERSAL_RULES) {
    ref.appendChild(el('div', 'small', '· ' + r.name + ' — ' + r.desc));
  }
  for (const fid in FACTION_RULES) {
    const f = STATE.factions[fid];
    if (!f) continue;
    ref.appendChild(el('div', 'small dim', crestOf(f) + ' ' + f.def.short + ':'));
    for (const r of FACTION_RULES[fid]) {
      ref.appendChild(el('div', 'small', '· ' + r.name + ' — ' + r.desc));
    }
  }
  ref.appendChild(el('div', 'small dim', 'PLAYER-FOUNDED FACTIONS:'));
  for (const r of PLAYER_FACTION_RULES) {
    ref.appendChild(el('div', 'small', '· ' + r.name + ' — ' + r.desc));
  }
  root.appendChild(ref);
}

/* --- HIERARCHY TAB ------------------------------------------------------- */
function renderHierarchy() {
  const root = $('main-panel');
  const p = STATE.player;

  for (const f of Object.values(STATE.factions)) {
    if (f.defunct) continue;
    const box = el('div', 'panel');
    const t = el('div', 'panel-title');
    t.appendChild(el('span', 'crest', crestOf(f) + ' '));
    t.appendChild(document.createTextNode(f.def.name + ' — HIERARCHY'));
    box.appendChild(t);

    for (let r = RANK_COUNT - 1; r >= 0; r--) {
      const at = npcsOfFaction(STATE, f.id).filter(n => n.rankIndex === r);
      const isPlayerHere = p.factionId === f.id && p.rankIndex === r;
      if (!at.length && !isPlayerHere) continue;
      const row = el('div', 'rank-row');
      row.appendChild(el('div', 'rank-title', f.def.rankTitles[r]));
      const names = el('div', 'rank-names');
      if (isPlayerHere) {
        names.appendChild(el('span', 'npc you', 'YOU'));
      }
      for (const n of at) {
        const tag = el('span', 'npc' + (n.isRival ? ' rival' : ''),
          n.name + ' [' + n.trait.label + ']');
        tag.title = n.trait.note + (n.isRival ? ' Holds your former seat.' : '');
        names.appendChild(tag);
      }
      row.appendChild(names);
      box.appendChild(row);
    }
    root.appendChild(box);
  }
}

/* --- ARCHIVE TAB --------------------------------------------------------- */
function renderHistory() {
  const root = $('main-panel');
  const box = el('div', 'panel');
  box.appendChild(el('div', 'panel-title', 'ARCHIVE — PRIOR DECADE'));
  for (const h of STATE.history) {
    const line = el('div', 'hist-line');
    line.appendChild(el('span', 'hist-year', h.year + ' '));
    line.appendChild(el('span', null, h.text));
    box.appendChild(line);
  }
  root.appendChild(box);

  const p = STATE.player;
  const rec = el('div', 'panel');
  rec.appendChild(el('div', 'panel-title', 'SUBJECT RECORD'));
  rec.appendChild(el('div', 'small', 'Weeks survived: ' + STATE.week));
  rec.appendChild(el('div', 'small', 'Specializations: ' + (p.specializations.join(', ') || 'none')));
  rec.appendChild(el('div', 'small', 'Instruments: ' +
    (p.creations.map(c => c.title).join('; ') || 'none')));
  rec.appendChild(el('div', 'small', 'Prior flags: ' +
    (p.priorFactions.map(x => STATE.factions[x.id].def.short + ' (rank ' + x.rankIndex + ', left WK' + x.week + ')').join('; ') || 'none')));
  root.appendChild(rec);
}

/* --- LOG ----------------------------------------------------------------- */
function renderLog() {
  const root = $('log');
  root.innerHTML = '';
  const entries = STATE.log.slice(-120);
  let lastWeek = null;
  for (const e of entries) {
    if (e.week !== lastWeek) {
      root.appendChild(el('div', 'log-week', '— WEEK ' + e.week + ' —'));
      lastWeek = e.week;
    }
    root.appendChild(el('div', 'log-line log-' + e.kind, e.text));
  }
  root.scrollTop = root.scrollHeight;
}

/* ---------------------------------------------------------------------------
 * MASTER RENDER
 * ------------------------------------------------------------------------- */
function render() {
  renderStatus();
  renderTabs();
  const main = $('main-panel');
  main.innerHTML = '';
  if (STATE.gameOver) { renderOps(); }
  else if (UI.tab === 'ops') renderOps();
  else if (UI.tab === 'factions') renderFactions();
  else if (UI.tab === 'hierarchy') renderHierarchy();
  else renderHistory();
  renderLog();
  $('header-date').textContent = dateString(STATE);
  $('header-seed').textContent = 'CASE ' + STATE.seed.toString(16).toUpperCase();
}

/* ---------------------------------------------------------------------------
 * BOOT
 * ------------------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  newGame();
  renderSetup();
});
