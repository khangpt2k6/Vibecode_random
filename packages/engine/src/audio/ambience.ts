import { makeNoise, makeReverb, type AudioBus } from './bus.js';

/**
 * Generative outdoor ambience: wind, a stream, birds, and a slow pentatonic
 * drift of pads and plucks over the top.
 *
 * Synthesised rather than streamed, and that is the whole design decision.
 * A downloaded ambience loop is a few megabytes, has a licence attached, and
 * gives itself away the moment the player notices the same bird twice - which
 * on a base-builder people leave open for an hour is about four minutes in.
 * This never repeats, weighs nothing, and starts instantly.
 *
 * It is deliberately quiet and deliberately sparse. The brief was music to
 * think over, not music to listen to: a note every few seconds, a chord that
 * takes fifteen to turn over, and birds that are events rather than a texture.
 *
 * Everything is scheduled with plain timers rather than a lookahead clock.
 * Ambient events are seconds apart and none of them lands on a beat, so the
 * handful of milliseconds a timer drifts by is inaudible, and the alternative
 * is a scheduler running forever to place a note every four seconds.
 */

export interface AmbienceOptions {
  /** Average seconds between bird calls. */
  birdEvery?: number;
  /** Average seconds between plucked notes. */
  noteEvery?: number;
  /** 0 silences the musical layer and leaves only wind, water and birds. */
  musicLevel?: number;
  /** 0 silences wind and water. */
  natureLevel?: number;
}

/**
 * D major pentatonic, as semitone offsets from the root.
 *
 * Pentatonic because there is no interval in it that can sound wrong against
 * any other, which is exactly what a generative layer needs: notes are picked
 * at random and the scale has to guarantee the result.
 */
const SCALE = [0, 2, 4, 7, 9];
const ROOT_MIDI = 62; // D4

/**
 * Four chords that all share notes with the scale above, so a pad can change
 * underneath a held pluck without either having to know about the other.
 */
const CHORDS: number[][] = [
  [62, 66, 69], // D  F# A
  [59, 62, 66], // B  D  F#
  [55, 59, 62], // G  B  D
  [57, 62, 64], // A  D  E
];

const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export class Ambience {
  private readonly opts: Required<AmbienceOptions>;
  private running = false;
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly sources: AudioScheduledSourceNode[] = [];

  /** Musical voices share a reverb send; wind and water stay dry. */
  private wet!: GainNode;
  private musicGain!: GainNode;
  private natureGain!: GainNode;
  private chordIndex = 0;

  constructor(private readonly bus: AudioBus, opts: AmbienceOptions = {}) {
    this.opts = {
      birdEvery: opts.birdEvery ?? 9,
      noteEvery: opts.noteEvery ?? 4.5,
      musicLevel: opts.musicLevel ?? 1,
      natureLevel: opts.natureLevel ?? 1,
    };
  }

  /**
   * Build the graph and start every voice.
   *
   * Deferred until the bus is live, because a suspended context has a frozen
   * clock and every scheduled note would land on the same instant when it
   * finally started.
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
      this.queueNote();
      this.queueChord();
    });
  }

  stop(): void {
    this.running = false;
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

    const reverb = makeReverb(ctx, 2.6, 2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.wet.connect(reverb);
    reverb.connect(this.musicGain);
  }

  private track(node: AudioScheduledSourceNode): void {
    this.sources.push(node);
  }

  private after(seconds: number, fn: () => void): void {
    const t = setTimeout(() => {
      if (this.running) fn();
    }, seconds * 1000);
    this.timers.push(t);
  }

  // ------------------------------------------------------------ nature bed

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
    gain.gain.value = 0.16;

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
    breatheAmount.gain.value = 0.06;
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
    gain.gain.value = 0.05;

    src.connect(filter).connect(gain).connect(this.natureGain);
    src.start();
    shimmer.start();
    this.track(src);
    this.track(shimmer);
  }

  // ---------------------------------------------------------------- birds

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
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);

      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;

      osc.connect(gain).connect(panner);
      panner.connect(this.natureGain);
      // A touch of the same room the music is in, so they share a space.
      panner.connect(this.wet);
      osc.start(t);
      osc.stop(t + 0.14);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        panner.disconnect();
      };
    }
  }

  // ---------------------------------------------------------------- music

  private queueNote(): void {
    const spread = this.opts.noteEvery * 0.8;
    this.after(this.opts.noteEvery - spread / 2 + Math.random() * spread, () => {
      this.pluck();
      // Sometimes a second note follows close behind, which is the difference
      // between a sequence of notes and something that sounds played.
      if (Math.random() < 0.35) this.after(0.28 + Math.random() * 0.35, () => this.pluck());
      this.queueNote();
    });
  }

  private pluck(): void {
    const ctx = this.bus.ctx;
    const octave = Math.random() < 0.35 ? 12 : Math.random() < 0.5 ? 0 : -12;
    const midi = ROOT_MIDI + octave + SCALE[Math.floor(Math.random() * SCALE.length)]!;
    const t = this.bus.now + 0.02;
    const decay = 1.6 + Math.random() * 1.6;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + decay);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.075, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    const panner = ctx.createStereoPanner();
    panner.pan.value = (Math.random() * 2 - 1) * 0.55;

    osc.connect(filter).connect(gain).connect(panner);
    panner.connect(this.musicGain);
    panner.connect(this.wet);
    osc.start(t);
    osc.stop(t + decay + 0.1);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
  }

  private queueChord(): void {
    this.chord();
    this.after(15 + Math.random() * 6, () => this.queueChord());
  }

  /** A soft held chord. Long enough that the change is felt, not heard. */
  private chord(): void {
    const ctx = this.bus.ctx;
    // Usually step to the next chord, occasionally jump, so the progression
    // has a shape without ever becoming a loop you can count along to.
    this.chordIndex = Math.random() < 0.75
      ? (this.chordIndex + 1) % CHORDS.length
      : Math.floor(Math.random() * CHORDS.length);
    const notes = CHORDS[this.chordIndex]!;

    const t = this.bus.now + 0.05;
    const attack = 3.4;
    const hold = 7;
    const release = 6;

    for (const midi of notes) {
      // Two oscillators a few cents apart. The slow beating between them is
      // what stops a sine pad sounding like a test tone.
      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = midiToHz(midi - 12);
        osc.detune.value = detune;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.035, t + attack);
        gain.gain.setValueAtTime(0.035, t + attack + hold);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 820;

        osc.connect(filter).connect(gain);
        gain.connect(this.musicGain);
        gain.connect(this.wet);
        osc.start(t);
        osc.stop(t + attack + hold + release + 0.2);
        osc.onended = () => {
          osc.disconnect();
          filter.disconnect();
          gain.disconnect();
        };
      }
    }
  }
}
