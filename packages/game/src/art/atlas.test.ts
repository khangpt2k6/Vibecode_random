import { describe, expect, it } from 'vitest';
import {
  ATLAS,
  ATLAS_DENSITY,
  ATLAS_GROUPS,
  ATLAS_PAGES,
  ATLAS_PAGE_SIZE,
} from './atlas.generated.js';
import { groupExcluding, groupMatching, pickFrom, pickProp, propPool } from './atlas.js';

/**
 * Guards on the generated atlas.
 *
 * The manifest is machine-written, so these are not testing arithmetic that
 * a human might fumble - they are testing that a re-bake did not silently
 * change the contract the game relies on. A sprite that falls off its page,
 * an anchor that drifts outside its own image, or a group the world
 * generator asks for that came back empty are all invisible until someone
 * looks at the island and sees a hole in it.
 */

const entries = Object.entries(ATLAS);

/** Groups the world scatter reads. An empty one means a bare island. */
const REQUIRED_GROUPS = ['tree', 'bush', 'rock', 'stone', 'flower', 'grass'];

describe('baked atlas manifest', () => {
  it('is not empty and fits on the declared pages', () => {
    expect(entries.length).toBeGreaterThan(500);
    expect(ATLAS_PAGES.length).toBeGreaterThan(0);
    expect(ATLAS_DENSITY).toBeGreaterThanOrEqual(1);
  });

  it('keeps every frame inside its page', () => {
    for (const [id, f] of entries) {
      expect(f.p, id).toBeGreaterThanOrEqual(0);
      expect(f.p, id).toBeLessThan(ATLAS_PAGES.length);
      expect(f.w, id).toBeGreaterThan(0);
      expect(f.h, id).toBeGreaterThan(0);
      expect(f.x + f.w, id).toBeLessThanOrEqual(ATLAS_PAGE_SIZE);
      expect(f.y + f.h, id).toBeLessThanOrEqual(ATLAS_PAGE_SIZE);
    }
  });

  it('never overlaps two sprites on a page', () => {
    // Shelf packing is easy to break by one pixel, and the symptom is a
    // neighbour's leaves showing up on the edge of a rock.
    const byPage = new Map<number, Array<[string, typeof entries[number][1]]>>();
    for (const [id, f] of entries) {
      const list = byPage.get(f.p) ?? [];
      list.push([id, f]);
      byPage.set(f.p, list);
    }
    for (const list of byPage.values()) {
      list.sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [idA, a] = list[i]!;
          const [idB, b] = list[j]!;
          if (b.y >= a.y + a.h) break; // sorted by y: nothing after this can overlap
          const apart = b.x >= a.x + a.w || a.x >= b.x + b.w;
          expect(apart, `${idA} overlaps ${idB}`).toBe(true);
        }
      }
    }
  });

  /**
   * The anchor may sit a little outside the image - a support pillar hangs
   * below its origin, a gate arches above it - but a sprite anchored a whole
   * image-width away means the baker picked the wrong reference point, which
   * is the bug that put barrels 43 pixels off their own tile.
   */
  it('anchors within a sprite of the image', () => {
    for (const [id, f] of entries) {
      expect(f.ax, `${id} ax`).toBeGreaterThan(-f.w);
      expect(f.ax, `${id} ax`).toBeLessThan(f.w * 2);
      expect(f.ay, `${id} ay`).toBeGreaterThan(-f.h);
      expect(f.ay, `${id} ay`).toBeLessThan(f.h * 2);
    }
  });

  it('has every group the world generator asks for', () => {
    for (const group of REQUIRED_GROUPS) {
      expect(ATLAS_GROUPS[group], group).toBeDefined();
      expect(ATLAS_GROUPS[group]!.length, group).toBeGreaterThan(0);
    }
  });

  it('lists only real sprite ids in its groups', () => {
    for (const [group, ids] of Object.entries(ATLAS_GROUPS)) {
      for (const id of ids) expect(ATLAS[id], `${group}/${id}`).toBeDefined();
    }
  });

  it('splits conifers out of the tree group', () => {
    // The scatter relies on this: pines go on ridges, broadleaf in meadows.
    expect(groupMatching('tree', 'pine').length).toBeGreaterThan(0);
    expect(groupExcluding('tree', 'pine').length).toBeGreaterThan(0);
  });
});

describe('picking', () => {
  it('returns the same sprite for the same seed', () => {
    const ids = ATLAS_GROUPS.tree!;
    for (const seed of [0, 1, 7, 1234, -99, 2 ** 30]) {
      expect(pickFrom(ids, seed)).toBe(pickFrom(ids, seed));
    }
  });

  it('spreads neighbouring seeds across the pool', () => {
    // Consecutive tile coordinates must not walk the list in order, or the
    // map stripes: row after row of the same tree in the same rotation.
    const ids = ATLAS_GROUPS.tree!;
    const picked = new Set<string>();
    for (let i = 0; i < 40; i++) picked.add(pickFrom(ids, i)!);
    expect(picked.size).toBeGreaterThan(8);
  });

  it('survives a group that does not exist', () => {
    expect(pickProp('no-such-group', 3)).toBeUndefined();
    expect(pickFrom([], 3)).toBeUndefined();
  });

  it('caches a pool by key rather than rebuilding it', () => {
    let built = 0;
    const build = (): readonly string[] => {
      built++;
      return ['a', 'b'];
    };
    const key = 'atlas-test-pool';
    expect(propPool(key, build)).toBe(propPool(key, build));
    expect(built).toBe(1);
  });
});
