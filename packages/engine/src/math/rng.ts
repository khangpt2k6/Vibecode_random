/**
 * Seeded, deterministic RNG.
 *
 * Everything the game randomises - world generation, wild encounters, damage
 * rolls, loot - goes through one of these. Determinism is not a nicety here:
 * replayable battle logs and reproducible worlds are both load-bearing
 * features, and Math.random() makes both impossible.
 */
export class Rng {
  private s: number;

  constructor(seed: number | string) {
    this.s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // Zero is a fixed point of mulberry32; nudge it off.
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** Uniform in [0, 1). mulberry32 - small, fast, good enough for games. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Uniform integer in [lo, hi], inclusive on both ends. */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)]!;
  }

  /** Weighted pick. Weights need not sum to 1; non-positive weights never win. */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const it of items) {
      const w = weightOf(it);
      if (w > 0) total += w;
    }
    if (total <= 0) throw new Error('Rng.pickWeighted: no positive weights');
    let roll = this.next() * total;
    for (const it of items) {
      const w = weightOf(it);
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return it;
    }
    return items[items.length - 1]!;
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i]!;
      items[i] = items[j]!;
      items[j] = a;
    }
    return items;
  }

  /** Approximately normal via the sum of 3 uniforms. Cheap, plenty for jitter. */
  gaussian(mean = 0, stddev = 1): number {
    const u = (this.next() + this.next() + this.next()) / 3;
    return mean + (u - 0.5) * 3.46 * stddev;
  }

  /** A fresh stream deterministically derived from this one. */
  fork(tag: string): Rng {
    return new Rng((this.s ^ hashString(tag)) >>> 0);
  }

  /** Snapshot for save files. */
  getState(): number {
    return this.s;
  }

  setState(s: number): void {
    this.s = s >>> 0;
  }
}

/** FNV-1a. Stable across runs and platforms. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 2D value noise, seeded. Drives terrain height and biome blending.
 *
 * Value noise rather than simplex: with a smoothstep fade it looks fine at
 * tile scale, needs no permutation table, and stays readable.
 */
export class ValueNoise2D {
  private readonly seed: number;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  private hash2(x: number, y: number): number {
    let h = this.seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

  /** Single octave, output in [0, 1]. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // smoothstep, so the lattice does not show up as diamond creases
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = this.hash2(x0, y0);
    const n10 = this.hash2(x0 + 1, y0);
    const n01 = this.hash2(x0, y0 + 1);
    const n11 = this.hash2(x0 + 1, y0 + 1);

    const top = n00 + (n10 - n00) * sx;
    const bot = n01 + (n11 - n01) * sx;
    return top + (bot - top) * sy;
  }

  /** Fractal Brownian motion. More octaves, more fine detail. Output in [0, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm === 0 ? 0 : sum / norm;
  }

  /** Ridged variant - sharper crests, good for circuit-trace terrain. */
  ridged(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.sample(x * freq, y * freq) * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm === 0 ? 0 : sum / norm;
  }
}
