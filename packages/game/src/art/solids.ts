import type { ShapeBatch } from '@stackmon/engine';
import { PALETTE, shade } from './palette.js';

/**
 * Pseudo-3D solids.
 *
 * Everything in the world is flat triangles, so "3D" here is a lighting
 * convention: the sun is upper-left, top faces are warmed, right faces are
 * slightly cooled, left faces are cooled hard. Every solid below applies that
 * same convention, which is what lets a whale made of ellipses stand next to
 * a database made of slabs and read as being in the same place.
 *
 * All positions are world pixels. (cx, cy) is the point on the ground the
 * solid rises from.
 */

/** Isometric foreshortening: a circle on the ground is this much flatter. */
const GROUND = 0.5;

/** A ball. Dark base, lit body offset toward the light, a specular dot. */
export function sphere(b: ShapeBatch, cx: number, cy: number, r: number, color: number, seg = 18): void {
  b.circle(cx, cy, r, shade(color, -0.3), 1, 0, seg);
  b.circle(cx - r * 0.12, cy - r * 0.14, r * 0.86, color, 1, 0, seg);
  b.circle(cx - r * 0.34, cy - r * 0.38, r * 0.34, shade(color, 0.34), 0.9, 0, 12);
  b.circle(cx - r * 0.42, cy - r * 0.46, r * 0.12, PALETTE.sparkle, 0.85, 0, 8);
}

/** A squashed ball, for bodies that should read as heavy. */
export function ovoid(
  b: ShapeBatch, cx: number, cy: number, rx: number, ry: number, color: number, seg = 20,
): void {
  b.ellipse(cx, cy, rx, ry, shade(color, -0.3), 1, 0, seg);
  b.ellipse(cx - rx * 0.1, cy - ry * 0.14, rx * 0.88, ry * 0.86, color, 1, 0, seg);
  b.ellipse(cx - rx * 0.32, cy - ry * 0.42, rx * 0.34, ry * 0.26, shade(color, 0.34), 0.9, 0, 12);
}

/**
 * A rounded slab lying on the ground: the disc-and-side shape a database
 * icon is made of. `h` is its thickness in pixels.
 */
export function slab(
  b: ShapeBatch, cx: number, cy: number, rx: number, h: number, color: number, seg = 22,
): void {
  const ry = rx * GROUND;
  // side wall: a band between the bottom ellipse and the top ellipse
  b.ellipse(cx, cy, rx, ry, shade(color, -0.34), 1, 0, seg);
  b.rect(cx - rx, cy - h, rx * 2, h, shade(color, -0.2), 1, 0);
  // the left half of the wall is in shadow
  b.rect(cx - rx, cy - h, rx, h, shade(color, -0.36), 1, 0);
  b.ellipse(cx, cy - h, rx, ry, shade(color, 0.08), 1, 0, seg);
  b.ellipse(cx - rx * 0.22, cy - h - ry * 0.18, rx * 0.5, ry * 0.42, shade(color, 0.3), 0.7, 0, 14);
}

/** A cylinder standing up. Same construction as a slab, but tall. */
export const cylinder = slab;

/**
 * An extruded regular polygon standing on the ground. Draws the visible side
 * faces darkest-to-lightest and then the top, so it reads as a prism.
 */
export function prism(
  b: ShapeBatch, cx: number, cy: number, r: number, sides: number, h: number,
  color: number, rot = Math.PI / 2,
): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * GROUND]);
  }
  // Side faces: only those whose outward normal points toward the viewer
  // (downward on screen) are visible.
  for (let i = 0; i < sides; i++) {
    const p0 = pts[i]!;
    const p1 = pts[(i + 1) % sides]!;
    const mid = (p0[1] + p1[1]) / 2;
    if (mid <= cy) continue;
    // Faces whose midpoint is left of centre are the shaded ones.
    const lit = (p0[0] + p1[0]) / 2 >= cx;
    b.quad(
      p0[0], p0[1] - h, p1[0], p1[1] - h, p1[0], p1[1], p0[0], p0[1],
      shade(color, lit ? -0.16 : -0.36), 1, 0,
    );
  }
  const top: number[] = [];
  for (const [x, y] of pts) top.push(x, y - h);
  b.polygon(top, shade(color, 0.1), 1, 0);
}

/** A cone. Left half shaded, right half lit, like the pines. */
export function cone(
  b: ShapeBatch, cx: number, cy: number, r: number, h: number, color: number,
): void {
  b.ellipse(cx, cy, r, r * GROUND, shade(color, -0.36), 1, 0, 16);
  b.triangle(cx, cy - h, cx - r, cy, cx, cy + r * GROUND, shade(color, -0.3), 1, 0);
  b.triangle(cx, cy - h, cx + r, cy, cx, cy + r * GROUND, shade(color, -0.04), 1, 0);
  b.triangle(cx, cy - h, cx - r * 0.35, cy - h * 0.5, cx + r * 0.05, cy - h * 0.55, shade(color, 0.3), 0.8, 0);
}

/**
 * A box: an isometric block drawn from its ground-centre.
 *
 * `hw` is the half-extent along +gx (down-right on screen), `hd` along +gy
 * (down-left). In screen space +gx is the direction (1, 0.5) and +gy is
 * (-1, 0.5), which is where the corner arithmetic below comes from.
 */
export function box(
  b: ShapeBatch, cx: number, cy: number, hw: number, hd: number, h: number, color: number,
): void {
  const back: [number, number] = [cx - hw + hd, cy - (hw + hd) * GROUND];
  const right: [number, number] = [cx + hw + hd, cy + (hw - hd) * GROUND];
  const front: [number, number] = [cx + hw - hd, cy + (hw + hd) * GROUND];
  const left: [number, number] = [cx - hw - hd, cy + (hd - hw) * GROUND];

  b.quad(left[0], left[1] - h, front[0], front[1] - h, front[0], front[1], left[0], left[1], shade(color, -0.36), 1, 0);
  b.quad(front[0], front[1] - h, right[0], right[1] - h, right[0], right[1], front[0], front[1], shade(color, -0.16), 1, 0);
  b.quad(back[0], back[1] - h, right[0], right[1] - h, front[0], front[1] - h, left[0], left[1] - h, shade(color, 0.1), 1, 0);
}

/** A soft ground shadow sized for a body of radius r. */
export function footprint(b: ShapeBatch, cx: number, cy: number, r: number, strength = 0.3): void {
  b.groundShadow(cx, cy, r, PALETTE.shadow, strength);
}
