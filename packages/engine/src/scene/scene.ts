import type { Renderer } from '../render/renderer.js';
import type { Input } from '../input/input.js';
import { Transition, type TransitionOptions } from './transition.js';

/**
 * A scene is one screen of the game: the overworld, a battle, the base
 * builder, a menu. Scenes are pushed onto a stack, so a battle can sit on top
 * of the overworld and reveal it again on pop without the overworld ever
 * having been torn down.
 */

export interface SceneContext {
  renderer: Renderer;
  input: Input;
  scenes: SceneManager;
}

export interface Scene {
  readonly name: string;

  /** Called once when the scene is first pushed. */
  enter?(ctx: SceneContext): void | Promise<void>;
  /** Called when the scene is popped for good. Release GL resources here. */
  exit?(ctx: SceneContext): void;
  /** Called when another scene is pushed on top of this one. */
  pause?(ctx: SceneContext): void;
  /** Called when the scene above this one is popped. */
  resume?(ctx: SceneContext): void;

  update(dt: number, ctx: SceneContext): void;
  render(alpha: number, ctx: SceneContext): void;

  /**
   * True if the scene below should keep updating while this one is on top.
   * A pause menu says no; a battle overlay that wants the world to keep
   * animating behind it says yes.
   */
  readonly updateBelow?: boolean;
  /** True if the scene below should keep rendering behind this one. */
  readonly renderBelow?: boolean;
}

export class SceneManager {
  /** Covers the moment of a scene swap. Drawn by the app, over everything. */
  readonly transition = new Transition();
  private readonly stack: Scene[] = [];
  private ctx!: SceneContext;
  /** Deferred so a scene can safely push or pop from inside its own update. */
  private readonly pending: Array<() => void | Promise<void>> = [];
  private transitioning = false;

  bind(ctx: SceneContext): void {
    this.ctx = ctx;
  }

  get current(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Push behind a fade. The swap happens while the screen is covered. */
  pushWith(scene: Scene, opts?: TransitionOptions): void {
    this.transition.start(() => this.push(scene), opts);
  }

  popWith(opts?: TransitionOptions): void {
    this.transition.start(() => this.pop(), opts);
  }

  replaceWith(scene: Scene, opts?: TransitionOptions): void {
    this.transition.start(() => this.replace(scene), opts);
  }

  push(scene: Scene): void {
    this.pending.push(async () => {
      this.current?.pause?.(this.ctx);
      this.stack.push(scene);
      await scene.enter?.(this.ctx);
    });
  }

  pop(): void {
    this.pending.push(() => {
      const scene = this.stack.pop();
      scene?.exit?.(this.ctx);
      this.current?.resume?.(this.ctx);
    });
  }

  /** Pop everything and push `scene`. The usual "go to a new screen" move. */
  replace(scene: Scene): void {
    this.pending.push(async () => {
      while (this.stack.length > 0) {
        this.stack.pop()?.exit?.(this.ctx);
      }
      this.stack.push(scene);
      await scene.enter?.(this.ctx);
    });
  }

  /** True while an enter() is still resolving, so the caller can show a spinner. */
  get isTransitioning(): boolean {
    return this.transitioning || this.pending.length > 0;
  }

  update(dt: number): void {
    this.transition.update(dt);
    this.drainPending();
    if (this.transitioning) return;

    // Walk down from the top until a scene says nothing below it should run.
    let startIndex = this.stack.length - 1;
    while (startIndex > 0 && this.stack[startIndex]!.updateBelow) startIndex--;
    for (let i = startIndex; i < this.stack.length; i++) {
      this.stack[i]!.update(dt, this.ctx);
    }
  }

  render(alpha: number): void {
    if (this.stack.length === 0) return;
    let startIndex = this.stack.length - 1;
    while (startIndex > 0 && this.stack[startIndex]!.renderBelow) startIndex--;
    for (let i = startIndex; i < this.stack.length; i++) {
      this.stack[i]!.render(alpha, this.ctx);
    }
  }

  private drainPending(): void {
    while (this.pending.length > 0 && !this.transitioning) {
      const op = this.pending.shift()!;
      const result = op();
      if (result instanceof Promise) {
        this.transitioning = true;
        result
          .catch((err) => {
            console.error('Scene transition failed:', err);
          })
          .finally(() => {
            this.transitioning = false;
          });
      }
    }
  }
}
