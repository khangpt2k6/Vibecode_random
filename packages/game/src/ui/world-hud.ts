import { drawText } from '@stackmon/engine';
import {
  BUILDINGS,
  CROPS,
  RESOURCES,
  getBuilding,
  unlockedCrops,
  type ResourceId,
} from '@stackmon/content';
import {
  buildMenu,
  buildProgress,
  currentObjective,
  nudges,
  objectivesDone,
  OBJECTIVES,
  rushCost,
  type PlayerState,
} from '@stackmon/core';
import { PALETTE, shade, type TypeId } from '../art/palette.js';
import { drawIconBadge } from '../art/icons.js';
import { button, hovered, panel, paragraph, tag, type Rect, type UIContext } from './widgets.js';

/**
 * The overworld HUD.
 *
 * Split out of the scene because the scene was becoming a file where the
 * world simulation and the interface argued over the same thousand lines.
 * Everything here is immediate mode: each function draws and returns whatever
 * the player clicked, and the scene decides what that means.
 *
 * The design brief for this HUD is one sentence: a player who has never seen
 * the game should know what to do next without being told by a human.
 */

const RESOURCE_ORDER: ResourceId[] = ['scrap', 'compute', 'memory', 'bandwidth', 'storage'];

const RESOURCE_COLORS: Record<ResourceId, number> = {
  scrap: PALETTE.typeCache,
  compute: PALETTE.resCompute,
  memory: PALETTE.resMemory,
  bandwidth: PALETTE.resBandwidth,
  storage: PALETTE.resStorage,
};

export interface HudResult {
  openBuild: boolean;
  openCodex: boolean;
  openHelp: boolean;
}

/** The resource strip along the top right. */
export function drawResourceBar(ui: UIContext, p: PlayerState, width: number): void {
  const cell = 104;
  const w = cell * RESOURCE_ORDER.length + 18;
  const x = width - w - 14;
  panel(ui, { x, y: 11, w, h: 46 }, undefined, 0.96, 12);

  for (let i = 0; i < RESOURCE_ORDER.length; i++) {
    const id = RESOURCE_ORDER[i]!;
    const cx = x + 12 + i * cell;
    const color = RESOURCE_COLORS[id];
    ui.shapes.roundedRect(cx, 22, 8, 24, 4, color, 1, 0);
    drawText(ui.quads, ui.font, String(Math.floor(p.resources[id] ?? 0)), cx + 16, 18, {
      color: PALETTE.ink,
    });
    drawText(ui.quads, ui.fontSmall, RESOURCES[id].label, cx + 16, 37, {
      color: PALETTE.inkSoft,
      scale: 0.88,
      letterSpacing: 1,
    });
  }
}

/**
 * The objective card.
 *
 * One goal at a time, with why it matters and how to do it. Three lines is
 * the whole tutorial: a permanent list of twelve steps is a manual, and
 * nobody reads a manual inside a game.
 */
export function drawObjective(ui: UIContext, p: PlayerState, now: number, y: number): number {
  const o = currentObjective(p, now);
  const w = 336;
  const x = 14;

  if (!o) {
    panel(ui, { x, y, w, h: 62 }, PALETTE.good);
    drawText(ui.quads, ui.font, 'ALL OBJECTIVES CLEAR', x + 20, y + 16, {
      color: PALETTE.ink,
      letterSpacing: 1.4,
    });
    drawText(ui.quads, ui.fontSmall, 'Keep building. Higher tiers are waiting.', x + 20, y + 38, {
      color: PALETTE.inkSoft,
    });
    return 62;
  }

  const whyLines = ui.fontSmall.wrap(o.why, w - 40);
  const howLines = ui.fontSmall.wrap(o.how, w - 40);
  const h = 78 + (whyLines.length + howLines.length) * ui.fontSmall.lineHeight;

  panel(ui, { x, y, w, h }, PALETTE.warn);
  drawText(ui.quads, ui.fontSmall, `NEXT  -  ${objectivesDone(p, now) + 1} / ${OBJECTIVES.length}`, x + 20, y + 14, {
    color: PALETTE.inkSoft,
    letterSpacing: 1.6,
  });
  drawText(ui.quads, ui.font, o.title, x + 20, y + 32, { color: PALETTE.ink, letterSpacing: 0.8 });

  let ly = y + 56;
  for (const line of whyLines) {
    drawText(ui.quads, ui.fontSmall, line, x + 20, ly, { color: PALETTE.inkSoft });
    ly += ui.fontSmall.lineHeight;
  }
  ly += 4;
  for (const line of howLines) {
    drawText(ui.quads, ui.fontSmall, line, x + 20, ly, { color: PALETTE.info });
    ly += ui.fontSmall.lineHeight;
  }

  const prog = o.progress?.(p, now);
  if (prog !== undefined) {
    ui.shapes.roundedRect(x + 20, y + h - 14, w - 40, 5, 3, PALETTE.uiShadow, 0.2, 0);
    ui.shapes.roundedRect(x + 20, y + h - 14, (w - 40) * Math.max(0.02, prog), 5, 3, PALETTE.warn, 1, 0);
  }
  return h;
}

/** Small contextual reminders under the objective card. */
export function drawNudges(ui: UIContext, p: PlayerState, now: number, y: number): number {
  const list = nudges(p, now).slice(0, 3);
  let ly = y;
  for (const n of list) {
    const color = n.tone === 'good' ? PALETTE.good : n.tone === 'warn' ? PALETTE.warn : PALETTE.info;
    const w = ui.fontSmall.measure(n.text) + 40;
    ui.shapes.roundedRect(14, ly, w, 24, 12, PALETTE.uiPanel, 0.94, 0);
    ui.shapes.circle(30, ly + 12, 5, color, 1, 0, 10);
    drawText(ui.quads, ui.fontSmall, n.text, 42, ly + 5, { color: PALETTE.ink });
    ly += 28;
  }
  return ly - y;
}

/** The bottom-left button row. Returns which overlay to open. */
export function drawToolbar(ui: UIContext, height: number): HudResult {
  const y = height - 56;
  const result: HudResult = { openBuild: false, openCodex: false, openHelp: false };
  if (button(ui, { x: 14, y, w: 116, h: 40 }, 'BUILD  (B)', { color: PALETTE.typeInfra, small: true })) {
    result.openBuild = true;
  }
  if (button(ui, { x: 138, y, w: 116, h: 40 }, 'CODEX  (G)', { color: PALETTE.typeIntel, small: true })) {
    result.openCodex = true;
  }
  if (button(ui, { x: 262, y, w: 100, h: 40 }, 'HELP  (H)', { color: PALETTE.inkSoft, small: true })) {
    result.openHelp = true;
  }
  return result;
}

// --------------------------------------------------------------- build menu

export interface BuildMenuResult {
  close: boolean;
  build: string | null;
  rush: boolean;
}

/**
 * The build menu.
 *
 * Locked entries stay visible and show why they are locked, because the
 * reason is the lesson. Hiding them would turn a dependency graph the player
 * could be learning into a list that mysteriously grows.
 */
export function drawBuildMenu(
  ui: UIContext, p: PlayerState, now: number, width: number, height: number,
): BuildMenuResult {
  const result: BuildMenuResult = { close: false, build: null, rush: false };
  ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.55, 0);

  const w = Math.min(1020, width - 56);
  const h = Math.min(560, height - 60);
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  panel(ui, { x, y, w, h }, PALETTE.typeInfra, 0.985, 16);

  drawText(ui.quads, ui.fontBig ?? ui.font, 'BUILD', x + 26, y + 18, {
    color: PALETTE.ink,
    letterSpacing: 3,
  });
  drawText(ui.quads, ui.fontSmall, 'Each structure needs the one before it. The reason is written on the card.', x + 120, y + 26, {
    color: PALETTE.inkSoft,
  });
  if (button(ui, { x: x + w - 116, y: y + 14, w: 100, h: 34 }, 'CLOSE', { color: PALETTE.inkSoft, small: true })) {
    result.close = true;
  }

  // Current construction, if any.
  let listTop = y + 62;
  if (p.base.building) {
    const spec = getBuilding(p.base.building.buildingId);
    const prog = buildProgress(p.base, now);
    const remain = Math.max(0, Math.ceil((p.base.building.doneAt - now) / 1000));
    ui.shapes.roundedRect(x + 20, listTop, w - 40, 52, 10, shade(spec.tint, 0.7), 1, 0);
    drawText(ui.quads, ui.font, `BUILDING  ${spec.name}`, x + 36, listTop + 10, { color: PALETTE.ink, letterSpacing: 1 });
    ui.shapes.roundedRect(x + 36, listTop + 32, w - 220, 8, 4, PALETTE.uiShadow, 0.2, 0);
    ui.shapes.roundedRect(x + 36, listTop + 32, (w - 220) * prog, 8, 4, spec.tint, 1, 0);
    drawText(ui.quads, ui.fontSmall, `${remain}s left`, x + w - 170, listTop + 32, { color: PALETTE.inkSoft });
    if (button(ui, { x: x + w - 116, y: listTop + 9, w: 96, h: 34 }, `RUSH ${rushCost(p.base, now)}`, {
      color: PALETTE.warn, small: true, disabled: p.resources.scrap < rushCost(p.base, now),
    })) {
      result.rush = true;
    }
    listTop += 64;
  }

  // The tree, in two columns.
  const menu = new Map(buildMenu(p, p.base).map((e) => [e.id, e] as const));
  const cols = 2;
  const cardW = (w - 52) / cols;
  const cardH = 96;
  for (let i = 0; i < BUILDINGS.length; i++) {
    const spec = BUILDINGS[i]!;
    const entry = menu.get(spec.id)!;
    const cx = x + 20 + (i % cols) * (cardW + 12);
    const cy = listTop + Math.floor(i / cols) * (cardH + 10);
    if (cy + cardH > y + h - 12) continue;

    const rect: Rect = { x: cx, y: cy, w: cardW, h: cardH };
    const over = hovered(ui, rect);
    const bg =
      entry.state === 'built' ? shade(PALETTE.good, 0.72)
        : entry.state === 'available' ? PALETTE.uiPanel
          : PALETTE.wallShade;

    ui.shapes.roundedRect(rect.x, rect.y + 2, rect.w, rect.h, 10, PALETTE.uiShadow, 0.14, 0);
    ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 10, bg, 1, 0);
    ui.shapes.roundedRect(rect.x, rect.y, 6, rect.h, 3, entry.state === 'locked' ? PALETTE.uiPanelEdge : spec.tint, 1, 0);
    if (over && entry.state === 'available') {
      ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 10, spec.tint, 0.12, 0);
    }

    drawText(ui.quads, ui.font, spec.name, rect.x + 18, rect.y + 10, {
      color: entry.state === 'locked' ? PALETTE.inkSoft : PALETTE.ink,
      letterSpacing: 1,
    });

    if (entry.state === 'built') {
      tag(ui, rect.x + rect.w - 86, rect.y + 12, 'BUILT', PALETTE.good, true);
      paragraph(ui, rect.x + 18, rect.y + 32, rect.w - 36, spec.description, PALETTE.inkSoft, 0.95);
    } else if (entry.state === 'locked') {
      const needs = entry.missingRequires.map((r) => getBuilding(r).name).join(' + ');
      tag(ui, rect.x + rect.w - 110, rect.y + 12, `NEEDS ${needs}`, PALETTE.warn);
      paragraph(ui, rect.x + 18, rect.y + 34, rect.w - 36, spec.whyGated, PALETTE.inkSoft, 0.92);
    } else {
      // Cost chips, with the ones you cannot afford in red.
      let tx = rect.x + 18;
      for (const [k, v] of Object.entries(spec.cost) as Array<[ResourceId, number]>) {
        const short = (entry.missing[k] ?? 0) > 0;
        tx += tag(ui, tx, rect.y + 34, `${RESOURCES[k].label} ${v}`, short ? PALETTE.danger : RESOURCE_COLORS[k]) + 5;
      }
      paragraph(ui, rect.x + 18, rect.y + 56, rect.w - 130, spec.description, PALETTE.inkSoft, 0.92);
      const canBuild = entry.state === 'available' && !p.base.building;
      if (button(ui, { x: rect.x + rect.w - 104, y: rect.y + rect.h - 44, w: 88, h: 32 }, 'BUILD', {
        color: spec.tint, small: true, disabled: !canBuild,
      })) {
        result.build = spec.id;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------- plant menu

export interface PlantMenuResult {
  close: boolean;
  crop: string | null;
}

/** A small radial-ish picker anchored near the plot being planted. */
export function drawPlantMenu(
  ui: UIContext, p: PlayerState, width: number, height: number,
): PlantMenuResult {
  const result: PlantMenuResult = { close: false, crop: null };
  ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.45, 0);

  const unlocked = unlockedCrops(p.base.built);
  const list = CROPS.filter((c) => unlocked.includes(c.id));
  const cardW = 188;
  const cardH = 132;
  const w = list.length * (cardW + 10) + 26;
  const x = Math.max(16, (width - w) / 2);
  const y = height / 2 - cardH / 2 - 20;

  panel(ui, { x, y: y - 52, w, h: cardH + 92 }, PALETTE.good, 0.985, 14);
  drawText(ui.quads, ui.font, 'PLANT', x + 20, y - 42, { color: PALETTE.ink, letterSpacing: 2.5 });
  drawText(ui.quads, ui.fontSmall, 'Crops keep growing while the tab is closed.', x + 96, y - 36, {
    color: PALETTE.inkSoft,
  });
  if (button(ui, { x: x + w - 104, y: y - 46, w: 88, h: 30 }, 'CANCEL', { color: PALETTE.inkSoft, small: true })) {
    result.close = true;
  }

  for (let i = 0; i < list.length; i++) {
    const crop = list[i]!;
    const rect: Rect = { x: x + 14 + i * (cardW + 10), y, w: cardW, h: cardH };
    const cost = crop.seedCost.scrap ?? 0;
    const afford = p.resources.scrap >= cost;
    const over = hovered(ui, rect);

    ui.shapes.roundedRect(rect.x, rect.y + 2, rect.w, rect.h, 10, PALETTE.uiShadow, 0.16, 0);
    ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 10, afford ? PALETTE.uiPanel : PALETTE.wallShade, 1, 0);
    ui.shapes.roundedRect(rect.x, rect.y, rect.w, 6, 3, crop.tint, 1, 0);
    if (over && afford) ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 10, crop.tint, 0.12, 0);

    drawText(ui.quads, ui.font, crop.name, rect.x + 14, rect.y + 14, { color: PALETTE.ink, letterSpacing: 0.8 });
    let tx = rect.x + 14;
    for (const [k, v] of Object.entries(crop.yield) as Array<[ResourceId, number]>) {
      tx += tag(ui, tx, rect.y + 36, `+${v} ${RESOURCES[k].label}`, RESOURCE_COLORS[k]) + 5;
    }
    drawText(ui.quads, ui.fontSmall, `${crop.growSeconds}s  -  ${cost} scrap`, rect.x + 14, rect.y + 58, {
      color: afford ? PALETTE.inkSoft : PALETTE.danger,
    });
    paragraph(ui, rect.x + 14, rect.y + 78, rect.w - 28, crop.description, PALETTE.inkSoft, 0.88);

    if (over && afford && ui.input.clicked) result.crop = crop.id;
  }
  return result;
}

// -------------------------------------------------------------------- help

/** The rules of the game on one screen. Returns true when it should close. */
export function drawHelp(ui: UIContext, width: number, height: number): boolean {
  ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.66, 0);
  const w = Math.min(880, width - 60);
  const h = Math.min(560, height - 60);
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  panel(ui, { x, y, w, h }, PALETTE.info, 0.985, 16);

  drawText(ui.quads, ui.fontBig ?? ui.font, 'HOW THIS GAME WORKS', x + 28, y + 20, {
    color: PALETTE.ink,
    letterSpacing: 2.5,
  });

  const sections: Array<[string, string]> = [
    [
      'THE IDEA',
      'Every creature here is a real technology, and its six stats are its real trade-offs. ' +
        'Redis has latency 5 and durability 55. Postgres has latency 55 and consistency 195. ' +
        'Nothing was tuned to be balanced first - it was written to be true.',
    ],
    [
      'THE LOOP',
      'Catch technologies on the island. Farm the four resources. Build the tech tree, where ' +
        'every structure needs the one before it for a real architectural reason. Fight incidents ' +
        'to earn scrap and experience, then spend both on going further.',
    ],
    [
      'THE PIPELINE',
      'A battle is three slots: INGEST, PROCESS, STORE. Load arrives at ingest. Each stage handles ' +
        'what its throughput allows, buffers the overflow up to its memory, and drops the rest. ' +
        'What it handles is what it passes on - so the bottleneck is the smallest stage, and adding ' +
        'capacity anywhere else does nothing at all.',
    ],
    [
      'WINNING AND LOSING',
      'You damage an incident by successfully serving traffic through it. You lose when your error ' +
        'budget runs out, and it burns on your error RATE, not the raw number of dropped requests. ' +
        'That is what an error budget actually measures.',
    ],
    [
      'CONTROLS',
      'Drag or WASD to pan, scroll to zoom. Click a wild creature to capture it. Click the Ops Centre ' +
        'to fight. Click a plot to plant or harvest. B for build, G for codex, H for this screen, ESC to close.',
    ],
  ];

  let sy = y + 62;
  for (const [title, body] of sections) {
    drawText(ui.quads, ui.font, title, x + 28, sy, { color: PALETTE.info, letterSpacing: 1.6 });
    sy += 22;
    sy += paragraph(ui, x + 28, sy, w - 56, body, PALETTE.ink, 0.98);
    sy += 14;
  }

  return button(ui, { x: x + w / 2 - 80, y: y + h - 52, w: 160, h: 38 }, 'GOT IT', { color: PALETTE.info });
}

/** A compact roster strip so the player can see what they own. */
export function drawRosterStrip(
  ui: UIContext, p: PlayerState, familyOf: (specId: string) => TypeId, width: number, y: number,
): void {
  const show = p.roster.slice(-8);
  if (show.length === 0) return;
  const w = show.length * 40 + 24;
  const x = width - w - 14;
  panel(ui, { x, y, w, h: 48 }, undefined, 0.94, 12);
  for (let i = 0; i < show.length; i++) {
    const c = show[i]!;
    drawIconBadge(ui.shapes, c.specId, x + 32 + i * 40, y + 24, 15, familyOf(c.specId));
    drawText(ui.quads, ui.fontSmall, `L${c.level}`, x + 32 + i * 40, y + 32, {
      color: PALETTE.ink,
      align: 'center',
      scale: 0.8,
    });
  }
}
