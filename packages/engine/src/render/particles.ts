import type { ShapeBatch } from './shape-batch.js';
import type { Rng } from '@stackmon/util';

/**
 * Particle system.
 *
 * A fixed-capacity pool of structure-of-arrays particles, drawn as polygons
 * through the shape batch. No textures: a spark here is a small quad or a
 * short line, which matches the vector look and means particles can carry an
 * emissive weight and feed the bloom pass like everything else.
 *
 * Structure-of-arrays rather than an array of objects because the update is
 * a tight numeric loop over every live particle every tick, and this is the
 * one place in the engine where that difference is measurable.
 */

export type ParticleShape = 'spark' | 'square' | 'streak' | 'ring';

export interface ParticleEmitConfig {
  x: number;
  y: number;
  count: number;
  /** Speed range in pixels per second. */
  speedMin?: number;
  speedMax?: number;
  /** Emission cone, radians. `angle` is the centre, `spread` the full width. */
  angle?: number;
  spread?: number;
  lifeMin?: number;
  lifeMax?: number;
  sizeMin?: number;
  sizeMax?: number;
  color: number;
  /** Colour faded toward over the particle lifetime. Defaults to `color`. */
  colorEnd?: number;
  emissive?: number;
  gravity?: number;
  /** Velocity retained per second. 1 keeps all of it, 0.1 stops fast. */
  drag?: number;
  shape?: ParticleShape;
  /** Rotational velocity range, radians per second. */
  spinMin?: number;
  spinMax?: number;
}

const MAX_PARTICLES = 4096;

export class ParticleSystem {
  private readonly x = new Float32Array(MAX_PARTICLES);
  private readonly y = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly rotation = new Float32Array(MAX_PARTICLES);
  private readonly spin = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly colorStart = new Uint32Array(MAX_PARTICLES);
  private readonly colorEnd = new Uint32Array(MAX_PARTICLES);
  private readonly emissive = new Float32Array(MAX_PARTICLES);
  private readonly shape = new Uint8Array(MAX_PARTICLES);

  /** Live particles are packed into [0, count). */
  private count = 0;

  constructor(private readonly rng: Rng) {}

  get liveCount(): number {
    return this.count;
  }

  emit(cfg: ParticleEmitConfig): void {
    const rng = this.rng;
    const shapeId = SHAPE_IDS[cfg.shape ?? 'spark'];
    const speedMin = cfg.speedMin ?? 40;
    const speedMax = cfg.speedMax ?? 160;
    const angle = cfg.angle ?? 0;
    const spread = cfg.spread ?? Math.PI * 2;
    const lifeMin = cfg.lifeMin ?? 0.3;
    const lifeMax = cfg.lifeMax ?? 0.8;
    const sizeMin = cfg.sizeMin ?? 2;
    const sizeMax = cfg.sizeMax ?? 5;

    for (let i = 0; i < cfg.count; i++) {
      if (this.count >= MAX_PARTICLES) return; // Drop the excess rather than stall.
      const p = this.count++;

      const a = angle + rng.range(-spread / 2, spread / 2);
      const speed = rng.range(speedMin, speedMax);

      this.x[p] = cfg.x;
      this.y[p] = cfg.y;
      this.vx[p] = Math.cos(a) * speed;
      this.vy[p] = Math.sin(a) * speed;
      const life = rng.range(lifeMin, lifeMax);
      this.life[p] = life;
      this.maxLife[p] = life;
      this.size[p] = rng.range(sizeMin, sizeMax);
      this.rotation[p] = rng.range(0, Math.PI * 2);
      this.spin[p] = rng.range(cfg.spinMin ?? -4, cfg.spinMax ?? 4);
      this.gravity[p] = cfg.gravity ?? 0;
      this.drag[p] = cfg.drag ?? 0.35;
      this.colorStart[p] = cfg.color;
      this.colorEnd[p] = cfg.colorEnd ?? cfg.color;
      this.emissive[p] = cfg.emissive ?? 1.5;
      this.shape[p] = shapeId;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.swapRemove(i);
        continue; // do not advance: a new particle now occupies this slot
      }

      // Exponential drag, so the decay rate is independent of frame rate.
      const dragFactor = Math.pow(this.drag[i]!, dt);
      this.vx[i]! *= dragFactor;
      this.vy[i]! *= dragFactor;
      this.vy[i]! += this.gravity[i]! * dt;

      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rotation[i]! += this.spin[i]! * dt;
      i++;
    }
  }

  render(shapes: ShapeBatch): void {
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i]! / this.maxLife[i]!;
      // Fade in fast, out slow: a particle that pops in at full brightness
      // and eases away reads as energy, the reverse reads as a glitch.
      const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      const color = lerpRgb(this.colorStart[i]!, this.colorEnd[i]!, t);
      const size = this.size[i]! * (1 - t * 0.55);
      const px = this.x[i]!;
      const py = this.y[i]!;
      const emissive = this.emissive[i]!;

      switch (this.shape[i]) {
        case SHAPE_IDS.square: {
          const h = size * 0.5;
          const c = Math.cos(this.rotation[i]!);
          const s = Math.sin(this.rotation[i]!);
          shapes.quad(
            px + (-h * c - -h * s), py + (-h * s + -h * c),
            px + (h * c - -h * s), py + (h * s + -h * c),
            px + (h * c - h * s), py + (h * s + h * c),
            px + (-h * c - h * s), py + (-h * s + h * c),
            color, alpha, emissive,
          );
          break;
        }
        case SHAPE_IDS.streak: {
          // Trail pointing back along the velocity, length scaled by speed.
          const speed = Math.hypot(this.vx[i]!, this.vy[i]!);
          const len = Math.min(28, speed * 0.05 + size);
          const nx = speed > 0.001 ? this.vx[i]! / speed : 1;
          const ny = speed > 0.001 ? this.vy[i]! / speed : 0;
          shapes.line(px, py, px - nx * len, py - ny * len, size * 0.6, color, alpha, emissive);
          break;
        }
        case SHAPE_IDS.ring: {
          shapes.ring(px, py, size * (1 + t * 3), Math.max(1, size * 0.3), color, alpha * 0.8, emissive, 20);
          break;
        }
        default:
          shapes.circle(px, py, size * 0.5, color, alpha, emissive, 6);
      }
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.life[i] = this.life[last]!;
    this.maxLife[i] = this.maxLife[last]!;
    this.size[i] = this.size[last]!;
    this.rotation[i] = this.rotation[last]!;
    this.spin[i] = this.spin[last]!;
    this.gravity[i] = this.gravity[last]!;
    this.drag[i] = this.drag[last]!;
    this.colorStart[i] = this.colorStart[last]!;
    this.colorEnd[i] = this.colorEnd[last]!;
    this.emissive[i] = this.emissive[last]!;
    this.shape[i] = this.shape[last]!;
  }

  clear(): void {
    this.count = 0;
  }
}

const SHAPE_IDS: Record<ParticleShape, number> = {
  spark: 0,
  square: 1,
  streak: 2,
  ring: 3,
};

function lerpRgb(a: number, b: number, t: number): number {
  if (a === b) return a;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    ((ar + (br - ar) * t) << 16) |
    ((ag + (bg - ag) * t) << 8) |
    (ab + (bb - ab) * t)
  ) & 0xffffff;
}
