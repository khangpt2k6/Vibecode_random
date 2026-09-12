import { Renderer } from './render/renderer.js';
import { Input } from './input/input.js';
import { GameLoop } from './core/loop.js';
import { SceneManager } from './scene/scene.js';
import type { Scene, SceneContext } from './scene/scene.js';

/**
 * Application bootstrap.
 *
 * Wires a canvas to a renderer, an input handler, a scene stack, and a fixed
 * timestep loop, then gets out of the way. Everything game-specific lives in
 * the scenes this is handed.
 */

export interface AppOptions {
  canvas: HTMLCanvasElement;
  /** Simulation rate. 60 unless there is a reason. */
  hz?: number;
  /** Called if the loop throws, so the game can show a real error screen. */
  onError?: (err: unknown) => void;
}

export class App {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly scenes = new SceneManager();
  readonly loop: GameLoop;

  private readonly ctx: SceneContext;
  private readonly onError: ((err: unknown) => void) | undefined;
  private crashed = false;

  constructor(opts: AppOptions) {
    this.renderer = new Renderer(opts.canvas);
    this.input = new Input(opts.canvas);
    this.onError = opts.onError;

    this.ctx = {
      renderer: this.renderer,
      input: this.input,
      scenes: this.scenes,
    };
    this.scenes.bind(this.ctx);

    this.loop = new GameLoop(
      {
        update: (dt) => this.update(dt),
        render: (alpha) => this.render(alpha),
      },
      { hz: opts.hz ?? 60 },
    );
  }

  start(initial: Scene): void {
    this.scenes.replace(initial);
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  private update(dt: number): void {
    if (this.crashed) return;
    try {
      this.renderer.handleResize();
      this.renderer.update(dt);
      this.scenes.update(dt);
    } catch (err) {
      this.crash(err);
    }
  }

  private render(alpha: number): void {
    if (this.crashed) return;
    try {
      this.renderer.beginFrame();
      this.scenes.render(alpha);
      this.renderer.endFrame();
      // Input edges (pressed, released, clicked) live until the end of the
      // rendered frame, not the end of the simulation tick. The immediate-mode
      // UI hit-tests while it draws, so a click cleared at the end of update
      // was gone before any button ever saw it. Clearing here means every
      // update in the frame and the render itself all see the same edge, and
      // a frame with zero simulation ticks still cannot drop one.
      this.input.endFrame();
    } catch (err) {
      this.crash(err);
    }
  }

  /**
   * Stop on the first exception rather than throwing sixty times a second.
   * A loop that keeps running after a crash buries the original error under
   * thousands of identical ones and makes the real cause unfindable.
   */
  private crash(err: unknown): void {
    this.crashed = true;
    this.loop.stop();
    console.error('STACKMON crashed:', err);
    this.onError?.(err);
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.renderer.dispose();
  }
}
