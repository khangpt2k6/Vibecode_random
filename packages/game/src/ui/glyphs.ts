import type { ShapeBatch } from '@stackmon/engine';

/**
 * Interface glyphs.
 *
 * Small vector marks for buttons and headers - a scroll, a hammer, a book, a
 * question mark. Distinct from `art/icons.ts`, which draws technology logos:
 * these say what a control does, those say what a thing is.
 *
 * They replace the coloured tab that used to sit on the leading edge of every
 * button. A two-pixel bar of colour carries no meaning on its own - the
 * player has to read the label anyway - so it was decoration pretending to be
 * information. A hammer is readable before the text is.
 *
 * Every glyph draws inside a box of half-extent `r` centred on (cx, cy), in
 * the single colour it is given, so a caller can flip it with the label.
 */

export type Glyph = (b: ShapeBatch, cx: number, cy: number, r: number, color: number) => void;

/** A checklist on a page: the missions mark. */
export const glyphMissions: Glyph = (b, cx, cy, r, color) => {
  // page with a folded corner
  b.polygon(
    [
      cx - r * 0.72, cy - r,
      cx + r * 0.4, cy - r,
      cx + r * 0.72, cy - r * 0.66,
      cx + r * 0.72, cy + r,
      cx - r * 0.72, cy + r,
    ],
    color, 0.95, 0,
  );
  // three ticked lines, punched out of the page
  for (let i = 0; i < 3; i++) {
    const ly = cy - r * 0.46 + i * r * 0.5;
    b.polyline(
      [cx - r * 0.5, ly, cx - r * 0.3, ly + r * 0.18, cx - r * 0.02, ly - r * 0.2],
      r * 0.16, 0x0d1a2e, 1, 0,
    );
    b.rect(cx + r * 0.14, ly - r * 0.08, r * 0.44, r * 0.16, 0x0d1a2e, 1, 0);
  }
};

/** A hammer: the build mark. */
export const glyphBuild: Glyph = (b, cx, cy, r, color) => {
  // handle, running lower-left to upper-right
  b.line(cx - r * 0.62, cy + r * 0.78, cx + r * 0.26, cy - r * 0.16, r * 0.28, color, 0.95, 0);
  // head, square to the handle
  b.polygon(
    [
      cx - r * 0.06, cy - r * 0.62,
      cx + r * 0.52, cy - r * 0.98,
      cx + r * 0.92, cy - r * 0.3,
      cx + r * 0.34, cy + r * 0.06,
    ],
    color, 1, 0,
  );
};

/** An open book: the codex mark. */
export const glyphCodex: Glyph = (b, cx, cy, r, color) => {
  // two leaves meeting at a spine, each with a slight curl at the outer edge
  b.polygon(
    [cx - r * 0.86, cy - r * 0.56, cx - r * 0.06, cy - r * 0.3, cx - r * 0.06, cy + r * 0.72, cx - r * 0.86, cy + r * 0.44],
    color, 0.95, 0,
  );
  b.polygon(
    [cx + r * 0.86, cy - r * 0.56, cx + r * 0.06, cy - r * 0.3, cx + r * 0.06, cy + r * 0.72, cx + r * 0.86, cy + r * 0.44],
    color, 0.78, 0,
  );
  b.rect(cx - r * 0.07, cy - r * 0.32, r * 0.14, r * 1.06, color, 1, 0);
};

/** A question mark in a disc: the help mark. */
export const glyphHelp: Glyph = (b, cx, cy, r, color) => {
  b.circle(cx, cy, r * 0.92, color, 0.95, 0, 18);
  const ink = 0x0d1a2e;
  // hook
  b.polyline(
    [
      cx - r * 0.3, cy - r * 0.3,
      cx, cy - r * 0.56,
      cx + r * 0.3, cy - r * 0.26,
      cx + r * 0.04, cy + r * 0.06,
      cx + r * 0.02, cy + r * 0.26,
    ],
    r * 0.19, ink, 1, 0,
  );
  b.circle(cx + r * 0.02, cy + r * 0.6, r * 0.13, ink, 1, 0, 8);
};

/** A cross: close. */
export const glyphClose: Glyph = (b, cx, cy, r, color) => {
  b.line(cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6, r * 0.26, color, 1, 0);
  b.line(cx + r * 0.6, cy - r * 0.6, cx - r * 0.6, cy + r * 0.6, r * 0.26, color, 1, 0);
};

/** A sprout: the farm mark. */
export const glyphFarm: Glyph = (b, cx, cy, r, color) => {
  b.line(cx, cy + r * 0.9, cx, cy - r * 0.3, r * 0.18, color, 1, 0);
  b.blob(cx - r * 0.44, cy - r * 0.24, r * 0.42, r * 0.3, 1.1, color, 0.95, 0, 10);
  b.blob(cx + r * 0.44, cy - r * 0.5, r * 0.42, r * 0.3, 2.6, color, 0.8, 0, 10);
};

/**
 * A lightning bolt: the incident mark.
 *
 * This was crossed swords, which at eight pixels is a diagonal cross and
 * therefore indistinguishable from `glyphClose` - so "GO FIGHT" read as
 * "cancel". A bolt survives being small, and an incident is a spike of load
 * rather than a duel anyway.
 */
export const glyphFight: Glyph = (b, cx, cy, r, color) => {
  // Two triangles, not one polygon: `polygon` triangulates as a fan from the
  // first point, and a bolt is concave, so a fan would fill across the notch.
  b.triangle(
    cx + r * 0.5, cy - r,
    cx - r * 0.46, cy + r * 0.16,
    cx + r * 0.14, cy + r * 0.16,
    color, 1, 0,
  );
  b.triangle(
    cx - r * 0.5, cy + r,
    cx + r * 0.46, cy - r * 0.16,
    cx - r * 0.14, cy - r * 0.16,
    color, 1, 0,
  );
};

/** A pin: go to a place on the map. */
export const glyphPin: Glyph = (b, cx, cy, r, color) => {
  b.circle(cx, cy - r * 0.24, r * 0.62, color, 1, 0, 14);
  b.triangle(cx - r * 0.4, cy + r * 0.06, cx + r * 0.4, cy + r * 0.06, cx, cy + r * 0.96, color, 1, 0);
  b.circle(cx, cy - r * 0.24, r * 0.24, 0x0d1a2e, 1, 0, 10);
};

export const GLYPHS = {
  missions: glyphMissions,
  build: glyphBuild,
  codex: glyphCodex,
  help: glyphHelp,
  close: glyphClose,
  farm: glyphFarm,
  fight: glyphFight,
  pin: glyphPin,
} as const;

export type GlyphName = keyof typeof GLYPHS;
