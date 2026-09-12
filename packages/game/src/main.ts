import { App } from '@stackmon/engine';
import { WorldScene } from './scenes/world-scene.js';

/**
 * Entry point.
 *
 * Boots the app, hands it the first scene, and wires the two DOM elements the
 * game owns outside of the canvas: the boot splash and the crash screen.
 */

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const boot = document.getElementById('boot');
const crash = document.getElementById('crash');
const crashBody = document.getElementById('crash-body');

if (!canvas) throw new Error('main: #stage canvas is missing from index.html');

function showCrash(err: unknown): void {
  if (!crash || !crashBody) return;
  const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  crashBody.textContent = message;
  crash.classList.add('show');
  boot?.classList.add('hidden');
}

try {
  const app = new App({ canvas, onError: showCrash });
  app.start(new WorldScene());

  // Hold the splash for one full frame so the first render never shows a
  // flash of empty canvas before the world exists.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => boot?.classList.add('hidden'));
  });

  // Expose for debugging from the console and for the screenshot harness.
  (window as unknown as { stackmon: App }).stackmon = app;
} catch (err) {
  showCrash(err);
  throw err;
}
