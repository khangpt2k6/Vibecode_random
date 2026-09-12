import { drawText } from '@stackmon/engine';
import {
  BUILDINGS,
  CROPS,
  RESOURCES,
  getBuilding,
  getCreature,
  unlockedCrops,
  type ResourceId,
} from '@stackmon/content';
import {
  buildMenu,
  buildProgress,
  currentObjective,
  nudges,
  objectivePosition,
  OBJECTIVES,
  rushCost,
  findOwned,
  xpToNext,
  type OwnedCreature,
  type PlayerState,
} from '@stackmon/core';
import { PALETTE, shade, type TypeId } from '../art/palette.js';
import { drawIconBadge } from '../art/icons.js';
import { propAtlas } from '../art/atlas.js';
import { button, hovered, panel, paragraph, tag, tagRight, type Rect, type UIContext } from './widgets.js';

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
  openQuests: boolean;
  openBuild: boolean;
  openCodex: boolean;
  openHelp: boolean;
}

/**
 * A picture for each currency, taken from the baked prop atlas.
 *
 * A coloured bar next to a number tells you nothing until you have read the
 * label under it, which means the bar is decoration and the label is the
 * interface. An object you recognise does the job on its own: a generator is
 * compute, an aerial is bandwidth, a crate is storage. Same art as the
 * island, so the HUD looks like it belongs to the world rather than sitting
 * on top of it.
 */
const RESOURCE_ICONS: Record<ResourceId, string> = {
  scrap: 'survival/resource-stone#0',
  compute: 'space/machine_generatorLarge#0',
  memory: 'space/machine_barrel#0',
  bandwidth: 'space/machine_wireless#0',
  storage: 'survival/chest#0',
};

/**
 * A picture for each crop.
 *
 * These are not plants. They are CPU cycles, memory, bandwidth, storage and
 * telemetry, and drawing compute as a carrot would undercut the only joke
 * the game is making. So each one is the machine that would actually produce
 * it: a generator, a tank, an aerial, a crate, a dish.
 */
const CROP_ICONS: Record<string, string> = {
  'cpu-cycles': 'space/machine_generatorLarge#0',
  'ram-bank': 'space/machine_barrel#0',
  'fibre-line': 'space/machine_wireless#0',
  'disk-array': 'survival/chest#0',
  'log-stream': 'space/satelliteDish_detailed#0',
};

/** Numbers get long. 12400 reads worse than 12.4k in a 96 pixel pill. */
function compact(n: number): string {
  const v = Math.floor(n);
  if (v < 10_000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 100_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(1)}m`;
}

/**
 * The currency bar, and the party leader's level beside it.
 *
 * Drawn in two sweeps rather than one pass per pill: every pill body is a
 * shape and every icon and number is a quad, and the two batches flush each
 * other whenever they alternate. Five pills interleaved would be ten draw
 * calls for a strip of interface.
 */
export function drawResourceBar(ui: UIContext, p: PlayerState, width: number): void {
  const atlas = propAtlas();
  const pill = 104;
  const gap = 6;
  const badge = 54;
  const barH = 48;
  const w = badge + 10 + RESOURCE_ORDER.length * (pill + gap) - gap + 20;
  const x = width - w - 14;
  const y = 11;

  panel(ui, { x, y, w, h: barH }, undefined, 0.96, 12);

  // --- shapes: the pill bodies, then the level badge ---
  const pillX = (i: number): number => x + 14 + badge + 10 + i * (pill + gap);
  for (let i = 0; i < RESOURCE_ORDER.length; i++) {
    const id = RESOURCE_ORDER[i]!;
    const px = pillX(i);
    ui.shapes.slantRect(px, y + 7, pill, barH - 14, 5, 8, PALETTE.glass02, 0.85, 0);
    // No colour stripe. The icon is the identification; a coloured bar beside
    // it is a second, worse one, and five of them across the top of the
    // screen is a paint chart.
    ui.shapes.circle(px + 25, y + barH / 2 - 1, 17, PALETTE.glassInk, 0.07, 0, 20);
  }

  const lead = leadCreature(p);
  const bx = x + 14 + badge / 2;
  const by = y + barH / 2;
  if (lead) {
    const r = badge / 2 - 3;
    const need = xpToNext(lead.level);
    const progress = need > 0 ? Math.min(1, lead.xp / need) : 1;
    // Track first, then the filled sweep, starting at twelve o'clock.
    ui.shapes.ring(bx, by, r + 4, 3.5, PALETTE.glass02, 0.9, 0, 30);
    ui.shapes.ring(bx, by, r + 4, 3.5, PALETTE.good, 1, 0.55, 30, -Math.PI / 2, Math.PI * 2 * progress);
    drawIconBadge(ui.shapes, lead.specId, bx, by, r - 3, typeOfOwned(lead));
  }

  // --- quads: icons and numbers on top of the shapes drawn above ---
  for (let i = 0; i < RESOURCE_ORDER.length; i++) {
    const id = RESOURCE_ORDER[i]!;
    const px = pillX(i);
    atlas?.drawIcon(ui.quads, RESOURCE_ICONS[id], px + 25, y + barH / 2 - 2, 40);
    drawText(ui.quads, ui.font, compact(p.resources[id] ?? 0), px + 48, y + 8, {
      color: PALETTE.glassInk,
    });
    // 0.66 and almost no tracking, because STORAGE and BANDWIDTH have to fit
    // the same 52 pixels as SCRAP does.
    drawText(ui.quads, ui.fontSmall, RESOURCES[id].label, px + 49, y + 28, {
      color: PALETTE.glassInkDim,
      scale: 0.66,
      letterSpacing: 0.3,
    });
  }

  if (lead) {
    // Sits on the ring rather than inside the badge, which the mark owns.
    const label = `LV ${lead.level}`;
    ui.shapes.slantRect(bx - 21, by + badge / 2 - 9, 42, 15, 3, 4, PALETTE.glass02, 0.96, 0);
    drawText(ui.quads, ui.fontSmall, label, bx - 15, by + badge / 2 - 7, {
      color: PALETTE.glassInk,
      scale: 0.86,
      letterSpacing: 0.6,
    });
  }
}

/** The creature in the ingest slot, or the first one owned. */
function leadCreature(p: PlayerState): OwnedCreature | undefined {
  for (const uid of p.party) {
    if (!uid) continue;
    const c = findOwned(p, uid);
    if (c) return c;
  }
  return p.roster[0];
}

function typeOfOwned(c: OwnedCreature): TypeId {
  return getCreature(c.specId).type;
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
    panel(ui, { x, y, w, h: 62 }, undefined);
    drawText(ui.quads, ui.font, 'ALL MISSIONS CLEAR', x + 24, y + 16, {
      color: PALETTE.glassInk,
      letterSpacing: 1.4,
    });
    drawText(ui.quads, ui.fontSmall, 'Keep building. Higher tiers are waiting.', x + 24, y + 38, {
      color: PALETTE.glassInkDim,
    });
    return 62;
  }

  const whyLines = ui.fontSmall.wrap(o.why, w - 48);
  const howLines = ui.fontSmall.wrap(o.how, w - 48);
  const h = 78 + (whyLines.length + howLines.length) * ui.fontSmall.lineHeight;

  panel(ui, { x, y, w, h }, undefined);
  drawText(ui.quads, ui.fontSmall, `MISSION ${objectivePosition(p, now)} / ${OBJECTIVES.length}`, x + 24, y + 14, {
    color: PALETTE.glassInkDim,
    letterSpacing: 1.6,
  });
  drawText(ui.quads, ui.font, o.title, x + 24, y + 32, { color: PALETTE.glassInk, letterSpacing: 0.8 });

  let ly = y + 56;
  for (const line of whyLines) {
    drawText(ui.quads, ui.fontSmall, line, x + 24, ly, { color: PALETTE.glassInkDim });
    ly += ui.fontSmall.lineHeight;
  }
  ly += 4;
  for (const line of howLines) {
    drawText(ui.quads, ui.fontSmall, line, x + 24, ly, { color: PALETTE.info });
    ly += ui.fontSmall.lineHeight;
  }

  const prog = o.progress?.(p, now);
  if (prog !== undefined) {
    ui.shapes.capsule(x + 24, y + h - 15, w - 48, 6, Math.max(0.02, prog), PALETTE.warn, PALETTE.uiShadow, 0.5);
  }
  return h;
}

/** Small contextual reminders under the objective card. */
export function drawNudges(ui: UIContext, p: PlayerState, now: number, y: number): number {
  const list = nudges(p, now).slice(0, 3);
  let ly = y;
  for (const n of list) {
    const color = n.tone === 'good' ? PALETTE.good : n.tone === 'warn' ? PALETTE.warn : PALETTE.info;
    const w = ui.fontSmall.measure(n.text) + 46;
    ui.shapes.slantRect(14, ly, w, 25, 6, 6, PALETTE.glass02, 0.88, 0);
    ui.shapes.circle(34, ly + 12, 5, color, 1, 0.5, 10);
    drawText(ui.quads, ui.fontSmall, n.text, 46, ly + 5, { color: PALETTE.glassInk });
    ly += 28;
  }
  return ly - y;
}

/**
 * The bottom-left button row.
 *
 * MISSIONS sits first and carries its own count, because "where do I earn
 * experience" is the question a new player actually has and a button that
 * answers it should not be third in a row of equals.
 */
export function drawToolbar(
  ui: UIContext, height: number, quests: { questsDone: number; questsTotal: number },
): HudResult {
  const y = height - 56;
  const result: HudResult = { openQuests: false, openBuild: false, openCodex: false, openHelp: false };
  const label = `MISSIONS  ${quests.questsDone}/${quests.questsTotal}`;

  if (button(ui, { x: 14, y, w: 168, h: 40 }, label, { color: PALETTE.warn, small: true })) {
    result.openQuests = true;
  }
  if (button(ui, { x: 190, y, w: 116, h: 40 }, 'BUILD  (B)', { color: PALETTE.typeInfra, small: true })) {
    result.openBuild = true;
  }
  if (button(ui, { x: 314, y, w: 116, h: 40 }, 'CODEX  (G)', { color: PALETTE.typeIntel, small: true })) {
    result.openCodex = true;
  }
  if (button(ui, { x: 438, y, w: 100, h: 40 }, 'HELP  (H)', { color: PALETTE.info, small: true })) {
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

  // Sized to the window rather than to a fixed height: the whole tree has to
  // fit, because the locked cards are the screen's reason for existing and a
  // cut-off row hides exactly those.
  const w = Math.min(1100, width - 40);
  const h = height - 32;
  const x = (width - w) / 2;
  const y = 16;
  panel(ui, { x, y, w, h }, undefined, 0.985, 16);

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

  // Three columns so the whole tree fits without scrolling. A build menu you
  // have to scroll hides exactly the locked entries whose reasons are the
  // point of the screen.
  const menu = new Map(buildMenu(p, p.base).map((e) => [e.id, e] as const));
  const cols = 3;
  const cardW = (w - 40 - (cols - 1) * 12) / cols;
  const cardH = Math.max(96, Math.min(118, (h - 80) / 4 - 12));
  for (let i = 0; i < BUILDINGS.length; i++) {
    const spec = BUILDINGS[i]!;
    const entry = menu.get(spec.id)!;
    const cx = x + 20 + (i % cols) * (cardW + 12);
    const cy = listTop + Math.floor(i / cols) * (cardH + 12);
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
      tagRight(ui, rect.x + rect.w - 14, rect.y + 12, 'BUILT', PALETTE.good, true);
      paragraph(ui, rect.x + 18, rect.y + 34, rect.w - 34, spec.description, PALETTE.inkSoft, 0.92);
    } else if (entry.state === 'locked') {
      const needs = entry.missingRequires.map((r) => getBuilding(r).name).join(' + ');
      tagRight(ui, rect.x + rect.w - 14, rect.y + 30, `NEEDS ${needs}`, PALETTE.warn);
      paragraph(ui, rect.x + 18, rect.y + 52, rect.w - 34, spec.whyGated, PALETTE.inkSoft, 0.9);
    } else {
      // Cost chips, with the ones you cannot afford in red.
      let tx = rect.x + 18;
      for (const [k, v] of Object.entries(spec.cost) as Array<[ResourceId, number]>) {
        const short = (entry.missing[k] ?? 0) > 0;
        tx += tag(ui, tx, rect.y + 34, `${RESOURCES[k].label} ${v}`, short ? PALETTE.danger : RESOURCE_COLORS[k]) + 5;
      }
      paragraph(ui, rect.x + 18, rect.y + 56, rect.w - 34, spec.description, PALETTE.inkSoft, 0.9);
      const canBuild = entry.state === 'available' && !p.base.building;
      if (button(ui, { x: rect.x + rect.w - 100, y: rect.y + rect.h - 40, w: 86, h: 30 }, 'BUILD', {
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
  const atlas = propAtlas();
  ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.45, 0);

  const unlocked = unlockedCrops(p.base.built);
  const list = CROPS.filter((c) => unlocked.includes(c.id));
  const cardW = 188;
  const cardH = 206;
  /** Height of the picture well at the top of each card. */
  const artH = 78;
  const w = list.length * (cardW + 10) + 26;
  const x = Math.max(16, (width - w) / 2);
  const y = height / 2 - cardH / 2 - 20;

  panel(ui, { x, y: y - 52, w, h: cardH + 92 }, undefined, 0.985, 14);
  drawText(ui.quads, ui.font, 'PLANT', x + 20, y - 42, { color: PALETTE.glassInk, letterSpacing: 2.5 });
  drawText(ui.quads, ui.fontSmall, 'Crops keep growing while the tab is closed.', x + 96, y - 36, {
    color: PALETTE.glassInkDim,
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

    ui.shapes.roundedRect(rect.x, rect.y + 3, rect.w, rect.h, 12, PALETTE.uiShadow, 0.22, 0);
    ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 12, afford ? PALETTE.uiPanel : PALETTE.wallShade, 1, 0);

    // The picture well: the crop's own colour, washed out, so five cards read
    // as five different things before a single word has been read.
    ui.shapes.roundedRect(rect.x + 8, rect.y + 8, rect.w - 16, artH, 10, shade(crop.tint, 0.62), 1, 0);
    ui.shapes.roundedRect(rect.x + 8, rect.y + 8 + artH - 16, rect.w - 16, 16, 10, shade(crop.tint, 0.44), 1, 0);
    if (over && afford) ui.shapes.roundedRect(rect.x, rect.y, rect.w, rect.h, 12, crop.tint, 0.14, 0);

    const art = CROP_ICONS[crop.id];
    if (art) {
      // Shadow under it, so the object sits in the well instead of floating.
      ui.shapes.ellipse(rect.x + rect.w / 2, rect.y + artH - 6, 30, 8, PALETTE.uiShadow, 0.16, 0, 18);
      atlas?.drawIcon(ui.quads, art, rect.x + rect.w / 2, rect.y + 8 + artH / 2 - 4, artH - 6);
    }

    let ty = rect.y + artH + 18;
    drawText(ui.quads, ui.font, crop.name, rect.x + 14, ty, { color: PALETTE.ink, letterSpacing: 0.8 });
    ty += 24;
    let tx = rect.x + 14;
    for (const [k, v] of Object.entries(crop.yield) as Array<[ResourceId, number]>) {
      tx += tag(ui, tx, ty, `+${v} ${RESOURCES[k].label}`, RESOURCE_COLORS[k]) + 5;
    }
    ty += 24;
    drawText(ui.quads, ui.fontSmall, `${crop.growSeconds}s  -  ${cost} scrap`, rect.x + 14, ty, {
      color: afford ? PALETTE.inkSoft : PALETTE.danger,
    });
    paragraph(ui, rect.x + 14, ty + 20, rect.w - 28, crop.description, PALETTE.inkSoft, 0.88);

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
  panel(ui, { x, y, w, h }, undefined, 0.985, 16);

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
