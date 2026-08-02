/* =============================================================================
 * ui.js — Rendering, input, and the animated terminal log.
 *
 * INTERACTION MODEL (mobile-first):
 *   1. The player TAPS an action to STAGE it. Nothing resolves on tap.
 *   2. The staged order is echoed in the header's commit bar.
 *   3. Pressing COMMIT at the top resolves the order and turns the week.
 *   4. The week's log types itself out in the field log at the top of the
 *      screen; input is locked until the transmission finishes or is skipped.
 *
 * Everything user-supplied (faction names) goes in via textContent, so nothing
 * typed by the player is ever parsed as markup.
 * ========================================================================= */

const UI = {
  tab: 'ops',
  targetPanel: null,     // 'assassinate'|'bribe'|'blackmail'|'join'|'return'|'found'
  staged: null,          // { kind, id, payload, label }
  lastSeq: 0,            // highest STATE.log seq already shown
  lastWeekShown: null,   // week of the last line appended (for week headers)
  typing: false,
  timers: [],
  lastDelta: null,       // { money, territory, heat, rep } from the last commit
  prevSnapshot: null,
  pendingName: '',       // preserved text of the faction-name input
};

const TYPE_MS = 9;       // per-character reveal speed
const LINE_GAP_MS = 70;  // pause between lines

function $(id) { return document.getElementById(id); }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in (attrs || {})) n.setAttribute(k, attrs[k]);
  return n;
}

function crestOf(faction) { return faction.def.crest; }

function reducedMotion() {
  return window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* =============================================================================
 * SETUP SCREEN
 * ========================================================================= */
function renderSetup() {
  const region = REGIONS.find(r => r.id === STATE.player.regionId);
  const root = $('screen-setup');
  root.innerHTML = '';

  const head = el('div', 'setup-head');
  head.appendChild(el('h1', null, 'CONTINUITY OF GOVERNMENT'));
  head.appendChild(el('div', 'subtitle',
    'PROVISIONAL SURVIVAL RECORD // ' + CONFIG.START_YEAR +
    ' // CASE ' + STATE.seed.toString(16).toUpperCase() +
    ' // BUILD ' + CONFIG.BUILD));
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
    line.appendChild(el('span', 'hist-year', h.year + '  '));
    line.appendChild(el('span', null, h.text));
    hist.appendChild(line);
  }
  root.appendChild(hist);

  const assign = el('div', 'panel');
  assign.appendChild(el('div', 'panel-title', 'ASSIGNED REGION'));
  assign.appendChild(el('div', 'region-name', region.name));
  assign.appendChild(el('p', 'body', region.blurb));
  assign.appendChild(el('p', 'small dim',
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
    card.appendChild(el('div', 'sector-wage', 'WAGE INDEX ' + s.wageMod.toFixed(2)));
    card.addEventListener('click', () => {
      startGame(sid);
      $('screen-setup').classList.add('hidden');
      $('screen-game').classList.remove('hidden');
      resetLog();
      render();
      typeNewLog();
    });
    grid.appendChild(card);
  }
  choose.appendChild(grid);
  root.appendChild(choose);

  const reroll = el('button', 'ghost-btn', 'REASSIGN REGION — NEW CASE FILE');
  reroll.addEventListener('click', () => { newGame(); renderSetup(); });
  root.appendChild(reroll);
}

/* =============================================================================
 * THE ANIMATED FIELD LOG
 *
 * Lines are appended one at a time and typed character by character. The log
 * never re-renders existing DOM, so an in-flight transmission survives tab
 * switches and re-renders of the main panel.
 * ========================================================================= */
function resetLog() {
  clearTimers();
  UI.lastSeq = 0;
  UI.lastWeekShown = null;
  UI.typing = false;
  $('log').innerHTML = '';
  $('log-skip').classList.add('hidden');
  $('log-status').textContent = 'STANDBY';
}

/* Entries the player has not seen yet, oldest first. */
function unrevealedLog() {
  return STATE.log.filter(e => e.seq > UI.lastSeq);
}

/* Keep the log DOM bounded — a long run would otherwise accumulate thousands
 * of nodes and make scrolling stutter on a phone. */
function trimLogDom() {
  const box = $('log');
  const MAX = 260;
  while (box.childElementCount > MAX) box.removeChild(box.firstElementChild);
}

function clearTimers() {
  for (const t of UI.timers) clearTimeout(t);
  UI.timers = [];
}

function later(fn, ms) {
  const t = setTimeout(fn, ms);
  UI.timers.push(t);
  return t;
}

function logScrollToEnd() {
  const box = $('log');
  box.scrollTop = box.scrollHeight;
}

/* Append one entry's DOM (week header when the week changes) and return the
 * element that the typewriter will fill. */
function appendLogEntry(entry) {
  const box = $('log');
  if (entry.week !== UI.lastWeekShown) {
    box.appendChild(el('div', 'log-week', '── WEEK ' + entry.week + ' ──'));
    UI.lastWeekShown = entry.week;
  }
  const line = el('div', 'log-line log-' + entry.kind);
  box.appendChild(line);
  trimLogDom();
  return line;
}

/* Reveal everything instantly — used on skip, and under reduced-motion. */
function revealAllLog() {
  clearTimers();
  UI.typing = false;
  /* Drop any half-typed line; the loop below re-appends it complete. */
  if (UI.activeLine && UI.activeLine.parentNode) {
    UI.activeLine.parentNode.removeChild(UI.activeLine);
  }
  UI.activeLine = null;
  for (const entry of unrevealedLog()) {
    appendLogEntry(entry).textContent = entry.text;
    UI.lastSeq = entry.seq;
  }
  $('log-skip').classList.add('hidden');
  $('log-status').textContent = 'STANDBY';
  logScrollToEnd();
  updateCommitBar();
}

/* Type out every log entry that has not been shown yet. */
function typeNewLog() {
  if (!unrevealedLog().length) { updateCommitBar(); return; }
  if (reducedMotion()) { revealAllLog(); return; }

  UI.typing = true;
  $('log-skip').classList.remove('hidden');
  $('log-status').textContent = 'RECEIVING';
  updateCommitBar();

  const step = () => {
    const queue = unrevealedLog();
    if (!queue.length) {
      UI.typing = false;
      $('log-skip').classList.add('hidden');
      $('log-status').textContent = 'STANDBY';
      updateCommitBar();
      logScrollToEnd();
      return;
    }
    const entry = queue[0];
    const line = appendLogEntry(entry);
    UI.activeLine = line;
    line.classList.add('typing');
    logScrollToEnd();

    const text = entry.text;
    /* Long lines type in chunks so a wall of text never stalls the turn. */
    const chunk = text.length > 90 ? 3 : 1;
    let i = 0;
    const tick = () => {
      if (!UI.typing) return;            // skipped mid-line
      i = Math.min(text.length, i + chunk);
      line.textContent = text.slice(0, i);
      logScrollToEnd();
      if (i < text.length) {
        later(tick, TYPE_MS);
      } else {
        line.classList.remove('typing');
        UI.activeLine = null;
        UI.lastSeq = entry.seq;
        later(step, LINE_GAP_MS);
      }
    };
    tick();
  };
  step();
}

/* =============================================================================
 * COMMIT BAR — the staged order and the button that resolves it
 * ========================================================================= */
function stage(kind, id, payload, label) {
  if (UI.typing) return;
  UI.staged = { kind: kind, id: id, payload: payload, label: label };
  render();
}

function clearStaged() { UI.staged = null; }

function updateCommitBar() {
  const btn = $('commit-btn');
  const box = $('staged');
  const lbl = $('staged-label');

  if (STATE.gameOver) {
    box.classList.remove('armed');
    btn.classList.remove('armed', 'busy');
    btn.disabled = true;
    btn.textContent = 'CLOSED';
    lbl.textContent = 'RECORD CLOSED';
    return;
  }
  if (UI.typing) {
    btn.disabled = true;
    btn.classList.remove('armed');
    btn.classList.add('busy');
    btn.textContent = 'WAIT';
    lbl.textContent = 'INCOMING TRANSMISSION…';
    box.classList.remove('armed');
    return;
  }
  btn.classList.remove('busy');

  if (UI.staged) {
    box.classList.add('armed');
    lbl.textContent = UI.staged.label;
    btn.disabled = false;
    btn.classList.add('armed');
    btn.textContent = UI.staged.kind === 'incident' ? 'RESOLVE' : 'COMMIT';
  } else {
    box.classList.remove('armed');
    btn.disabled = true;
    btn.classList.remove('armed');
    btn.textContent = 'COMMIT';
    lbl.textContent = STATE.pendingIncident
      ? 'SELECT A RESPONSE BELOW'
      : (STATE.player.imprisonedWeeks > 0 ? 'HELD — SERVE THE WEEK'
                                          : 'NO ORDER SET');
  }
}

/* Snapshot the stats so the meters can show a delta after the week turns. */
function snapshot() {
  const p = STATE.player;
  return {
    money: p.money,
    territory: p.territory,
    heat: p.heat,
    rep: p.factionId ? (p.reputation[p.factionId] || 0) : 0,
  };
}

function commit() {
  if (UI.typing || STATE.gameOver || !UI.staged) return;
  const before = snapshot();
  const order = UI.staged;
  UI.staged = null;

  if (order.kind === 'incident') {
    resolveIncidentChoice(STATE, order.payload);
  } else if (order.kind === 'wait') {
    takeAction(STATE, '__wait__');
  } else {
    const res = takeAction(STATE, order.id, order.payload);
    /* An action that could not be afforded does not consume the week. */
    if (res && res.noTurn) { render(); typeNewLog(); return; }
  }

  const after = snapshot();
  UI.lastDelta = {
    money: after.money - before.money,
    territory: after.territory - before.territory,
    heat: after.heat - before.heat,
    rep: after.rep - before.rep,
  };
  UI.targetPanel = null;
  UI.pendingName = '';
  if (STATE.pendingIncident || STATE.gameOver) UI.tab = 'ops';

  const dateNode = $('header-date');
  dateNode.classList.remove('tick');
  void dateNode.offsetWidth;
  dateNode.classList.add('tick');

  render();
  typeNewLog();
}

/* =============================================================================
 * WIDGETS
 * ========================================================================= */
function meter(label, value, max, cls, valueLabel, delta) {
  const wrap = el('div', 'meter');
  const top = el('div', 'meter-top');
  const lab = el('span', 'meter-label', label);
  top.appendChild(lab);
  const right = el('span', 'meter-value', valueLabel !== undefined ? valueLabel : String(value));
  top.appendChild(right);
  wrap.appendChild(top);

  if (delta) {
    lab.appendChild(el('span', 'delta', (delta > 0 ? '▲+' : '▼') + delta));
    wrap.classList.add('changed');
  }

  const bar = el('div', 'bar');
  const fill = el('div', 'bar-fill ' + (cls || ''));
  fill.style.width = clamp((value / max) * 100, 0, 100).toFixed(1) + '%';
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

/* Reputation runs -100..+100 around a centre line. */
function repMeter(faction, value, delta) {
  const wrap = el('div', 'meter rep-meter');
  const top = el('div', 'meter-top');
  const lbl = el('span', 'meter-label');
  lbl.appendChild(el('span', 'crest', crestOf(faction)));
  lbl.appendChild(document.createTextNode(' ' + faction.def.short));
  if (delta) {
    lbl.appendChild(el('span', 'delta', (delta > 0 ? '▲+' : '▼') + delta));
    wrap.classList.add('changed');
  }
  top.appendChild(lbl);
  top.appendChild(el('span', 'meter-value', (value > 0 ? '+' : '') + value));
  wrap.appendChild(top);

  const bar = el('div', 'bar bar-centered');
  bar.appendChild(el('div', 'bar-zero'));
  const fill = el('div', 'bar-fill ' + (value >= 0 ? 'good-fill' : 'bad-fill'));
  const half = Math.abs(value) / CONFIG.MAX_REPUTATION * 50;
  if (value >= 0) { fill.style.left = '50%'; fill.style.width = half + '%'; }
  else { fill.style.left = (50 - half) + '%'; fill.style.width = half + '%'; }
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

/* Monochrome trend graph: filled area + line + head dot, drawn on entry. */
function sparkline(values, captionLeft, captionRight) {
  const wrap = el('div');
  const W = 300, H = 46;
  const svg = svgEl('svg', {
    class: 'spark', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none',
  });

  for (let i = 1; i < 4; i++) {
    svg.appendChild(svgEl('line', {
      class: 'spark-grid', x1: 0, x2: W, y1: (H / 4) * i, y2: (H / 4) * i,
    }));
  }

  const vals = values.length ? values : [0];
  let min = Math.min.apply(null, vals);
  let max = Math.max.apply(null, vals);
  if (max === min) { max = min + 1; }
  const pad = 4;
  const pts = vals.map((v, i) => {
    const x = vals.length === 1 ? W : (i / (vals.length - 1)) * W;
    const y = H - pad - ((v - min) / (max - min)) * (H - pad * 2);
    return [x, y];
  });
  const ptStr = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

  svg.appendChild(svgEl('polygon', {
    class: 'spark-area',
    points: '0,' + H + ' ' + ptStr + ' ' + W + ',' + H,
  }));
  svg.appendChild(svgEl('polyline', { class: 'drawn', points: ptStr }));
  const head = pts[pts.length - 1];
  svg.appendChild(svgEl('circle', {
    class: 'spark-dot', cx: head[0], cy: head[1], r: 2,
  }));

  wrap.appendChild(svg);
  const cap = el('div', 'spark-cap');
  cap.appendChild(el('span', null, captionLeft));
  cap.appendChild(el('span', null, captionRight));
  wrap.appendChild(cap);
  return wrap;
}

/* Small ASCII-ish bar used inside dense faction rows. */
function pipBar(value, max) {
  const filled = Math.round(clamp(value / max, 0, 1) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/* =============================================================================
 * HEADER CHIPS
 * ========================================================================= */
function renderHeader() {
  $('header-date').textContent = dateString(STATE);
  $('header-seed').textContent =
    CONFIG.BUILD + ' · CASE ' + STATE.seed.toString(16).toUpperCase();

  const p = STATE.player;
  const chips = $('header-chips');
  chips.innerHTML = '';

  chips.appendChild(el('span', 'chip', p.money + 'cr'));
  chips.appendChild(el('span', 'chip', 'TERR ' + p.territory));
  if (p.heat >= CONFIG.HEAT_ARREST_THRESHOLD) {
    chips.appendChild(el('span', 'chip warn', 'HEAT ' + p.heat));
  } else if (p.heat > 0) {
    chips.appendChild(el('span', 'chip', 'HEAT ' + p.heat));
  }
  if (p.imprisonedWeeks > 0) chips.appendChild(el('span', 'chip warn', 'HELD ' + p.imprisonedWeeks + 'W'));
  if (p.factionId) {
    const f = STATE.factions[p.factionId];
    chips.appendChild(el('span', 'chip invert', crestOf(f) + ' ' + f.def.rankTitles[p.rankIndex].toUpperCase()));
  } else {
    chips.appendChild(el('span', 'chip', 'UNAFFILIATED'));
  }
}

/* =============================================================================
 * TAB BAR
 * ========================================================================= */
function renderTabs() {
  const root = $('tabbar');
  root.innerHTML = '';
  const tabs = [
    ['ops',       '▶', 'ORDERS'],
    ['status',    '▤', 'DOSSIER'],
    ['factions',  '◈', 'POWERS'],
    ['hierarchy', '▲', 'RANKS'],
    ['history',   '≡', 'ARCHIVE'],
  ];
  for (const [id, glyph, label] of tabs) {
    const b = el('button', 'tab' + (UI.tab === id ? ' active' : ''));
    b.appendChild(el('span', 'tab-glyph', glyph));
    b.appendChild(el('span', null, label));
    b.addEventListener('click', () => {
      if (UI.tab !== id) { UI.tab = id; UI.targetPanel = null; render(); }
    });
    root.appendChild(b);
  }
}

/* =============================================================================
 * ORDERS TAB
 * ========================================================================= */
function renderOps() {
  const root = $('main-panel');
  const p = STATE.player;

  if (STATE.gameOver) {
    const over = el('div', 'panel gameover');
    over.appendChild(el('div', 'panel-title', 'RECORD CLOSED'));
    over.appendChild(el('p', 'body', STATE.gameOverReason));
    over.appendChild(el('p', 'small dim',
      `Survived ${STATE.week} weeks. Final holdings: ${p.money}cr, ` +
      `${p.territory} territory, ${p.creations.length} instrument(s) of record.`));
    if (STATE.trend.length > 1) {
      over.appendChild(sparkline(STATE.trend.map(t => t.territory),
        'TERRITORY OVER TIME', 'WK1–' + STATE.week));
    }
    const again = el('button', 'primary-btn', 'OPEN A NEW CASE FILE');
    again.addEventListener('click', () => {
      newGame();
      clearStaged();
      resetLog();
      UI.tab = 'ops'; UI.targetPanel = null; UI.lastDelta = null;
      $('screen-game').classList.add('hidden');
      $('screen-setup').classList.remove('hidden');
      renderSetup();
    });
    over.appendChild(again);
    root.appendChild(over);
    return;
  }

  /* A blocking incident owns the screen until answered. */
  if (STATE.pendingIncident) {
    const inc = STATE.pendingIncident;
    const box = el('div', 'panel incident');
    box.appendChild(el('div', 'panel-title', 'INCIDENT — ' + inc.title));
    box.appendChild(el('p', 'body', inc.body));
    const list = el('div', 'action-list');
    inc.choices.forEach((c, i) => {
      const b = el('button', 'action-btn' +
        (UI.staged && UI.staged.kind === 'incident' && UI.staged.payload === i ? ' selected' : ''));
      const head = el('div', 'action-head');
      head.appendChild(el('span', 'action-label', c.label));
      b.appendChild(head);
      b.addEventListener('click', () => stage('incident', 'incident', i, c.label.toUpperCase()));
      list.appendChild(b);
    });
    box.appendChild(list);
    box.appendChild(el('div', 'small dim', 'Select a response, then press RESOLVE above.'));
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
    const b = el('button', 'action-btn' + (UI.staged && UI.staged.kind === 'wait' ? ' selected' : ''));
    const head = el('div', 'action-head');
    head.appendChild(el('span', 'action-label', 'SERVE A WEEK'));
    b.appendChild(head);
    b.appendChild(el('div', 'action-hint', 'Then press COMMIT above.'));
    b.addEventListener('click', () => stage('wait', 'wait', null, 'SERVE A WEEK'));
    box.appendChild(b);
    root.appendChild(box);
    return;
  }

  const box = el('div', 'panel');
  const title = el('div', 'panel-title');
  title.appendChild(document.createTextNode('ORDERS — ' + dateString(STATE)));
  box.appendChild(title);
  box.appendChild(el('div', 'small dim',
    'Tap to set the order for this week. It resolves when you press COMMIT.'));

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
    list.appendChild(el('div', 'cat-header', header));
    for (const a of group) {
      const isStaged = UI.staged && UI.staged.kind === 'action' && UI.staged.id === a.id;
      const b = el('button', 'action-btn cat-' + cat + (isStaged ? ' selected' : ''));
      const head = el('div', 'action-head');
      head.appendChild(el('span', 'action-label', a.label));
      if (a.cost) head.appendChild(el('span', 'action-cost', a.cost + 'cr'));
      else if (a.opensPanel) head.appendChild(el('span', 'action-cost', 'SELECT ›'));
      b.appendChild(head);
      b.appendChild(el('div', 'action-desc',
        typeof a.desc === 'function' ? a.desc(STATE) : a.desc));
      b.appendChild(el('div', 'action-hint',
        typeof a.hint === 'function' ? a.hint(STATE) : (a.hint || '')));
      if (a.cost && p.money < a.cost) { b.classList.add('disabled'); b.disabled = true; }
      b.addEventListener('click', () => {
        if (a.opensPanel) { UI.targetPanel = a.opensPanel; render(); return; }
        stage('action', a.id, null, a.label);
      });
      list.appendChild(b);
    }
  }
  box.appendChild(list);
  root.appendChild(box);
}

/* --- Target-selection sub-screens ---------------------------------------- */
function renderTargetPanel(root) {
  const p = STATE.player;
  const panel = UI.targetPanel;
  const box = el('div', 'panel');

  const back = el('button', 'ghost-btn', '‹ BACK TO ORDERS');
  back.addEventListener('click', () => { UI.targetPanel = null; render(); });

  /* ---- Join / return rosters ---- */
  if (panel === 'join' || panel === 'return') {
    const isReturn = panel === 'return';
    box.appendChild(el('div', 'panel-title',
      isReturn ? 'RETURN — PRIOR FLAGS' : 'PETITION — AVAILABLE FLAGS'));
    box.appendChild(el('p', 'small dim', isReturn
      ? 'These factions kept evolving while you were gone. Your old seat is occupied.'
      : 'Acceptance depends on your standing, their presence in your region, and your sector.'));

    const list = el('div', 'action-list');
    const candidates = isReturn
      ? p.priorFactions.map(x => STATE.factions[x.id]).filter(f => f && !f.defunct)
      : Object.values(STATE.factions).filter(f => !f.defunct);
    if (!candidates.length) list.appendChild(el('div', 'small dim', 'No flags available to you.'));

    for (const f of candidates) {
      const odds = isReturn
        ? clamp(0.30 + (p.reputation[f.id] || 0) * 0.006 - f.playerHostility * 0.007, 0.03, 0.9)
        : joinOdds(STATE, f.id);
      const actionId = isReturn ? 'return_faction' : 'petition_join';
      const isStaged = UI.staged && UI.staged.id === actionId && UI.staged.payload === f.id;
      const b = el('button', 'action-btn cat-faction' + (isStaged ? ' selected' : ''));
      const head = el('div', 'action-head');
      const lbl = el('span', 'action-label');
      lbl.appendChild(el('span', 'crest', crestOf(f)));
      lbl.appendChild(document.createTextNode(' ' + f.def.name));
      head.appendChild(lbl);
      head.appendChild(el('span', 'action-cost', Math.round(odds * 100) + '%'));
      b.appendChild(head);
      b.appendChild(el('div', 'action-desc', f.def.blurb));
      b.appendChild(el('div', 'action-hint',
        'PWR ' + pipBar(f.power, 100) + ' ' + f.power +
        '  ·  COR ' + f.corruption + '  ·  MIL ' + f.militancy +
        '  ·  LOCAL ' + (f.control[p.regionId] || 0) +
        '  ·  HOSTILITY ' + f.playerHostility +
        (f.suppressingElections ? '  ·  SUPPRESSING ELECTIONS' : '')));
      b.addEventListener('click', () => {
        stage('action', actionId, f.id,
          (isReturn ? 'RETURN: ' : 'PETITION: ') + f.def.short);
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

  /* ---- Faction founding ---- */
  if (panel === 'found') {
    box.appendChild(el('div', 'panel-title', 'SCHISM — FOUND A FACTION'));
    const gate = canFoundFaction(STATE);
    box.appendChild(el('p', 'body',
      'Your money, wards, specializations and instruments of record transfer to ' +
      'the new flag. Every member of your current faction is rolled individually ' +
      'to see whether they follow you. Your old faction treats this as desertion, ' +
      'permanently.'));
    box.appendChild(el('div', 'small dim',
      `Cost ${CONFIG.FOUND_COST_MONEY}cr · Requires ${CONFIG.FOUND_MONEY_REQ}cr / ` +
      `${CONFIG.FOUND_REPUTATION_REQ} standing / ${CONFIG.FOUND_TERRITORY_REQ} territory / ` +
      `rank ${CONFIG.FOUND_MIN_RANK_INDEX}+.`));

    const input = el('input', 'name-input');
    input.type = 'text';
    input.maxLength = 40;
    input.placeholder = 'NAME YOUR FACTION';
    input.value = UI.pendingName;
    input.addEventListener('input', () => { UI.pendingName = input.value; });
    box.appendChild(input);

    const go = el('button', 'primary-btn', gate.ok ? 'SET ORDER: RAISE THE FLAG' : gate.reason);
    go.disabled = !gate.ok;
    if (!gate.ok) go.classList.add('disabled');
    go.addEventListener('click', () => {
      const name = (input.value || '').trim() || 'THE UNNAMED COMPACT';
      UI.pendingName = input.value;
      stage('action', 'found_faction', input.value, 'FOUND: ' + name.toUpperCase());
      UI.targetPanel = null;
      render();
    });
    box.appendChild(go);
    box.appendChild(back);
    root.appendChild(box);
    return;
  }

  /* ---- NPC target lists ---- */
  const titles = {
    assassinate: 'TARGET — ASSASSINATION',
    bribe: 'TARGET — BRIBERY',
    blackmail: 'TARGET — BLACKMAIL',
  };
  box.appendChild(el('div', 'panel-title', titles[panel]));
  const faction = STATE.factions[p.factionId];
  const targets = panel === 'assassinate' ? assassinationTargets(STATE) : corruptionTargets(STATE);

  if (panel === 'assassinate') {
    box.appendChild(el('p', 'small dim',
      'Only members of your own faction ranked above you can be targeted. ' +
      'Failure resolves on a five-entry table: botched, traced, imprisoned, ' +
      'expelled, or killed.'));
  }

  const list = el('div', 'action-list');
  if (!targets.length) list.appendChild(el('div', 'small dim', 'No valid targets.'));

  for (const t of targets) {
    const cost = panel === 'assassinate' ? assassinationCost(STATE, t)
      : panel === 'bribe' ? bribeCost(t) : 300;
    const odds = panel === 'assassinate' ? assassinationOdds(STATE, t)
      : panel === 'bribe' ? bribeOdds(STATE, t) : blackmailOdds(STATE, t);
    const isStaged = UI.staged && UI.staged.id === panel && UI.staged.payload === t.id;
    const b = el('button', 'action-btn cat-corrupt' + (isStaged ? ' selected' : ''));
    const head = el('div', 'action-head');
    head.appendChild(el('span', 'action-label', t.name));
    head.appendChild(el('span', 'action-cost', Math.round(odds * 100) + '% · ' + cost + 'cr'));
    b.appendChild(head);
    b.appendChild(el('div', 'action-desc',
      faction.def.rankTitles[t.rankIndex] + ' (rank ' + t.rankIndex + ')' +
      (t.isRival ? ' — YOUR RIVAL' : '')));
    b.appendChild(el('div', 'action-hint',
      t.trait.label + ': ' + t.trait.note +
      (t.note ? ' ' + t.note : '') +
      (t.grudge > 20 ? ' [GRUDGE ' + t.grudge + ']' : '')));
    if (p.money < cost) { b.classList.add('disabled'); b.disabled = true; }
    b.addEventListener('click', () => {
      stage('action', panel, t.id, panel.toUpperCase() + ': ' + t.name.toUpperCase());
      UI.targetPanel = null;
      render();
    });
    list.appendChild(b);
  }
  box.appendChild(list);
  box.appendChild(back);
  root.appendChild(box);
}

/* =============================================================================
 * DOSSIER TAB (the old sidebar, now a first-class mobile screen)
 * ========================================================================= */
function renderStatusTab() {
  const root = $('main-panel');
  const p = STATE.player;
  const region = REGIONS.find(r => r.id === p.regionId);
  const faction = p.factionId ? STATE.factions[p.factionId] : null;
  const d = UI.lastDelta || {};

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
  stats.appendChild(meter('MONEY', p.money, CONFIG.MONEY_METER_CEILING, 'money-fill', p.money + 'cr', d.money));
  stats.appendChild(meter('TERRITORY', p.territory, CONFIG.MAX_TERRITORY, 'terr-fill',
    p.territory + '/' + CONFIG.MAX_TERRITORY, d.territory));
  stats.appendChild(meter('HEAT', p.heat, 100, 'heat-fill', p.heat + '/100', d.heat));
  if (STATE.trend.length > 1) {
    stats.appendChild(sparkline(STATE.trend.map(t => t.money), 'CAPITAL CURVE',
      'WK' + STATE.trend[0].week + '–' + STATE.trend[STATE.trend.length - 1].week));
  }
  root.appendChild(stats);

  const reps = el('div', 'panel');
  reps.appendChild(el('div', 'panel-title', 'STANDING (PER FACTION)'));
  for (const f of Object.values(STATE.factions)) {
    if (f.defunct) continue;
    reps.appendChild(repMeter(f, p.reputation[f.id] || 0,
      (faction && f.id === faction.id) ? d.rep : 0));
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
    r.appendChild(el('span', 'k', k + '  ' + pipBar(have, need)));
    r.appendChild(el('span', 'v ' + (have >= need ? 'ok' : ''), have + ' / ' + need));
    found.appendChild(r);
  }
  found.appendChild(el('div', 'small dim', gate.ok ? 'ALL THRESHOLDS MET.' : gate.reason));
  root.appendChild(found);

  if (p.specializations.length) {
    const sp = el('div', 'panel');
    sp.appendChild(el('div', 'panel-title', 'SPECIALIZATIONS'));
    sp.appendChild(el('div', 'tags', p.specializations.join('  ·  ')));
    root.appendChild(sp);
  }

  if (p.creations.length) {
    const cr = el('div', 'panel');
    cr.appendChild(el('div', 'panel-title', 'INSTRUMENTS OF RECORD'));
    for (const c of p.creations) cr.appendChild(el('div', 'small', 'WK' + c.week + ': ' + c.title));
    root.appendChild(cr);
  }
}

/* =============================================================================
 * POWERS TAB
 * ========================================================================= */
function renderFactions() {
  const root = $('main-panel');
  const p = STATE.player;

  /* Comparative power graph across all live factions. */
  if (STATE.trend.length > 1) {
    const box = el('div', 'panel');
    box.appendChild(el('div', 'panel-title', 'BALANCE OF POWER'));
    for (const f of Object.values(STATE.factions)) {
      if (f.defunct) continue;
      const row = el('div', 'kv');
      const k = el('span', 'k');
      k.appendChild(el('span', 'crest', crestOf(f)));
      k.appendChild(document.createTextNode(' ' + f.def.short));
      row.appendChild(k);
      row.appendChild(el('span', 'v', pipBar(f.power, 100) + ' ' + f.power));
      box.appendChild(row);
    }
    const lead = Object.values(STATE.factions).find(f => f.ascendant);
    if (lead) {
      box.appendChild(sparkline(STATE.trend.map(t => t.powers[lead.id] || 0),
        'ASCENDANT: ' + lead.def.short, 'POWER TRACE'));
    }
    root.appendChild(box);
  }

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
    else if (f.id === p.factionId) flags.appendChild(el('span', 'flag good', 'AFFILIATED'));
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

    const ctrl = el('div', 'control-grid');
    for (const r of REGIONS) {
      const c = f.control[r.id] || 0;
      const row = el('div', 'kv');
      row.appendChild(el('span', 'k', r.name));
      row.appendChild(el('span', 'v' + (c > 0 ? '' : ' dim'), pipBar(c, 100) + ' ' + c));
      ctrl.appendChild(row);
    }
    box.appendChild(ctrl);

    const parts = [];
    for (const oid in f.relations) {
      const o = STATE.factions[oid];
      if (!o || o.defunct) continue;
      parts.push(o.def.short + ' ' + (f.relations[oid] > 0 ? '+' : '') + f.relations[oid]);
    }
    box.appendChild(el('div', 'small dim', 'RELATIONS: ' + (parts.join('  |  ') || 'none')));

    if (f.lastRuleFired) {
      box.appendChild(el('div', 'small rule-tag', 'LAST RULE FIRED: ' + f.lastRuleFired));
    }
    root.appendChild(box);
  }

  const ref = el('div', 'panel');
  ref.appendChild(el('div', 'panel-title', 'FACTION AI — RULE REFERENCE'));
  ref.appendChild(el('div', 'micro dim', 'UNIVERSAL (ALL FACTIONS)'));
  for (const r of UNIVERSAL_RULES) ref.appendChild(el('div', 'small', '· ' + r.name + ' — ' + r.desc));
  for (const fid in FACTION_RULES) {
    const f = STATE.factions[fid];
    if (!f) continue;
    ref.appendChild(el('div', 'micro dim', crestOf(f) + ' ' + f.def.short));
    for (const r of FACTION_RULES[fid]) ref.appendChild(el('div', 'small', '· ' + r.name + ' — ' + r.desc));
  }
  ref.appendChild(el('div', 'micro dim', 'PLAYER-FOUNDED FACTIONS'));
  for (const r of PLAYER_FACTION_RULES) ref.appendChild(el('div', 'small', '· ' + r.name + ' — ' + r.desc));
  root.appendChild(ref);
}

/* =============================================================================
 * RANKS TAB
 * ========================================================================= */
function renderHierarchy() {
  const root = $('main-panel');
  const p = STATE.player;

  for (const f of Object.values(STATE.factions)) {
    if (f.defunct) continue;
    const box = el('div', 'panel');
    const t = el('div', 'panel-title');
    t.appendChild(el('span', 'crest', crestOf(f)));
    t.appendChild(document.createTextNode(' ' + f.def.name));
    box.appendChild(t);

    for (let r = RANK_COUNT - 1; r >= 0; r--) {
      const at = npcsOfFaction(STATE, f.id).filter(n => n.rankIndex === r);
      const isPlayerHere = p.factionId === f.id && p.rankIndex === r;
      if (!at.length && !isPlayerHere) continue;
      const row = el('div', 'rank-row');
      row.appendChild(el('div', 'rank-title',
        String(r) + ' · ' + f.def.rankTitles[r].toUpperCase()));
      const names = el('div', 'rank-names');
      if (isPlayerHere) names.appendChild(el('span', 'npc you', 'YOU'));
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

/* =============================================================================
 * ARCHIVE TAB
 * ========================================================================= */
function renderHistory() {
  const root = $('main-panel');
  const p = STATE.player;

  const box = el('div', 'panel');
  box.appendChild(el('div', 'panel-title', 'ARCHIVE — PRIOR DECADE'));
  for (const h of STATE.history) {
    const line = el('div', 'hist-line');
    line.appendChild(el('span', 'hist-year', h.year + '  '));
    line.appendChild(el('span', null, h.text));
    box.appendChild(line);
  }
  root.appendChild(box);

  const rec = el('div', 'panel');
  rec.appendChild(el('div', 'panel-title', 'SUBJECT RECORD'));
  rec.appendChild(el('div', 'small', 'Weeks survived: ' + STATE.week));
  rec.appendChild(el('div', 'small', 'Specializations: ' + (p.specializations.join(', ') || 'none')));
  rec.appendChild(el('div', 'small', 'Instruments: ' +
    (p.creations.map(c => c.title).join('; ') || 'none')));
  rec.appendChild(el('div', 'small', 'Prior flags: ' +
    (p.priorFactions.map(x =>
      STATE.factions[x.id].def.short + ' (rank ' + x.rankIndex + ', left WK' + x.week + ')'
    ).join('; ') || 'none')));
  if (STATE.trend.length > 1) {
    rec.appendChild(sparkline(STATE.trend.map(t => t.heat), 'EXPOSURE TRACE', 'HEAT'));
  }
  root.appendChild(rec);
}

/* =============================================================================
 * MASTER RENDER
 * ========================================================================= */
function render() {
  renderHeader();
  renderTabs();
  updateCommitBar();

  /* Preserve the reading position when a re-render is caused by staging an
   * order; only jump back to the top when the view itself changed. */
  const content = $('content');
  const viewKey = UI.tab + '/' + (UI.targetPanel || '-') + '/' + (STATE.gameOver ? 'end' : 'live');
  const keepScroll = viewKey === UI._viewKey;
  const scrollY = content.scrollTop;
  UI._viewKey = viewKey;

  const main = $('main-panel');
  main.innerHTML = '';
  if (STATE.gameOver) renderOps();
  else if (UI.tab === 'ops') renderOps();
  else if (UI.tab === 'status') renderStatusTab();
  else if (UI.tab === 'factions') renderFactions();
  else if (UI.tab === 'hierarchy') renderHierarchy();
  else renderHistory();
  content.scrollTop = keepScroll ? scrollY : 0;
}

/* =============================================================================
 * BOOT
 * ========================================================================= */
window.addEventListener('DOMContentLoaded', () => {
  $('commit-btn').addEventListener('click', commit);
  $('log-skip').addEventListener('click', revealAllLog);
  $('log').addEventListener('click', () => { if (UI.typing) revealAllLog(); });

  /* Keyboard convenience on desktop: space/enter commits the staged order. */
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (UI.typing) revealAllLog();
      else commit();
    }
  });

  /* Belt-and-braces screen lock: block pinch-zoom and double-tap zoom. */
  document.addEventListener('gesturestart', e => e.preventDefault());
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  newGame();
  renderSetup();
});
