import { DEFAULT_ISO, gridToScreen, type GridPos, type ShapeBatch } from '@stackmon/engine';
import { getCrop } from '@stackmon/content';
import { PALETTE, mix, shade } from './palette.js';
import { box, footprint } from './solids.js';

/**
 * Farm plots.
 *
 * A tilled square of soil, and whatever is growing in it drawn at a size
 * that follows its growth fraction. The plant is abstract - a cluster of
 * little standing blocks in the crop's colour - because these are compute
 * cycles and disk arrays, not carrots, and drawing them as vegetables would
 * undercut the one joke the game is actually making.
 *
 * A ready plot is unmistakable: it bobs, it glows, and it has a floating
 * chevron over it. A farm layer where the player has to squint to find what
 * is harvestable is a farm layer they stop visiting.
 */

export function drawPlotBase(b: ShapeBatch, p: GridPos, hovered: boolean): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 0.44;
  const hh = DEFAULT_ISO.tileH * 0.44;

  // Soil, with a raised lip so it reads as tilled rather than painted on.
  b.quad(c.x, c.y - hh - 3, c.x + hw, c.y - 3, c.x, c.y + hh - 3, c.x - hw, c.y - 3, PALETTE.soilDeep, 1, 0);
  b.quad(
    c.x, c.y - hh - 6, c.x + hw, c.y - 6, c.x, c.y + hh - 6, c.x - hw, c.y - 6,
    hovered ? mix(PALETTE.soil, PALETTE.sand, 0.35) : PALETTE.soil, 1, 0,
  );

  // Furrows along the +gx diagonal.
  for (let i = -1; i <= 1; i++) {
    const o = i * hh * 0.42;
    b.line(
      c.x - hw * 0.75, c.y - 6 + o * 0.55,
      c.x + hw * 0.05, c.y - 6 + hh * 0.75 + o * 0.55,
      1.6, shade(PALETTE.soilDeep, -0.14), 0.75, 0,
    );
  }
}

/**
 * A growing crop.
 *
 * `growth` runs 0 to 1. `pulse` is seconds, used only when ready.
 */
export function drawCrop(
  b: ShapeBatch, p: GridPos, cropId: string, growth: number, ready: boolean, time: number,
): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const spec = getCrop(cropId);
  const bob = ready ? Math.sin(time * 3) * 2 : 0;

  // Sprouts grow taller and more numerous as the crop matures.
  const stalks = 1 + Math.floor(growth * 3);
  const h = 4 + growth * 16;

  footprint(b, c.x, c.y - 5, 11, 0.18);

  for (let i = 0; i < stalks; i++) {
    const a = (i / stalks) * Math.PI * 2 + 0.7;
    const dx = Math.cos(a) * 8 * Math.min(1, growth * 2);
    const dy = Math.sin(a) * 4 * Math.min(1, growth * 2);
    const tint = i % 2 === 0 ? spec.tint : shade(spec.tint, -0.16);
    box(b, c.x + dx, c.y - 5 + dy - bob, 3.2, 3.2, h * (0.7 + (i % 3) * 0.15), tint);
  }

  if (ready) {
    // Glow, and a chevron bobbing above it.
    const glow = 0.4 + Math.sin(time * 3) * 0.18;
    b.ellipse(c.x, c.y - 5, 20, 11, spec.tint, glow * 0.35, 0.9, 18);
    const cy = c.y - 34 - bob * 1.6;
    b.polygon(
      [c.x, cy + 7, c.x - 7, cy - 2, c.x - 3, cy - 2, c.x - 3, cy - 8, c.x + 3, cy - 8, c.x + 3, cy - 2, c.x + 7, cy - 2],
      PALETTE.good, 1, 1.1,
    );
  } else {
    // A thin progress ring on the ground, so the wait is legible at a glance.
    b.ring(c.x, c.y - 4, 15, 2, PALETTE.uiShadow, 0.25, 0, 20);
    b.ring(c.x, c.y - 4, 15, 2, spec.tint, 0.9, 0.4, 20, -Math.PI / 2, Math.PI * 2 * growth);
  }
}

/** An empty plot, with a dashed prompt so it reads as an invitation. */
export function drawEmptyPlot(b: ShapeBatch, p: GridPos, hovered: boolean, time: number): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  if (!hovered) {
    const pulse = 0.25 + Math.sin(time * 2 + p.gx + p.gy) * 0.08;
    b.ring(c.x, c.y - 5, 13, 1.6, PALETTE.wall, pulse, 0, 16);
    return;
  }
  b.ring(c.x, c.y - 5, 15, 2.4, PALETTE.good, 0.95, 0.7, 20);
  b.line(c.x - 6, c.y - 5, c.x + 6, c.y - 5, 2.4, PALETTE.good, 1, 0.7);
  b.line(c.x, c.y - 11, c.x, c.y + 1, 2.4, PALETTE.good, 1, 0.7);
}

/**
 * A player structure under construction: scaffolding and a progress bar.
 *
 * Deliberately not the finished building at partial alpha. A ghosted final
 * model reads as a rendering bug; scaffolding reads as work in progress.
 */
export function drawScaffold(
  b: ShapeBatch, p: GridPos, progress: number, tint: number, time: number,
): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 0.5;
  const hh = DEFAULT_ISO.tileH * 0.5;
  const full = 46;
  const h = 8 + progress * full;

  footprint(b, c.x, c.y, hw * 0.9, 0.28);
  b.quad(c.x, c.y - hh * 0.9, c.x + hw * 0.9, c.y, c.x, c.y + hh * 0.9, c.x - hw * 0.9, c.y, PALETTE.soil, 1, 0);

  // Four corner posts and two cross braces.
  const posts: Array<[number, number]> = [
    [c.x - hw * 0.6, c.y], [c.x + hw * 0.6, c.y],
    [c.x, c.y - hh * 0.6], [c.x, c.y + hh * 0.6],
  ];
  for (const [px, py] of posts) {
    b.rect(px - 2, py - h, 4, h, PALETTE.woodLight, 1, 0);
    b.rect(px - 2, py - h, 1.6, h, shade(PALETTE.wood, -0.25), 1, 0);
  }
  for (let i = 1; i <= 2; i++) {
    const y = c.y - (h * i) / 3;
    b.line(c.x - hw * 0.6, y, c.x, y + hh * 0.6, 2, PALETTE.wood, 0.9, 0);
    b.line(c.x, y + hh * 0.6, c.x + hw * 0.6, y, 2, PALETTE.wood, 0.9, 0);
  }

  // The material being lifted into place, bobbing on a rope.
  const lift = Math.sin(time * 1.6) * 4;
  box(b, c.x, c.y - h - 12 + lift, 9, 7, 9, tint);

  // Progress bar floating above.
  const barY = c.y - h - 34;
  b.roundedRect(c.x - 26, barY, 52, 8, 4, PALETTE.uiShadow, 0.45, 0);
  b.roundedRect(c.x - 25, barY + 1, 50 * Math.max(0.02, progress), 6, 3, tint, 1, 0.5);
}
