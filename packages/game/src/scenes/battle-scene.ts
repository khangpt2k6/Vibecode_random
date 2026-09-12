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
  button,
  hovered,
  meter,
  panel,
  paragraph,
  tag,
  tooltip,
  type Rect,
  type UIContext,
} from '../ui/widgets.js';

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

const PLATFORM_X = [-270, 0, 270];
const PLATFORM_Y = 40;
const INCIDENT_POS = { x: 0, y: -92 };

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
    shapes.ellipse(0, PLATFORM_Y + 44, 500, 105, shade(PALETTE.grass, -0.08), 1, 0, 40);
    shapes.ellipse(0, PLATFORM_Y + 36, 450, 88, PALETTE.grass, 1, 0, 40);

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
          y: PLATFORM_Y + 2 + (downed ? 14 : 0),
          scale: downed ? 1.2 : 1.7,
          phase: i * 2.3,
          facing: 1,
          moving: 0,
        }, downed ? 0 : this.time);
        if (flash > 0) {
          shapes.ellipse(x, PLATFORM_Y - 40, 60, 60, PALETTE.danger, flash * 0.8, 0.6, 24);
        }
        if (downed) {
          shapes.ellipse(x, PLATFORM_Y - 30, 62, 46, PALETTE.uiShadow, 0.55, 0, 24);
        }
        if (c.shield > 0) {
          shapes.ring(x, PLATFORM_Y - 42, 66 + Math.sin(this.time * 3) * 2, 3, PALETTE.info, 0.7, 0.5, 30);
        }
      } else {
        drawText(ctx.renderer.quads, this.fontSmall, 'EMPTY', x, PLATFORM_Y - 40, {
          color: PALETTE.inkSoft,
          align: 'center',
          letterSpacing: 2,
        });
      }
    }

    this.renderIncident(ctx);
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

    if (this.phase === 'over') this.renderResult(ui, ctx, width, height);

    // Read back through explicit types: TS narrowed these to null at the top
    // of the method and cannot see that the panel renderers reassign them.
    const hoverSkill = this.hoverSkill as Skill | null;
    const hoverTeach = this.hoverTeach as LogEntry | null;
    // Nothing under the result overlay is interactive, so nothing under it
    // should explain itself either.
    if (this.phase === 'over') return;
    if (hoverSkill) {
      tooltip(ui, width, height, hoverSkill.name, `${hoverSkill.description}\n\n${hoverSkill.realWorld}`);
    } else if (hoverTeach?.teach) {
      tooltip(ui, width, height, 'WHY', hoverTeach.teach);
    }
    void s;
  }

  private renderTopBar(ui: UIContext, width: number): void {
    const s = this.battle.state;
    const spec = getIncident(s.incident.specId);
    const incColor = TYPE_COLORS[s.incident.type];

    panel(ui, { x: 16, y: 14, w: width - 32, h: 84 }, incColor);
    drawText(ui.quads, this.fontBig, s.incident.name, 34, 26, { color: PALETTE.ink, letterSpacing: 2 });
    let tx = 34;
    tx += tag(ui, tx, 60, `TIER ${spec.tier}`, incColor, true) + 6;
    tx += tag(ui, tx, 60, `TURN ${s.turn}`, PALETTE.inkSoft) + 6;
    tx += tag(ui, tx, 60, `LOAD ${Math.round(s.incident.load + s.incident.surge)}`, PALETTE.warn) + 6;
    void tx;

    const barX = width * 0.42;
    const barW = width - barX - 40;
    meter(
      ui,
      { x: barX, y: 42, w: barW, h: 14 },
      s.incident.integrity / s.incident.maxIntegrity,
      incColor,
      'INCIDENT INTEGRITY',
      `${Math.round(s.incident.integrity)} / ${s.incident.maxIntegrity}`,
      this.integrityGhost / s.incident.maxIntegrity,
    );
    meter(
      ui,
      { x: barX, y: 78, w: barW, h: 12 },
      s.errorBudget / s.maxErrorBudget,
      s.errorBudget > s.maxErrorBudget * 0.35 ? PALETTE.good : PALETTE.danger,
      'ERROR BUDGET',
      `${s.errorBudget.toFixed(1)}%`,
      this.budgetGhost / s.maxErrorBudget,
    );
  }

  private renderLog(ui: UIContext, width: number, height: number): void {
    const r: Rect = { x: width - 336, y: 112, w: 320, h: height - 112 - 196 };
    panel(ui, r, undefined, 0.94);
    drawText(ui.quads, this.fontSmall, 'INCIDENT LOG', r.x + 16, r.y + 12, {
      color: PALETTE.inkSoft,
      letterSpacing: 1.6,
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
        ui.shapes.roundedRect(r.x + 14, y + 2, 6, 6, 3, PALETTE.flowerYellow, 1, 0);
        if (hovered(ui, row)) {
          ui.shapes.roundedRect(row.x, row.y, row.w, row.h + 2, 6, PALETTE.flowerYellow, 0.16, 0);
          this.hoverTeach = e;
        }
      }
      for (const line of lines) {
        drawText(ui.quads, this.fontSmall, line, r.x + 26, y, { color, scale: 0.95 });
        y += lineH;
      }
    }
  }

  private renderActionPanel(ui: UIContext, width: number, height: number): void {
    const s = this.battle.state;
    const r: Rect = { x: 16, y: height - 182, w: width - 32 - 336 - 10, h: 166 };
    panel(ui, r);

    // Creature tabs across the top of the panel.
    let tx = r.x + 14;
    for (let i = 0; i < 3; i++) {
      const c = s.pipeline[i]!.occupant;
      const role = s.pipeline[i]!.role;
      const tabW = 168;
      const rect: Rect = { x: tx, y: r.y + 12, w: tabW, h: 46 };
      const active = i === this.selectedSlot;
      const color = c ? TYPE_COLORS[c.type] : PALETTE.uiPanelEdge;

      ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 10, active ? color : PALETTE.wallShade, active ? 1 : 0.6, 0);
      if (c) {
        drawIconBadge(ui.shapes, c.specId, rect.x + 24, rect.y + 23, 15, c.type);
        drawText(ui.quads, this.font, c.name, rect.x + 48, rect.y + 6, {
          color: active ? PALETTE.inkOnDark : PALETTE.ink,
          letterSpacing: 1,
        });
        const hpFrac = c.hp / c.maxHp;
        ui.shapes.roundedRect(rect.x + 48, rect.y + 28, 104, 6, 3, PALETTE.uiShadow, 0.25, 0);
        ui.shapes.roundedRect(rect.x + 48, rect.y + 28, 104 * hpFrac, 6, 3, c.downed ? PALETTE.danger : PALETTE.good, 1, 0);
        drawText(ui.quads, this.fontSmall, `${ROLE_INFO[role].label}${c.roles.includes(role) ? '' : ' (off-role)'}`, rect.x + 48, rect.y + 34, {
          color: active ? PALETTE.inkOnDark : PALETTE.inkSoft,
          scale: 0.82,
          letterSpacing: 0.8,
        });
        if (hovered(ui, rect) && ui.input.clicked && !c.downed && this.phase === 'input') {
          this.selectedSlot = i;
          this.swapping = false;
        }
      } else {
        drawText(ui.quads, this.fontSmall, `${ROLE_INFO[role].label} - EMPTY`, rect.x + 14, rect.y + 16, {
          color: PALETTE.inkSoft,
          letterSpacing: 1,
        });
        if (hovered(ui, rect) && ui.input.clicked && this.phase === 'input') {
          this.selectedSlot = i;
          this.swapping = true;
        }
      }
      tx += tabW + 8;
    }

    const actor = s.pipeline[this.selectedSlot]?.occupant ?? null;
    const rowY = r.y + 70;

    if (this.swapping) {
      this.renderBench(ui, r, rowY);
      return;
    }

    if (!actor || actor.downed) {
      drawText(ui.quads, this.fontSmall, 'Select a component, or SWAP one in from the bench.', r.x + 16, rowY + 10, {
        color: PALETTE.inkSoft,
      });
    } else {
      const skills = getCreature(actor.specId).skills.map(getSkill);
      const cardW = Math.min(150, (r.w - 32 - 190 - (skills.length - 1) * 8) / skills.length);
      let cx = r.x + 14;
      for (const skill of skills) {
        const rect: Rect = { x: cx, y: rowY, w: cardW, h: 84 };
        this.renderSkillCard(ui, rect, actor, skill);
        cx += cardW + 8;
      }
    }

    // Hold and swap live on the right of the row.
    const bx = r.x + r.w - 176;
    const canAct = this.phase === 'input';
    if (button(ui, { x: bx, y: rowY, w: 160, h: 38 }, 'HOLD', { color: PALETTE.inkSoft, disabled: !canAct, small: true })) {
      this.act({ kind: 'hold' });
    }
    if (button(ui, { x: bx, y: rowY + 46, w: 160, h: 38 }, `SWAP  (${s.bench.length})`, {
      color: PALETTE.typeInfra,
      disabled: !canAct || s.bench.length === 0,
      small: true,
    })) {
      this.swapping = true;
    }
  }

  private renderSkillCard(ui: UIContext, rect: Rect, actor: Combatant, skill: Skill): void {
    const blocked = this.battle.skillBlockedReason(actor.uid, skill.id);
    const usable = blocked === null && this.phase === 'input';
    const color = TYPE_COLORS[skill.type];
    const over = hovered(ui, rect);

    ui.shapes.roundedRect(rect.x, rect.y + 3, rect.w, rect.h, 10, PALETTE.uiShadow, usable ? 0.22 : 0.08, 0);
    ui.shapes.roundedRect(rect.x, rect.y - (over && usable ? 2 : 0), rect.w, rect.h, 10, usable ? PALETTE.uiPanel : PALETTE.wallShade, 1, 0);
    ui.shapes.roundedRect(rect.x, rect.y - (over && usable ? 2 : 0), rect.w, 5, 3, usable ? color : PALETTE.uiPanelEdge, 1, 0);

    const lines = this.fontSmall.wrap(skill.name, rect.w - 20, 1);
    let y = rect.y + 12;
    for (const line of lines.slice(0, 2)) {
      drawText(ui.quads, this.fontSmall, line, rect.x + 10, y, {
        color: usable ? PALETTE.ink : PALETTE.inkSoft,
        letterSpacing: 0.6,
      });
      y += 14;
    }

    let tx = rect.x + 10;
    tx += tag(ui, tx, rect.y + rect.h - 40, `MEM ${skill.cost}`, PALETTE.resMemory) + 4;
    if (skill.cooldown > 0) tx += tag(ui, tx, rect.y + rect.h - 40, `CD ${skill.cooldown}`, PALETTE.inkSoft) + 4;
    if ((skill.priority ?? 0) > 0) tag(ui, tx, rect.y + rect.h - 40, 'FIRST', PALETTE.warn);

    if (blocked) {
      drawText(ui.quads, this.fontSmall, blocked, rect.x + 10, rect.y + rect.h - 18, {
        color: PALETTE.danger,
        scale: 0.85,
      });
    } else {
      const target = skill.target.toUpperCase();
      drawText(ui.quads, this.fontSmall, `-> ${target}`, rect.x + 10, rect.y + rect.h - 18, {
        color: PALETTE.inkSoft,
        scale: 0.85,
        letterSpacing: 0.6,
      });
    }

    if (over) this.hoverSkill = skill;
    if (over && usable && ui.input.clicked) {
      this.act({ kind: 'skill', actorUid: actor.uid, skillId: skill.id });
    }
  }

  private renderBench(ui: UIContext, r: Rect, rowY: number): void {
    const s = this.battle.state;
    drawText(ui.quads, this.fontSmall, `Deploy to ${ROLE_INFO[s.pipeline[this.selectedSlot]!.role].label}:`, r.x + 16, rowY, {
      color: PALETTE.inkSoft,
      letterSpacing: 1,
    });
    let x = r.x + 14;
    for (let i = 0; i < s.bench.length; i++) {
      const c = s.bench[i]!;
      const rect: Rect = { x, y: rowY + 18, w: 150, h: 62 };
      const fit = c.roles.includes(s.pipeline[this.selectedSlot]!.role);
      ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 10, c.downed ? PALETTE.wallShade : PALETTE.uiPanel, 1, 0);
      ui.shapes.roundedRect(rect.x, rect.y, rect.w, 5, 3, TYPE_COLORS[c.type], 1, 0);
      drawIconBadge(ui.shapes, c.specId, rect.x + 22, rect.y + 34, 14, c.type);
      drawText(ui.quads, this.fontSmall, c.name, rect.x + 44, rect.y + 14, { color: PALETTE.ink, letterSpacing: 0.8 });
      drawText(ui.quads, this.fontSmall, c.downed ? 'DOWN' : fit ? 'good fit' : 'off-role', rect.x + 44, rect.y + 32, {
        color: c.downed ? PALETTE.danger : fit ? PALETTE.good : PALETTE.warn,
        scale: 0.85,
      });
      if (!c.downed && hovered(ui, rect) && ui.input.clicked && this.phase === 'input') {
        this.act({ kind: 'swap', slotIndex: this.selectedSlot, benchIndex: i });
      }
      x += 158;
    }
    if (button(ui, { x: r.x + r.w - 176, y: rowY + 18, w: 160, h: 38 }, 'CANCEL', { color: PALETTE.inkSoft, small: true })) {
      this.swapping = false;
    }
  }

  private renderResult(ui: UIContext, ctx: SceneContext, width: number, height: number): void {
    const s = this.battle.state;
    const spec = getIncident(s.incident.specId);
    const won = s.outcome === 'victory';

    ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.55, 0);
    const r: Rect = { x: width / 2 - 270, y: height / 2 - 170, w: 540, h: 340 };
    panel(ui, r, won ? PALETTE.good : PALETTE.danger);

    drawText(ui.quads, this.fontBig, won ? 'INCIDENT RESOLVED' : 'INCIDENT WON', r.x + r.w / 2, r.y + 26, {
      color: won ? PALETTE.good : PALETTE.danger,
      align: 'center',
      letterSpacing: 3,
    });
    drawText(ui.quads, this.fontSmall, `${Math.round(s.totalHandled)} ops served  -  ${Math.round(s.totalDropped)} dropped  -  ${s.turn - 1} turns`, r.x + r.w / 2, r.y + 64, {
      color: PALETTE.inkSoft,
      align: 'center',
      letterSpacing: 1,
    });

    drawText(ui.quads, this.font, won ? 'WHAT WORKED' : 'WHAT WOULD HAVE WORKED', r.x + 28, r.y + 98, {
      color: PALETTE.ink,
      letterSpacing: 1.5,
    });
    paragraph(ui, r.x + 28, r.y + 124, r.w - 56, spec.counterHint, PALETTE.ink);

    if (won) {
      let tx = r.x + 28;
      tx += tag(ui, tx, r.y + r.h - 90, `+${spec.rewards.xp} XP`, PALETTE.flowerYellow, true) + 8;
      tx += tag(ui, tx, r.y + r.h - 90, `+${spec.rewards.scrap} SCRAP`, PALETTE.resStorage, true) + 8;
      void tx;
    }

    if (button(ui, { x: r.x + r.w / 2 - 110, y: r.y + r.h - 62, w: 220, h: 44 }, 'RETURN TO ISLAND', {
      color: won ? PALETTE.good : PALETTE.typeInfra,
    })) {
      ctx.scenes.pop();
    }
  }
}

const LOG_COLORS: Partial<Record<LogEntry['kind'], number>> = {
  info: PALETTE.inkSoft,
  skill: PALETTE.typeData,
  damage: PALETTE.ink,
  heal: PALETTE.good,
  incident: PALETTE.danger,
  flow: PALETTE.typeInfra,
  drop: PALETTE.danger,
  down: PALETTE.danger,
  phase: PALETTE.typeStream,
  result: PALETTE.ink,
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

