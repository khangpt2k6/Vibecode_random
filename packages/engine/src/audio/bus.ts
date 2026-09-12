/**
 * The audio graph everything else hangs off.
 *
 * One AudioContext, three gain stages - master, music, effects - so volume
 * is a property of the mix rather than something every caller multiplies in
 * by hand.
 *
 * The awkward part of web audio is that a context created before the player
 * has touched the page starts suspended, and stays suspended until a real
 * user gesture resumes it. Worse, a suspended context's clock does not
 * advance, so anything that schedules itself relative to `currentTime` will
 * pile every event it queued onto the same instant when the context finally
 * starts. So the bus owns the unlock: it listens for the first gesture,
 * resumes, and only then runs whatever was waiting on it.
 */

export interface AudioBusOptions {
  master?: number;
  music?: number;
  sfx?: number;
}

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

export class AudioBus {
  readonly ctx: AudioContext;
  /** Everything ends up here. Muting is a gain of zero on this node. */
  readonly master: GainNode;
  /** Ambience and generative music. */
  readonly music: GainNode;
  /** One-shot interface and world sounds. */
  readonly sfx: GainNode;

  private ready = false;
  private readonly waiting: Array<() => void> = [];
  private levels: { master: number; music: number; sfx: number };
  private muted = false;

  constructor(opts: AudioBusOptions = {}) {
    this.levels = {
      master: opts.master ?? 0.75,
      music: opts.music ?? 0.45,
      sfx: opts.sfx ?? 0.7,
    };

    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.master.gain.value = this.levels.master;
    this.music.gain.value = this.levels.music;
    this.sfx.gain.value = this.levels.sfx;
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.master.connect(this.ctx.destination);

    if (this.ctx.state === 'running') {
      this.ready = true;
    } else {
      this.listenForGesture();
    }
  }

  private listenForGesture(): void {
    const unlock = (): void => {
      void this.ctx.resume().then(() => {
        if (this.ready) return;
        this.ready = true;
        for (const fn of this.waiting.splice(0)) fn();
      });
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock);
    };
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, unlock, { passive: true });
    }
  }

  /** True once a gesture has resumed the context and the clock is running. */
  get running(): boolean {
    return this.ready && this.ctx.state === 'running';
  }

  /**
   * Run `fn` now if audio is live, otherwise the moment it becomes live.
   *
   * Anything that schedules itself into the future has to go through this or
   * it will queue a minute of events against a clock that is not moving.
   */
  whenReady(fn: () => void): void {
    if (this.running) fn();
    else this.waiting.push(fn);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setLevel(which: 'master' | 'music' | 'sfx', value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.levels[which] = v;
    if (which === 'master' && this.muted) return;
    this[which].gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  getLevel(which: 'master' | 'music' | 'sfx'): number {
    return this.levels[which];
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.master.gain.setTargetAtTime(muted ? 0 : this.levels.master, this.ctx.currentTime, 0.04);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  dispose(): void {
    void this.ctx.close();
  }
}

/**
 * A short synthetic room, so the music has somewhere to be.
 *
 * Exponentially decaying noise is not a real space, but at these levels the
 * ear only asks for "not completely dry" and this is a few lines against a
 * hundred kilobytes of impulse response.
 */
export function makeReverb(ctx: BaseAudioContext, seconds = 2.4, decay = 2.6): ConvolverNode {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = buffer;
  return convolver;
}

/** A loopable buffer of noise, the raw material for wind and water. */
export function makeNoise(ctx: BaseAudioContext, seconds = 3): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Pink-ish rather than white: white noise reads as radio static, and the
  // low tilt is what makes it sound like moving air instead.
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099;
    b1 = 0.963 * b1 + white * 0.2965;
    b2 = 0.57 * b2 + white * 1.0526;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
  }
  return buffer;
}
