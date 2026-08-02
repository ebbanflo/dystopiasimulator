/* =============================================================================
 * rng.js — Seeded pseudo-random number generation.
 *
 * Every playthrough draws a seed once. All procedural world state (faction
 * standings, corruption, NPC hierarchies, procedural history) is derived from
 * that seed, so a run is internally coherent and the seed can be shown in the
 * dossier header as a "case file number".
 *
 * NOTE: state is in-memory only. Reloading the page starts a new seed, by
 * design (no localStorage anywhere in this build).
 * ========================================================================= */

/* mulberry32 — small, fast, adequate for game feel. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RNG = {
  seed: 0,
  _next: null,

  /* Reseed the whole world. Called once per new game. */
  reseed(seed) {
    this.seed = (seed === undefined || seed === null)
      ? (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0)
      : (seed >>> 0);
    this._next = mulberry32(this.seed);
    return this.seed;
  },

  /* Float in [0,1). */
  next() {
    if (!this._next) this.reseed();
    return this._next();
  },

  /* Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  },

  /* Float in [min, max). */
  float(min, max) {
    return min + this.next() * (max - min);
  },

  /* True with probability p. */
  chance(p) {
    return this.next() < p;
  },

  /* Uniform pick from an array. */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  },

  /* Pick n distinct elements (or fewer if the array is short). */
  sample(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0]);
    }
    return out;
  },

  /* In-place-ish shuffle returning a new array. */
  shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  },

  /* Weighted pick. `items` is [{ w: number, ...rest }]. */
  weighted(items) {
    let total = 0;
    for (const it of items) total += Math.max(0, it.w || 0);
    if (total <= 0) return items[0];
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, it.w || 0);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  },
};

/* Small shared math helper used everywhere. */
function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
