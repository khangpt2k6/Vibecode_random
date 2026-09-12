import { describe, expect, it } from 'vitest';
import { DEFAULT_ISO, gridToScreen, screenToGrid, screenToGridOnHeightmap } from './iso.js';

/**
 * Projection round trips.
 *
 * The one that matters is centre -> screen -> tile. It was wrong for a long
 * time in a way nothing visible caught: `gridToScreen` returns the centre of a
 * diamond, so a whole grid coordinate IS a centre, and flooring it to get a
 * tile index lands half a tile up and left. Hover looked plausible, and
 * clicking a flat plot resolved to the tile behind it.
 */
describe('isometric projection', () => {
  const flat = () => 0;

  it('screen -> grid inverts grid -> screen exactly', () => {
    for (const [gx, gy] of [[0, 0], [3, 7], [24, 23], [41, 2]] as const) {
      const s = gridToScreen({ gx, gy, h: 0 });
      const g = screenToGrid(s);
      expect(g.gx).toBeCloseTo(gx, 6);
      expect(g.gy).toBeCloseTo(gy, 6);
    }
  });

  it('picks the tile whose centre was clicked', () => {
    for (const [gx, gy] of [[0, 0], [5, 5], [24, 23], [12, 30]] as const) {
      const s = gridToScreen({ gx, gy, h: 0 });
      expect(screenToGridOnHeightmap(s, flat, 6)).toEqual({ gx, gy, h: 0 });
    }
  });

  it('picks the same tile from anywhere inside it', () => {
    const target = { gx: 10, gy: 4, h: 0 };
    const c = gridToScreen(target);
    const inside: Array<[number, number]> = [
      [0, 0],
      [DEFAULT_ISO.tileW * 0.3, 0],
      [-DEFAULT_ISO.tileW * 0.3, 0],
      [0, DEFAULT_ISO.tileH * 0.3],
      [0, -DEFAULT_ISO.tileH * 0.3],
    ];
    for (const [dx, dy] of inside) {
      expect(screenToGridOnHeightmap({ x: c.x + dx, y: c.y + dy }, flat, 6)).toEqual(target);
    }
  });

  it('picks a raised tile over the flat ground it hides', () => {
    // One step further along BOTH axes and two elevations up lands on exactly
    // the same pixels, and is nearer the camera, so it is what you can see.
    const heightAt = (gx: number, gy: number) => (gx === 11 && gy === 5 ? 2 : 0);
    const s = gridToScreen({ gx: 10, gy: 4, h: 0 });
    expect(screenToGridOnHeightmap(s, heightAt, 6)).toEqual({ gx: 11, gy: 5, h: 2 });
  });

  it('a tile one nearer and two taller covers exactly the same pixels', () => {
    const behind = gridToScreen({ gx: 10, gy: 4, h: 0 });
    const front = gridToScreen({ gx: 11, gy: 5, h: 2 });
    expect(front.x).toBeCloseTo(behind.x, 6);
    expect(front.y).toBeCloseTo(behind.y, 6);
  });

  it('returns null when nothing is under the point', () => {
    const s = gridToScreen({ gx: 5, gy: 5, h: 0 });
    expect(screenToGridOnHeightmap(s, () => -1, 6)).toBeNull();
  });
});
