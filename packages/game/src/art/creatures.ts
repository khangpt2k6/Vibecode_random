import type { ShapeBatch } from '@stackmon/engine';
import { PALETTE, TYPE_COLORS, shade, type TypeId } from './palette.js';
import { drawIcon } from './icons.js';

/**
 * Creature sprites.
 *
 * One body plan for everything: a rounded blob, two eyes, small feet, and
 * the technology's mark on its front. The family colour and the mark carry
 * all of the identity.
 *
 * That uniformity is a decision, not a shortcut. Twenty-four bespoke
 * silhouettes drawn from primitives would be twenty-four different levels of
 * quality and no shared read; one body plan means a player learns to look at
 * the colour and the emblem, which is exactly the information the game wants
 * them to internalise. It is also what lets a new technology ship with art
 * on the same day as its stats.
 *
 * The body shape varies a little by family, so a CACHE creature is visibly
 * quicker-looking than a DATA one even before you read the mark.
 */

export interface CreatureVisual {
  creatureId: string;
  type: TypeId;
  /** World pixels, the point the creature stands on. */
  x: number;
  y: number;
  /** Overall size. 1 is a wild creature; the player's are a little larger. */
  scale: number;
  /** Seconds, for the idle bob and blink. Offset per creature. */
  phase: number;
  /** -1 facing left, 1 facing right. */
  facing: -1 | 1;
  /** 0 idle, 1 walking. Drives the bounce and the foot swing. */
  moving: number;
}

/** Body proportions per family, so silhouettes differ at a glance. */
const SHAPE: Record<TypeId, { w: number; h: number; ears: 'none' | 'spikes' | 'antenna' | 'fins' }> = {
  data: { w: 1.08, h: 0.92, ears: 'none' }, // squat and solid
  stream: { w: 0.92, h: 1.06, ears: 'fins' }, // tall, finned, flowing
  runtime: { w: 1.0, h: 1.0, ears: 'antenna' }, // the generalist
  infra: { w: 1.12, h: 0.86, ears: 'spikes' }, // wide, armoured
  cache: { w: 0.86, h: 0.96, ears: 'spikes' }, // small and sharp
  intel: { w: 0.96, h: 1.04, ears: 'antenna' }, // tall, sensing
};

export function drawCreature(b: ShapeBatch, c: CreatureVisual, time: number): void {
  const shape = SHAPE[c.type];
  const color = TYPE_COLORS[c.type];
  const s = c.scale * 13;

  const t = time + c.phase;
  // Idle: a slow breath. Walking: a faster, larger hop.
  const bob = c.moving > 0 ? Math.abs(Math.sin(t * 7)) * 2.6 * c.scale : Math.sin(t * 2) * 1.1 * c.scale;
  const squash = c.moving > 0 ? 1 - Math.abs(Math.sin(t * 7)) * 0.09 : 1 + Math.sin(t * 2) * 0.035;

  const bodyW = s * shape.w;
  const bodyH = s * shape.h * squash;
  const cy = c.y - bodyH - bob;

  // Contact shadow shrinks as the creature rises, which is what sells the hop.
  b.groundShadow(c.x, c.y, bodyW * 0.8 * (1 - bob * 0.05), PALETTE.shadow, 0.3);

  // Feet, swinging out of phase with each other when walking.
  const swing = c.moving > 0 ? Math.sin(t * 7) * 3 * c.scale : 0;
  for (const side of [-1, 1] as const) {
    b.ellipse(
      c.x + side * bodyW * 0.42 + swing * side,
      c.y - 2 * c.scale,
      bodyW * 0.26,
      bodyW * 0.16,
      shade(color, -0.35),
      1, 0, 10,
    );
  }

  drawEars(b, c, shape.ears, c.x, cy, bodyW, bodyH, color, t);

  // Body: shaded underside, lit mass, rim of sun on the upper left.
  b.ellipse(c.x, cy + bodyH * 0.12, bodyW, bodyH * 0.96, shade(color, -0.24), 1, 0, 22);
  b.ellipse(c.x, cy, bodyW * 0.97, bodyH * 0.9, color, 1, 0, 22);
  b.ellipse(
    c.x - bodyW * 0.3, cy - bodyH * 0.34,
    bodyW * 0.38, bodyH * 0.26,
    shade(color, 0.34), 0.85, 0, 14,
  );

  // Belly plate, and the technology mark on it.
  const plateW = bodyW * 0.62;
  b.ellipse(c.x, cy + bodyH * 0.2, plateW, bodyH * 0.44, PALETTE.wall, 1, 0, 18);
  drawIcon(b, c.creatureId, c.x, cy + bodyH * 0.2, plateW * 0.6, c.type);

  drawFace(b, c, c.x, cy, bodyW, bodyH, t);
}

/**
 * Eyes and mouth.
 *
 * Two dark ovals with a specular dot, set fairly wide and fairly low. Wide
 * and low is the whole cuteness formula - the same two dots placed high and
 * close together read as menacing, and nothing else about the sprite changes.
 */
function drawFace(
  b: ShapeBatch, c: CreatureVisual, cx: number, cy: number, bw: number, bh: number, t: number,
): void {
  // Blink: closed for a moment, on an irregular cycle so they do not
  // all blink in unison.
  const cycle = (t * 0.55 + c.phase) % 1;
  const blinking = cycle > 0.955;

  const eyeY = cy - bh * 0.06;
  const eyeDx = bw * 0.3;
  const lean = c.facing * bw * 0.05;

  for (const side of [-1, 1] as const) {
    const ex = cx + side * eyeDx + lean;
    if (blinking) {
      b.rect(ex - bw * 0.11, eyeY - 1, bw * 0.22, 2.2, PALETTE.ink, 1, 0);
      continue;
    }
    b.ellipse(ex, eyeY, bw * 0.115, bh * 0.15, PALETTE.ink, 1, 0, 12);
    b.circle(ex - bw * 0.035, eyeY - bh * 0.05, bw * 0.042, PALETTE.sparkle, 1, 0, 8);
  }

  // Mouth: a small upward arc.
  const mx = cx + lean;
  const my = cy + bh * 0.1;
  b.polyline(
    [mx - bw * 0.1, my, mx, my + bh * 0.045, mx + bw * 0.1, my],
    1.6, PALETTE.ink, 0.75, 0,
  );
}

/** Family-specific head shapes, drawn behind the body. */
function drawEars(
  b: ShapeBatch,
  c: CreatureVisual,
  kind: 'none' | 'spikes' | 'antenna' | 'fins',
  cx: number, cy: number, bw: number, bh: number,
  color: number, t: number,
): void {
  const dark = shade(color, -0.3);
  switch (kind) {
    case 'spikes':
      for (const side of [-1, 1] as const) {
        b.triangle(
          cx + side * bw * 0.5, cy - bh * 0.5,
          cx + side * bw * 0.92, cy - bh * 1.02,
          cx + side * bw * 0.34, cy - bh * 0.86,
          dark, 1, 0,
        );
      }
      break;
    case 'antenna': {
      const sway = Math.sin(t * 2.4) * bw * 0.08;
      b.line(cx + sway * 0.4, cy - bh * 0.75, cx + sway, cy - bh * 1.4, 2.2, dark, 1, 0);
      b.circle(cx + sway, cy - bh * 1.45, bw * 0.11, shade(color, 0.4), 1, 0, 10);
      break;
    }
    case 'fins':
      for (const side of [-1, 1] as const) {
        b.polygon(
          [
            cx + side * bw * 0.4, cy - bh * 0.2,
            cx + side * bw * 1.12, cy - bh * 0.62,
            cx + side * bw * 0.96, cy + bh * 0.12,
            cx + side * bw * 0.45, cy + bh * 0.2,
          ],
          dark, 1, 0,
        );
      }
      break;
    case 'none':
      break;
  }
}

/**
 * A name plate floating above a creature.
 *
 * Drawn in world space but at a fixed pixel size, so it stays readable when
 * the camera is zoomed out. Text itself is the caller's job - this is the
 * plate it sits on.
 */
export function drawNamePlate(
  b: ShapeBatch, x: number, y: number, width: number, type: TypeId,
): void {
  const w = width + 16;
  b.roundedRect(x - w / 2, y + 1, w, 17, 8, PALETTE.uiShadow, 0.18, 0);
  b.roundedRect(x - w / 2, y - 1, w, 17, 8, PALETTE.uiPanel, 0.96, 0);
  b.roundedRect(x - w / 2, y - 1, 4, 17, 2, TYPE_COLORS[type], 1, 0);
}
