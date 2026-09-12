import { Texture, type QuadBatch } from '@stackmon/engine';
import {
  ATLAS,
  ATLAS_DENSITY,
  ATLAS_GROUPS,
  ATLAS_PAGES,
  ATLAS_PAGE_SIZE,
  type AtlasFrame,
} from './atlas.generated.js';

/**
 * The baked prop atlas.
 *
 * Everything the player walks past that is not a creature, a building
 * silhouette or a tile - trees, rocks, flowers, crates, pipes, dishes - comes
 * from here. The sprites were rendered from CC0 low-poly models through the
 * game's own isometric camera by packages/tools/src/bake, so the numbers in
 * atlas.generated.ts already agree with the grid: a sprite drawn with its
 * anchor on a tile's screen point stands on that tile.
 *
 * Two conversions are the whole of this file. Sprites are baked at
 * ATLAS_DENSITY times their drawn size to survive the camera zooming in, so
 * every pixel measurement is divided by it. And the anchor is subtracted,
 * because callers think in "where does this thing stand", not "where is its
 * top left corner".
 *
 * This complements the hand-drawn art rather than replacing it. solids.ts
 * still draws anything that has to animate, react, or be tinted by type -
 * baked pixels cannot squash when a creature hops.
 */

export interface DrawPropOptions {
  /** Multiplies the baked size. 1 keeps a model unit equal to a grid tile. */
  scale?: number;
  alpha?: number;
  /** Multiplied into the sprite. Leave white unless deliberately tinting. */
  tint?: number;
  /** Bloom weight, matching the other batches. */
  emissive?: number;
}

export class PropAtlas {
  private constructor(
    private readonly pages: Texture[],
  ) {}

  /**
   * Load every atlas page.
   *
   * Called from a scene's async enter(), which is why SceneManager bothers to
   * await that at all. A failure here is fatal to the look of the world, so
   * it throws rather than quietly rendering an empty island.
   */
  static async load(gl: WebGL2RenderingContext): Promise<PropAtlas> {
    const pages = await Promise.all(ATLAS_PAGES.map(async (src) => {
      const image = new Image();
      image.src = src;
      try {
        await image.decode();
      } catch (cause) {
        throw new Error(`PropAtlas: could not load ${src}`, { cause });
      }
      // Linear, because the sprites are minified far more often than they are
      // magnified: the world starts zoomed out. No mipmaps - the atlas packs
      // sprites one pixel apart and the lower levels would bleed neighbours
      // into each other.
      return Texture.fromSource(gl, image, { filter: 'linear', wrap: 'clamp' });
    }));
    current = new PropAtlas(pages);
    return current;
  }

  has(id: string): boolean {
    return id in ATLAS;
  }

  frame(id: string): AtlasFrame | undefined {
    return ATLAS[id];
  }

  /** Drawn width and height in world pixels, before any scale option. */
  sizeOf(id: string): { w: number; h: number } | undefined {
    const f = ATLAS[id];
    return f && { w: f.w / ATLAS_DENSITY, h: f.h / ATLAS_DENSITY };
  }

  /**
   * Draw a prop as a UI icon: scaled to fit a box and centred in it.
   *
   * The world wants sprites placed by the ground they stand on, which is
   * what `draw` does. An icon in a panel wants the opposite - the picture
   * centred in its slot, with the anchor irrelevant - so this converts
   * between the two rather than making every caller do the arithmetic.
   */
  drawIcon(
    quads: QuadBatch, id: string, cx: number, cy: number, box: number,
    opts: DrawPropOptions = {},
  ): void {
    const f = ATLAS[id];
    if (!f) return;
    const nat = { w: f.w / ATLAS_DENSITY, h: f.h / ATLAS_DENSITY };
    const k = (box / Math.max(nat.w, nat.h)) * (opts.scale ?? 1);
    this.draw(
      quads, id,
      cx - (nat.w * k) / 2 + (f.ax / ATLAS_DENSITY) * k,
      cy - (nat.h * k) / 2 + (f.ay / ATLAS_DENSITY) * k,
      { ...opts, scale: k },
    );
  }

  /**
   * Draw a prop standing at a world point.
   *
   * (x, y) is the ground point - the same value gridToScreen returns for the
   * tile - not the corner of the image.
   */
  draw(quads: QuadBatch, id: string, x: number, y: number, opts: DrawPropOptions = {}): void {
    const f = ATLAS[id];
    if (!f) return;

    const s = (opts.scale ?? 1) / ATLAS_DENSITY;
    const w = f.w * s;
    const h = f.h * s;
    const inv = 1 / ATLAS_PAGE_SIZE;

    quads.draw(
      this.pages[f.p]!,
      x - f.ax * s, y - f.ay * s, w, h,
      f.x * inv, f.y * inv, (f.x + f.w) * inv, (f.y + f.h) * inv,
      opts.tint ?? 0xffffff, opts.alpha ?? 1, opts.emissive ?? 0,
    );
  }

  dispose(): void {
    for (const page of this.pages) page.dispose();
    if (current === this) current = null;
  }
}

/**
 * The one loaded atlas, reachable without being handed down.
 *
 * The HUD wants these sprites as icons, and the HUD is drawn by functions
 * that take a UIContext assembled somewhere else entirely. Threading the
 * atlas through every panel signature to reach two of them is worse than
 * admitting what is already true: there is exactly one atlas per process,
 * it is loaded once at boot, and everything drawing from it wants the same
 * one. Returns null before it has loaded, and callers are expected to cope -
 * the first frames of a session genuinely have no atlas.
 */
let current: PropAtlas | null = null;

export function propAtlas(): PropAtlas | null {
  return current;
}

/**
 * Pick one sprite out of a list, the same way every time for the same seed.
 *
 * World generation runs on every load, so a tree has to land on the same
 * trunk it had last time or the island reshuffles itself whenever the player
 * refreshes. Callers pass something derived from the tile coordinates.
 */
export function pickFrom(ids: readonly string[], seed: number): string | undefined {
  if (ids.length === 0) return undefined;
  // Mix the seed before taking a remainder: neighbouring tiles differ by one
  // and would otherwise walk through the list in order, striping the map.
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ids[(h >>> 0) % ids.length];
}

export function pickProp(group: string, seed: number): string | undefined {
  return pickFrom(ATLAS_GROUPS[group] ?? [], seed);
}

const pools = new Map<string, readonly string[]>();

/**
 * A named, cached subset of the atlas.
 *
 * The catalogue's groups are coarse on purpose - every conifer is filed under
 * "tree" - so callers that want a narrower pool describe it here once and get
 * the same array back forever after. Scatter code runs this per prop, and
 * rebuilding a filtered list a thousand times would be silly.
 */
export function propPool(key: string, build: () => readonly string[]): readonly string[] {
  let pool = pools.get(key);
  if (!pool) {
    pool = build();
    pools.set(key, pool);
  }
  return pool;
}

/** Sprite ids in a group whose name contains `needle`. */
export function groupMatching(group: string, needle: string): readonly string[] {
  return (ATLAS_GROUPS[group] ?? []).filter((id) => id.includes(needle));
}

/** Sprite ids in a group whose name does not contain `needle`. */
export function groupExcluding(group: string, needle: string): readonly string[] {
  return (ATLAS_GROUPS[group] ?? []).filter((id) => !id.includes(needle));
}

/** Every group the baker produced, for tooling and for asserting in tests. */
export function propGroups(): string[] {
  return Object.keys(ATLAS_GROUPS);
}

export { ATLAS_GROUPS, ATLAS_DENSITY };
