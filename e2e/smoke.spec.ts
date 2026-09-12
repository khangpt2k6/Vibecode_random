import { expect, test } from '@playwright/test';
import { analysePng, boot, frames, measureFps, player, press, sceneName } from './harness.js';

/**
 * Boot and render.
 *
 * These are the tests that would have caught the three worst bugs this
 * project has had: a render target that failed to allocate, a batch that drew
 * every polygon through the wrong shader, and a canvas whose contents could
 * not be captured at all. All three left the game "working" by every measure
 * except what was on the screen.
 */

test.describe('boot', () => {
  test('starts without crashing and runs the loop', async ({ page }) => {
    await boot(page);
    expect(await sceneName(page)).toBe('world');
    await expect(page.locator('#crash')).not.toHaveClass(/show/);
    await expect(page.locator('#boot')).toHaveClass(/hidden/);
  });

  test('WebGL2 came up with float render targets', async ({ page }) => {
    await boot(page);
    const caps = await page.evaluate(() => {
      const gl = window.stackmon.renderer.gl;
      return {
        version: gl.getParameter(gl.VERSION),
        // The scene target needs two attachments and will refuse to allocate
        // without them, so its existence is the assertion.
        attachments: window.stackmon.renderer.sceneTarget.textures.length,
        formats: window.stackmon.renderer.sceneTarget.textures.map((t: any) => t.format),
      };
    });
    expect(caps.version).toContain('WebGL 2');
    expect(caps.attachments).toBe(2);
  });

  test('actually draws a world, not a black screen', async ({ page }) => {
    await boot(page);
    await frames(page, 10);

    // Go through Playwright's own capture rather than reading the canvas in
    // page context. `preserveDrawingBuffer` is off, so both readPixels and
    // drawImage see an already-cleared buffer and report a black screen that
    // the player never saw. The compositor path is the only honest one.
    const png = await page.locator('#stage').screenshot();
    const stats = analysePng(png);

    expect(stats.nonBlack / stats.pixels, 'most of the frame should be lit').toBeGreaterThan(0.8);
    expect(stats.distinct, 'a flat fill would have very few distinct colours').toBeGreaterThan(60);
    expect(stats.greenish / stats.pixels, 'the island should dominate the frame').toBeGreaterThan(0.2);
  });

  test('holds a playable frame rate on the full island', async ({ page }) => {
    await boot(page);
    const fps = await measureFps(page, 1500);
    expect(fps, `measured ${fps.toFixed(1)} fps`).toBeGreaterThan(30);
  });

  test('resizes without breaking', async ({ page }) => {
    await boot(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await frames(page, 5);
    await page.setViewportSize({ width: 1400, height: 900 });
    await frames(page, 5);

    const size = await page.evaluate(() => ({
      w: window.stackmon.renderer.ctx.width,
      h: window.stackmon.renderer.ctx.height,
      running: window.stackmon.loop.isRunning,
    }));
    expect(size.running).toBe(true);
    expect(size.w).toBeGreaterThan(1200);
    await expect(page.locator('#crash')).not.toHaveClass(/show/);
  });

  test('a fresh player starts with a party and the first objective', async ({ page }) => {
    await boot(page);
    const p = await player(page);
    expect(p.roster.length).toBe(5);
    expect(p.party.filter(Boolean).length).toBe(3);
    expect(p.bench.length).toBe(2);
    expect(p.stats.battles).toBe(0);
    expect(p.base.built).toEqual([]);
  });
});

test.describe('overlays', () => {
  test('help opens and closes', async ({ page }) => {
    await boot(page);
    await press(page, 'h');
    expect(await page.evaluate(() => window.stackmon.scenes.current.overlay)).toBe('help');
    await press(page, 'Escape');
    expect(await page.evaluate(() => window.stackmon.scenes.current.overlay)).toBe('none');
  });

  test('codex opens and lists every technology', async ({ page }) => {
    await boot(page);
    await press(page, 'g');
    expect(await page.evaluate(() => window.stackmon.scenes.current.overlay)).toBe('codex');
    await frames(page, 4);
    await expect(page.locator('#crash')).not.toHaveClass(/show/);
    await press(page, 'g');
    const after = await page.evaluate(() => ({
      overlay: window.stackmon.scenes.current.overlay,
      ticks: window.stackmon.loop.getStats().ups,
      fps: window.stackmon.loop.getStats().fps,
    }));
    expect(after.overlay, `after second g: ${JSON.stringify(after)}`).toBe('none');
  });

  test('build menu opens and shows the whole tree', async ({ page }) => {
    await boot(page);
    await press(page, 'b');
    const state = await page.evaluate(() => {
      const core = window.stackmon.scenes.current;
      return { overlay: core.overlay, built: window.player.base.built.length };
    });
    expect(state.overlay).toBe('build');
    expect(state.built).toBe(0);
    await frames(page, 4);
    await expect(page.locator('#crash')).not.toHaveClass(/show/);
  });

  test('an open overlay swallows the pointer instead of panning the world', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => ({
      x: window.stackmon.renderer.camera.target.x,
      y: window.stackmon.renderer.camera.target.y,
    }));
    await press(page, 'h');
    const box = (await page.locator('#stage').boundingBox())!;
    await page.mouse.move(box.x + 600, box.y + 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 200, { steps: 6 });
    await page.mouse.up();
    await frames(page, 4);
    const after = await page.evaluate(() => ({
      x: window.stackmon.renderer.camera.target.x,
      y: window.stackmon.renderer.camera.target.y,
    }));
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });
});
