import { drawText, type Font, type Input, type ShapeBatch, type QuadBatch } from '@stackmon/engine';
import { PALETTE, shade } from '../art/palette.js';

/**
 * Immediate-mode UI.
 *
 * A widget is a function you call every frame with where it goes; it draws
 * itself and tells you if it was clicked. No retained tree, no layout pass,
 * no event routing. For a game HUD that redraws at 60 Hz anyway, retained UI
 * is bookkeeping that buys nothing, and immediate mode keeps every screen's
 * layout readable top to bottom in one function.
 *
 * All coordinates are CSS pixels in the UI layer.
 */

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

/** A card-style panel with a drop shadow and an optional accent stripe. */
export function panel(ui: UIContext, r: Rect, accent?: number, alpha = 0.97, radius = 14): void {
  ui.shapes.roundedRect(r.x, r.y + 3, r.w, r.h, radius, PALETTE.uiShadow, 0.18, 0);
  ui.shapes.roundedRect(r.x, r.y, r.w, r.h, radius, PALETTE.uiPanel, alpha, 0);
  if (accent !== undefined) {
    ui.shapes.roundedRect(r.x, r.y, r.w, 6, 3, accent, 1, 0);
  }
}

export interface ButtonOptions {
  color?: number;
  disabled?: boolean;
  /** Smaller text, for dense rows. */
  small?: boolean;
  /** Draw as selected: filled with the colour rather than outlined. */
  active?: boolean;
}

/** Returns true on the frame the button is clicked. */
export function button(ui: UIContext, r: Rect, label: string, opts: ButtonOptions = {}): boolean {
  const color = opts.color ?? PALETTE.typeInfra;
  const over = !opts.disabled && hovered(ui, r);
  const press = over && ui.input.pointer.down;

  const lift = press ? 0 : over ? 2 : 0;
  const y = r.y - lift;

  ui.shapes.roundedRect(r.x, r.y + 3, r.w, r.h, 10, PALETTE.uiShadow, opts.disabled ? 0.08 : 0.22, 0);

  if (opts.active) {
    ui.shapes.roundedRect(r.x, y, r.w, r.h, 10, color, 1, 0);
    ui.shapes.roundedRect(r.x, y, r.w, r.h * 0.45, 10, shade(color, 0.25), 0.55, 0);
  } else {
    ui.shapes.roundedRect(r.x, y, r.w, r.h, 10, opts.disabled ? PALETTE.wallShade : PALETTE.uiPanel, 1, 0);
    ui.shapes.roundedRect(r.x, y + r.h - 4, r.w, 4, 2, opts.disabled ? PALETTE.uiPanelEdge : color, 1, 0);
    if (over) ui.shapes.roundedRect(r.x, y, r.w, r.h, 10, color, 0.1, 0);
  }

  drawText(ui.quads, opts.small ? ui.fontSmall : ui.font, label, r.x + r.w / 2, y + (r.h - (opts.small ? 13 : 18)) / 2, {
    color: opts.active ? PALETTE.inkOnDark : opts.disabled ? PALETTE.inkSoft : PALETTE.ink,
    align: 'center',
    letterSpacing: 1,
  });

  return over && ui.input.clicked;
}

/** A horizontal meter with a label and a value readout. */
export function meter(
  ui: UIContext,
  r: Rect,
  fraction: number,
  color: number,
  label: string,
  value: string,
  /** Fraction shown as a ghost behind the bar, e.g. the value before a hit. */
  ghost?: number,
): void {
  const f = Math.max(0, Math.min(1, fraction));
  ui.shapes.roundedRect(r.x, r.y, r.w, r.h, r.h / 2, PALETTE.uiShadow, 0.18, 0);
  if (ghost !== undefined && ghost > f) {
    ui.shapes.roundedRect(r.x, r.y, r.w * Math.min(1, ghost), r.h, r.h / 2, PALETTE.danger, 0.55, 0);
  }
  if (f > 0) {
    ui.shapes.roundedRect(r.x, r.y, Math.max(r.h, r.w * f), r.h, r.h / 2, color, 1, 0);
    ui.shapes.roundedRect(r.x + 2, r.y + 2, Math.max(r.h - 4, r.w * f - 4), r.h * 0.35, r.h / 3, shade(color, 0.35), 0.5, 0);
  }
  drawText(ui.quads, ui.fontSmall, label, r.x + 2, r.y - 16, { color: PALETTE.inkSoft, letterSpacing: 1.2 });
  drawText(ui.quads, ui.fontSmall, value, r.x + r.w - 2, r.y - 16, { color: PALETTE.ink, align: 'right' });
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

  ui.shapes.roundedRect(x, y + 3, w, h, 12, PALETTE.uiShadow, 0.3, 0);
  ui.shapes.roundedRect(x, y, w, h, 12, PALETTE.ink, 0.97, 0);
  drawText(ui.quads, ui.font, title, x + pad, y + pad - 2, { color: PALETTE.flowerYellow, letterSpacing: 1 });
  for (let i = 0; i < bodyLines.length; i++) {
    drawText(ui.quads, ui.fontSmall, bodyLines[i]!, x + pad, y + pad + 22 + i * ui.fontSmall.lineHeight, {
      color: PALETTE.uiPanel,
    });
  }
}

/** A small pill tag: "COST 24", "CD 3", a type label. */
export function tag(ui: UIContext, x: number, y: number, text: string, color: number, dark = false): number {
  const w = ui.fontSmall.measure(text) * 0.9 + 14;
  ui.shapes.roundedRect(x, y, w, 16, 8, color, dark ? 1 : 0.18, 0);
  drawText(ui.quads, ui.fontSmall, text, x + w / 2, y + 2, {
    color: dark ? PALETTE.inkOnDark : shade(color, -0.35),
    align: 'center',
    scale: 0.9,
    letterSpacing: 0.6,
  });
  return w;
}
