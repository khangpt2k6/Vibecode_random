import type { Vec2 } from '../math/vec2.js';

/**
 * Input state.
 *
 * Polled, not event-driven: the game loop asks "is W down this tick" rather
 * than reacting to keydown. That keeps input sampling aligned with the fixed
 * simulation step, which matters because a key tapped and released between
 * two ticks must still register exactly once.
 *
 * `pressed` and `released` are edge states. An edge is delivered to exactly
 * one simulation tick and to the render that follows it, then cleared.
 *
 * "Exactly one tick" is load bearing. A frame that has fallen behind runs
 * several catch-up ticks, and an edge visible to all of them fires whatever
 * it is bound to several times - a toggle bound to a keypress opened and
 * immediately closed itself, apparently at random, depending only on how far
 * behind the accumulator happened to be. The phase below is how that is
 * prevented without hiding edges from the immediate-mode UI, which hit-tests
 * during render and genuinely does need to see the click.
 */

/**
 * What the engine is doing right now.
 *
 * `update-first` is the first simulation tick of a frame, `update-repeat` any
 * catch-up tick after it, and `render` the draw that follows. Edges are
 * reported during `update-first` and `render`, and suppressed during
 * `update-repeat`.
 */
export type InputPhase = 'update-first' | 'update-repeat' | 'render';

export interface PointerState {
  /** Position in CSS pixels relative to the canvas. */
  readonly position: Vec2;
  /** Movement since the last tick. */
  readonly delta: Vec2;
  readonly down: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
  /** Accumulated wheel delta since the last tick. Positive scrolls down. */
  readonly wheel: number;
  /** True while a drag is in progress (down and moved past the threshold). */
  readonly dragging: boolean;
}

const DRAG_THRESHOLD_PX = 4;

export class Input {
  private readonly down = new Set<string>();
  private readonly pressedKeys = new Set<string>();
  private readonly releasedKeys = new Set<string>();
  private textBuffer = '';

  private readonly pointerPos: Vec2 = { x: 0, y: 0 };
  private readonly pointerDelta: Vec2 = { x: 0, y: 0 };
  private readonly pointerDownAt: Vec2 = { x: 0, y: 0 };
  private pointerDown = false;
  private pointerPressed = false;
  private pointerReleased = false;
  private pointerDragging = false;
  private wheelDelta = 0;
  private rightDown = false;
  private rightPressed = false;

  private readonly detach: Array<() => void> = [];
  private phase: InputPhase = 'update-first';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.attach();
  }

  /** Set by the app around each tick and each draw. */
  setPhase(phase: InputPhase): void {
    this.phase = phase;
  }

  /** False during catch-up ticks, so an edge fires once per frame. */
  private get edgesVisible(): boolean {
    return this.phase !== 'update-repeat';
  }

  private attach(): void {
    const on = <K extends keyof WindowEventMap>(
      target: EventTarget,
      type: K,
      handler: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      const h = handler as EventListener;
      target.addEventListener(type, h, opts);
      this.detach.push(() => target.removeEventListener(type, h, opts));
    };

    on(window, 'keydown', (e) => {
      // Stop the browser scrolling the page out from under a game that uses
      // arrows and space, but leave the devtools and reload shortcuts alone.
      if (SWALLOWED_KEYS.has(e.code) && !e.ctrlKey && !e.metaKey) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedKeys.add(e.code);
      this.down.add(e.code);
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.textBuffer += e.key;
      if (e.code === 'Backspace') this.textBuffer += '\b';
    });

    on(window, 'keyup', (e) => {
      this.down.delete(e.code);
      this.releasedKeys.add(e.code);
    });

    // A lost focus with keys held would otherwise leave the player walking
    // forever once they come back.
    on(window, 'blur', () => {
      for (const code of this.down) this.releasedKeys.add(code);
      this.down.clear();
      this.pointerDown = false;
      this.pointerDragging = false;
    });

    on(this.canvas, 'pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.updatePointerPosition(e);
      if (e.button === 2) {
        this.rightDown = true;
        this.rightPressed = true;
        return;
      }
      this.pointerDown = true;
      this.pointerPressed = true;
      this.pointerDownAt.x = this.pointerPos.x;
      this.pointerDownAt.y = this.pointerPos.y;
      this.pointerDragging = false;
    });

    on(this.canvas, 'pointermove', (e) => {
      const prevX = this.pointerPos.x;
      const prevY = this.pointerPos.y;
      this.updatePointerPosition(e);
      this.pointerDelta.x += this.pointerPos.x - prevX;
      this.pointerDelta.y += this.pointerPos.y - prevY;

      if (this.pointerDown && !this.pointerDragging) {
        const dx = this.pointerPos.x - this.pointerDownAt.x;
        const dy = this.pointerPos.y - this.pointerDownAt.y;
        if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          this.pointerDragging = true;
        }
      }
    });

    on(this.canvas, 'pointerup', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.updatePointerPosition(e);
      if (e.button === 2) {
        this.rightDown = false;
        return;
      }
      this.pointerDown = false;
      this.pointerReleased = true;
    });

    on(this.canvas, 'pointercancel', () => {
      this.pointerDown = false;
      this.pointerDragging = false;
    });

    on(this.canvas, 'wheel', (e) => {
      e.preventDefault();
      // deltaMode 1 is lines, 2 is pages. Normalising to roughly-pixels keeps
      // zoom speed consistent between a trackpad and a notched mouse wheel.
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this.wheelDelta += e.deltaY * scale;
    }, { passive: false });

    on(this.canvas, 'contextmenu', (e) => e.preventDefault());
  }

  private updatePointerPosition(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerPos.x = e.clientX - rect.left;
    this.pointerPos.y = e.clientY - rect.top;
  }

  // ---- keyboard ----

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.edgesVisible && this.pressedKeys.has(code);
  }

  wasReleased(code: string): boolean {
    return this.edgesVisible && this.releasedKeys.has(code);
  }

  anyPressed(): boolean {
    return this.edgesVisible && this.pressedKeys.size > 0;
  }

  /** Characters typed this tick, plus \b for each backspace. */
  takeText(): string {
    const t = this.textBuffer;
    this.textBuffer = '';
    return t;
  }

  /** -1, 0, or 1 along each axis from WASD and the arrow keys. */
  axis(): Vec2 {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    return { x, y };
  }

  // ---- pointer ----

  get pointer(): PointerState {
    const edges = this.edgesVisible;
    return {
      position: this.pointerPos,
      delta: this.pointerDelta,
      down: this.pointerDown,
      pressed: edges && this.pointerPressed,
      released: edges && this.pointerReleased,
      wheel: this.wheelDelta,
      dragging: this.pointerDragging,
    };
  }

  get rightMouseDown(): boolean {
    return this.rightDown;
  }

  get rightMousePressed(): boolean {
    return this.edgesVisible && this.rightPressed;
  }

  /**
   * True if the pointer went down and up without dragging - a click, as
   * opposed to the end of a camera pan. UI should use this, never `released`.
   */
  get clicked(): boolean {
    return this.edgesVisible && this.pointerReleased && !this.pointerDragging;
  }

  /** Clear per-tick edge state. Call once at the end of each simulation tick. */
  endFrame(): void {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pointerPressed = false;
    this.pointerReleased = false;
    this.rightPressed = false;
    this.pointerDelta.x = 0;
    this.pointerDelta.y = 0;
    this.wheelDelta = 0;
    if (!this.pointerDown) this.pointerDragging = false;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }
}

const SWALLOWED_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab', 'Slash', "Quote",
]);
