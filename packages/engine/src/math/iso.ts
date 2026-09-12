import type { Vec2 } from './vec2.js';

/**
 * Isometric grid <-> screen projection.
 *
 * The world is a grid of diamond tiles. A tile at grid (gx, gy) with height
 * `h` projects to a screen point where:
 *
 *      +gx goes right-and-down,  +gy goes left-and-down,  +h goes up.
 *
 *            (0,0)
 *            /  \
 *     -gy   /    \   +gx
 *          /      \
 *          \      /
 *           \    /
 *            \  /
 *           (1,1)
 *
 * `tileW`/`tileH` are the full width and height of a diamond in pixels. The
 * classic 2:1 look is tileW = 2 * tileH. `elevation` is how many pixels one
 * unit of height lifts a tile.
 */
export interface IsoConfig {
  tileW: number;
  tileH: number;
  elevation: number;
}

export const DEFAULT_ISO: IsoConfig = {
  tileW: 64,
  tileH: 32,
  elevation: 16,
};

/** Grid coordinate. Integer for tiles, fractional for anything moving. */
export interface GridPos {
  gx: number;
  gy: number;
  h: number;
}

export const grid = (gx = 0, gy = 0, h = 0): GridPos => ({ gx, gy, h });

/** Grid -> screen (world-space pixels, before camera transform). */
export function gridToScreen(p: GridPos, cfg: IsoConfig = DEFAULT_ISO): Vec2 {
  return {
    x: (p.gx - p.gy) * (cfg.tileW * 0.5),
    y: (p.gx + p.gy) * (cfg.tileH * 0.5) - p.h * cfg.elevation,
  };
}

/**
 * Screen -> grid, assuming ground level (h = 0).
 *
 * Returns CONTINUOUS grid coordinates, where whole numbers land on tile
 * centres because that is what `gridToScreen` projects. Rounding, not
 * flooring, is therefore what turns this into a tile index - flooring treats
 * the value as a corner and lands half a tile up-left of the truth, which
 * looks like a rounding glitch and is actually an off-by-half-a-tile.
 *
 * Picking on uneven terrain needs a height-aware search; this is the
 * flat-ground fast path that every pointer interaction starts from.
 */
export function screenToGrid(s: Vec2, cfg: IsoConfig = DEFAULT_ISO): GridPos {
  const hw = cfg.tileW * 0.5;
  const hh = cfg.tileH * 0.5;
  return {
    gx: (s.x / hw + s.y / hh) * 0.5,
    gy: (s.y / hh - s.x / hw) * 0.5,
    h: 0,
  };
}

/**
 * Screen -> grid on terrain of known heights.
 *
 * A tile drawn at height h lands where a flat tile would if we shifted the
 * sample point down by h elevations. So we test candidate heights from
 * tallest to shortest and take the first hit: the tallest match is the one
 * nearest the camera, which is exactly the tile the player can actually see.
 * Picking therefore always agrees with the painter-order render.
 */
export function screenToGridOnHeightmap(
  s: Vec2,
  heightAt: (gx: number, gy: number) => number,
  maxHeight: number,
  cfg: IsoConfig = DEFAULT_ISO,
): GridPos | null {
  for (let h = maxHeight; h >= 0; h--) {
    const lifted: Vec2 = { x: s.x, y: s.y + h * cfg.elevation };
    const g = screenToGrid(lifted, cfg);
    // Round: a whole grid coordinate is the centre of a tile, not its corner.
    const gx = Math.round(g.gx);
    const gy = Math.round(g.gy);
    if (heightAt(gx, gy) === h) return { gx, gy, h };
  }
  return null;
}

/**
 * Painter-algorithm depth key. Larger draws later, so on top.
 *
 * Ties on (gx + gy) break by height, so a tower covers the ground it stands
 * on, and then by `bias`, so a creature draws over the tile it stands on.
 */
export function depthKey(p: GridPos, bias = 0): number {
  return (p.gx + p.gy) * 1024 + p.h * 16 + bias;
}

/** The four diamond corners of a tile in world pixels: top, right, bottom, left. */
export function tileCorners(
  p: GridPos,
  cfg: IsoConfig = DEFAULT_ISO,
): [Vec2, Vec2, Vec2, Vec2] {
  const c = gridToScreen(p, cfg);
  const hw = cfg.tileW * 0.5;
  const hh = cfg.tileH * 0.5;
  return [
    { x: c.x, y: c.y - hh },
    { x: c.x + hw, y: c.y },
    { x: c.x, y: c.y + hh },
    { x: c.x - hw, y: c.y },
  ];
}

/** Manhattan distance - the movement metric for 4-way iso walking. */
export const gridDist = (a: GridPos, b: GridPos): number =>
  Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);

/** Chebyshev distance - the metric for 8-way range checks like skill AoE. */
export const gridDistCheb = (a: GridPos, b: GridPos): number =>
  Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
