/**
 * The palette.
 *
 * One file, because a consistent colour language is most of what separates a
 * game that looks designed from one that looks assembled. Nothing anywhere
 * else in the game writes a hex literal.
 *
 * Direction: bright stylised daylight. Saturated but not neon, warm sun from
 * the upper left, cool blue in the shade. The single most important rule is
 * that shadows are never grey - a shaded face is the lit colour pulled
 * toward blue, never toward black. That one decision is most of the
 * difference between "3D cartoon" and "flat diagram".
 */

export const PALETTE = {
  // --- sky and atmosphere ---
  skyTop: 0x4fbcf0,
  skyMid: 0x93dcfa,
  skyLow: 0xd9f4ff,
  cloud: 0xffffff,
  haze: 0xc8ecff,

  // --- ground ---
  grassLight: 0x9ede54,
  grass: 0x7fcb3f,
  grassDeep: 0x63ad2c,
  grassDark: 0x4b8c22,

  sand: 0xf2dfa8,
  sandDeep: 0xdcc287,
  path: 0xe8cf94,
  pathDeep: 0xcbae74,

  soil: 0xb4804c,
  soilDeep: 0x8d5f36,

  rock: 0xa9a597,
  rockDeep: 0x86826f,
  cliff: 0xc0b59c,
  cliffDeep: 0x9a9078,

  water: 0x3fb9e8,
  waterDeep: 0x2a92c9,
  waterFoam: 0xe2f9ff,

  // --- plants ---
  leafLight: 0x8ad94f,
  leaf: 0x5fb832,
  leafDeep: 0x3f8f22,
  trunk: 0x9a6b3f,
  trunkDeep: 0x74502e,

  flowerPink: 0xff89c4,
  flowerYellow: 0xffd84d,
  flowerWhite: 0xfff6e0,
  flowerBlue: 0x86a6ff,

  // --- structures ---
  wall: 0xfdf3e0,
  wallShade: 0xe6d7bf,
  wallWarm: 0xffe6bd,
  woodLight: 0xd6a35f,
  wood: 0xb07f42,
  metal: 0xd2dae3,
  metalDeep: 0xa5b0bd,
  glass: 0x8fd8f2,

  // --- text and UI ---
  ink: 0x2f3b4a,
  inkSoft: 0x5d6b7d,
  inkOnDark: 0xffffff,
  uiPanel: 0xfffaf0,
  uiPanelEdge: 0xd9c9a8,
  uiShadow: 0x1d2733,

  // --- the six type colours ---
  // Each family owns one hue and nothing else may use it, so a player can
  // identify a type from a roof colour at a glance. Chosen to stay legible
  // against bright green, which rules out most greens.
  typeData: 0x3d7ff0,
  typeStream: 0xa855f7,
  typeRuntime: 0xff9d2e,
  typeInfra: 0x14c7a8,
  typeCache: 0xff5470,
  typeIntel: 0xffd029,

  // --- semantics ---
  good: 0x35c65f,
  warn: 0xffb020,
  danger: 0xf2495c,
  info: 0x36a9e8,

  // --- resources ---
  resCompute: 0xff8a3d,
  resMemory: 0x4d8cff,
  resBandwidth: 0x18cfb0,
  resStorage: 0xa87bff,

  // --- effects ---
  sun: 0xfff2c4,
  shadow: 0x2a4a6e,
  sparkle: 0xffffff,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * Tint a colour toward the sun or toward shadow.
 *
 * `amount` above 0 warms toward sunlight; below 0 cools toward the shadow
 * blue. Using a blue for shade rather than black is what keeps shaded faces
 * looking lit-from-the-sky rather than dirty, and it is the whole trick.
 */
export function shade(rgb: number, amount: number): number {
  const target = amount >= 0 ? PALETTE.sun : PALETTE.shadow;
  const t = Math.min(1, Math.abs(amount));
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  return (
    (Math.round(r + (tr - r) * t) << 16) |
    (Math.round(g + (tg - g) * t) << 8) |
    Math.round(b + (tb - b) * t)
  );
}

/** Blend two colours in sRGB. Good enough for everything the game tints. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/**
 * Face colours for a block, sun in the upper left.
 *
 * The contrast is gentle on purpose. A steep falloff reads as dramatic and
 * heavy; a shallow one reads as a bright afternoon, which is the mood.
 */
export function faceColors(rgb: number): { top: number; right: number; left: number } {
  return {
    top: shade(rgb, 0.1),
    right: shade(rgb, -0.16),
    left: shade(rgb, -0.32),
  };
}

/**
 * The six creature families.
 *
 * The authoritative definitions live in @stackmon/content; this only attaches
 * colour, because content must not know anything about rendering.
 */
export const TYPE_COLORS = {
  data: PALETTE.typeData,
  stream: PALETTE.typeStream,
  runtime: PALETTE.typeRuntime,
  infra: PALETTE.typeInfra,
  cache: PALETTE.typeCache,
  intel: PALETTE.typeIntel,
} as const;

export type TypeId = keyof typeof TYPE_COLORS;

export const TYPE_IDS = Object.keys(TYPE_COLORS) as TypeId[];

export const typeColor = (t: TypeId): number => TYPE_COLORS[t];

/** Pale wall colour to sit under a roof of the given type colour. */
export function typeTint(t: TypeId): number {
  return shade(TYPE_COLORS[t], 0.66);
}
