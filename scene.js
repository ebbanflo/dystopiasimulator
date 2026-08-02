/* =============================================================================
 * scene.js — THE FIGURE BAR.
 *
 * A wide, short canvas strip pinned under the header that shows the player as
 * a stick figure standing in their region, and ACTS OUT whatever order was
 * just committed: working a line, addressing a crowd, handing over money,
 * walking up behind somebody, being shot at, being jailed, raising a flag.
 *
 * Design rules:
 *   - One fixed logical coordinate space (SCENE_W x SCENE_H), scaled to the
 *     element and to devicePixelRatio, so it looks identical on every phone.
 *   - Everything is drawn from primitives: no images, no external assets.
 *   - Animations are queued. The strip returns to `idle` when the queue drains.
 *   - The whole loop stops when nothing is animating and the tab is hidden,
 *     so it costs nothing while the player reads.
 *
 * PUBLIC API
 *   Scene.init(canvas, captionEl)
 *   Scene.setWorld({ sector, regionName, crest, rankLabel, held, alive })
 *   Scene.play(animId, { caption, accent })   — queue one beat
 *   Scene.clear()                             — drop the queue, return to idle
 * ========================================================================= */

const SCENE_W = 340;
const SCENE_H = 96;
/* The ground sits well above the bottom edge: the lower band of the strip is
 * reserved for the caption, so figures never draw underneath the text. */
const GROUND_Y = 62;

/* Accent colours per action category. The strip is the one place in the app
 * that carries saturated colour, so the current activity reads instantly. */
const SCENE_ACCENTS = {
  work:    '#7ea6c4',   // steel
  legit:   '#79b479',   // green
  corrupt: '#c25a52',   // red
  faction: '#6fb5b8',   // cyan
  special: '#a482c4',   // violet
  danger:  '#d2554a',   // alarm red
  neutral: '#9a9a9a',
};

const Scene = {
  canvas: null,
  ctx: null,
  captionEl: null,
  dpr: 1,
  running: false,
  queue: [],
  current: null,
  startedAt: 0,
  t0: 0,
  world: {
    sector: 'water',
    regionName: '',
    crest: '',
    rankLabel: '',
    held: false,
    alive: true,
  },

  init(canvas, captionEl) {
    this.canvas = canvas;
    this.captionEl = captionEl;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.t0 = performance.now();
    this.start();
  },

  /* The bar occupies a FIXED height (read from the --scene-h CSS variable) so
   * it cannot eat the content area on a tall phone. Width scales freely; the
   * vertical scale is derived separately, which squashes the drawing slightly
   * on wide screens. That is deliberate — a predictable shell beats a
   * perfectly square stick figure. */
  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width || SCENE_W);
    const cssVar = getComputedStyle(document.documentElement)
      .getPropertyValue('--scene-h').trim();
    const h = parseFloat(cssVar) || SCENE_H;

    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.height = h + 'px';
    this.scaleX = (w / SCENE_W) * this.dpr;
    this.scaleY = (h / SCENE_H) * this.dpr;
  },

  setWorld(w) {
    Object.assign(this.world, w);
  },

  play(animId, opts) {
    const anim = SCENE_ANIMS[animId] ? animId : 'idle';
    this.queue.push({
      id: anim,
      dur: SCENE_ANIMS[anim].dur,
      caption: (opts && opts.caption) || SCENE_ANIMS[anim].caption || '',
      accent: SCENE_ACCENTS[(opts && opts.accent) || SCENE_ANIMS[anim].accent || 'neutral'],
    });
    this.start();
  },

  clear() {
    this.queue.length = 0;
    this.current = null;
  },

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (now) => {
      if (!this.running) return;
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  frame(now) {
    if (!this.current || now - this.startedAt >= this.current.dur) {
      if (this.queue.length) {
        this.current = this.queue.shift();
        this.startedAt = now;
        if (this.captionEl) this.captionEl.textContent = this.current.caption;
      } else if (!this.current || this.current.id !== 'idle') {
        this.current = {
          id: this.world.alive ? (this.world.held ? 'jail_idle' : 'idle') : 'dead_idle',
          dur: Infinity,
          caption: this.idleCaption(),
          accent: SCENE_ACCENTS.neutral,
        };
        this.startedAt = now;
        if (this.captionEl) this.captionEl.textContent = this.current.caption;
      }
    }
    const elapsed = now - this.startedAt;
    const p = this.current.dur === Infinity ? 0 : clamp(elapsed / this.current.dur, 0, 1);
    this.draw(elapsed, p);
  },

  idleCaption() {
    const w = this.world;
    if (!w.alive) return 'RECORD CLOSED';
    if (w.held) return 'IN CUSTODY';
    return [w.regionName, w.rankLabel].filter(Boolean).join(' · ');
  },

  draw(elapsed, progress) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);

    const S = {
      ctx: ctx,
      t: elapsed,
      p: progress,
      accent: this.current.accent,
      world: this.world,
      time: (performance.now() - this.t0) / 1000,
    };

    drawBackdrop(S);
    (SCENE_ANIMS[this.current.id] || SCENE_ANIMS.idle).draw(S);
    drawForeground(S);
    ctx.restore();
  },
};

/* =============================================================================
 * PRIMITIVES
 * ========================================================================= */

function sline(ctx, x1, y1, x2, y2, w, color) {
  ctx.beginPath();
  ctx.lineWidth = w || 1.4;
  ctx.strokeStyle = color || '#d4d4d4';
  ctx.lineCap = 'round';
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/* A stick figure. Angles are in radians, 0 = straight down for limbs. */
function figure(ctx, cfg) {
  const x = cfg.x, y = cfg.y;             // y is the FEET line
  const s = cfg.scale || 1;
  const color = cfg.color || '#e8e8e8';
  const lw = (cfg.weight || 1.5) * s;
  const H = 36 * s;                        // full height
  const headR = 3.6 * s;
  const lean = cfg.lean || 0;

  if (cfg.down) {
    /* Horizontal: dead, unconscious, or thrown. */
    const yy = y - 3 * s;
    sline(ctx, x - 9 * s, yy, x + 7 * s, yy, lw, color);
    ctx.beginPath();
    ctx.arc(x + 10 * s, yy - 1 * s, headR, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
    sline(ctx, x - 2 * s, yy, x - 6 * s, yy + 5 * s, lw, color);
    sline(ctx, x + 2 * s, yy, x + 5 * s, yy + 5 * s, lw, color);
    return;
  }

  const hipY = y - H * 0.42;
  const hipX = x + lean * 4;
  const shoulderY = y - H * 0.82;
  const shoulderX = x + lean * 8;
  const headY = shoulderY - headR - 1.2 * s;

  /* Legs */
  const legLen = H * 0.42;
  const lA = cfg.legL || 0, rA = cfg.legR || 0;
  sline(ctx, hipX, hipY, hipX + Math.sin(lA) * legLen, hipY + Math.cos(lA) * legLen, lw, color);
  sline(ctx, hipX, hipY, hipX + Math.sin(rA) * legLen, hipY + Math.cos(rA) * legLen, lw, color);

  /* Torso */
  sline(ctx, hipX, hipY, shoulderX, shoulderY, lw, color);

  /* Arms */
  const armLen = H * 0.34;
  const aL = cfg.armL === undefined ? 0.3 : cfg.armL;
  const aR = cfg.armR === undefined ? -0.3 : cfg.armR;
  sline(ctx, shoulderX, shoulderY,
    shoulderX + Math.sin(aL) * armLen, shoulderY + Math.cos(aL) * armLen, lw, color);
  sline(ctx, shoulderX, shoulderY,
    shoulderX + Math.sin(aR) * armLen, shoulderY + Math.cos(aR) * armLen, lw, color);

  /* Head */
  ctx.beginPath();
  ctx.arc(shoulderX + (cfg.headTilt || 0) * 2, headY, headR, 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (cfg.fillHead) { ctx.fillStyle = color; ctx.fill(); }
}

/* Small crowd of figures, animated with a shared phase. */
function crowd(ctx, x, y, n, time, color, scale) {
  for (let i = 0; i < n; i++) {
    const ph = time * 2 + i * 1.3;
    figure(ctx, {
      x: x + i * 11, y: y, scale: (scale || 0.62),
      color: color,
      armL: 0.5 + Math.sin(ph) * 0.9,
      armR: -0.5 - Math.cos(ph * 0.8) * 0.9,
      legL: 0.12, legR: -0.12,
      weight: 1.2,
    });
  }
}

/* =============================================================================
 * BACKDROP — sector props, region silhouette, faction banner
 * ========================================================================= */
function drawBackdrop(S) {
  const ctx = S.ctx;

  /* Sky wash. */
  const grad = ctx.createLinearGradient(0, 0, 0, SCENE_H);
  grad.addColorStop(0, '#101014');
  grad.addColorStop(1, '#1a1a1e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  /* Distant skyline: deterministic bars so it does not shimmer. */
  ctx.fillStyle = '#232329';
  for (let i = 0; i < 22; i++) {
    const w = 8 + ((i * 37) % 13);
    const h = 8 + ((i * 53) % 22);
    ctx.fillRect(i * 16 - 4, GROUND_Y - h, w, h);
  }

  /* A sun/haze disc that drifts very slowly. */
  const sx = 280 + Math.sin(S.time * 0.05) * 12;
  ctx.beginPath();
  ctx.arc(sx, 18, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(220,220,220,0.08)';
  ctx.fill();

  drawSectorProp(S);

  /* Ground line + hatching. */
  sline(ctx, 0, GROUND_Y, SCENE_W, GROUND_Y, 1, '#3a3a3a');
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < SCENE_W; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 2);
    ctx.lineTo(x - 5, SCENE_H);
    ctx.stroke();
  }

  drawBanner(S);
}

/* One silhouette prop per sector, so the strip says where you work. */
function drawSectorProp(S) {
  const ctx = S.ctx;
  const c = '#2a2a2e';
  const sec = S.world.sector;

  if (sec === 'energy') {
    /* Pylon */
    const x = 44, top = 20;
    sline(ctx, x - 9, GROUND_Y, x - 3, top, 1.4, c);
    sline(ctx, x + 9, GROUND_Y, x + 3, top, 1.4, c);
    for (let i = 0; i < 4; i++) {
      const yy = top + i * 14;
      const spread = 3 + i * 2;
      sline(ctx, x - spread, yy, x + spread, yy, 1, c);
    }
    sline(ctx, x - 14, top + 4, x + 14, top + 4, 1, c);
    /* Slowly blinking hazard lamp. */
    if (Math.floor(S.time * 0.8) % 2 === 0) {
      ctx.beginPath(); ctx.arc(x, top - 2, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(210,85,74,0.75)'; ctx.fill();
    }
  } else if (sec === 'water') {
    /* Storage tank + pipe run */
    ctx.fillStyle = c;
    ctx.fillRect(24, GROUND_Y - 34, 34, 34);
    ctx.fillRect(20, GROUND_Y - 38, 42, 5);
    ctx.fillRect(58, GROUND_Y - 14, 40, 4);
    sline(ctx, 30, GROUND_Y - 30, 52, GROUND_Y - 30, 1, '#3d3d42');
    sline(ctx, 30, GROUND_Y - 22, 52, GROUND_Y - 22, 1, '#3d3d42');
    /* Drip. */
    const dy = (S.time * 26) % 20;
    ctx.fillStyle = 'rgba(126,166,196,0.5)';
    ctx.fillRect(97, GROUND_Y - 10 + dy, 1.4, 3);
  } else {
    /* Stack house: lit growing tiers */
    ctx.fillStyle = c;
    ctx.fillRect(26, GROUND_Y - 40, 40, 40);
    for (let i = 0; i < 4; i++) {
      const yy = GROUND_Y - 36 + i * 9;
      const lit = (Math.floor(S.time * 0.5) + i) % 5 !== 0;
      ctx.fillStyle = lit ? 'rgba(121,180,121,0.30)' : 'rgba(121,180,121,0.08)';
      ctx.fillRect(30, yy, 32, 4);
    }
  }
}

/* Faction banner on a pole — the crest glyph flies from it when affiliated. */
function drawBanner(S) {
  const ctx = S.ctx;
  if (!S.world.crest) return;
  const x = 306, top = 16;
  sline(ctx, x, top, x, GROUND_Y, 1.2, '#4a4a4e');
  const wave = Math.sin(S.time * 1.6) * 1.8;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(x, top + 2);
  ctx.lineTo(x - 20, top + 4 + wave);
  ctx.lineTo(x - 20, top + 16 + wave);
  ctx.lineTo(x, top + 15);
  ctx.closePath();
  ctx.fill();
  ctx.font = '9px monospace';
  ctx.fillStyle = '#cfcfcf';
  ctx.textAlign = 'center';
  ctx.fillText(S.world.crest, x - 10, top + 13 + wave);
  ctx.textAlign = 'left';
}

/* Vignette + scanline overlay so the strip matches the shell. */
function drawForeground(S) {
  const ctx = S.ctx;
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < SCENE_H; y += 3) ctx.fillRect(0, y, SCENE_W, 1);
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(SCENE_W / 2, GROUND_Y - 12, 40, SCENE_W / 2, GROUND_Y - 12, 200);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  /* Solid band under the ground line so the caption always has a backing. */
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, GROUND_Y + 16, SCENE_W, SCENE_H - GROUND_Y - 16);
}

/* Shared helper: the player's default standing position. */
const PX = 150;

/* Breathing/sway idle pose values. */
function idlePose(time) {
  return {
    armL: 0.28 + Math.sin(time * 1.1) * 0.05,
    armR: -0.28 - Math.cos(time * 0.9) * 0.05,
    legL: 0.1, legR: -0.1,
    lean: Math.sin(time * 0.6) * 0.03,
  };
}

/* =============================================================================
 * ANIMATIONS
 * Each: { dur, caption, accent, draw(S) }
 * ========================================================================= */
const SCENE_ANIMS = {

  idle: {
    dur: Infinity, accent: 'neutral',
    draw(S) {
      const pose = idlePose(S.time);
      figure(S.ctx, Object.assign({ x: PX, y: GROUND_Y, scale: 1, color: '#e8e8e8' }, pose));
    },
  },

  jail_idle: {
    dur: Infinity, caption: 'IN CUSTODY', accent: 'danger',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, { x: PX, y: GROUND_Y, scale: 1, color: '#9a9a9a', armL: 0.2, armR: -0.2, legL: 0.08, legR: -0.08 });
      for (let i = 0; i < 6; i++) {
        sline(ctx, PX - 26 + i * 10, GROUND_Y - 44, PX - 26 + i * 10, GROUND_Y, 1.6, '#6a6a6a');
      }
      sline(ctx, PX - 30, GROUND_Y - 44, PX + 26, GROUND_Y - 44, 1.6, '#6a6a6a');
    },
  },

  dead_idle: {
    dur: Infinity, caption: 'RECORD CLOSED', accent: 'danger',
    draw(S) {
      figure(S.ctx, { x: PX, y: GROUND_Y, scale: 1, color: '#6a6a6a', down: true });
      S.ctx.font = '7px monospace';
      S.ctx.fillStyle = '#6a6a6a';
      S.ctx.fillText('▬', PX - 3, GROUND_Y - 14);
    },
  },

  /* ---- Subsistence ---- */
  work: {
    dur: 2400, caption: 'WORKING THE LINE', accent: 'work',
    draw(S) {
      const swing = Math.sin(S.t / 150) * 0.9;
      figure(S.ctx, {
        x: PX, y: GROUND_Y, scale: 1, color: '#e8e8e8', lean: 0.15,
        armL: 1.1 + swing, armR: 1.0 + swing * 0.9, legL: 0.25, legR: -0.2,
      });
      /* Tool + spark on the down-stroke. */
      const tipX = PX + 16 + Math.sin(S.t / 150) * 6;
      const tipY = GROUND_Y - 16 + Math.cos(S.t / 150) * 5;
      sline(S.ctx, PX + 6, GROUND_Y - 20, tipX, tipY, 1.6, S.accent);
      if (Math.sin(S.t / 150) > 0.85) {
        S.ctx.fillStyle = S.accent;
        for (let i = 0; i < 4; i++) {
          S.ctx.fillRect(tipX + (i - 2) * 2.5, tipY + ((i * 7) % 5) - 2, 1.4, 1.4);
        }
      }
    },
  },

  scrounge: {
    dur: 2400, caption: 'STRIPPING SALVAGE', accent: 'work',
    draw(S) {
      const ctx = S.ctx;
      const bend = 0.5 + Math.sin(S.t / 260) * 0.35;
      figure(ctx, {
        x: PX, y: GROUND_Y, scale: 1, color: '#e8e8e8', lean: 0.5,
        armL: 1.5, armR: 1.3, legL: 0.4, legR: -0.25, headTilt: 1,
      });
      /* A pile of scrap that grows as the beat runs. */
      ctx.fillStyle = S.accent;
      const n = Math.floor(S.p * 7) + 1;
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = 0.5 + (i % 3) * 0.15;
        ctx.fillRect(PX + 22 + (i % 4) * 5, GROUND_Y - 3 - Math.floor(i / 4) * 4, 4, 3);
      }
      ctx.globalAlpha = 1;
      void bend;
    },
  },

  laylow: {
    dur: 2200, caption: 'LYING LOW', accent: 'work',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, {
        x: PX, y: GROUND_Y, scale: 0.86, color: '#9a9a9a',
        armL: 0.9, armR: -0.9, legL: 0.9, legR: -0.9, lean: 0.4,
      });
      /* A doorway shadow closing over the figure. */
      ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + S.p * 0.45).toFixed(2) + ')';
      ctx.fillRect(PX - 34, 0, 68, SCENE_H);
    },
  },

  /* ---- Legitimate ---- */
  protest: {
    dur: 2800, caption: 'ORGANISING A PROTEST', accent: 'legit',
    draw(S) {
      const ctx = S.ctx;
      crowd(ctx, PX + 20, GROUND_Y, 5, S.time, 'rgba(232,232,232,0.55)', 0.6);
      figure(ctx, {
        x: PX - 18, y: GROUND_Y, scale: 1.05, color: '#ffffff',
        armL: 2.7, armR: -0.4, legL: 0.15, legR: -0.15,
      });
      /* Raised placard. */
      const px = PX - 30, py = GROUND_Y - 40;
      sline(ctx, PX - 22, GROUND_Y - 24, px + 4, py + 8, 1.4, S.accent);
      ctx.fillStyle = S.accent;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(px - 6, py - 6, 20, 13);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#0c0c0e'; ctx.lineWidth = 1;
      ctx.strokeRect(px - 3, py - 3, 6, 1);
      ctx.strokeRect(px - 3, py, 12, 1);
    },
  },

  draft: {
    dur: 2600, caption: 'DRAFTING AN INSTRUMENT', accent: 'legit',
    draw(S) {
      const ctx = S.ctx;
      /* Desk */
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(PX - 6, GROUND_Y - 16, 44, 3);
      sline(ctx, PX - 4, GROUND_Y - 13, PX - 4, GROUND_Y, 1.2, '#2a2a2e');
      sline(ctx, PX + 36, GROUND_Y - 13, PX + 36, GROUND_Y, 1.2, '#2a2a2e');
      figure(ctx, {
        x: PX - 14, y: GROUND_Y, scale: 0.95, color: '#e8e8e8', lean: 0.35,
        armL: 1.35 + Math.sin(S.t / 120) * 0.12, armR: 1.1, legL: 0.5, legR: -0.4, headTilt: 1,
      });
      /* Paper filling with ruled lines as the beat runs. */
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(PX + 8, GROUND_Y - 24, 18, 9);
      ctx.strokeStyle = S.accent; ctx.lineWidth = 0.6;
      const rows = Math.floor(S.p * 4) + 1;
      for (let i = 0; i < rows; i++) {
        ctx.beginPath();
        ctx.moveTo(PX + 10, GROUND_Y - 22 + i * 2);
        ctx.lineTo(PX + 24, GROUND_Y - 22 + i * 2);
        ctx.stroke();
      }
      /* Stamp on the final beat. */
      if (S.p > 0.78) {
        ctx.globalAlpha = clamp((S.p - 0.78) * 6, 0, 1);
        ctx.strokeStyle = SCENE_ACCENTS.danger; ctx.lineWidth = 1.4;
        ctx.strokeRect(PX + 12, GROUND_Y - 23, 11, 7);
        ctx.globalAlpha = 1;
      }
    },
  },

  campaign: {
    dur: 2800, caption: 'PUBLIC CAMPAIGN', accent: 'legit',
    draw(S) {
      const ctx = S.ctx;
      /* Podium */
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(PX - 12, GROUND_Y - 18, 24, 18);
      figure(ctx, {
        x: PX, y: GROUND_Y - 18, scale: 0.95, color: '#ffffff',
        armL: 2.4, armR: -0.5, legL: 0.1, legR: -0.1,
      });
      /* Broadcast arcs. */
      ctx.strokeStyle = S.accent;
      for (let i = 0; i < 3; i++) {
        const r = 14 + i * 9 + (S.t / 60) % 9;
        ctx.globalAlpha = clamp(1 - (r - 14) / 34, 0, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(PX + 8, GROUND_Y - 44, r, -0.9, 0.9);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      crowd(ctx, PX + 34, GROUND_Y, 4, S.time * 0.6, 'rgba(232,232,232,0.4)', 0.55);
    },
  },

  organize: {
    dur: 2600, caption: 'ORGANISING A WARD', accent: 'legit',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, {
        x: PX - 24, y: GROUND_Y, scale: 1, color: '#ffffff',
        armL: 1.9, armR: -0.3, legL: 0.12, legR: -0.12,
      });
      /* Figures walking in and lining up as the beat progresses. */
      const n = 4;
      for (let i = 0; i < n; i++) {
        const target = PX + 4 + i * 13;
        const from = SCENE_W + 20 + i * 18;
        const x = from + (target - from) * clamp(S.p * 1.4 - i * 0.1, 0, 1);
        figure(ctx, {
          x: x, y: GROUND_Y, scale: 0.62, color: 'rgba(232,232,232,0.6)',
          armL: 0.5 + Math.sin(S.time * 4 + i) * 0.5,
          armR: -0.5 - Math.sin(S.time * 4 + i) * 0.5,
          legL: Math.sin(S.time * 6 + i) * 0.5, legR: -Math.sin(S.time * 6 + i) * 0.5,
          weight: 1.2,
        });
      }
    },
  },

  promote: {
    dur: 2600, caption: 'ELEVATED', accent: 'legit',
    draw(S) {
      const ctx = S.ctx;
      const lift = S.p * 16;
      /* Rising plinth. */
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(PX - 14, GROUND_Y - lift, 28, lift + 2);
      figure(ctx, {
        x: PX, y: GROUND_Y - lift, scale: 1, color: '#ffffff',
        armL: 2.6, armR: -2.6, legL: 0.1, legR: -0.1,
      });
      ctx.strokeStyle = S.accent; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.35;
        const r1 = 20 + S.p * 6, r2 = r1 + 5;
        ctx.globalAlpha = 0.9 - S.p * 0.5;
        ctx.beginPath();
        ctx.moveTo(PX + Math.cos(a) * r1, GROUND_Y - lift - 26 + Math.sin(a) * r1);
        ctx.lineTo(PX + Math.cos(a) * r2, GROUND_Y - lift - 26 + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },

  /* ---- Corrupt ---- */
  bribe: {
    dur: 2600, caption: 'PAYMENT MADE', accent: 'corrupt',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, { x: PX - 26, y: GROUND_Y, scale: 1, color: '#e8e8e8', armL: 1.4, armR: -0.3, legL: 0.1, legR: -0.1 });
      figure(ctx, { x: PX + 26, y: GROUND_Y, scale: 1.05, color: '#b8b8b8', armL: 0.3, armR: -1.4, legL: 0.1, legR: -0.1 });
      /* Coin travelling between the two hands. */
      const t = clamp((S.p - 0.15) / 0.55, 0, 1);
      const cx = (PX - 16) + t * 32;
      const cy = GROUND_Y - 24 - Math.sin(t * Math.PI) * 12;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = S.accent;
      ctx.fill();
      if (S.p > 0.75) {
        ctx.globalAlpha = clamp((S.p - 0.75) * 4, 0, 1);
        ctx.font = '7px monospace';
        ctx.fillStyle = S.accent;
        ctx.fillText('✓', PX + 22, GROUND_Y - 38);
        ctx.globalAlpha = 1;
      }
    },
  },

  blackmail: {
    dur: 2600, caption: 'LEVERAGE APPLIED', accent: 'corrupt',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, { x: PX - 26, y: GROUND_Y, scale: 1, color: '#e8e8e8', armL: 1.5, armR: -0.2, legL: 0.1, legR: -0.1 });
      /* The other figure recoils as the beat runs. */
      figure(ctx, {
        x: PX + 28 + S.p * 6, y: GROUND_Y, scale: 1, color: '#b8b8b8',
        armL: 0.4 + S.p * 1.6, armR: -0.4 - S.p * 1.6, legL: 0.2, legR: -0.3, lean: 0.3 * S.p,
      });
      /* Envelope/photograph held out. */
      const ex = PX - 8, ey = GROUND_Y - 26;
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(ex, ey, 13, 9);
      ctx.strokeStyle = S.accent; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + 6.5, ey + 5); ctx.lineTo(ex + 13, ey); ctx.stroke();
    },
  },

  assassinate_ok: {
    dur: 3000, caption: 'TARGET REMOVED', accent: 'corrupt',
    draw(S) {
      const ctx = S.ctx;
      /* Player closes the distance, then the target goes down. */
      const approach = clamp(S.p / 0.55, 0, 1);
      const x = PX - 40 + approach * 34;
      const fallen = S.p > 0.6;
      if (!fallen) {
        figure(ctx, {
          x: PX + 26, y: GROUND_Y, scale: 1.05, color: '#b8b8b8',
          armL: 0.3, armR: -0.3, legL: 0.1, legR: -0.1,
        });
      } else {
        figure(ctx, { x: PX + 26, y: GROUND_Y, scale: 1.05, color: '#6a6a6a', down: true });
      }
      figure(ctx, {
        x: x, y: GROUND_Y, scale: 1, color: '#ffffff', lean: 0.2,
        armL: fallen ? 0.4 : 1.6, armR: -0.2,
        legL: Math.sin(S.time * 7) * 0.45 * (1 - approach) + 0.12,
        legR: -Math.sin(S.time * 7) * 0.45 * (1 - approach) - 0.12,
      });
      if (S.p > 0.55 && S.p < 0.72) {
        ctx.globalAlpha = 1 - (S.p - 0.55) / 0.17;
        ctx.fillStyle = SCENE_ACCENTS.danger;
        ctx.fillRect(PX + 12, GROUND_Y - 30, 3, 3);
        ctx.globalAlpha = 1;
      }
    },
  },

  assassinate_fail: {
    dur: 3000, caption: 'ATTEMPT FAILED', accent: 'danger',
    draw(S) {
      const ctx = S.ctx;
      /* The target is ready; the player is driven back. */
      figure(ctx, {
        x: PX + 30, y: GROUND_Y, scale: 1.05, color: '#e8e8e8',
        armL: 1.5, armR: -1.5, legL: 0.2, legR: -0.2,
      });
      const retreat = clamp((S.p - 0.35) / 0.65, 0, 1);
      figure(ctx, {
        x: PX - 6 - retreat * 40, y: GROUND_Y, scale: 1, color: '#9a9a9a', lean: -0.4,
        armL: 2.4, armR: -2.4,
        legL: Math.sin(S.time * 9) * 0.6, legR: -Math.sin(S.time * 9) * 0.6,
      });
      /* Muzzle flashes from the target's side. */
      if (Math.floor(S.t / 140) % 3 === 0 && S.p > 0.25) {
        ctx.fillStyle = SCENE_ACCENTS.danger;
        ctx.fillRect(PX + 16, GROUND_Y - 26, 6, 1.6);
      }
    },
  },

  seize: {
    dur: 2800, caption: 'SEIZING GROUND', accent: 'corrupt',
    draw(S) {
      const ctx = S.ctx;
      /* Two small groups meeting in the middle. */
      const push = Math.sin(S.p * Math.PI) * 8;
      crowd(ctx, PX - 60 + push, GROUND_Y, 3, S.time * 1.4, 'rgba(255,255,255,0.75)', 0.6);
      crowd(ctx, PX + 24 - push, GROUND_Y, 3, S.time * 1.2, 'rgba(184,184,184,0.55)', 0.6);
      figure(ctx, {
        x: PX - 16 + push, y: GROUND_Y, scale: 1, color: '#ffffff', lean: 0.3,
        armL: 1.8, armR: 1.2, legL: 0.3, legR: -0.25,
      });
      /* Contested marker. */
      ctx.strokeStyle = S.accent; ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(PX + 4, GROUND_Y - 40, 26, 40);
      ctx.setLineDash([]);
    },
  },

  skim: {
    dur: 2400, caption: 'DIVERTING FUNDS', accent: 'corrupt',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, {
        x: PX, y: GROUND_Y, scale: 1, color: '#e8e8e8', lean: 0.2,
        armL: 1.3, armR: 0.9, legL: 0.15, legR: -0.15, headTilt: -1,
      });
      /* Ledger with a column quietly walking off the page. */
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(PX + 14, GROUND_Y - 30, 20, 14);
      ctx.fillStyle = S.accent;
      for (let i = 0; i < 4; i++) {
        const drift = S.p * 14 * ((i % 2) ? 1 : 0.4);
        ctx.fillRect(PX + 17 + drift, GROUND_Y - 27 + i * 3, 8 - drift * 0.3, 1.2);
      }
    },
  },

  /* ---- Affiliation / schism ---- */
  join: {
    dur: 2600, caption: 'PETITIONING', accent: 'faction',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, {
        x: PX - 24, y: GROUND_Y, scale: 1, color: '#e8e8e8',
        armL: 1.5, armR: -0.2, legL: 0.1, legR: -0.1, lean: 0.15,
      });
      figure(ctx, {
        x: PX + 20, y: GROUND_Y, scale: 1.08, color: '#b8b8b8',
        armL: 0.2, armR: -1.5, legL: 0.1, legR: -0.1,
      });
      /* Handshake meeting in the middle. */
      const met = clamp((S.p - 0.3) / 0.4, 0, 1);
      ctx.beginPath();
      ctx.arc(PX - 2, GROUND_Y - 22, 2 + met * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = S.accent;
      ctx.globalAlpha = 0.3 + met * 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  },

  leave: {
    dur: 2600, caption: 'WALKING AWAY', accent: 'faction',
    draw(S) {
      const ctx = S.ctx;
      crowd(ctx, PX + 30, GROUND_Y, 3, S.time * 0.5, 'rgba(184,184,184,0.4)', 0.6);
      const x = PX - S.p * 70;
      figure(ctx, {
        x: x, y: GROUND_Y, scale: 1, color: '#e8e8e8', lean: -0.1,
        armL: Math.sin(S.time * 6) * 0.7, armR: -Math.sin(S.time * 6) * 0.7,
        legL: Math.sin(S.time * 6) * 0.55, legR: -Math.sin(S.time * 6) * 0.55,
      });
    },
  },

  found: {
    dur: 3200, caption: 'RAISING THE FLAG', accent: 'special',
    draw(S) {
      const ctx = S.ctx;
      const poleTop = GROUND_Y - 12 - S.p * 42;
      sline(ctx, PX + 10, GROUND_Y, PX + 10, poleTop, 1.6, '#cfcfcf');
      ctx.fillStyle = S.accent;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(PX + 10, poleTop + 1);
      ctx.lineTo(PX + 30, poleTop + 4 + Math.sin(S.time * 5) * 1.5);
      ctx.lineTo(PX + 30, poleTop + 15 + Math.sin(S.time * 5) * 1.5);
      ctx.lineTo(PX + 10, poleTop + 13);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      figure(ctx, {
        x: PX, y: GROUND_Y, scale: 1.05, color: '#ffffff',
        armL: 2.5, armR: -0.4, legL: 0.15, legR: -0.15,
      });
      /* Followers arriving behind. */
      const n = Math.floor(S.p * 4);
      for (let i = 0; i < n; i++) {
        figure(ctx, {
          x: PX - 26 - i * 12, y: GROUND_Y, scale: 0.6,
          color: 'rgba(255,255,255,0.5)',
          armL: 0.4, armR: -0.4, legL: 0.15, legR: -0.15, weight: 1.2,
        });
      }
    },
  },

  /* ---- Things done TO the player ---- */
  attacked: {
    dur: 3000, caption: 'ATTEMPT ON YOUR LIFE', accent: 'danger',
    draw(S) {
      const ctx = S.ctx;
      /* Attacker lunges in from the right; player twists away. */
      const lunge = clamp(S.p / 0.4, 0, 1);
      figure(ctx, {
        x: SCENE_W - 40 - lunge * 60, y: GROUND_Y, scale: 1.05, color: '#8a8a8a', lean: 0.4,
        armL: 1.7, armR: 1.3,
        legL: Math.sin(S.time * 10) * 0.5, legR: -Math.sin(S.time * 10) * 0.5,
      });
      figure(ctx, {
        x: PX - 10, y: GROUND_Y, scale: 1, color: '#ffffff', lean: -0.5,
        armL: 2.2, armR: -2.2, legL: 0.5, legR: -0.4,
      });
      /* Impact flare. */
      if (S.p > 0.42 && S.p < 0.62) {
        const a = 1 - (S.p - 0.42) / 0.2;
        ctx.globalAlpha = a;
        ctx.strokeStyle = SCENE_ACCENTS.danger;
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(PX + 6 + Math.cos(ang) * 5, GROUND_Y - 28 + Math.sin(ang) * 5);
          ctx.lineTo(PX + 6 + Math.cos(ang) * 12, GROUND_Y - 28 + Math.sin(ang) * 12);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    },
  },

  jailed: {
    dur: 2600, caption: 'TAKEN INTO CUSTODY', accent: 'danger',
    draw(S) {
      const ctx = S.ctx;
      figure(ctx, {
        x: PX, y: GROUND_Y, scale: 1, color: '#b8b8b8',
        armL: 0.15, armR: -0.15, legL: 0.06, legR: -0.06,
      });
      /* Bars descending over the whole strip. */
      const drop = S.p * 46;
      for (let i = 0; i < 7; i++) {
        sline(ctx, PX - 32 + i * 10, GROUND_Y - drop, PX - 32 + i * 10, GROUND_Y, 1.8, '#7a7a7a');
      }
      sline(ctx, PX - 36, GROUND_Y - drop, PX + 30, GROUND_Y - drop, 1.8, '#7a7a7a');
    },
  },

  death: {
    dur: 3400, caption: 'RECORD CLOSED', accent: 'danger',
    draw(S) {
      const ctx = S.ctx;
      /* Figure collapses, then the strip desaturates to nothing. */
      if (S.p < 0.3) {
        figure(ctx, {
          x: PX, y: GROUND_Y, scale: 1, color: '#ffffff', lean: -S.p * 3,
          armL: 2.0, armR: -2.0, legL: 0.3, legR: -0.3,
        });
      } else {
        figure(ctx, { x: PX, y: GROUND_Y, scale: 1, color: '#9a9a9a', down: true });
      }
      ctx.fillStyle = 'rgba(0,0,0,' + clamp((S.p - 0.4) * 1.2, 0, 0.75).toFixed(2) + ')';
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);
      if (S.p > 0.6) {
        ctx.globalAlpha = clamp((S.p - 0.6) * 3, 0, 1);
        ctx.font = '8px monospace';
        ctx.fillStyle = SCENE_ACCENTS.danger;
        ctx.textAlign = 'center';
        ctx.fillText('▬ ▬ ▬', SCENE_W / 2, GROUND_Y - 30);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    },
  },

  incident: {
    dur: 2200, caption: 'INCIDENT', accent: 'neutral',
    draw(S) {
      const ctx = S.ctx;
      const pose = idlePose(S.time);
      figure(ctx, Object.assign({ x: PX, y: GROUND_Y, scale: 1, color: '#e8e8e8' }, pose));
      /* A second figure arrives and stops, waiting for an answer. */
      const x = SCENE_W + 10 - clamp(S.p * 2, 0, 1) * 120;
      figure(ctx, {
        x: x, y: GROUND_Y, scale: 0.95, color: '#9a9a9a',
        armL: 0.35, armR: -0.35,
        legL: S.p < 0.5 ? Math.sin(S.time * 8) * 0.5 : 0.1,
        legR: S.p < 0.5 ? -Math.sin(S.time * 8) * 0.5 : -0.1,
      });
      if (S.p > 0.55) {
        ctx.globalAlpha = clamp((S.p - 0.55) * 4, 0, 1);
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText('?', PX + 16, GROUND_Y - 40);
        ctx.globalAlpha = 1;
      }
    },
  },

  quiet: {
    dur: 2000, caption: 'AN ORDINARY WEEK', accent: 'neutral',
    draw(S) {
      const ctx = S.ctx;
      const pose = idlePose(S.time);
      figure(ctx, Object.assign({ x: PX, y: GROUND_Y, scale: 1, color: '#d4d4d4' }, pose));
      /* Passers-by crossing the frame and nothing else happening. */
      for (let i = 0; i < 2; i++) {
        const speed = 40 + i * 22;
        const x = ((S.time * speed) + i * 190) % (SCENE_W + 80) - 40;
        figure(ctx, {
          x: x, y: GROUND_Y, scale: 0.55, color: 'rgba(154,154,154,0.45)',
          armL: Math.sin(S.time * 6 + i) * 0.5, armR: -Math.sin(S.time * 6 + i) * 0.5,
          legL: Math.sin(S.time * 7 + i) * 0.5, legR: -Math.sin(S.time * 7 + i) * 0.5,
          weight: 1.1,
        });
      }
    },
  },

  payday: {
    dur: 1800, caption: 'PAID', accent: 'work',
    draw(S) {
      const ctx = S.ctx;
      const pose = idlePose(S.time);
      figure(ctx, Object.assign({ x: PX, y: GROUND_Y, scale: 1, color: '#e8e8e8' }, pose, { armL: 1.8 }));
      for (let i = 0; i < 5; i++) {
        const t = clamp(S.p * 1.4 - i * 0.12, 0, 1);
        if (t <= 0) continue;
        const y = GROUND_Y - 44 + t * 30;
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.fillStyle = S.accent;
        ctx.beginPath();
        ctx.arc(PX + 14 + (i % 3) * 7, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
};

/* Map an action id (and its result) onto a scene beat. Kept here so ui.js
 * does not need to know anything about the animation set. */
function sceneBeatFor(actionId, ok) {
  switch (actionId) {
    case 'work_shift':       return { anim: 'work', accent: 'work' };
    case 'scrounge':         return { anim: 'scrounge', accent: 'work' };
    case 'lay_low':          return { anim: 'laylow', accent: 'work' };
    case 'organize_protest': return { anim: 'protest', accent: 'legit' };
    case 'draft_ordinance':  return { anim: 'draft', accent: 'legit' };
    case 'public_campaign':  return { anim: 'campaign', accent: 'legit' };
    case 'organize_ward':    return { anim: 'organize', accent: 'legit' };
    case 'petition_promotion': return ok
      ? { anim: 'promote', accent: 'legit' }
      : { anim: 'draft', accent: 'legit' };
    case 'bribe':            return { anim: 'bribe', accent: 'corrupt' };
    case 'blackmail':        return { anim: 'blackmail', accent: 'corrupt' };
    case 'skim_funds':       return { anim: 'skim', accent: 'corrupt' };
    case 'seize_turf':       return { anim: 'seize', accent: 'corrupt' };
    case 'assassinate':      return ok
      ? { anim: 'assassinate_ok', accent: 'corrupt' }
      : { anim: 'assassinate_fail', accent: 'danger' };
    case 'petition_join':    return { anim: 'join', accent: 'faction' };
    case 'return_faction':   return { anim: 'join', accent: 'faction' };
    case 'leave_faction':    return { anim: 'leave', accent: 'faction' };
    case 'found_faction':    return { anim: 'found', accent: 'special' };
    case 'wait':             return { anim: 'jail_idle', accent: 'danger' };
    default:                 return { anim: 'incident', accent: 'neutral' };
  }
}
