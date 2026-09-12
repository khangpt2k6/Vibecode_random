/**
 * Fixed-timestep game loop with render interpolation.
 *
 * Simulation runs at a fixed rate so game logic is deterministic and never
 * depends on how fast the machine is. Rendering runs as fast as the display
 * allows and interpolates between the last two simulation states, so a 60 Hz
 * sim still looks smooth on a 144 Hz monitor.
 *
 * The accumulator is clamped: after a tab has been backgrounded for a minute,
 * we do not want to run 3600 catch-up ticks and lock the page. Time is simply
 * lost, which for a single-player game is the right trade.
 */

export interface LoopCallbacks {
  /** Fixed-rate simulation. `dt` is always exactly the configured step. */
  update: (dt: number) => void;
  /**
   * Render. `alpha` in [0, 1] is how far between the previous and current
   * simulation state this frame falls - use it to interpolate positions.
   * `frameDt` is real elapsed time, for effects that should not be quantised.
   */
  render: (alpha: number, frameDt: number) => void;
}

export interface LoopOptions {
  /** Simulation ticks per second. */
  hz?: number;
  /** Hard cap on catch-up ticks per frame, to stay responsive after a stall. */
  maxCatchUpTicks?: number;
}

export interface LoopStats {
  fps: number;
  ups: number;
  frameMs: number;
  updateMs: number;
  renderMs: number;
  /** Ticks dropped because the accumulator was clamped. */
  droppedTicks: number;
}

export class GameLoop {
  private readonly step: number;
  private readonly maxCatchUpTicks: number;
  private accumulator = 0;
  private lastTime = 0;
  private rafId: number | null = null;
  private running = false;

  // rolling stats
  private frameCount = 0;
  private updateCount = 0;
  private statsTimer = 0;
  private readonly stats: LoopStats = {
    fps: 0,
    ups: 0,
    frameMs: 0,
    updateMs: 0,
    renderMs: 0,
    droppedTicks: 0,
  };

  constructor(
    private readonly cb: LoopCallbacks,
    opts: LoopOptions = {},
  ) {
    const hz = opts.hz ?? 60;
    this.step = 1 / hz;
    this.maxCatchUpTicks = opts.maxCatchUpTicks ?? 5;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  getStats(): Readonly<LoopStats> {
    return this.stats;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const frameStart = now;
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // A frame this long means a stall or a backgrounded tab, not slow code.
    if (frameDt > 0.25) frameDt = 0.25;

    this.accumulator += frameDt;

    const updateStart = performance.now();
    let ticks = 0;
    while (this.accumulator >= this.step) {
      if (ticks >= this.maxCatchUpTicks) {
        const dropped = Math.floor(this.accumulator / this.step);
        this.stats.droppedTicks += dropped;
        this.accumulator = 0;
        break;
      }
      this.cb.update(this.step);
      this.accumulator -= this.step;
      ticks++;
      this.updateCount++;
    }
    const updateEnd = performance.now();

    const alpha = this.accumulator / this.step;
    this.cb.render(alpha, frameDt);
    const renderEnd = performance.now();

    this.frameCount++;
    this.stats.updateMs = updateEnd - updateStart;
    this.stats.renderMs = renderEnd - updateEnd;
    this.stats.frameMs = renderEnd - frameStart;

    this.statsTimer += frameDt;
    if (this.statsTimer >= 0.5) {
      this.stats.fps = this.frameCount / this.statsTimer;
      this.stats.ups = this.updateCount / this.statsTimer;
      this.frameCount = 0;
      this.updateCount = 0;
      this.statsTimer = 0;
    }
  };
}

/**
 * Headless loop driver for tests and for the balance simulator.
 *
 * Same fixed step, no requestAnimationFrame, no render. Lets the whole
 * simulation run in Node at whatever speed the CPU manages.
 */
export function runHeadless(
  update: (dt: number) => void,
  seconds: number,
  hz = 60,
): number {
  const step = 1 / hz;
  const ticks = Math.round(seconds / step);
  for (let i = 0; i < ticks; i++) update(step);
  return ticks;
}
