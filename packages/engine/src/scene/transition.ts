import { clamp01 } from '@stackmon/util';

/**
 * Screen transitions.
 *
 * A scene swap that happens between two frames is jarring: the eye has no
 * time to accept that it moved, so it reads as a glitch rather than as going
 * somewhere. Covering the swap with half a second of black turns the same
 * cut into a journey, and the cost is one fullscreen quad.
 *
 * The transition owns the moment of the swap, not the scenes: it fades out,
 * runs the callback that actually changes the stack, then fades in. Neither
 * scene has to know a transition happened.
 */

export type TransitionStyle = 'fade' | 'wipe' | 'iris';

export interface TransitionOptions {
  style?: TransitionStyle;
  /** Seconds for the covering half. The reveal takes the same again. */
  duration?: number;
  /** 0xRRGGBB the screen is covered with. */
  color?: number;
}

type Phase = 'idle' | 'covering' | 'swapping' | 'revealing';

export class Transition {
  private phase: Phase = 'idle';
  private t = 0;
  private duration = 0.28;
  private style: TransitionStyle = 'fade';
  private colorValue = 0x0a1020;
  private onSwap: (() => void) | null = null;

  /**
   * Begin a transition. `swap` runs at full cover, when nothing is visible.
   *
   * A transition already in flight is not restarted - a second click on a
   * button during the fade should be ignored, not queue a second journey.
   */
  start(swap: () => void, opts: TransitionOptions = {}): boolean {
    if (this.phase !== 'idle') return false;
    this.style = opts.style ?? 'fade';
    this.duration = Math.max(0.05, opts.duration ?? 0.28);
    this.colorValue = opts.color ?? 0x0a1020;
    this.onSwap = swap;
    this.phase = 'covering';
    this.t = 0;
    return true;
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.t += dt;

    if (this.phase === 'covering' && this.t >= this.duration) {
      this.phase = 'swapping';
      // Run the swap inside a guard: a scene that throws while entering must
      // not leave the screen covered in black forever.
      try {
        this.onSwap?.();
      } finally {
        this.onSwap = null;
        this.phase = 'revealing';
        this.t = 0;
      }
      return;
    }

    if (this.phase === 'revealing' && this.t >= this.duration) {
      this.phase = 'idle';
      this.t = 0;
    }
  }

  /** True while anything is on screen, so input can be locked out. */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  get color(): number {
    return this.colorValue;
  }

  get currentStyle(): TransitionStyle {
    return this.style;
  }

  /** How covered the screen is: 0 clear, 1 fully hidden. */
  get cover(): number {
    if (this.phase === 'idle') return 0;
    if (this.phase === 'swapping') return 1;
    const k = clamp01(this.t / this.duration);
    // Ease so the cover arrives quickly and the reveal lingers, which reads
    // as arriving somewhere rather than as a symmetrical wipe.
    return this.phase === 'covering' ? k * k : 1 - k * (2 - k);
  }
}
