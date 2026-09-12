import { drawText, type Font, type Input, type ShapeBatch, type QuadBatch } from '@stackmon/engine';
import { PALETTE, shade } from '../art/palette.js';
import type { Glyph } from './glyphs.js';

/**
 * Immediate-mode UI.
 *
 * A widget is a function you call every frame with where it goes; it draws
 * itself and tells you if it was clicked. No retained tree, no layout pass,
 * no event routing. For a game HUD that redraws at 60 Hz anyway, retained UI
 * is bookkeeping that buys nothing, and immediate mode keeps every screen's
 * layout readable top to bottom in one function.
 *
 * The visual language is sheared cards on dark translucent glass, the way a
 * console RPG lays out a party list. Two earlier versions leaned on bars of
 * flat colour: first a rule across the top of every panel, then a short tab
 * on each leading edge. Both were the same mistake at different sizes. A bar
 * of colour is unreadable on its own, so the player decodes the label anyway
 * and the bar is pure noise - and several of them at once reads as a form,
 * not a game. Colour now arrives only as an icon, a meter fill, or the fill
 * of whatever is selected. Nothing in this file draws a coloured line.
 *
 * All coordinates are CSS pixels in the UI layer.
 */

/** How far a card's top edge leads its bottom edge. One number, everywhere. */
export const SKEW = 11;
/** Corner chamfer, sized to read as the same family as the shear. */
export const CUT = 9;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UIContext {
  shapes: ShapeBatch;
  quads: QuadBatch;
  input: Input;
  font: Font;
  fontSmall: Font;
  /** Optional display face for headings. Falls back to `font`. */
  fontBig?: Font;
  /** Seconds, for hover pulses. */
  time: number;
}

export const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function hovered(ui: UIContext, r: Rect): boolean {
  const p = ui.input.pointer.position;
  return inRect(r, p.x, p.y);
}

/**
 * Dark glass: the default surface for anything the player reads.
 *
 * `accent` used to paint a tab of family colour on the leading edge. It is now
 * ignored, and kept only so the call sites that pass a colour still compile.
 * Four panels on screen meant four coloured bars, and a bar is the weakest
 * signal in the kit: it cannot be read without the label beside it, so it
 * adds noise and no information. Colour belongs on icons, meter fills, and
 * whatever is currently selected.
 */
export function panel(ui: UIContext, r: Rect, _accent?: number, alpha = 0.88, skew = SKEW): void {
  ui.shapes.slantPanel(r.x, r.y, r.w, r.h, skew, CUT, PALETTE.glass01, alpha);
}

/** A pale surface, for the few places dark glass would swallow the art. */
export function lightPanel(ui: UIContext, r: Rect, alpha = 0.95, skew = SKEW): void {
  ui.shapes.slantPanel(r.x, r.y, r.w, r.h, skew, CUT, PALETTE.uiPanel, alpha);
}

export interface ButtonOptions {
  color?: number;
  disabled?: boolean;
  /** Smaller text, for dense rows. */
  small?: boolean;
  /** Draw as selected: filled with the colour rather than outlined. */
  active?: boolean;
  /** A mark set before the label. This is where colour goes now. */
  icon?: Glyph;
}

/**
 * A sheared button. Returns true on the frame it is clicked.
 *
 * Hover fills it with its own colour and flips the label to white, which is
 * the read a console menu gives you and is far clearer at a glance than a
 * two-pixel underline changing shade.
 *
 * There used to be a short bar of `color` on the leading edge of every
 * unfilled button. It is gone. With four buttons in the toolbar it read as
 * four unrelated colour codes that decode to nothing, and a player has to
 * read the label regardless. An `icon` takes that slot instead: a hammer or a
 * book is recognised before the word under it is, so the colour finally
 * carries something.
 */
export function button(ui: UIContext, r: Rect, label: string, opts: ButtonOptions = {}): boolean {
  const color = opts.color ?? PALETTE.typeInfra;
  const over = !opts.disabled && hovered(ui, r);
  const press = over && ui.input.pointer.down;
  const filled = opts.active === true || (over && !opts.disabled);

  const y = r.y - (press ? 0 : over ? 2 : 0);
  const skew = SKEW * 0.7;

  ui.shapes.slantRect(r.x, r.y + 4, r.w, r.h, skew, CUT, PALETTE.uiShadow, opts.disabled ? 0.1 : 0.26, 0);

  if (filled) {
    ui.shapes.slantRect(r.x, y, r.w, r.h, skew, CUT, color, 1, 0);
    ui.shapes.slantRect(r.x, y, r.w, r.h * 0.42, skew, CUT, shade(color, 0.3), 0.45, 0);
  } else {
    // An outline, drawn as a slightly larger card behind the fill.
    //
    // Without the old colour tab an unfilled button was glass over a glass
    // panel: the same value on the same value, so it read as a line of text
    // that happened to be centred. The edge is what says "this is a control",
    // and it has to come from the shape rather than from a colour code.
    ui.shapes.slantRect(
      r.x - 1.5, y - 1.5, r.w + 3, r.h + 3, skew, CUT + 1,
      opts.disabled ? PALETTE.glass02 : PALETTE.glassInkDim, opts.disabled ? 0.5 : 0.4, 0,
    );
    ui.shapes.slantRect(r.x, y, r.w, r.h, skew, CUT, PALETTE.glass02, opts.disabled ? 0.96 : 0.99, 0);
  }

  // The icon shifts the label right by exactly its own column, so a row of
  // buttons with and without icons still has its text on one baseline.
  const iconR = Math.min(9, r.h * 0.26);
  const gap = opts.icon ? iconR * 2 + 10 : 0;
  const face = opts.small ? ui.fontSmall : ui.font;
  const textW = face.measure(label);
  const cx = r.x + (r.w - gap) / 2 + gap + skew * 0.5;

  if (opts.icon) {
    opts.icon(
      ui.shapes,
      cx - textW / 2 - 10 - iconR,
      y + r.h / 2,
      iconR,
      filled ? PALETTE.inkOnDark : opts.disabled ? PALETTE.glassInkDim : color,
    );
  }

  drawText(ui.quads, face, label, cx, y + (r.h - (opts.small ? 13 : 18)) / 2, {
    color: filled ? PALETTE.inkOnDark : opts.disabled ? PALETTE.glassInkDim : PALETTE.glassInk,
    align: 'center',
    letterSpacing: 1.2,
  });

  return over && ui.input.clicked;
}

/**
 * A square button that is only a mark: close, back, step.
 *
 * Every full-screen panel needs a way out in the same place, and a 34px box
 * with a cross in it is that way out in every game ever shipped. Spelling
 * "CLOSE" costs three times the width and reads no faster.
 */
export function iconButton(
  ui: UIContext, r: Rect, icon: Glyph, color: number, tipText?: string,
): boolean {
  const over = hovered(ui, r);
  const skew = SKEW * 0.5;
  ui.shapes.slantRect(r.x, r.y + 3, r.w, r.h, skew, CUT * 0.7, PALETTE.uiShadow, 0.26, 0);
  ui.shapes.slantRect(r.x, r.y, r.w, r.h, skew, CUT * 0.7, over ? color : PALETTE.glass01, over ? 1 : 0.92, 0);
  icon(
    ui.shapes,
    r.x + r.w / 2 + skew * 0.25,
    r.y + r.h / 2,
    Math.min(r.w, r.h) * 0.3,
    over ? PALETTE.inkOnDark : PALETTE.glassInk,
  );
  if (over && tipText) {
    drawText(ui.quads, ui.fontSmall, tipText, r.x + r.w / 2, r.y + r.h + 6, {
      color: PALETTE.glassInk,
      align: 'center',
      scale: 0.86,
      letterSpacing: 1,
    });
  }
  return over && ui.input.clicked;
}

/**
 * A capsule meter with its label and value set above it.
 *
 * `ghost` is the value before the most recent change, drawn in red behind the
 * fill, so a hit reads as a slice being taken out rather than as a number
 * that was always smaller.
 */
export function meter(
  ui: UIContext,
  r: Rect,
  fraction: number,
  color: number,
  label: string,
  value: string,
  ghost?: number,
  onGlass = true,
): void {
  const f = Math.max(0, Math.min(1, fraction));
  if (ghost !== undefined && ghost > f) {
    ui.shapes.roundedRect(r.x, r.y, r.w, r.h, r.h / 2, PALETTE.uiShadow, 0.5, 0);
    ui.shapes.roundedRect(
      r.x, r.y, Math.max(r.h, r.w * Math.min(1, ghost)), r.h, r.h / 2, PALETTE.danger, 0.85, 0,
    );
    if (f > 0) ui.shapes.roundedRect(r.x, r.y, Math.max(r.h, r.w * f), r.h, r.h / 2, color, 1, 0);
  } else {
    ui.shapes.capsule(r.x, r.y, r.w, r.h, f, color, PALETTE.uiShadow, 0.5);
  }
  drawText(ui.quads, ui.fontSmall, label, r.x + 2, r.y - 17, {
    color: onGlass ? PALETTE.glassInkDim : PALETTE.inkSoft,
    letterSpacing: 1.4,
  });
  drawText(ui.quads, ui.fontSmall, value, r.x + r.w - 2, r.y - 17, {
    color: onGlass ? PALETTE.glassInk : PALETTE.ink,
    align: 'right',
  });
}

/** A bare capsule with no labels, for HP inside a card. */
export function bar(ui: UIContext, r: Rect, fraction: number, color: number): void {
  ui.shapes.capsule(r.x, r.y, r.w, r.h, fraction, color, PALETTE.uiShadow, 0.45);
}

/** Word-wrapped paragraph. Returns the height used. */
export function paragraph(
  ui: UIContext,
  x: number,
  y: number,
  width: number,
  text: string,
  // Annotated rather than inferred: PALETTE is `as const`, so a bare default
  // would narrow this parameter to that one literal colour.
  color: number = PALETTE.ink,
  scale = 1,
): number {
  const lines = ui.fontSmall.wrap(text, width, scale);
  const lh = ui.fontSmall.lineHeight * scale;
  for (let i = 0; i < lines.length; i++) {
    drawText(ui.quads, ui.fontSmall, lines[i]!, x, y + i * lh, { color, scale });
  }
  return lines.length * lh;
}

/**
 * A tooltip near the pointer, kept on screen.
 *
 * Drawn last by the caller so it sits over everything. The teaching text in
 * this game arrives almost entirely through these, so they are generous with
 * width - a tooltip that wraps to nine lines is not read.
 */
export function tooltip(ui: UIContext, screenW: number, screenH: number, title: string, body: string): void {
  const p = ui.input.pointer.position;
  const w = 300;
  const pad = 14;
  const bodyLines = ui.fontSmall.wrap(body, w - pad * 2);
  const h = pad * 2 + 22 + bodyLines.length * ui.fontSmall.lineHeight;
  let x = p.x + 18;
  let y = p.y + 18;
  if (x + w > screenW - 8) x = p.x - w - 18;
  if (y + h > screenH - 8) y = screenH - h - 8;

  ui.shapes.slantPanel(x, y, w, h, SKEW * 0.55, CUT, PALETTE.glass02, 0.97);
  drawText(ui.quads, ui.font, title, x + pad + 5, y + pad - 2, {
    color: PALETTE.flowerYellow,
    letterSpacing: 1,
  });
  for (let i = 0; i < bodyLines.length; i++) {
    drawText(ui.quads, ui.fontSmall, bodyLines[i]!, x + pad + 5, y + pad + 22 + i * ui.fontSmall.lineHeight, {
      color: PALETTE.glassInk,
    });
  }
}

/**
 * A pill tag whose RIGHT edge sits at `right`.
 *
 * Needed wherever the label length varies - "NEEDS IMAGE REGISTRY" is twice
 * the width of "BUILT", and a left-anchored pill for both means one of them
 * hangs off the card.
 */
export function tagRight(
  ui: UIContext, right: number, y: number, text: string, color: number, dark = false,
): number {
  const w = ui.fontSmall.measure(text) * 0.9 + 14;
  return tag(ui, right - w, y, text, color, dark);
}

/** A small pill tag: "COST 24", "CD 3", a type label. */
export function tag(
  ui: UIContext, x: number, y: number, text: string, color: number,
  dark = false, onGlass = false,
): number {
  const w = ui.fontSmall.measure(text) * 0.9 + 16;
  ui.shapes.slantRect(x, y, w, 17, 4, 4, color, dark ? 1 : onGlass ? 0.34 : 0.18, 0);
  drawText(ui.quads, ui.fontSmall, text, x + w / 2 + 2, y + 2, {
    color: dark ? PALETTE.inkOnDark : onGlass ? shade(color, 0.6) : shade(color, -0.35),
    align: 'center',
    scale: 0.9,
    letterSpacing: 0.6,
  });
  return w;
}
