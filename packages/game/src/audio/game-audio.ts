import { Ambience, AudioBus, Sfx } from '@stackmon/engine';

/**
 * The game's sound, assembled and wired to the page.
 *
 * Two halves. The samples are Kenney's CC0 interface set, eight of them,
 * eighty kilobytes in total - a click, a confirm, a refusal and so on. The
 * music is not a file at all: `Ambience` synthesises wind, a stream, birds
 * and a slow pentatonic drift, which is why there is no soundtrack in the
 * repository and why it never loops.
 *
 * This module installs its own listeners rather than asking the scene to
 * call it. A pointer-down anywhere is a click, and every panel in the game
 * already reacts to pointer-down, so routing the sound through the interface
 * code would mean touching every widget to say the same thing once.
 */

/** Where each sample lives, relative to the site root. */
const SOURCES: Record<string, string> = {
  click: '/audio/ui-click.ogg',
  hover: '/audio/ui-hover.ogg',
  confirm: '/audio/ui-confirm.ogg',
  deny: '/audio/ui-deny.ogg',
  back: '/audio/ui-back.ogg',
  open: '/audio/ui-open.ogg',
  place: '/audio/ui-place.ogg',
  reward: '/audio/ui-reward.ogg',
};

const STORAGE_KEY = 'stackmon.audio.v1';

/** Keys that open or close a panel, and so deserve a sound. */
const OVERLAY_KEYS = new Set(['b', 'g', 'h', 'j', 'c']);

interface StoredSettings {
  muted: boolean;
  master: number;
  music: number;
  sfx: number;
}

function readSettings(): Partial<StoredSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<StoredSettings>) : {};
  } catch {
    // Private windows and blocked storage both land here. Defaults are fine.
    return {};
  }
}

export class GameAudio {
  readonly bus: AudioBus;
  readonly sfx: Sfx;
  readonly ambience: Ambience;

  private constructor() {
    const saved = readSettings();
    this.bus = new AudioBus({
      master: saved.master ?? 0.7,
      music: saved.music ?? 0.4,
      sfx: saved.sfx ?? 0.75,
    });
    if (saved.muted) this.bus.setMuted(true);

    this.sfx = new Sfx(this.bus);
    // Sparse on purpose. This plays under a game people leave open, so the
    // brief was music to think over rather than music to listen to.
    this.ambience = new Ambience(this.bus, { birdEvery: 10, noteEvery: 5 });
  }

  /**
   * Build the audio, load the samples, and start listening.
   *
   * Safe to call before any user gesture: the context will be suspended, the
   * bus will hold the ambience back until the first click resumes it, and
   * `Sfx.play` drops anything asked for in the meantime.
   */
  static start(): GameAudio {
    if (current) return current;
    const audio = new GameAudio();
    current = audio;

    void audio.sfx.load(SOURCES).then(() => audio.ambience.start());
    audio.install();
    return audio;
  }

  private install(): void {
    // The click. Quiet, slightly detuned each time, and throttled, so
    // dragging the camera does not turn into a woodpecker.
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.sfx.play('click', { gain: 0.5, variance: 0.09, throttleMs: 70 });
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'm' || e.key === 'M') {
        this.setMuted(!this.bus.isMuted);
        return;
      }
      // Only the keys that put something on screen. WASD is held down to pan
      // the camera, and a tick per direction turns walking into morse code.
      if (OVERLAY_KEYS.has(e.key.toLowerCase()) || e.key === 'Escape') {
        this.sfx.play('open', { gain: 0.32, variance: 0.06, throttleMs: 90 });
      }
    });
  }

  play(name: string, gain = 1): void {
    this.sfx.play(name, { gain });
  }

  setMuted(muted: boolean): void {
    this.bus.setMuted(muted);
    this.save();
  }

  setLevel(which: 'master' | 'music' | 'sfx', v: number): void {
    this.bus.setLevel(which, v);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        muted: this.bus.isMuted,
        master: this.bus.getLevel('master'),
        music: this.bus.getLevel('music'),
        sfx: this.bus.getLevel('sfx'),
      } satisfies StoredSettings));
    } catch {
      // Not being able to remember the volume is not worth a crash.
    }
  }
}

let current: GameAudio | null = null;

/**
 * The running audio, or null before `GameAudio.start()`.
 *
 * Same reasoning as `propAtlas()`: there is one of these per page, the HUD
 * wants to make a noise when a card is clicked, and threading it through
 * every draw signature to get there is worse than saying so.
 */
export function gameAudio(): GameAudio | null {
  return current;
}

/** Play a sound if audio is up. The common case, so it gets a short name. */
export function playSfx(name: string, gain = 1): void {
  current?.play(name, gain);
}
