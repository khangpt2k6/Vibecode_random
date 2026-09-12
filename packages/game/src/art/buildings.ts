import { DEFAULT_ISO, gridToScreen, type GridPos, type ShapeBatch } from '@stackmon/engine';
import { PALETTE, TYPE_COLORS, shade, type TypeId } from './palette.js';
import { drawIcon } from './icons.js';

/**
 * Tech buildings.
 *
 * Each technology gets a little house whose roof is its family colour and
 * whose signboard carries its mark. The shape is the same for everything on
 * purpose: the world reads as one village rather than as a showcase of
 * twenty unrelated models, and the colour plus the emblem carry all the
 * identification a player needs.
 *
 * Drawn from the ground up in painter order - shadow, walls, roof, chimney,
 * sign - because there is no depth buffer and the order here IS the depth.
 */

export interface BuildingStyle {
  /** Tiles wide and deep. Everything is square for now. */
  size: number;
  /** Storeys. Taller buildings are more advanced versions of the same tech. */
  storeys: number;
  type: TypeId;
  creatureId: string;
  /** Per-instance variation so a row of the same tech is not a row of clones. */
  seed: number;
}

const WALL_H = 20;
const ROOF_H = 17;

/**
 * A house.
 *
 * `p` is the ground tile it stands on. The building is drawn centred on that
 * tile and extends upward, so the caller only has to sort by (gx + gy) the
 * same way it sorts terrain.
 */
export function drawBuilding(b: ShapeBatch, p: GridPos, style: BuildingStyle, time: number): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 0.5 * style.size * 0.82;
  const hh = DEFAULT_ISO.tileH * 0.5 * style.size * 0.82;
  const roofColor = TYPE_COLORS[style.type];

  b.groundShadow(c.x, c.y + hh * 0.32, hw * 0.95, PALETTE.shadow, 0.3);

  // --- plinth: a thin stone base so the walls do not grow out of the grass
  drawSlab(b, c.x, c.y, hw, hh, 4, PALETTE.rock, PALETTE.rockDeep);

  // --- walls, one quad per storey so windows can band
  let baseY = c.y - 4;
  for (let s = 0; s < style.storeys; s++) {
    drawWallBlock(b, c.x, baseY, hw, hh, WALL_H, style, s);
    baseY -= WALL_H;
  }

  // --- roof
  drawRoof(b, c.x, baseY, hw, hh, roofColor);

  // --- chimney with a curl of smoke
  const chimX = c.x + hw * 0.42;
  const chimY = baseY - ROOF_H * 0.45;
  b.rect(chimX - 3.2, chimY - 12, 6.4, 14, shade(PALETTE.rock, -0.1), 1, 0);
  b.rect(chimX - 3.2, chimY - 12, 2.4, 14, shade(PALETTE.rock, -0.34), 1, 0);
  b.rect(chimX - 4.2, chimY - 14, 8.4, 3, shade(roofColor, -0.25), 1, 0);
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.45 + i * 0.34) % 1;
    const puff = 3 + t * 5;
    b.circle(
      chimX + Math.sin(t * 5 + style.seed) * 5,
      chimY - 16 - t * 26,
      puff,
      PALETTE.cloud,
      (1 - t) * 0.55,
      0,
      10,
    );
  }

  // --- signboard on a post, carrying the technology mark
  const signY = c.y - 2;
  const signX = c.x - hw * 0.72;
  b.line(signX, signY, signX, signY - 22, 2.6, PALETTE.wood, 1, 0);
  const r = 10;
  b.circle(signX, signY - 30, r + 2, PALETTE.uiShadow, 0.18, 0, 16);
  b.circle(signX, signY - 31, r + 1.5, PALETTE.uiPanel, 1, 0, 18);
  b.ring(signX, signY - 31, r + 1.5, 2.2, shade(roofColor, -0.12), 1, 0, 20);
  drawIcon(b, style.creatureId, signX, signY - 31, r * 0.78);
}

/** A short stone slab, used as a plinth under buildings. */
function drawSlab(
  b: ShapeBatch,
  cx: number, cy: number, hw: number, hh: number, h: number,
  top: number, side: number,
): void {
  b.quad(cx - hw, cy - h, cx, cy + hh - h, cx, cy + hh, cx - hw, cy, shade(side, -0.28), 1, 0);
  b.quad(cx, cy + hh - h, cx + hw, cy - h, cx + hw, cy, cx, cy + hh, shade(side, -0.1), 1, 0);
  b.quad(cx, cy - hh - h, cx + hw, cy - h, cx, cy + hh - h, cx - hw, cy - h, top, 1, 0);
}

/** One storey of wall, with a window on each visible face. */
function drawWallBlock(
  b: ShapeBatch,
  cx: number, cy: number, hw: number, hh: number, h: number,
  style: BuildingStyle, storey: number,
): void {
  const wall = PALETTE.wall;
  const left = shade(wall, -0.3);
  const right = shade(wall, -0.13);

  b.quad(cx - hw, cy - h, cx, cy + hh - h, cx, cy + hh, cx - hw, cy, left, 1, 0);
  b.quad(cx, cy + hh - h, cx + hw, cy - h, cx + hw, cy, cx, cy + hh, right, 1, 0);

  // A tinted band at the base of each storey, in the family colour, so the
  // building still reads as its type when the roof is off screen.
  const band = shade(TYPE_COLORS[style.type], 0.3);
  b.line(cx - hw, cy, cx, cy + hh, 3, shade(band, -0.2), 1, 0);
  b.line(cx, cy + hh, cx + hw, cy, 3, band, 1, 0);

  drawWindow(b, cx - hw * 0.5, cy + hh * 0.5 - h * 0.55, -1, storey, style.seed);
  drawWindow(b, cx + hw * 0.5, cy + hh * 0.5 - h * 0.55, 1, storey, style.seed);
}

/**
 * A window on a slanted wall face.
 *
 * `side` -1 is the left face, 1 the right. The quad is sheared to match the
 * isometric face, which is the whole reason this is not just a rectangle -
 * an axis-aligned window on an angled wall reads as a sticker.
 */
function drawWindow(
  b: ShapeBatch, x: number, y: number, side: -1 | 1, storey: number, seed: number,
): void {
  const w = 7;
  const h = 8.5;
  const skew = (DEFAULT_ISO.tileH / DEFAULT_ISO.tileW) * w * side;

  // Lit or dark, decided per window but stable across frames.
  const lit = Math.sin(seed * 13.7 + storey * 4.1 + side * 2.3) > -0.2;
  const glass = lit ? PALETTE.wallWarm : PALETTE.glass;

  b.quad(
    x - w, y - skew - h,
    x + w, y + skew - h,
    x + w, y + skew,
    x - w, y - skew,
    side < 0 ? shade(glass, -0.18) : glass,
    1, lit ? 0.5 : 0,
  );
  b.quad(
    x - w, y - skew - h,
    x + w, y + skew - h,
    x + w, y + skew - h + 2,
    x - w, y - skew - h + 2,
    PALETTE.woodLight, 1, 0,
  );
}

/** A hipped roof: two visible slopes meeting at a ridge, plus eaves. */
function drawRoof(
  b: ShapeBatch, cx: number, cy: number, hw: number, hh: number, color: number,
): void {
  const overhang = 1.18;
  const ew = hw * overhang;
  const eh = hh * overhang;
  const peak = cy - ROOF_H;

  // Eave board, so the roof visibly sits on the walls rather than merging.
  b.quad(cx - ew, cy, cx, cy + eh, cx, cy + eh + 3, cx - ew, cy + 3, shade(color, -0.42), 1, 0);
  b.quad(cx, cy + eh, cx + ew, cy, cx + ew, cy + 3, cx, cy + eh + 3, shade(color, -0.3), 1, 0);

  // Front-left slope, then front-right, then the sunlit back edge.
  b.triangle(cx - ew, cy, cx, cy + eh, cx, peak, shade(color, -0.26), 1, 0);
  b.triangle(cx, cy + eh, cx + ew, cy, cx, peak, shade(color, -0.05), 1, 0);
  b.triangle(cx - ew, cy, cx, peak, cx, cy - eh, shade(color, 0.16), 1, 0);
  b.triangle(cx + ew, cy, cx, peak, cx, cy - eh, shade(color, 0.3), 1, 0);

  // Ridge highlight.
  b.line(cx, peak, cx, cy - eh, 2, shade(color, 0.45), 1, 0);
  b.circle(cx, peak, 3.2, shade(color, 0.5), 1, 0, 10);
}

/**
 * The player's main hall - bigger, fancier, and unmistakably the centre of
 * the base. Same visual language, scaled up with a second tier and a flag.
 */
export function drawMainHall(b: ShapeBatch, p: GridPos, level: number, time: number): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 1.1;
  const hh = DEFAULT_ISO.tileH * 1.1;

  b.groundShadow(c.x, c.y + hh * 0.3, hw * 1.05, PALETTE.shadow, 0.34);
  drawSlab(b, c.x, c.y, hw, hh, 6, PALETTE.cliff, PALETTE.cliffDeep);

  let y = c.y - 6;
  const storeys = Math.min(4, 2 + Math.floor(level / 6));
  for (let s = 0; s < storeys; s++) {
    const w = hw * (1 - s * 0.1);
    const d = hh * (1 - s * 0.1);
    b.quad(c.x - w, y - 24, c.x, y + d - 24, c.x, y + d, c.x - w, y, shade(PALETTE.wall, -0.3), 1, 0);
    b.quad(c.x, y + d - 24, c.x + w, y - 24, c.x + w, y, c.x, y + d, shade(PALETTE.wall, -0.12), 1, 0);
    b.line(c.x - w, y, c.x, y + d, 3.2, shade(PALETTE.woodLight, -0.2), 1, 0);
    b.line(c.x, y + d, c.x + w, y, 3.2, PALETTE.woodLight, 1, 0);
    y -= 24;
  }

  drawRoof(b, c.x, y, hw * 0.9, hh * 0.9, PALETTE.typeInfra);

  // Flag on the ridge, waving.
  const poleY = y - ROOF_H;
  b.line(c.x, poleY, c.x, poleY - 26, 2, PALETTE.metal, 1, 0);
  const wave = Math.sin(time * 2.6) * 3;
  b.polygon(
    [
      c.x + 1, poleY - 26,
      c.x + 20, poleY - 22 + wave,
      c.x + 16, poleY - 16 + wave,
      c.x + 20, poleY - 11 + wave,
      c.x + 1, poleY - 12,
    ],
    PALETTE.typeCache, 1, 0,
  );
}
