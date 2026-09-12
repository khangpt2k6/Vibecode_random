import { App } from '@stackmon/engine';
import { WorldScene } from './scenes/world-scene.js';
import { GameAudio } from './audio/game-audio.js';
import { loadPlayer } from './state/save.js';

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
  // Before the scene, so the samples are decoding while the world generates.
  // Nothing is audible until the player's first click resumes the context,
  // which is the browser's rule, not ours.
  const audio = GameAudio.start();
  const player = loadPlayer();
  app.start(new WorldScene(player));

  // Hold the splash for one full frame so the first render never shows a
  // flash of empty canvas before the world exists.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => boot?.classList.add('hidden'));
  });

  // Expose for debugging from the console and for the screenshot harness.
  (window as unknown as { stackmon: App; player: typeof player }).stackmon = app;
  (window as unknown as { player: typeof player }).player = player;
  (window as unknown as { audio: GameAudio }).audio = audio;
} catch (err) {
  showCrash(err);
  throw err;
}
