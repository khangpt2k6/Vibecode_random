import type { AudioBus } from './bus.js';

/**
 * One-shot sounds.
 *
 * Small enough to keep every sample decoded in memory - the whole interface
 * set is under a hundred kilobytes - so playing one is allocating a source
 * node and starting it, with no I/O on the click path.
 *
 * Two details separate this from `new Audio().play()`. Every playback gets a
 * little random detune, because a UI sound repeated at exactly the same pitch
 * twenty times a minute starts to sound like a fault. And identical sounds
 * are refused if they arrive within a few milliseconds of each other, which
 * is what stops a hover that crosses two widgets from firing twice and
 * doubling in volume.
 */

export interface PlayOptions {
  /** 0..1, multiplied into the effects bus. */
  gain?: number;
  /** Playback rate. 1 is the recorded pitch. */
  rate?: number;
  /** How much random detune to add, as a fraction of the rate. */
  variance?: number;
  /** -1 left, 1 right. */
  pan?: number;
  /** Refuse a repeat of this sound within this many milliseconds. */
  throttleMs?: number;
}

const DEFAULT_THROTTLE_MS = 45;

export class Sfx {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<string, number>();

  constructor(private readonly bus: AudioBus) {}

  /**
   * Fetch and decode a set of named samples.
   *
   * Failures are logged and skipped rather than thrown: a missing click is
   * not a reason to take the game down, and `play` on an unknown name is
   * already a no-op.
   */
  async load(sources: Record<string, string>): Promise<void> {
    await Promise.all(Object.entries(sources).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        this.buffers.set(name, await this.bus.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (err) {
        console.warn(`Sfx: could not load ${name} from ${url}`, err);
      }
    }));
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  play(name: string, opts: PlayOptions = {}): void {
    const buffer = this.buffers.get(name);
    // Before the first gesture there is no audible output and no clock, so
    // playing would either be silent or stack up. Dropping is correct.
    if (!buffer || !this.bus.running) return;

    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < (opts.throttleMs ?? DEFAULT_THROTTLE_MS)) return;
    this.lastPlayed.set(name, now);

    const ctx = this.bus.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const variance = opts.variance ?? 0.06;
    source.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * variance);

    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 1;

    let tail: AudioNode = gain;
    if (opts.pan !== undefined && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(panner);
      tail = panner;
    }

    source.connect(gain);
    tail.connect(this.bus.sfx);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (tail !== gain) tail.disconnect();
    };
  }
}
