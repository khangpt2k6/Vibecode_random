import { Font, drawText, type Scene, type SceneContext } from '@stackmon/engine';
import {
  ROLE_INFO,
  getCreature,
  getIncident,
  getSkill,
  type Skill,
} from '@stackmon/content';
import { Battle, type BattleSetup, type Combatant, type LogEntry } from '@stackmon/core';
import { Rng } from '@stackmon/util';
import { PALETTE, TYPE_COLORS, mix, shade } from '../art/palette.js';
import { drawCreature } from '../art/creatures.js';
import { slab, sphere } from '../art/solids.js';
import { drawIconBadge } from '../art/icons.js';
import {
  CUT,
  SKEW,
  bar,
  button,
  hovered,
  iconButton,
  meter,
  panel,
  paragraph,
  tag,
  tooltip,
  type Rect,
  type UIContext,
} from '../ui/widgets.js';
import { GLYPHS } from '../ui/glyphs.js';
import { playSfx } from '../audio/game-audio.js';

/**
 * The battle screen.
 *
 * The rules live entirely in @stackmon/core. This scene owns three things:
 * the diorama (platforms, creatures, the incident), the controls that turn a
 * click into a `PlayerAction`, and the playback that turns the simulator's
 * log into a sequence of animations the player can follow.
 *
 * Playback is the important one. `Battle.step` resolves a whole turn at once
 * and returns every log entry it produced; showing all of that in one frame
 * would be correct and unreadable. So the entries are queued and released
 * one at a time, each triggering its own floating number, shake, or particle
 * burst, and input is locked until the queue drains. The player sees cause
 * and effect in order, which is the only way the numbers can teach anything.
 */

const PLATFORM_X = [-250, 0, 250];
const PLATFORM_Y = 46;
const INCIDENT_POS = { x: 0, y: -104 };

/**
 * How big a creature stands on its platform.
 *
 * Was 1.7, which rendered a bespoke Postgres elephant as a forty-pixel blue
 * smudge - all the modelling work was there and none of it was legible. The
 * battle is the one screen where a creature is the subject rather than set
 * dressing, so it gets the size that implies.
 */
const CREATURE_SCALE = 2.9;

/**
 * Where the camera looks. Offset right so the diorama sits left of the log
 * panel, and down so the platforms clear the action panel at the bottom.
 */
const CAMERA_AT = { x: 70, y: 46 };

type Phase = 'input' | 'animating' | 'over';

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: number;
  life: number;
  maxLife: number;
  scale: number;
}

interface Packet {
  /** 0 at ingest, 1 at store. */
  t: number;
  speed: number;
  lane: number;
  dropped: boolean;
}

export interface BattleSceneOptions {
  setup: BattleSetup;
  /** Called with the finished battle when the player leaves the screen. */
  onFinish?: (battle: Battle) => void;
}

export class BattleScene implements Scene {
  readonly name = 'battle';
  readonly renderBelow = false;

  private readonly battle: Battle;
  private readonly onFinish: ((b: Battle) => void) | undefined;
  private readonly rng = new Rng('battle-fx');

  private font!: Font;
  private fontSmall!: Font;
  private fontBig!: Font;
  private time = 0;

  private phase: Phase = 'input';
  private queue: LogEntry[] = [];
  private queueTimer = 0;
  private shown: LogEntry[] = [];

  private selectedSlot = 0;
  private swapping = false;
  private hoverSkill: Skill | null = null;
  private hoverTeach: LogEntry | null = null;

  private floats: FloatingText[] = [];
  private packets: Packet[] = [];
  private shakeTimer = 0;
  private hitFlash = new Map<string, number>();
  private incidentFlash = 0;
  private budgetGhost: number;
  private integrityGhost: number;
  /** True once the player has asked to leave and is being asked to confirm. */
  private confirmLeave = false;

  /**
   * Whether the battle is accepting orders this frame.
   *
   * Immediate-mode widgets hit-test as they draw, so a panel drawn before an
   * overlay still swallows the click that lands on the overlay. Everything
   * interactive under a modal reads this instead of `phase` directly.
   */
  private get canAct(): boolean {
    return this.phase === 'input' && !this.confirmLeave;
  }

  constructor(opts: BattleSceneOptions) {
    this.battle = new Battle(opts.setup);
    this.onFinish = opts.onFinish;
    this.budgetGhost = this.battle.state.errorBudget;
    this.integrityGhost = this.battle.state.incident.integrity;
    this.shown = [...this.battle.state.log];
  }

  enter(ctx: SceneContext): void {
    this.font = new Font(ctx.renderer.gl, { size: 14, weight: 700 });
    this.fontSmall = new Font(ctx.renderer.gl, { size: 11, weight: 600 });
    this.fontBig = new Font(ctx.renderer.gl, { size: 24, weight: 800 });

    const cam = ctx.renderer.camera;
    cam.bounds = null;
    cam.snapTo(CAMERA_AT.x, CAMERA_AT.y);
    cam.setZoom(1, true);

    // Pick the first living creature so the skill panel is never empty.
    this.selectedSlot = this.battle.state.pipeline.findIndex((p) => p.occupant && !p.occupant.downed);
    if (this.selectedSlot < 0) this.selectedSlot = 0;
  }

  exit(): void {
    this.font.dispose();
    this.fontSmall.dispose();
    this.fontBig.dispose();
    this.onFinish?.(this.battle);
  }

  // ---------------------------------------------------------------- update

  update(dt: number, ctx: SceneContext): void {
    this.time += dt;
    const cam = ctx.renderer.camera;

    if (this.shakeTimer > 0) this.shakeTimer -= dt;

    for (const f of this.floats) f.life -= dt;
    this.floats = this.floats.filter((f) => f.life > 0);

    for (const p of this.packets) p.t += p.speed * dt;
    this.packets = this.packets.filter((p) => p.t < 1.05);

    for (const [k, v] of this.hitFlash) {
      if (v - dt <= 0) this.hitFlash.delete(k);
      else this.hitFlash.set(k, v - dt);
    }
    this.incidentFlash = Math.max(0, this.incidentFlash - dt);

    // Ghost bars chase the real value so a hit shows as a red slice shrinking.
    const s = this.battle.state;
    this.budgetGhost += (s.errorBudget - this.budgetGhost) * Math.min(1, dt * 2.5);
    this.integrityGhost += (s.incident.integrity - this.integrityGhost) * Math.min(1, dt * 2.5);

    if (this.phase === 'animating') {
      this.queueTimer -= dt;
      if (this.queueTimer <= 0) this.playNext();
    }

    // Escape is the way out of everything, innermost layer first: the swap
    // list, then the leave prompt, then the battle.
    if (ctx.input.wasPressed('Escape')) {
      if (this.swapping) {
        this.swapping = false;
        playSfx('back', 0.7);
      } else if (this.confirmLeave) {
        this.confirmLeave = false;
        playSfx('back', 0.7);
      } else if (this.phase === 'over') {
        ctx.scenes.popWith({ style: 'iris', duration: 0.34 });
      } else {
        this.confirmLeave = true;
        playSfx('open', 0.8);
      }
    }

    void cam;
  }

  /** Release the next log entry and trigger whatever it implies visually. */
  private playNext(): void {
    const entry = this.queue.shift();
    if (!entry) {
      this.phase = this.battle.state.outcome === 'ongoing' ? 'input' : 'over';
      if (this.phase === 'input') {
        const cur = this.battle.state.pipeline[this.selectedSlot]?.occupant;
        if (!cur || cur.downed) {
          const next = this.battle.state.pipeline.findIndex((p) => p.occupant && !p.occupant.downed);
          if (next >= 0) this.selectedSlot = next;
        }
      }
      return;
    }

    this.shown.push(entry);
    if (this.shown.length > 60) this.shown.shift();

    let delay = 0.38;
    const s = this.battle.state;

    switch (entry.kind) {
      case 'damage': {
        if (entry.actorUid && entry.text.includes('takes')) {
          // A creature was hit.
          const slot = s.pipeline.findIndex((p) => p.occupant?.uid === entry.actorUid);
          if (slot >= 0) {
            this.hitFlash.set(entry.actorUid, 0.35);
            this.float(PLATFORM_X[slot]!, PLATFORM_Y - 90, `-${entry.amount ?? ''}`, PALETTE.danger, 1.2);
            this.shakeTimer = 0.25;
          }
        } else {
          // The incident was hit.
          this.incidentFlash = 0.3;
          const strong = entry.text.includes('CRITICAL');
          this.float(
            INCIDENT_POS.x + this.rng.range(-40, 40),
            INCIDENT_POS.y - 30,
            `${entry.amount ?? ''}`,
            strong ? PALETTE.flowerYellow : PALETTE.uiPanel,
            strong ? 1.6 : 1.25,
          );
        }
        delay = 0.42;
        break;
      }
      case 'heal': {
        const slot = s.pipeline.findIndex((p) => p.occupant?.uid === entry.actorUid);
        const x = slot >= 0 ? PLATFORM_X[slot]! : 0;
        this.float(x, PLATFORM_Y - 90, `+${entry.amount ?? ''}`, PALETTE.good, 1.2);
        break;
      }
      case 'flow': {
        // Send packets down the pipeline; how many get through is the story.
        const handled = Math.min(14, Math.round(s.totalHandled / Math.max(1, s.turn) / 18));
        for (let i = 0; i < Math.max(4, handled); i++) {
          this.packets.push({
            t: -i * 0.06,
            speed: this.rng.range(0.9, 1.25),
            lane: this.rng.range(-1, 1),
            dropped: false,
          });
        }
        delay = 0.7;
        break;
      }
      case 'drop': {
        const n = Math.min(6, Math.max(2, Math.round((entry.amount ?? 4) / 3)));
        for (let i = 0; i < n; i++) {
          this.packets.push({ t: this.rng.range(0.1, 0.8), speed: 0.4, lane: this.rng.range(-1, 1), dropped: true });
        }
        this.shakeTimer = 0.18;
        delay = 0.5;
        break;
      }
      case 'down': {
        this.shakeTimer = 0.45;
        delay = 0.7;
        break;
      }
      case 'phase':
      case 'result':
        delay = 1.1;
        break;
      case 'incident':
        this.incidentFlash = Math.max(this.incidentFlash, 0.15);
        delay = 0.55;
        break;
      case 'skill':
        delay = 0.5;
        break;
      default:
        delay = 0.3;
    }
    this.queueTimer = delay;
  }

  private float(x: number, y: number, text: string, color: number, scale = 1): void {
    this.floats.push({ x, y, text, color, life: 1.1, maxLife: 1.1, scale });
  }

  private act(action: Parameters<Battle['step']>[0]): void {
    if (this.phase !== 'input') return;
    const entries = this.battle.step(action);
    this.queue.push(...entries);
    this.phase = 'animating';
    this.queueTimer = 0.05;
    this.swapping = false;
  }

  // ---------------------------------------------------------------- render

  render(_alpha: number, ctx: SceneContext): void {
    const r = ctx.renderer;
    const shakeX = this.shakeTimer > 0 ? Math.sin(this.time * 60) * this.shakeTimer * 22 : 0;
    r.camera.snapTo(CAMERA_AT.x + shakeX, CAMERA_AT.y);

    r.beginLayer('world');
    this.renderDiorama(ctx);
    r.beginLayer('effects');
    this.renderEffects(ctx);
    r.beginLayer('ui');
    this.renderUI(ctx);
    r.endLayer();
  }

  // --------------------------------------------------------------- diorama

  private renderDiorama(ctx: SceneContext): void {
    const { shapes } = ctx.renderer;
    const s = this.battle.state;

    // Ground: a wide soft disc so the platforms sit on something.
    shapes.ellipse(0, PLATFORM_Y + 48, 520, 112, shade(PALETTE.grass, -0.14), 1, 0, 40);
    shapes.ellipse(0, PLATFORM_Y + 40, 470, 94, PALETTE.grass, 1, 0, 40);
    shapes.ellipse(0, PLATFORM_Y + 26, 380, 60, shade(PALETTE.grassLight, 0.06), 0.45, 0, 36);

    // Conveyor between platforms.
    for (let i = 0; i < 2; i++) {
      const x0 = PLATFORM_X[i]! + 70;
      const x1 = PLATFORM_X[i + 1]! - 70;
      shapes.rect(x0, PLATFORM_Y - 6, x1 - x0, 14, shade(PALETTE.path, -0.2), 1, 0);
      shapes.rect(x0, PLATFORM_Y - 6, x1 - x0, 5, PALETTE.path, 1, 0);
      // Chevrons, scrolling toward the store.
      const scroll = (this.time * 40) % 26;
      for (let cx = x0 + scroll; cx < x1 - 8; cx += 26) {
        shapes.polygon([cx, PLATFORM_Y - 3, cx + 8, PLATFORM_Y + 1, cx, PLATFORM_Y + 5], shade(PALETTE.path, -0.45), 0.8, 0);
      }
    }

    for (let i = 0; i < 3; i++) {
      const slot = s.pipeline[i]!;
      const x = PLATFORM_X[i]!;
      const c = slot.occupant;
      const roleColor = c ? TYPE_COLORS[c.type] : PALETTE.uiPanelEdge;
      const selected = i === this.selectedSlot && this.phase === 'input';

      // Platform: a wide slab, with a glowing rim when selected.
      slab(shapes, x, PLATFORM_Y + 18, 80, 14, selected ? shade(roleColor, 0.3) : PALETTE.rock);
      if (selected) {
        shapes.ring(x, PLATFORM_Y + 4, 84, 3, roleColor, 0.9, 0.8, 36);
      }

      if (c) {
        const flash = this.hitFlash.get(c.uid) ?? 0;
        const downed = c.downed;
        drawCreature(shapes, {
          creatureId: c.specId,
          type: c.type,
          x,
          y: PLATFORM_Y + 2 + (downed ? 22 : 0),
          scale: downed ? CREATURE_SCALE * 0.62 : CREATURE_SCALE,
          phase: i * 2.3,
          facing: 1,
          moving: 0,
        }, downed ? 0 : this.time);
        if (flash > 0) {
          shapes.ellipse(x, PLATFORM_Y - 64, 92, 92, PALETTE.danger, flash * 0.7, 0.6, 26);
        }
        if (downed) {
          shapes.ellipse(x, PLATFORM_Y - 44, 92, 66, PALETTE.uiShadow, 0.5, 0, 26);
        }
        if (c.shield > 0) {
          shapes.ring(
            x, PLATFORM_Y - 66, 96 + Math.sin(this.time * 3) * 3, 3.5,
            PALETTE.info, 0.65, 0.5, 32,
          );
        }
        this.drawStagePlate(ctx, i, x, c);
      } else {
        drawText(ctx.renderer.quads, this.fontSmall, 'EMPTY SLOT', x, PLATFORM_Y - 46, {
          color: PALETTE.glassInkDim,
          align: 'center',
          letterSpacing: 2,
        });
      }
    }

    this.renderIncident(ctx);
  }

  /**
   * A name and health plate floating over a fighter.
   *
   * On the stage rather than only in the panel below, because during the
   * animation phase the player is watching the creatures, and making them
   * look down at a list to find out who just got hit breaks the one moment
   * where cause and effect are visible together.
   */
  private drawStagePlate(ctx: SceneContext, slot: number, x: number, c: Combatant): void {
    const { shapes, quads } = ctx.renderer;
    const world = { x, y: PLATFORM_Y - 132 };
    const p = ctx.renderer.camera.worldToScreen(world);
    void p;

    const w = 132;
    const h = 38;
    const left = x - w / 2;
    const top = PLATFORM_Y - 150;

    shapes.slantPanel(left, top, w, h, SKEW * 0.55, CUT * 0.7, PALETTE.glass02, 0.82);
    shapes.slantRect(left + 4, top + 9, 4, h - 18, 2, 2, TYPE_COLORS[c.type], 1, 0.4);

    drawText(quads, this.fontSmall, c.name, left + 16, top + 6, {
      color: PALETTE.glassInk,
      letterSpacing: 1,
    });
    drawText(quads, this.fontSmall, `L${c.level}`, left + w - 10, top + 6, {
      color: PALETTE.glassInkDim,
      align: 'right',
      scale: 0.9,
    });

    const frac = c.hp / c.maxHp;
    const color = frac > 0.5 ? PALETTE.good : frac > 0.22 ? PALETTE.warn : PALETTE.danger;
    shapes.capsule(left + 16, top + 24, w - 30, 7, frac, color, PALETTE.uiShadow, 0.55);
    void slot;
  }

  /**
   * The incident: a dark storm of stacked spheres that churns and pulses,
   * coloured by its type so the effectiveness chart reads visually.
   */
  private renderIncident(ctx: SceneContext): void {
    const { shapes } = ctx.renderer;
    const s = this.battle.state;
    const base = mix(TYPE_COLORS[s.incident.type], PALETTE.uiShadow, 0.55);
    const health = s.incident.integrity / s.incident.maxIntegrity;
    const size = 1 + (1 - health) * 0.25 + Math.sin(this.time * 2.2) * 0.04;
    const flash = this.incidentFlash;

    for (let i = 0; i < 7; i++) {
      const a = this.time * (0.4 + i * 0.07) + i * 0.9;
      const rx = 70 * size;
      const x = INCIDENT_POS.x + Math.cos(a) * rx * (0.6 + (i % 3) * 0.2);
      const y = INCIDENT_POS.y + Math.sin(a * 1.3) * 26 * size;
      const r = (34 - i * 2.5) * size;
      const c = flash > 0 ? mix(base, PALETTE.uiPanel, flash * 2.2) : shade(base, -0.1 + (i % 2) * 0.16);
      sphere(shapes, x, y, r, c, 18);
    }
    // Eyes: an incident is a character too. Angry ones.
    const ex = INCIDENT_POS.x;
    const ey = INCIDENT_POS.y - 4;
    for (const side of [-1, 1] as const) {
      shapes.polygon(
        [ex + side * 12, ey, ex + side * 34, ey - 10, ex + side * 32, ey + 6, ex + side * 14, ey + 8],
        PALETTE.flowerYellow, 1, 1.2,
      );
      shapes.circle(ex + side * 23, ey, 4.5, PALETTE.ink, 1, 0, 8);
    }
  }

  private renderEffects(ctx: SceneContext): void {
    const { shapes } = ctx.renderer;

    for (const p of this.packets) {
      const t = Math.max(0, Math.min(1, p.t));
      const x = PLATFORM_X[0]! + (PLATFORM_X[2]! - PLATFORM_X[0]!) * t;
      const y = PLATFORM_Y - 20 + p.lane * 5 - Math.sin(t * Math.PI) * 24;
      if (p.dropped) {
        shapes.rect(x - 4, y + (p.t * 60), 8, 8, PALETTE.danger, 0.8, 1.4);
      } else {
        shapes.rect(x - 4, y - 4, 8, 8, PALETTE.waterFoam, 0.95, 1.8);
      }
    }
  }

  // -------------------------------------------------------------------- UI

  private renderUI(ctx: SceneContext): void {
    const { width, height } = ctx.renderer.ctx;
    const ui: UIContext = {
      shapes: ctx.renderer.shapes,
      quads: ctx.renderer.quads,
      input: ctx.input,
      font: this.font,
      fontSmall: this.fontSmall,
      time: this.time,
    };
    const s = this.battle.state;
    this.hoverSkill = null;
    this.hoverTeach = null;

    // World-space floats need projecting into the UI layer.
    for (const f of this.floats) {
      const k = 1 - f.life / f.maxLife;
      const sp = ctx.renderer.camera.worldToScreen({ x: f.x, y: f.y - k * 46 });
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      drawText(ui.quads, this.fontBig, f.text, sp.x, sp.y, {
        color: f.color,
        alpha,
        align: 'center',
        scale: f.scale * (1 + (1 - Math.min(1, k * 6)) * 0.5),
      });
    }

    this.renderTopBar(ui, width);
    this.renderLog(ui, width, height);
    this.renderActionPanel(ui, width, height);

    // The way out, in the corner every game puts it in, on screen from the
    // first frame. The only exit before this was the button on the result
    // card, which is no exit at all: a player who opens a fight by accident,
    // or who wants to go back and swap the party, had to lose first.
    if (this.phase !== 'over' && !this.confirmLeave) {
      if (button(ui, { x: width - 152, y: 26, w: 136, h: 40 }, 'LEAVE  (ESC)', {
        color: PALETTE.danger,
        small: true,
        icon: GLYPHS.close,
      })) {
        this.confirmLeave = true;
        playSfx('open', 0.8);
        ctx.input.consumeClick();
      }
    }

    if (this.confirmLeave && this.phase !== 'over') this.renderLeavePrompt(ui, ctx, width, height);

    if (this.phase === 'over') this.renderResult(ui, ctx, width, height);

    // Read back through explicit types: TS narrowed these to null at the top
    // of the method and cannot see that the panel renderers reassign them.
    const hoverSkill = this.hoverSkill as Skill | null;
    const hoverTeach = this.hoverTeach as LogEntry | null;
    // Nothing under the result overlay is interactive, so nothing under it
    // should explain itself either.
    if (this.phase === 'over' || this.confirmLeave) return;
    if (hoverSkill) {
      tooltip(ui, width, height, hoverSkill.name, `${hoverSkill.description}\n\n${hoverSkill.realWorld}`);
    } else if (hoverTeach?.teach) {
      tooltip(ui, width, height, 'WHY', hoverTeach.teach);
    }
    void s;
  }

  /**
   * The incident header.
   *
   * Two cards rather than one full-width band: the identity of the thing you
   * are fighting on the left, the two numbers that decide the fight on the
   * right. A single bar spanning the window made the whole screen feel like
   * a dashboard, and buried the two meters that actually matter among the
   * labels around them.
   */
  private renderTopBar(ui: UIContext, width: number): void {
    const s = this.battle.state;
    const spec = getIncident(s.incident.specId);
    const incColor = TYPE_COLORS[s.incident.type];

    // --- identity card
    const idW = 320;
    panel(ui, { x: 16, y: 14, w: idW, h: 76 });
    drawText(ui.quads, this.fontBig, s.incident.name, 40, 24, {
      color: PALETTE.glassInk,
      letterSpacing: 2,
    });
    let tx = 40;
    tx += tag(ui, tx, 56, `TIER ${spec.tier}`, incColor, true) + 6;
    tx += tag(ui, tx, 56, `TURN ${s.turn}`, PALETTE.glassInkDim, false, true) + 6;
    tag(ui, tx, 56, `LOAD ${Math.round(s.incident.load + s.incident.surge)}`, PALETTE.warn, false, true);

    // --- the two numbers that decide the fight
    const meterX = idW + 44;
    const meterW = Math.max(240, width - meterX - 16 - 336 - 14);
    panel(ui, { x: meterX - 18, y: 14, w: meterW + 36, h: 76 });
    meter(
      ui,
      { x: meterX, y: 38, w: meterW, h: 13 },
      s.incident.integrity / s.incident.maxIntegrity,
      incColor,
      'INCIDENT INTEGRITY',
      `${Math.round(s.incident.integrity)} / ${s.incident.maxIntegrity}`,
      this.integrityGhost / s.incident.maxIntegrity,
    );
    meter(
      ui,
      { x: meterX, y: 74, w: meterW, h: 11 },
      s.errorBudget / s.maxErrorBudget,
      s.errorBudget > s.maxErrorBudget * 0.35 ? PALETTE.good : PALETTE.danger,
      'ERROR BUDGET',
      `${s.errorBudget.toFixed(1)}%`,
      this.budgetGhost / s.maxErrorBudget,
    );
  }

  private renderLog(ui: UIContext, width: number, height: number): void {
    const r: Rect = { x: width - 336, y: 104, w: 320, h: height - 104 - 200 };
    panel(ui, r, undefined, 0.86);
    drawText(ui.quads, this.fontSmall, 'INCIDENT LOG', r.x + 22, r.y + 12, {
      color: PALETTE.glassInkDim,
      letterSpacing: 1.8,
    });

    const lineH = 15;
    const maxLines = Math.floor((r.h - 40) / lineH);
    const recent = this.shown.slice(-maxLines);
    let y = r.y + 34;
    for (const e of recent) {
      const color = LOG_COLORS[e.kind] ?? PALETTE.ink;
      const lines = this.fontSmall.wrap(e.text, r.w - 44, 0.95);
      const row: Rect = { x: r.x + 10, y: y - 2, w: r.w - 20, h: lines.length * lineH };
      if (e.teach) {
        ui.shapes.circle(r.x + 19, y + 6, 3, PALETTE.flowerYellow, 1, 0.6, 8);
        if (hovered(ui, row)) {
          ui.shapes.slantRect(row.x, row.y, row.w, row.h + 2, 4, 4, PALETTE.flowerYellow, 0.14, 0);
          this.hoverTeach = e;
        }
      }
      for (const line of lines) {
        drawText(ui.quads, this.fontSmall, line, r.x + 30, y, { color, scale: 0.95 });
        y += lineH;
      }
    }
  }

  private renderActionPanel(ui: UIContext, width: number, height: number): void {
    const s = this.battle.state;
    const r: Rect = { x: 16, y: height - 186, w: width - 32 - 336 - 10, h: 170 };
    panel(ui, r, undefined, 0.9);

    // Pipeline tabs: icon, name, role, health. One card per slot, with an
    // arrow between them so the row reads as a pipeline rather than a toolbar.
    let tx = r.x + 18;
    for (let i = 0; i < 3; i++) {
      const c = s.pipeline[i]!.occupant;
      const role = s.pipeline[i]!.role;
      const tabW = 176;
      const rect: Rect = { x: tx, y: r.y + 12, w: tabW, h: 52 };
      const active = i === this.selectedSlot;
      const color = c ? TYPE_COLORS[c.type] : PALETTE.glassInkDim;
      const over = hovered(ui, rect);

      ui.shapes.slantRect(
        rect.x, rect.y, rect.w, rect.h, SKEW * 0.6, CUT,
        active ? color : PALETTE.glass02, active ? 1 : over ? 0.85 : 0.62, 0,
      );
      if (active) {
        ui.shapes.slantRect(rect.x, rect.y, rect.w, rect.h * 0.4, SKEW * 0.6, CUT, shade(color, 0.3), 0.4, 0);
      }

      if (c) {
        drawIconBadge(ui.shapes, c.specId, rect.x + 30, rect.y + 26, 16, c.type);
        drawText(ui.quads, this.font, c.name, rect.x + 54, rect.y + 8, {
          color: active ? PALETTE.inkOnDark : PALETTE.glassInk,
          letterSpacing: 1,
        });
        drawText(
          ui.quads, this.fontSmall,
          `${ROLE_INFO[role].label}${c.roles.includes(role) ? '' : '  OFF-ROLE'}`,
          rect.x + 54, rect.y + 26,
          {
            color: active ? PALETTE.inkOnDark : c.roles.includes(role) ? PALETTE.glassInkDim : PALETTE.warn,
            scale: 0.84,
            letterSpacing: 1,
          },
        );
        const hpFrac = c.hp / c.maxHp;
        bar(
          ui,
          { x: rect.x + 54, y: rect.y + 40, w: tabW - 74, h: 7 },
          hpFrac,
          c.downed ? PALETTE.danger : hpFrac > 0.4 ? PALETTE.good : PALETTE.warn,
        );
        if (over && ui.input.clicked && !c.downed && this.canAct) {
          this.selectedSlot = i;
          this.swapping = false;
        }
      } else {
        drawText(ui.quads, this.fontSmall, `${ROLE_INFO[role].label}`, rect.x + 20, rect.y + 12, {
          color: PALETTE.glassInkDim,
          letterSpacing: 1.4,
        });
        drawText(ui.quads, this.fontSmall, 'EMPTY - nothing flows', rect.x + 20, rect.y + 30, {
          color: PALETTE.warn,
          scale: 0.86,
        });
        if (over && ui.input.clicked && this.canAct) {
          this.selectedSlot = i;
          this.swapping = true;
        }
      }

      if (i < 2) {
        const ax = tx + tabW + 10;
        const ay = rect.y + rect.h / 2;
        ui.shapes.polygon(
          [ax, ay - 6, ax + 9, ay, ax, ay + 6],
          PALETTE.glassInkDim, 0.7, 0,
        );
      }
      tx += tabW + 26;
    }

    const actor = s.pipeline[this.selectedSlot]?.occupant ?? null;
    const rowY = r.y + 78;

    if (this.swapping) {
      this.renderBench(ui, r, rowY);
      return;
    }

    if (!actor || actor.downed) {
      drawText(ui.quads, this.fontSmall, 'Select a component, or SWAP one in from the bench.', r.x + 20, rowY + 10, {
        color: PALETTE.glassInkDim,
      });
    } else {
      const skills = getCreature(actor.specId).skills.map(getSkill);
      const cardW = Math.min(162, (r.w - 40 - 190 - (skills.length - 1) * 10) / skills.length);
      let cx = r.x + 18;
      for (const skill of skills) {
        const rect: Rect = { x: cx, y: rowY, w: cardW, h: 80 };
        this.renderSkillCard(ui, rect, actor, skill);
        cx += cardW + 10;
      }
    }

    // Hold and swap live on the right of the row.
    const bx = r.x + r.w - 180;
    const canAct = this.canAct;
    if (button(ui, { x: bx, y: rowY, w: 160, h: 36 }, 'HOLD', {
      color: PALETTE.info, disabled: !canAct, small: true,
    })) {
      this.act({ kind: 'hold' });
    }
    if (button(ui, { x: bx, y: rowY + 44, w: 160, h: 36 }, `SWAP  (${s.bench.length})`, {
      color: PALETTE.typeInfra,
      disabled: !canAct || s.bench.length === 0,
      small: true,
    })) {
      this.swapping = true;
    }
  }

  private renderSkillCard(ui: UIContext, rect: Rect, actor: Combatant, skill: Skill): void {
    const blocked = this.battle.skillBlockedReason(actor.uid, skill.id);
    const usable = blocked === null && this.canAct;
    const color = TYPE_COLORS[skill.type];
    const over = hovered(ui, rect);

    const lift = over && usable ? 2 : 0;
    const y0 = rect.y - lift;
    const skew = SKEW * 0.6;

    ui.shapes.slantRect(rect.x, rect.y + 4, rect.w, rect.h, skew, CUT, PALETTE.uiShadow, usable ? 0.26 : 0.08, 0);
    ui.shapes.slantRect(
      rect.x, y0, rect.w, rect.h, skew, CUT,
      usable ? (over ? shade(color, -0.15) : PALETTE.glass01) : PALETTE.glass02,
      usable ? 0.95 : 0.6, 0,
    );
    // A dot of the skill's type colour in the corner, not a bar down the
    // edge. Same information, and it reads as a marker rather than a rule.
    ui.shapes.circle(rect.x + rect.w - 13, y0 + 13, 4.5, usable ? color : PALETTE.glassInkDim, 1, 0, 10);

    const lines = this.fontSmall.wrap(skill.name, rect.w - 28, 1);
    let y = y0 + 11;
    for (const line of lines.slice(0, 2)) {
      drawText(ui.quads, this.fontSmall, line, rect.x + 16, y, {
        color: usable ? PALETTE.glassInk : PALETTE.glassInkDim,
        letterSpacing: 0.6,
      });
      y += 14;
    }

    let tx = rect.x + 16;
    tx += tag(ui, tx, y0 + rect.h - 40, `MEM ${skill.cost}`, PALETTE.resMemory, false, true) + 5;
    if (skill.cooldown > 0) {
      tx += tag(ui, tx, y0 + rect.h - 40, `CD ${skill.cooldown}`, PALETTE.glassInkDim, false, true) + 5;
    }
    if ((skill.priority ?? 0) > 0) tag(ui, tx, y0 + rect.h - 40, 'FIRST', PALETTE.warn, false, true);

    if (blocked) {
      drawText(ui.quads, this.fontSmall, blocked, rect.x + 16, y0 + rect.h - 18, {
        color: PALETTE.danger,
        scale: 0.85,
      });
    } else {
      drawText(ui.quads, this.fontSmall, `TARGET  ${skill.target.toUpperCase()}`, rect.x + 16, y0 + rect.h - 18, {
        color: PALETTE.glassInkDim,
        scale: 0.85,
        letterSpacing: 0.8,
      });
    }

    if (over) this.hoverSkill = skill;
    if (over && usable && ui.input.clicked) {
      this.act({ kind: 'skill', actorUid: actor.uid, skillId: skill.id });
    }
  }

  private renderBench(ui: UIContext, r: Rect, rowY: number): void {
    const s = this.battle.state;
    drawText(
      ui.quads, this.fontSmall,
      `DEPLOY TO ${ROLE_INFO[s.pipeline[this.selectedSlot]!.role].label}`,
      r.x + 20, rowY - 4,
      { color: PALETTE.glassInkDim, letterSpacing: 1.4 },
    );
    let x = r.x + 18;
    for (let i = 0; i < s.bench.length; i++) {
      const c = s.bench[i]!;
      const rect: Rect = { x, y: rowY + 16, w: 158, h: 62 };
      const fit = c.roles.includes(s.pipeline[this.selectedSlot]!.role);
      const over = hovered(ui, rect);
      ui.shapes.slantRect(
        rect.x, rect.y, rect.w, rect.h, SKEW * 0.6, CUT,
        c.downed ? PALETTE.glass02 : over ? shade(TYPE_COLORS[c.type], -0.2) : PALETTE.glass01,
        c.downed ? 0.55 : 0.95, 0,
      );
      ui.shapes.slantRect(rect.x + 4, rect.y + 12, 4, rect.h - 24, 2, 2, TYPE_COLORS[c.type], 1, 0);
      drawIconBadge(ui.shapes, c.specId, rect.x + 30, rect.y + 31, 15, c.type);
      drawText(ui.quads, this.fontSmall, c.name, rect.x + 52, rect.y + 12, {
        color: PALETTE.glassInk,
        letterSpacing: 0.8,
      });
      drawText(ui.quads, this.fontSmall, c.downed ? 'DOWN' : fit ? 'GOOD FIT' : 'OFF-ROLE', rect.x + 52, rect.y + 30, {
        color: c.downed ? PALETTE.danger : fit ? PALETTE.good : PALETTE.warn,
        scale: 0.85,
        letterSpacing: 0.8,
      });
      bar(ui, { x: rect.x + 52, y: rect.y + 46, w: rect.w - 70, h: 6 }, c.hp / c.maxHp, PALETTE.good);
      if (!c.downed && over && ui.input.clicked && this.canAct) {
        this.act({ kind: 'swap', slotIndex: this.selectedSlot, benchIndex: i });
      }
      x += 168;
    }
    if (button(ui, { x: r.x + r.w - 180, y: rowY + 16, w: 160, h: 36 }, 'CANCEL', {
      color: PALETTE.info, small: true,
    })) {
      this.swapping = false;
    }
  }

  /**
   * Confirm before abandoning a fight.
   *
   * Leaving mid-incident scores nothing - `onFinish` ignores an outcome that
   * is still 'ongoing' - so this needs to say that plainly rather than drop
   * the player back on the island wondering where their XP went.
   */
  private renderLeavePrompt(ui: UIContext, ctx: SceneContext, width: number, height: number): void {
    ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.55, 0);
    const r: Rect = { x: width / 2 - 230, y: height / 2 - 96, w: 460, h: 192 };
    panel(ui, r, undefined, 0.97);

    drawText(ui.quads, this.fontBig, 'LEAVE THE INCIDENT?', r.x + r.w / 2, r.y + 26, {
      color: PALETTE.glassInk,
      align: 'center',
      letterSpacing: 2,
    });
    paragraph(
      ui, r.x + 34, r.y + 68, r.w - 68,
      'The incident stays unresolved. No XP, no scrap, and nothing is recorded against it. Your components keep the damage they have taken.',
      PALETTE.glassInkDim,
    );

    if (button(ui, { x: r.x + 34, y: r.y + r.h - 60, w: 186, h: 42 }, 'KEEP FIGHTING', {
      color: PALETTE.good,
      active: true,
    })) {
      this.confirmLeave = false;
      playSfx('back', 0.7);
      ctx.input.consumeClick();
    }
    if (button(ui, { x: r.x + r.w - 220, y: r.y + r.h - 60, w: 186, h: 42 }, 'LEAVE', {
      color: PALETTE.danger,
      icon: GLYPHS.close,
    })) {
      playSfx('deny', 0.7);
      ctx.scenes.popWith({ style: 'iris', duration: 0.34 });
    }
  }

  private renderResult(ui: UIContext, ctx: SceneContext, width: number, height: number): void {
    const s = this.battle.state;
    const spec = getIncident(s.incident.specId);
    const won = s.outcome === 'victory';

    ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.58, 0);
    const r: Rect = { x: width / 2 - 280, y: height / 2 - 175, w: 560, h: 350 };
    panel(ui, r, undefined, 0.97);

    drawText(ui.quads, this.fontBig, won ? 'INCIDENT RESOLVED' : 'INCIDENT WON', r.x + r.w / 2, r.y + 28, {
      color: won ? PALETTE.good : PALETTE.danger,
      align: 'center',
      letterSpacing: 3,
    });
    drawText(
      ui.quads, this.fontSmall,
      `${Math.round(s.totalHandled)} ops served   ${Math.round(s.totalDropped)} dropped   ${s.turn - 1} turns`,
      r.x + r.w / 2, r.y + 66,
      { color: PALETTE.glassInkDim, align: 'center', letterSpacing: 1.4 },
    );

    drawText(ui.quads, this.font, won ? 'WHAT WORKED' : 'WHAT WOULD HAVE WORKED', r.x + 34, r.y + 100, {
      color: won ? PALETTE.good : PALETTE.warn,
      letterSpacing: 1.8,
    });
    paragraph(ui, r.x + 34, r.y + 126, r.w - 68, spec.counterHint, PALETTE.glassInk);

    if (won) {
      let tx = r.x + 34;
      tx += tag(ui, tx, r.y + r.h - 92, `+${spec.rewards.xp} XP`, PALETTE.flowerYellow, true) + 8;
      tag(ui, tx, r.y + r.h - 92, `+${spec.rewards.scrap} SCRAP`, PALETTE.resStorage, true);
    }

    if (button(ui, { x: r.x + r.w / 2 - 115, y: r.y + r.h - 62, w: 230, h: 44 }, 'RETURN TO ISLAND', {
      color: won ? PALETTE.good : PALETTE.typeInfra,
      active: true,
    })) {
      ctx.scenes.popWith({ style: 'iris', duration: 0.34 });
    }
  }
}

/**
 * Log colours, tuned for dark glass.
 *
 * The previous set was picked against a cream panel, where mid-blue on white
 * is fine; the same blue on navy is nearly invisible. Everything here is
 * light enough to read on `glass01`.
 */
const LOG_COLORS: Partial<Record<LogEntry['kind'], number>> = {
  info: PALETTE.glassInkDim,
  skill: 0x7fb4ff,
  damage: PALETTE.glassInk,
  heal: 0x6ee39a,
  incident: 0xff8093,
  flow: 0x5fe3cd,
  drop: 0xff8093,
  down: 0xff5470,
  phase: 0xc98bff,
  result: PALETTE.glassInk,
};

/** The party used until captured creatures and a real save exist. */
export function starterSetup(incidentId: string, seed: string): BattleSetup {
  return {
    lineup: [
      { specId: 'kafka', level: 9 },
      { specId: 'golang', level: 9 },
      { specId: 'postgres', level: 9 },
    ],
    bench: [
      { specId: 'redis', level: 9 },
      { specId: 'nginx', level: 9 },
    ],
    incidentId,
    seed,
  };
}

