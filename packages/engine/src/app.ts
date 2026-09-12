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
  /**
   * Simulation ticks since input edges were last cleared.
   *
   * A render can happen with zero ticks behind it - the fixed-timestep
   * accumulator simply has not reached a full step yet - and clearing edges on
   * such a frame throws the keypress away before any update has seen it. That
   * showed up as keys that worked in isolation and silently failed one time in
   * ten under load, which is the worst possible way for it to show up.
   */
  private ticksSinceInputClear = 0;

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
      this.input.setPhase(this.ticksSinceInputClear === 0 ? 'update-first' : 'update-repeat');
      this.renderer.handleResize();
      this.renderer.update(dt);
      this.scenes.update(dt);
      this.ticksSinceInputClear++;
    } catch (err) {
      this.crash(err);
    }
  }

  private render(alpha: number): void {
    if (this.crashed) return;
    try {
      this.input.setPhase('render');
      this.renderer.beginFrame();
      this.scenes.render(alpha);
      this.drawTransition();
      this.renderer.endFrame();
      // Input edges (pressed, released, clicked) live until the end of a
      // rendered frame that actually simulated something. The immediate-mode
      // UI hit-tests while it draws, so clearing at the end of update would
      // lose a click before any button saw it; clearing on a frame with no
      // ticks would lose it before any update saw it. Both have happened.
      if (this.ticksSinceInputClear > 0) {
        this.input.endFrame();
        this.ticksSinceInputClear = 0;
      }
    } catch (err) {
      this.crash(err);
    }
  }

  /**
   * The screen cover for a scene transition.
   *
   * Drawn in the UI layer so it lands after the world has been composited and
   * graded - a fade applied before the grade gets tone mapped back toward
   * visible, which is a very confusing thing to debug.
   */
  private drawTransition(): void {
    const t = this.scenes.transition;
    if (!t.active) return;
    const cover = t.cover;
    if (cover <= 0.001) return;

    this.renderer.beginLayer('ui');
    const { width, height } = this.renderer.ctx;
    const shapes = this.renderer.shapes;

    switch (t.currentStyle) {
      case 'wipe': {
        // A slab sweeping in from the left, with a lit leading edge.
        const w = width * cover;
        shapes.rect(0, 0, w, height, t.color, 1, 0);
        shapes.rect(w - 3, 0, 3, height, 0xffffff, 0.35 * cover, 0.8);
        break;
      }
      case 'iris': {
        // A shrinking hole. Four rects around a centred gap, so no stencil.
        const r = (1 - cover) * Math.hypot(width, height) * 0.6;
        const cx = width / 2;
        const cy = height / 2;
        shapes.rect(0, 0, width, Math.max(0, cy - r), t.color, 1, 0);
        shapes.rect(0, cy + r, width, Math.max(0, height - cy - r), t.color, 1, 0);
        shapes.rect(0, cy - r, Math.max(0, cx - r), r * 2, t.color, 1, 0);
        shapes.rect(cx + r, cy - r, Math.max(0, width - cx - r), r * 2, t.color, 1, 0);
        break;
      }
      default:
        shapes.rect(0, 0, width, height, t.color, cover, 0);
    }
    this.renderer.endLayer();
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
