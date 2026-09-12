/**
 * The palette.
 *
 * One file, because a consistent colour language is most of what separates a
 * game that looks designed from one that looks assembled. Nothing anywhere
 * else in the game is allowed to write a hex literal.
 *
 * The world is a data centre at night: a very dark blue-black ground, cool
 * steel surfaces, and saturated neon reserved for things that carry meaning.
 * Neon is a scarce resource here. If everything glows, nothing reads.
 */

export const PALETTE = {
  // --- ground and structure ---
  voidDeep: 0x05070f,
  voidMid: 0x0a1020,
  panelDark: 0x141d31,
  panel: 0x1e2a45,
  panelLight: 0x2b3c60,
  steel: 0x3d5480,
  steelLight: 0x5a74a4,
  chrome: 0x9db2d6,

  // --- terrain, by elevation ---
  // Terrain has to carry real tonal range or the isometric faces collapse
  // into one another and the whole island reads as a flat smudge. These run
  // from a shadowed base to a lit plateau, and the face shading in isoBlock
  // then spreads each of them further.
  terrainBase: 0x16203a,
  terrainLow: 0x24314f,
  terrainMid: 0x334a70,
  terrainHigh: 0x445e90,
  terrainPeak: 0x5876ab,

  // --- text ---
  ink: 0xdce9ff,
  inkDim: 0x8aa0c4,
  inkFaint: 0x51658a,

  // --- the six type colours ---
  // Each creature family owns one hue, and nothing else may use it. This is
  // what lets a player identify a type from a glance at a silhouette glow.
  typeData: 0x4d8cff, // relational stores, disks, persistence
  typeStream: 0xb44dff, // queues, brokers, event logs
  typeRuntime: 0xffb03a, // languages, VMs, interpreters
  typeInfra: 0x2ce5c8, // containers, orchestrators, networking
  typeCache: 0xff4d6d, // in-memory, ephemeral, fast
  typeIntel: 0xa8ff4d, // search, analytics, ML

  // --- semantics ---
  good: 0x3ddc84,
  warn: 0xffc53d,
  danger: 0xff4d6d,
  info: 0x4dd8ff,

  // --- resources ---
  resCompute: 0xff9e3d,
  resMemory: 0x4d8cff,
  resBandwidth: 0x2ce5c8,
  resStorage: 0xa98bff,

  // --- effects ---
  glowCyan: 0x7ef0ff,
  glowWhite: 0xeaf6ff,
  shadow: 0x000308,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * The six creature families.
 *
 * These are not arbitrary buckets: each family groups technologies that make
 * the same core trade-off, which is what makes the type chart teachable
 * rather than memorisable. Cache trades durability for latency. Data trades
 * latency for durability. That relationship is the whole game.
 */
export const TYPES = {
  data: {
    id: 'data',
    label: 'DATA',
    color: PALETTE.typeData,
    tagline: 'Durable, consistent, deliberate.',
  },
  stream: {
    id: 'stream',
    label: 'STREAM',
    color: PALETTE.typeStream,
    tagline: 'Buffers everything, guarantees order, never forgets.',
  },
  runtime: {
    id: 'runtime',
    label: 'RUNTIME',
    color: PALETTE.typeRuntime,
    tagline: 'Where the work actually happens.',
  },
  infra: {
    id: 'infra',
    label: 'INFRA',
    color: PALETTE.typeInfra,
    tagline: 'Moves it, packs it, keeps it alive.',
  },
  cache: {
    id: 'cache',
    label: 'CACHE',
    color: PALETTE.typeCache,
    tagline: 'Blindingly fast, and forgets the moment it dies.',
  },
  intel: {
    id: 'intel',
    label: 'INTEL',
    color: PALETTE.typeIntel,
    tagline: 'Finds the needle, learns the shape, answers the question.',
  },
} as const;

export type TypeId = keyof typeof TYPES;

export const TYPE_IDS = Object.keys(TYPES) as TypeId[];

export const typeColor = (t: TypeId): number => TYPES[t].color;

/** Slightly darker variant of a type colour, for fills under neon trim. */
export function typeFill(t: TypeId): number {
  const c = TYPES[t].color;
  const r = Math.round(((c >> 16) & 0xff) * 0.22);
  const g = Math.round(((c >> 8) & 0xff) * 0.22);
  const b = Math.round((c & 0xff) * 0.26);
  return (r << 16) | (g << 8) | b;
}
