import { makeNoise, makeReverb, type AudioBus } from './bus.js';

/**
 * The soundtrack: a generative piece that plays for as long as the game is
 * open and never repeats, over a bed of wind, water and birdsong.
 *
 * Synthesised rather than streamed, and that is the whole design decision.
 * A downloaded loop is megabytes, carries a licence, and gives itself away
 * the moment the player hears the same phrase twice - which on a base builder
 * people leave open for an hour is about four minutes in. This weighs
 * nothing, starts instantly, and cannot repeat.
 *
 * The music runs on a real clock at a slow tempo. An earlier version placed
 * notes at random intervals and the result read as atmosphere rather than as
 * music: without a pulse the ear files it under "wind" and stops hearing it.
 * So there is a bar, chords land on it, an arpeggio marks the beat, and a
 * melody plays actual phrases across it. Everything is still chosen at random
 * within a pentatonic scale, where no two notes can clash, so it composes
 * itself without ever needing to be right.
 *
 * Scheduling is the standard web-audio lookahead: a timer wakes up often,
 * looks a fraction of a second into the future, and books everything due in
 * that window against the audio clock. Timers alone drift audibly once
 * anything lands on a beat.
 */

export interface AmbienceOptions {
  /** Average seconds between bird calls. */
  birdEvery?: number;
  /** 0 silences the musical layer and leaves only wind, water and birds. */
  musicLevel?: number;
  /** 0 silences wind and water. */
  natureLevel?: number;
  /** Beats per minute. Slow: this plays under thinking, not over it. */
  bpm?: number;
}

/**
 * D major pentatonic, as semitone offsets from the root.
 *
 * Pentatonic because it contains no interval that can sound wrong against
 * any other, which is exactly what a generative layer needs: the notes are
 * picked at random and the scale has to guarantee the result.
 */
const SCALE = [0, 2, 4, 7, 9];
const ROOT_MIDI = 62; // D4

/** Chord, and the bass note under it. All share tones with the scale. */
const PROGRESSION: Array<{ notes: number[]; bass: number }> = [
  { notes: [62, 66, 69], bass: 38 }, // D  F# A
  { notes: [57, 61, 64], bass: 33 }, // A  C# E
  { notes: [59, 62, 66], bass: 35 }, // B  D  F#
  { notes: [55, 59, 62], bass: 31 }, // G  B  D
];

/** Sixteenths in two bars of four. One chord lasts exactly this long. */
const STEPS_PER_CHORD = 32;
/** How far ahead the scheduler books, and how often it wakes, in seconds. */
const LOOKAHEAD = 0.3;
const TICK_MS = 60;

const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export class Ambience {
  private readonly opts: Required<AmbienceOptions>;
  private running = false;
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly sources: AudioScheduledSourceNode[] = [];

  /** Musical voices share a reverb send; wind and water stay dry. */
  private wet!: GainNode;
  private musicGain!: GainNode;
  private natureGain!: GainNode;

  /** Position in the piece, counted in sixteenth notes since it started. */
  private step = 0;
  private nextStepTime = 0;
  private chordIndex = 0;
  /** Melody notes already booked, as [audio time, midi] pairs. */
  private phrase: Array<[number, number]> = [];

  constructor(private readonly bus: AudioBus, opts: AmbienceOptions = {}) {
    this.opts = {
      birdEvery: opts.birdEvery ?? 9,
      musicLevel: opts.musicLevel ?? 1,
      natureLevel: opts.natureLevel ?? 1,
      bpm: opts.bpm ?? 68,
    };
  }

  private get sixteenth(): number {
    return 60 / this.opts.bpm / 4;
  }

  /**
   * Build the graph and start playing.
   *
   * Deferred until the bus is live, because a suspended context has a frozen
   * clock: every note the scheduler booked would land on the same instant
   * the moment it resumed.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.bus.whenReady(() => {
      if (!this.running) return;
      this.build();
      this.startWind();
      this.startStream();
      this.queueBird();

      this.step = 0;
      this.nextStepTime = this.bus.now + 0.2;
      this.ticker = setInterval(() => this.tick(), TICK_MS);
    });
  }

  stop(): void {
    this.running = false;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    for (const t of this.timers.splice(0)) clearTimeout(t);
    for (const s of this.sources.splice(0)) {
      try {
        s.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      s.disconnect();
    }
    this.musicGain?.disconnect();
    this.natureGain?.disconnect();
    this.wet?.disconnect();
  }

  setMusicLevel(v: number): void {
    this.opts.musicLevel = Math.max(0, Math.min(1, v));
    this.musicGain?.gain.setTargetAtTime(this.opts.musicLevel, this.bus.now, 0.5);
  }

  setNatureLevel(v: number): void {
    this.opts.natureLevel = Math.max(0, Math.min(1, v));
    this.natureGain?.gain.setTargetAtTime(this.opts.natureLevel, this.bus.now, 0.5);
  }

  private build(): void {
    const ctx = this.bus.ctx;

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.opts.musicLevel;
    this.musicGain.connect(this.bus.music);

    this.natureGain = ctx.createGain();
    this.natureGain.gain.value = this.opts.natureLevel;
    this.natureGain.connect(this.bus.music);

    const reverb = makeReverb(ctx, 2.8, 2.3);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(reverb);
    reverb.connect(this.musicGain);
  }

  // ------------------------------------------------------------- the clock

  /** Book everything falling inside the lookahead window. */
  private tick(): void {
    if (!this.running) return;
    const until = this.bus.now + LOOKAHEAD;
    while (this.nextStepTime < until) {
      this.onStep(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.sixteenth;
    }
  }

  private onStep(step: number, t: number): void {
    const inChord = step % STEPS_PER_CHORD;

    if (inChord === 0) {
      // Usually walk the progression, occasionally jump, so it has a shape
      // without becoming a loop anyone can count along to.
      this.chordIndex = Math.random() < 0.78
        ? (this.chordIndex + 1) % PROGRESSION.length
        : Math.floor(Math.random() * PROGRESSION.length);
      this.pad(t);
      this.bass(t);
      this.phrase = [];
    }

    // The pulse. Quarter notes always, with an off-beat sometimes, which is
    // the difference between a metronome and something being played.
    if (inChord % 4 === 0 || (inChord % 2 === 0 && Math.random() < 0.3)) {
      this.arp(t, step);
    }

    // A phrase in the second half of most chords, so there is space between.
    if (inChord === 10 && Math.random() < 0.62) this.buildPhrase(t);

    for (const [at, midi] of this.phrase) {
      if (at >= t && at < t + this.sixteenth) this.lead(at, midi);
    }
  }

  // ---------------------------------------------------------------- voices

  /** A soft held chord, one octave down, under everything else. */
  private pad(t: number): void {
    const ctx = this.bus.ctx;
    const bars = this.sixteenth * STEPS_PER_CHORD;
    const attack = bars * 0.28;
    const release = bars * 0.5;

    for (const midi of PROGRESSION[this.chordIndex]!.notes) {
      // Two oscillators a few cents apart. The slow beating between them is
      // what stops a sine pad sounding like a test tone.
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = midiToHz(midi - 12);
        osc.detune.value = detune;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.05, t + attack);
        gain.gain.setValueAtTime(0.05, t + bars - release);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + bars);

        osc.connect(filter).connect(gain);
        gain.connect(this.musicGain);
        gain.connect(this.wet);
        this.play(osc, gain, t, t + bars + 0.1, filter);
      }
    }
  }

  /** The root, two octaves down. Gives the chord a floor to stand on. */
  private bass(t: number): void {
    const ctx = this.bus.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(PROGRESSION[this.chordIndex]!.bass);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);

    osc.connect(filter).connect(gain);
    gain.connect(this.musicGain);
    this.play(osc, gain, t, t + 3.4, filter);
  }

  /**
   * The pulse: one short note from the current chord, walking up and down.
   *
   * Panned by position in the bar rather than at random, so the figure moves
   * across the stereo field instead of jittering about in it.
   */
  private arp(t: number, step: number): void {
    const ctx = this.bus.ctx;
    const chord = PROGRESSION[this.chordIndex]!.notes;
    const index = Math.floor(step / 2) % (chord.length * 2);
    const up = index < chord.length;
    const midi = chord[up ? index : chord.length * 2 - 1 - index]! + (up ? 0 : 12);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, t);
    filter.frequency.exponentialRampToValueAtTime(800, t + 0.9);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.042, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.sin((step / 8) * Math.PI) * 0.45;

    osc.connect(filter).connect(gain).connect(panner);
    panner.connect(this.musicGain);
    panner.connect(this.wet);
    this.play(osc, gain, t, t + 1.0, filter, panner);
  }

  /**
   * Compose a short phrase over the current chord.
   *
   * A walk rather than a scatter: the melody steps to a neighbouring degree
   * most of the time and leaps occasionally, which is roughly what a person
   * humming does and is why it sounds intentional.
   */
  private buildPhrase(t: number): void {
    const length = 3 + Math.floor(Math.random() * 3);
    let degree = Math.floor(Math.random() * SCALE.length);
    let at = t;
    this.phrase = [];

    for (let i = 0; i < length; i++) {
      const octave = Math.random() < 0.25 ? 12 : 0;
      this.phrase.push([at, ROOT_MIDI + octave + SCALE[degree]!]);
      // Two or three sixteenths apart, so the rhythm is uneven.
      at += this.sixteenth * (Math.random() < 0.55 ? 2 : 3);
      degree = Math.max(0, Math.min(SCALE.length - 1,
        degree + (Math.random() < 0.72 ? (Math.random() < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2))));
    }
  }

  /** One melody note: a bell, with a quiet octave above for sparkle. */
  private lead(t: number, midi: number): void {
    const ctx = this.bus.ctx;
    const decay = 1.5;

    for (const [offset, level, type] of [[0, 0.085, 'triangle'], [12, 0.022, 'sine']] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToHz(midi + offset);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3200;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

      osc.connect(filter).connect(gain);
      gain.connect(this.musicGain);
      gain.connect(this.wet);
      this.play(osc, gain, t, t + decay + 0.1, filter);
    }
  }

  /** Start a voice and make sure every node it used is released after. */
  private play(
    osc: OscillatorNode, gain: GainNode, start: number, stop: number, ...rest: AudioNode[]
  ): void {
    osc.start(start);
    osc.stop(stop);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      for (const node of rest) node.disconnect();
    };
  }

  // ------------------------------------------------------------ nature bed

  private track(node: AudioScheduledSourceNode): void {
    this.sources.push(node);
  }

  private after(seconds: number, fn: () => void): void {
    const t = setTimeout(() => {
      if (this.running) fn();
    }, seconds * 1000);
    this.timers.push(t);
  }

  /** Moving air: pink noise under a lowpass whose corner wanders. */
  private startWind(): void {
    const ctx = this.bus.ctx;
    const src = ctx.createBufferSource();
    src.buffer = makeNoise(ctx, 4);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0.14;

    // Two slow oscillators at unrelated rates, so the gusting never lines up
    // into a pattern the ear can latch onto.
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.043;
    const sweepAmount = ctx.createGain();
    sweepAmount.gain.value = 170;
    sweep.connect(sweepAmount).connect(filter.frequency);

    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.071;
    const breatheAmount = ctx.createGain();
    breatheAmount.gain.value = 0.05;
    breathe.connect(breatheAmount).connect(gain.gain);

    src.connect(filter).connect(gain).connect(this.natureGain);
    src.start();
    sweep.start();
    breathe.start();
    this.track(src);
    this.track(sweep);
    this.track(breathe);
  }

  /** Water somewhere off to one side. Narrow band, high, and very quiet. */
  private startStream(): void {
    const ctx = this.bus.ctx;
    const src = ctx.createBufferSource();
    src.buffer = makeNoise(ctx, 3);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1050;
    filter.Q.value = 1.4;

    const shimmer = ctx.createOscillator();
    shimmer.frequency.value = 0.19;
    const shimmerAmount = ctx.createGain();
    shimmerAmount.gain.value = 260;
    shimmer.connect(shimmerAmount).connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.value = 0.045;

    src.connect(filter).connect(gain).connect(this.natureGain);
    src.start();
    shimmer.start();
    this.track(src);
    this.track(shimmer);
  }

  private queueBird(): void {
    const spread = this.opts.birdEvery * 0.7;
    this.after(this.opts.birdEvery - spread / 2 + Math.random() * spread, () => {
      this.bird();
      this.queueBird();
    });
  }

  /**
   * One bird call: a short run of chirps at one bird's pitch.
   *
   * A chirp is a fast frequency sweep up and back rather than a steady tone -
   * that glide is most of what makes it read as a bird instead of a beep.
   */
  private bird(): void {
    const ctx = this.bus.ctx;
    const base = 1900 + Math.random() * 1700;
    const chirps = 2 + Math.floor(Math.random() * 4);
    const pan = (Math.random() * 2 - 1) * 0.8;
    // Whether this individual's call rises or falls across its chirps.
    const drift = Math.random() < 0.5 ? 1.04 : 0.97;

    for (let i = 0; i < chirps; i++) {
      const t = this.bus.now + 0.12 + i * (0.07 + Math.random() * 0.09);
      const f = base * Math.pow(drift, i);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 0.82, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, t + 0.022);
      osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.07);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.085, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);

      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;

      osc.connect(gain).connect(panner);
      panner.connect(this.natureGain);
      // A touch of the same room the music is in, so they share a space.
      panner.connect(this.wet);
      this.play(osc, gain, t, t + 0.14, panner);
    }
  }
}
