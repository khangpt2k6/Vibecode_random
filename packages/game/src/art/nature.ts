import { DEFAULT_ISO, gridToScreen, type GridPos, type ShapeBatch } from '@stackmon/engine';
import { PALETTE, mix, shade } from './palette.js';

/**
 * Natural props.
 *
 * Every one of these is drawn from a handful of blobs and quads, seeded per
 * instance so no two are identical. That irregularity is doing most of the
 * work: a forest of identical perfect circles reads as clip art no matter how
 * nice the colours are, and the same forest with each canopy wobbled by five
 * percent reads as hand-placed.
 *
 * Everything here draws in world pixels, already projected. Callers are
 * responsible for painter order - draw props in increasing (gx + gy) like
 * everything else, or they will overlap wrongly.
 */

/** Ground position of a prop, in world pixels, plus a per-instance seed. */
export interface PropAnchor {
  x: number;
  y: number;
  seed: number;
  /** 0.6 to 1.4 or so. Varies size so a row of trees is not a row of clones. */
  scale: number;
}

export function anchorAt(p: GridPos, seed: number, scale = 1): PropAnchor {
  const s = gridToScreen(p, DEFAULT_ISO);
  return { x: s.x, y: s.y, seed, scale };
}

/**
 * A leafy tree: trunk, three overlapping canopy blobs, a highlight, shadow.
 *
 * Three blobs rather than one because a single circle has no silhouette. The
 * offsets are asymmetric and seeded, so the outline is always a bit lopsided,
 * which is what a tree looks like.
 */
export function drawTree(b: ShapeBatch, a: PropAnchor, tint = 0): void {
  const s = a.scale;
  const leafBase = tint === 0 ? PALETTE.leaf : mix(PALETTE.leaf, tint, 0.35);

  b.groundShadow(a.x, a.y + 2 * s, 13 * s, PALETTE.shadow, 0.3);

  // Trunk, slightly tapered by drawing it as a quad rather than a rect.
  const trunkH = 15 * s;
  const tw = 3.4 * s;
  b.quad(
    a.x - tw * 0.8, a.y,
    a.x + tw * 0.8, a.y,
    a.x + tw * 0.55, a.y - trunkH,
    a.x - tw * 0.55, a.y - trunkH,
    PALETTE.trunk, 1, 0,
  );
  b.quad(
    a.x - tw * 0.8, a.y,
    a.x - tw * 0.1, a.y,
    a.x - tw * 0.1, a.y - trunkH,
    a.x - tw * 0.55, a.y - trunkH,
    PALETTE.trunkDeep, 1, 0,
  );

  const cy = a.y - trunkH - 9 * s;
  const wobble = Math.sin(a.seed) * 2.5 * s;

  // Shaded underside first, then the lit mass over it.
  b.blob(a.x + wobble * 0.5, cy + 5 * s, 15 * s, 11 * s, a.seed, shade(leafBase, -0.3), 1, 0, 16);
  b.blob(a.x - 8 * s + wobble, cy + 1 * s, 11 * s, 9.5 * s, a.seed + 1.7, shade(leafBase, -0.12), 1, 0, 14);
  b.blob(a.x + 8 * s - wobble, cy + 2 * s, 10 * s, 9 * s, a.seed + 3.1, shade(leafBase, -0.05), 1, 0, 14);
  b.blob(a.x + wobble, cy - 4 * s, 13 * s, 11 * s, a.seed + 5.3, leafBase, 1, 0, 16);
  // Sun catch on the upper left, which is where the light is coming from.
  b.blob(a.x - 5 * s + wobble, cy - 8 * s, 6.5 * s, 5 * s, a.seed + 7.9, shade(PALETTE.leafLight, 0.18), 1, 0, 12);
}

/** A conifer: three stacked tapering tiers. Reads instantly as "pine". */
export function drawPine(b: ShapeBatch, a: PropAnchor): void {
  const s = a.scale;
  b.groundShadow(a.x, a.y + 2 * s, 11 * s, PALETTE.shadow, 0.3);

  b.rect(a.x - 2.2 * s, a.y - 9 * s, 4.4 * s, 9 * s, PALETTE.trunkDeep, 1, 0);

  const tiers: Array<[number, number, number]> = [
    [8, 15, 12],
    [19, 12, 11],
    [29, 8.5, 10],
  ];
  for (let i = 0; i < tiers.length; i++) {
    const [lift, halfW, h] = tiers[i]!;
    const y = a.y - lift * s;
    const c = i === 2 ? shade(PALETTE.leaf, 0.06) : PALETTE.leafDeep;
    // Left half shaded, right half lit, split down the middle.
    b.triangle(a.x, y - h * s, a.x - halfW * s, y, a.x, y, shade(c, -0.24), 1, 0);
    b.triangle(a.x, y - h * s, a.x + halfW * s, y, a.x, y, shade(c, -0.02), 1, 0);
  }
}

/** A low bush. Cheap filler that stops the ground reading as empty. */
export function drawBush(b: ShapeBatch, a: PropAnchor): void {
  const s = a.scale;
  b.groundShadow(a.x, a.y + 1 * s, 8 * s, PALETTE.shadow, 0.22);
  b.blob(a.x, a.y - 3 * s, 9 * s, 6.5 * s, a.seed, shade(PALETTE.leafDeep, -0.08), 1, 0, 12);
  b.blob(a.x - 3 * s, a.y - 5.5 * s, 5.5 * s, 4.5 * s, a.seed + 2, PALETTE.leaf, 1, 0, 10);
  b.blob(a.x + 3.5 * s, a.y - 4.5 * s, 4.5 * s, 3.8 * s, a.seed + 4, shade(PALETTE.leafLight, 0.1), 1, 0, 10);
}

/** A rock. Faceted rather than round, so it does not read as another bush. */
export function drawRock(b: ShapeBatch, a: PropAnchor): void {
  const s = a.scale;
  b.groundShadow(a.x, a.y + 1 * s, 9 * s, PALETTE.shadow, 0.24);
  const w = 9 * s;
  const h = 8 * s;
  b.polygon(
    [
      a.x - w, a.y,
      a.x - w * 0.7, a.y - h * 0.7,
      a.x - w * 0.1, a.y - h,
      a.x + w * 0.6, a.y - h * 0.75,
      a.x + w, a.y,
    ],
    shade(PALETTE.rock, -0.2), 1, 0,
  );
  // Lit top facet.
  b.polygon(
    [
      a.x - w * 0.7, a.y - h * 0.7,
      a.x - w * 0.1, a.y - h,
      a.x + w * 0.25, a.y - h * 0.6,
      a.x - w * 0.35, a.y - h * 0.45,
    ],
    shade(PALETTE.cliff, 0.12), 1, 0,
  );
}

const FLOWER_COLORS = [
  PALETTE.flowerPink,
  PALETTE.flowerYellow,
  PALETTE.flowerWhite,
  PALETTE.flowerBlue,
];

/** A clump of flowers. Pure decoration, and the cheapest charm in the game. */
export function drawFlowers(b: ShapeBatch, a: PropAnchor): void {
  const s = a.scale;
  const count = 3 + (Math.floor(a.seed * 7) % 3);
  for (let i = 0; i < count; i++) {
    const angle = a.seed * 3 + i * 2.1;
    const dx = Math.cos(angle) * 7 * s;
    const dy = Math.sin(angle) * 3.5 * s;
    const color = FLOWER_COLORS[(Math.floor(a.seed * 11) + i) % FLOWER_COLORS.length]!;
    const px = a.x + dx;
    const py = a.y + dy;
    b.line(px, py, px, py - 5 * s, 1.2 * s, PALETTE.leafDeep, 1, 0);
    b.circle(px, py - 6 * s, 2.3 * s, color, 1, 0, 8);
    b.circle(px - 0.6 * s, py - 6.6 * s, 1.1 * s, shade(color, 0.4), 1, 0, 6);
  }
}

/** Tufts of tall grass. Used at biome edges to break up flat colour. */
export function drawGrassTuft(b: ShapeBatch, a: PropAnchor): void {
  const s = a.scale;
  for (let i = 0; i < 5; i++) {
    const lean = (i - 2) * 2.4 * s;
    const h = (7 + (i % 2) * 3) * s;
    const x = a.x + (i - 2) * 2.6 * s;
    b.line(x, a.y, x + lean * 0.5, a.y - h, 1.4 * s, shade(PALETTE.grassDeep, -0.05), 1, 0);
  }
}

/**
 * An animated water tile.
 *
 * The diamond, a lighter band that slides across it, and a foam edge on the
 * downhill corners. Water that does not move is the single most obvious tell
 * that a world is a static picture, and one sliding band fixes it for almost
 * nothing.
 */
export function drawWaterTile(b: ShapeBatch, p: GridPos, time: number, edge: boolean): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 0.5;
  const hh = DEFAULT_ISO.tileH * 0.5;

  const phase = Math.sin(time * 0.8 + (p.gx + p.gy) * 0.55);
  const body = mix(PALETTE.waterDeep, PALETTE.water, 0.5 + phase * 0.28);

  b.quad(c.x, c.y - hh, c.x + hw, c.y, c.x, c.y + hh, c.x - hw, c.y, body, 1, 0);

  // A highlight band travelling along the tile diagonal.
  const t = (Math.sin(time * 0.55 + p.gx * 0.4 - p.gy * 0.3) + 1) * 0.5;
  const bandY = c.y - hh + hh * 2 * t;
  const width = hw * (1 - Math.abs(t - 0.5) * 2) * 0.85;
  if (width > 1) {
    b.quad(
      c.x - width, bandY,
      c.x + width, bandY,
      c.x + width * 0.9, bandY + 2.5,
      c.x - width * 0.9, bandY + 2.5,
      PALETTE.waterFoam, 0.3, 0,
    );
  }

  if (edge) {
    const foam = 0.55 + phase * 0.2;
    b.line(c.x - hw, c.y, c.x, c.y + hh, 2.2, PALETTE.waterFoam, foam, 0);
    b.line(c.x, c.y + hh, c.x + hw, c.y, 2.2, PALETTE.waterFoam, foam, 0);
  }
}

/**
 * A little wooden fence post and rail along one tile edge.
 *
 * `dir` 0 runs along the +gx edge, 1 along the +gy edge.
 */
export function drawFence(b: ShapeBatch, p: GridPos, dir: 0 | 1): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 0.5;
  const hh = DEFAULT_ISO.tileH * 0.5;

  const [ax, ay, bx, by] = dir === 0
    ? [c.x, c.y + hh, c.x + hw, c.y]
    : [c.x, c.y + hh, c.x - hw, c.y];

  b.line(ax, ay - 9, bx, by - 9, 2.2, PALETTE.wood, 1, 0);
  b.line(ax, ay - 4, bx, by - 4, 2, shade(PALETTE.wood, -0.16), 1, 0);
  for (const [px, py] of [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2]] as const) {
    b.rect(px - 1.6, py - 13, 3.2, 13, PALETTE.woodLight, 1, 0);
    b.rect(px - 1.6, py - 13, 1.3, 13, shade(PALETTE.wood, -0.22), 1, 0);
  }
}

/**
 * A path segment drawn over a ground tile.
 *
 * Full tile width, not inset. An inset diamond leaves a green gap between
 * every pair of neighbouring path tiles, which turns a road into a dotted
 * line of unrelated tan squares - the single change from 0.86 to 1.0 here is
 * the difference between "a path" and "scattered rubble".
 */
export function drawPathTile(b: ShapeBatch, p: GridPos, seed: number): void {
  const c = gridToScreen(p, DEFAULT_ISO);
  const hw = DEFAULT_ISO.tileW * 0.5;
  const hh = DEFAULT_ISO.tileH * 0.5;

  b.quad(
    c.x, c.y - hh,
    c.x + hw, c.y,
    c.x, c.y + hh,
    c.x - hw, c.y,
    mix(PALETTE.path, PALETTE.pathDeep, (Math.sin(seed) * 0.5 + 0.5) * 0.45),
    1, 0,
  );
  // A few paler stones, kept well inside so they never break the silhouette.
  for (let i = 0; i < 3; i++) {
    const a = seed * 2 + i * 2.3;
    b.blob(
      c.x + Math.cos(a) * hw * 0.34,
      c.y + Math.sin(a) * hh * 0.34,
      4.2, 2.4, a,
      i % 2 === 0 ? PALETTE.sand : PALETTE.pathDeep,
      0.8, 0, 8,
    );
  }
}
