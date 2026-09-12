import { drawText } from '@stackmon/engine';
import {
  OBJECTIVES,
  objectivePosition,
  objectivesDone,
  outstandingRewards,
  type Objective,
  type ObjectiveTarget,
  type PlayerState,
} from '@stackmon/core';
import { PALETTE, shade } from '../art/palette.js';
import {
  CUT,
  SKEW,
  bar,
  button,
  hovered,
  iconButton,
  panel,
  tag,
  type Rect,
  type UIContext,
} from './widgets.js';
import { GLYPHS, type Glyph } from './glyphs.js';

/**
 * The quest log.
 *
 * Every objective at once, with its progress, its reward, and a button that
 * takes the player to it. The game previously showed one goal at a time in a
 * corner card, which answers "what next" and answers nothing else: a player
 * could not see how much was left, could not see that quests pay, and had no
 * idea where the experience in this game actually comes from.
 *
 * Rewards are shown on every row including the locked ones on purpose. The
 * list is the answer to "why would I bother", and that answer has to be
 * visible before the bothering, not after.
 */

export interface QuestLogResult {
  close: boolean;
  /** Where the player asked to be taken, if they pressed GO on a row. */
  goto: ObjectiveTarget | null;
}

const ROW_H = 64;

export function drawQuestLog(
  ui: UIContext,
  p: PlayerState,
  now: number,
  width: number,
  height: number,
  scroll: number,
): QuestLogResult {
  const result: QuestLogResult = { close: false, goto: null };
  ui.shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.58, 0);

  const w = Math.min(820, width - 48);
  const h = height - 40;
  const x = (width - w) / 2;
  const y = 20;
  panel(ui, { x, y, w, h }, undefined, 0.96);

  const done = objectivesDone(p, now);
  const total = OBJECTIVES.length;
  const outstanding = outstandingRewards(p, now);

  // ---- header
  drawText(ui.quads, ui.fontBig ?? ui.font, 'MISSIONS', x + 36, y + 20, {
    color: PALETTE.glassInk,
    letterSpacing: 3,
  });
  drawText(ui.quads, ui.fontSmall, 'Every mission pays scrap and experience. Scrap buys captures and buildings.', x + 36, y + 50, {
    color: PALETTE.glassInkDim,
  });

  if (iconButton(ui, { x: x + w - 58, y: y + 16, w: 38, h: 38 }, GLYPHS.close, PALETTE.danger, 'ESC')) {
    result.close = true;
  }

  // Overall progress, the thing the reference screen leads with.
  const barW = w - 72 - 150;
  bar(ui, { x: x + 36, y: y + 76, w: barW, h: 12 }, done / total, PALETTE.good);
  drawText(ui.quads, ui.font, `${done} / ${total}`, x + 36 + barW + 14, y + 70, {
    color: PALETTE.glassInk,
    letterSpacing: 1,
  });
  drawText(ui.quads, ui.fontSmall, `${outstanding.scrap} scrap left to earn`, x + 36 + barW + 14, y + 90, {
    color: PALETTE.glassInkDim,
    scale: 0.9,
  });

  // ---- rows
  const listTop = y + 108;
  const listBottom = y + h - 16;
  const current = objectivePosition(p, now) - 1;

  for (let i = 0; i < OBJECTIVES.length; i++) {
    const o = OBJECTIVES[i]!;
    const ry = listTop + i * (ROW_H + 6) - scroll;
    if (ry + ROW_H < listTop || ry > listBottom) continue;

    drawRow(ui, p, now, o, { x: x + 24, y: ry, w: w - 48, h: ROW_H }, i === current, result);
  }

  // A hint that the list continues, rather than silently clipping.
  const contentH = OBJECTIVES.length * (ROW_H + 6);
  if (contentH > listBottom - listTop) {
    drawText(ui.quads, ui.fontSmall, 'scroll for more', x + w / 2, listBottom - 4, {
      color: PALETTE.glassInkDim,
      align: 'center',
      scale: 0.85,
      letterSpacing: 1.2,
    });
  }

  return result;
}

/** Total scrollable height beyond the visible area, or 0. */
export function questLogOverflow(height: number): number {
  const h = height - 40;
  const visible = 20 + h - 16 - (20 + 108);
  return Math.max(0, OBJECTIVES.length * (ROW_H + 6) - visible + 24);
}

function drawRow(
  ui: UIContext,
  p: PlayerState,
  now: number,
  o: Objective,
  r: Rect,
  isCurrent: boolean,
  result: QuestLogResult,
): void {
  const complete = o.done(p, now);
  const claimed = (p.claimedObjectives ?? []).includes(o.id);
  const over = hovered(ui, r);

  const bg = complete ? PALETTE.glass02 : isCurrent ? shade(PALETTE.info, -0.55) : PALETTE.glass02;
  ui.shapes.slantRect(r.x, r.y, r.w, r.h, SKEW * 0.5, CUT, bg, complete ? 0.5 : over ? 0.95 : 0.82, 0);
  // The active mission is marked with a pin, not a bar of colour down the
  // edge. A pin says "you are here"; a coloured edge says nothing at all.
  if (isCurrent && !complete) {
    GLYPHS.pin(ui.shapes, r.x + 13, r.y + r.h / 2, 8, PALETTE.info);
  }

  // ---- reward medallion on the left, like the reference layout
  const mx = r.x + 40;
  const my = r.y + r.h / 2;
  ui.shapes.circle(mx, my + 2, 19, PALETTE.uiShadow, 0.35, 0, 18);
  ui.shapes.circle(mx, my, 19, complete ? PALETTE.good : PALETTE.flowerYellow, complete ? 0.85 : 1, 0, 20);
  if (complete) {
    ui.shapes.polyline([mx - 8, my, mx - 2, my + 6, mx + 9, my - 6], 3.6, PALETTE.inkOnDark, 1, 0);
  } else {
    drawText(ui.quads, ui.fontSmall, `${o.reward.xp}`, mx, my - 10, {
      color: PALETTE.ink,
      align: 'center',
      letterSpacing: 0.5,
    });
    drawText(ui.quads, ui.fontSmall, 'XP', mx, my + 3, {
      color: PALETTE.ink,
      align: 'center',
      scale: 0.74,
      letterSpacing: 1,
    });
  }

  // ---- title and why
  const tx = r.x + 74;
  drawText(ui.quads, ui.font, o.title, tx, r.y + 10, {
    color: complete ? PALETTE.glassInkDim : PALETTE.glassInk,
    letterSpacing: 0.8,
  });
  const whyLines = ui.fontSmall.wrap(complete ? o.why : o.how, r.w - 320);
  drawText(ui.quads, ui.fontSmall, whyLines[0] ?? '', tx, r.y + 30, {
    color: complete ? PALETTE.glassInkDim : PALETTE.info,
    scale: 0.92,
  });

  // ---- progress, where the goal is countable
  const frac = o.progress?.(p, now);
  const count = o.count?.(p, now);
  if (!complete && frac !== undefined) {
    const pw = r.w - 340;
    bar(ui, { x: tx, y: r.y + r.h - 18, w: pw, h: 7 }, frac, PALETTE.warn);
    if (count) {
      drawText(ui.quads, ui.fontSmall, `${count.have} / ${count.need}`, tx + pw + 10, r.y + r.h - 22, {
        color: PALETTE.glassInkDim,
        scale: 0.9,
      });
    }
  }

  // ---- right hand side: state, or a way to get there
  const bx = r.x + r.w - 150;
  if (complete) {
    tag(ui, bx + 16, r.y + r.h / 2 - 9, claimed ? 'CLAIMED' : 'DONE', PALETTE.good, true);
    return;
  }

  tag(ui, bx + 8, r.y + 9, `+${o.reward.scrap} SCRAP`, PALETTE.resStorage, false, true);
  if (button(ui, { x: bx, y: r.y + r.h - 38, w: 130, h: 30 }, GO_LABEL[o.target], {
    color: PALETTE.info,
    small: true,
    active: isCurrent,
    icon: GO_ICON[o.target],
  })) {
    result.goto = o.target;
  }
}

const GO_ICON: Record<ObjectiveTarget, Glyph> = {
  wild: GLYPHS.pin,
  ops: GLYPHS.fight,
  plot: GLYPHS.farm,
  build: GLYPHS.build,
  codex: GLYPHS.codex,
};

const GO_LABEL: Record<ObjectiveTarget, string> = {
  wild: 'FIND ONE',
  ops: 'GO FIGHT',
  plot: 'GO FARM',
  build: 'OPEN BUILD',
  codex: 'OPEN CODEX',
};
