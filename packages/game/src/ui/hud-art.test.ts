import { describe, expect, it } from 'vitest';
import { BUILDINGS, CROPS, RESOURCES } from '@stackmon/content';
import { ATLAS } from '../art/atlas.generated.js';
import { BUILDING_ICONS, CROP_ICONS, RESOURCE_ICONS } from './world-hud.js';

/**
 * Every HUD picture resolves to a sprite that exists.
 *
 * `drawIcon` returns silently when the id is not in the atlas, which is the
 * right behaviour at runtime and a terrible one in development: a mistyped
 * sprite name produces an empty card rather than an error, and the build
 * screen had eleven of them for exactly that reason. This is the check that
 * would have caught it.
 */
describe('hud art', () => {
  it('gives every building a picture that is in the atlas', () => {
    for (const spec of BUILDINGS) {
      const id = BUILDING_ICONS[spec.id];
      expect(id, `${spec.id} has no picture`).toBeTruthy();
      expect(ATLAS[id!], `${spec.id} points at a missing sprite: ${id}`).toBeTruthy();
    }
  });

  it('gives every crop a picture that is in the atlas', () => {
    for (const crop of CROPS) {
      const id = CROP_ICONS[crop.id];
      expect(id, `${crop.id} has no picture`).toBeTruthy();
      expect(ATLAS[id!], `${crop.id} points at a missing sprite: ${id}`).toBeTruthy();
    }
  });

  it('gives every currency a picture that is in the atlas', () => {
    for (const id of Object.keys(RESOURCES)) {
      const art = RESOURCE_ICONS[id as keyof typeof RESOURCE_ICONS];
      expect(art, `${id} has no picture`).toBeTruthy();
      expect(ATLAS[art!], `${id} points at a missing sprite: ${art}`).toBeTruthy();
    }
  });

  it('does not hand two buildings the same picture', () => {
    const seen = new Map<string, string>();
    for (const spec of BUILDINGS) {
      const art = BUILDING_ICONS[spec.id]!;
      expect(seen.get(art), `${spec.id} reuses the picture from ${seen.get(art)}`).toBeUndefined();
      seen.set(art, spec.id);
    }
  });
});
