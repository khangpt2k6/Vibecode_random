import { test } from '@playwright/test';
import { boot, clickAt, frames, moveTo, opsCentreAt, press, settle } from './harness.js';

/**
 * Screenshot pass.
 *
 * Not assertions - these exist so the art can be looked at. Playwright's
 * compositor capture is the only honest picture of this canvas, because the
 * context is created with `preserveDrawingBuffer: false` and anything that
 * reads the drawing buffer back comes out black.
 */

const DIR = process.env.SHOT_DIR;
const shot = (name: string) => `${DIR}/${name}.png`;

test.describe('shots', () => {
  // Opt in with SHOT_DIR=<path>. There is nothing to assert here, so running
  // it on every `playwright test` would only cost a minute and litter a
  // directory.
  test.skip(!DIR, 'set SHOT_DIR to capture');

  test('world toolbar, quest log and battle exit', async ({ page }) => {
    await boot(page);
    await settle(page);

    await page.screenshot({ path: shot('01-world') });

    // hover the toolbar so one button shows its filled state next to three
    // unfilled ones, which is the comparison that matters
    await moveTo(page, 270, page.viewportSize()!.height - 36);
    await frames(page, 3);
    await page.screenshot({ path: shot('02-toolbar-hover') });

    await press(page, 'KeyJ');
    await settle(page);
    await page.screenshot({ path: shot('03-quests') });
    await press(page, 'KeyJ');
    await settle(page);

    const ops = await opsCentreAt(page);
    await clickAt(page, ops.x, ops.y);
    await settle(page);
    await frames(page, 30);
    await page.screenshot({ path: shot('04-battle') });

    // the leave prompt
    await press(page, 'Escape');
    await frames(page, 10);
    await page.screenshot({ path: shot('05-leave') });
  });
});
