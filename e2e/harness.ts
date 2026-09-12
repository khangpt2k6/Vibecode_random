import { inflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

/**
 * Test harness.
 *
 * The game is one canvas, so there is nothing in the DOM to query and
 * Playwright's usual selectors are useless here. Instead the page exposes
 * `window.stackmon` (the app) and `window.player` (the save), and the tests
 * drive the game through those plus synthetic pointer events at real screen
 * coordinates.
 *
 * That is deliberately not "call the function directly and assert". Clicks go
 * through the real event handlers, the real hit testing, and the real input
 * edge lifetime - which is exactly where the bugs have actually been.
 */

declare global {
  interface Window {
    stackmon: any;
    player: any;
  }
}

export const CANVAS = '#stage';

/** Load the game with a clean save and wait until it is actually running. */
export async function boot(page: Page, opts: { fresh?: boolean } = {}): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  if (opts.fresh !== false) {
    await page.evaluate(() => localStorage.removeItem('stackmon.save.v1'));
    await page.reload();
  }

  await page.waitForFunction(() => window.stackmon?.loop?.isRunning === true, null, {
    timeout: 20_000,
  });
  // One more frame so the first render has definitely happened.
  await frames(page, 2);

  const crashVisible = await page.locator('#crash.show').count();
  expect(crashVisible, `crash screen is up: ${errors.join(' | ')}`).toBe(0);
  expect(errors, 'console errors during boot').toEqual([]);
}

/** Wait for `n` animation frames to pass. */
export async function frames(page: Page, n = 1): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

export async function sceneName(page: Page): Promise<string> {
  return page.evaluate(() => window.stackmon.scenes.current?.name ?? 'none');
}

/** Read a slice of the save. */
export async function player(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.player)));
}

/**
 * Click at canvas-relative coordinates.
 *
 * Moves first so hover state settles, waits a frame so the immediate-mode UI
 * sees the pointer where the click will land, then presses. Clicking without
 * the move is how you write a test that passes while the button it is aiming
 * at is never actually highlighted.
 */
export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + x, box.y + y);
  await frames(page, 2);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 2);
}

export async function moveTo(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + x, box.y + y);
  await frames(page, 2);
}

export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await frames(page, 2);
}

/** Wait until any scene transition has finished. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.stackmon.scenes.transition.active === false, null, {
    timeout: 10_000,
  });
  await frames(page, 2);
}

/**
 * Screen position of a wild creature, in canvas coordinates.
 *
 * Mirrors what the scene's own hit test does, so a test that clicks here is
 * clicking where the game thinks the creature is. Returns null when the
 * island has none, which a test should treat as a failure rather than a skip.
 */
export async function wildAt(page: Page, index = 0): Promise<{ x: number; y: number; id: string } | null> {
  return page.evaluate((i) => {
    const sc = window.stackmon.scenes.current;
    const cam = window.stackmon.renderer.camera;
    const wilds = (sc.wild ?? []).filter((w: any) => w.leaving === 0);
    if (wilds.length === 0) return null;
    wilds.sort((a: any, b: any) => a.level - b.level);
    const w = wilds[Math.min(i, wilds.length - 1)];
    const h = sc.heightAt(Math.round(w.gx), Math.round(w.gy));
    const wx = (w.gx - w.gy) * 32;
    const wy = (w.gx + w.gy) * 16 - h * 16;
    const sp = cam.worldToScreen({ x: wx, y: wy });
    return { x: sp.x, y: sp.y - 14 * cam.zoom, id: w.creatureId };
  }, index);
}

/** Screen position of the Ops Centre. */
export async function opsCentreAt(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const sc = window.stackmon.scenes.current;
    const cam = window.stackmon.renderer.camera;
    const { gx, gy } = sc.hallAt;
    const h = sc.heightAt(gx, gy);
    const wx = (gx - gy) * 32;
    const wy = (gx + gy) * 16 - h * 16;
    return cam.worldToScreen({ x: wx, y: wy });
  });
}

/** Screen position of farm plot `index`, or null if it does not exist. */
export async function plotAt(page: Page, index = 0): Promise<{ x: number; y: number } | null> {
  return page.evaluate((i) => {
    const sc = window.stackmon.scenes.current;
    const cam = window.stackmon.renderer.camera;
    const tile = sc.plotTiles?.[i];
    if (!tile) return null;
    const h = sc.heightAt(tile.gx, tile.gy);
    const wx = (tile.gx - tile.gy) * 32;
    const wy = (tile.gx + tile.gy) * 16 - h * 16;
    return cam.worldToScreen({ x: wx, y: wy });
  }, index);
}

/** Give the player resources without going through the economy. */
export async function grant(page: Page, resources: Record<string, number>): Promise<void> {
  await page.evaluate((r) => {
    for (const [k, v] of Object.entries(r)) window.player.resources[k] = v;
  }, resources);
  await frames(page, 2);
}

/** Play the current battle to completion with a greedy policy. */
export async function autoBattle(page: Page, maxTurns = 80): Promise<string> {
  return page.evaluate(async (limit) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const sc = window.stackmon.scenes.current;
    if (sc?.name !== 'battle') return `not-in-battle:${sc?.name}`;

    let guard = 0;
    while (sc.battle.state.outcome === 'ongoing' && guard++ < limit) {
      while (sc.phase === 'animating') await sleep(40);
      if (sc.phase !== 'input') break;
      let best: any = { kind: 'hold' };
      let cost = -1;
      for (const slot of sc.battle.state.pipeline) {
        const c = slot.occupant;
        if (!c || c.downed) continue;
        for (const skill of sc.battle.availableSkills(c.uid)) {
          if (skill.cost > cost) {
            cost = skill.cost;
            best = { kind: 'skill', actorUid: c.uid, skillId: skill.id };
          }
        }
      }
      sc.act(best);
      await sleep(30);
    }
    while (sc.phase === 'animating') await sleep(40);
    return sc.battle.state.outcome;
  }, maxTurns);
}

/** Average frames per second measured over `ms`. */
export async function measureFps(page: Page, ms = 1500): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let count = 0;
        const start = performance.now();
        const tick = () => {
          count++;
          if (performance.now() - start >= duration) {
            resolve((count * 1000) / (performance.now() - start));
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/**
 * Decode a PNG far enough to measure what is on screen.
 *
 * A tiny inflate-and-unfilter rather than a dependency: the suite needs
 * exactly four numbers about a screenshot, and pulling in an image library to
 * get them would be more code than this, not less.
 */
export interface FrameStats {
  pixels: number;
  nonBlack: number;
  greenish: number;
  distinct: number;
}

export function analysePng(png: Buffer): FrameStats {
  const { width, height, rgba } = decodePng(png);
  let nonBlack = 0;
  let greenish = 0;
  const colors = new Set<string>();

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    if (r + g + b > 40) nonBlack++;
    // Grass and foliage: green clearly ahead of both other channels.
    if (g > r + 18 && g > b + 30) greenish++;
    colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  return { pixels: width * height, nonBlack, greenish, distinct: colors.size };
}

function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  let off = 8; // skip the signature
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const body = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8]!;
      colorType = body[9]!;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    off += len + 12;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG: depth ${bitDepth}, colour type ${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x]!;
      const a = x >= channels ? line[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: {
          // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unknown PNG filter ${filter}`);
      }
      line[x] = value & 0xff;
    }
    src += stride;

    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = line[from]!;
      out[to + 1] = line[from + 1]!;
      out[to + 2] = line[from + 2]!;
      out[to + 3] = channels === 4 ? line[from + 3]! : 255;
    }
    prev.set(line);
  }

  return { width, height, rgba: out };
}
