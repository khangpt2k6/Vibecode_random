import { hashString } from '@stackmon/util';

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
