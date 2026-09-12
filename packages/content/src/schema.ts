import type { TypeId } from './types.js';

/**
 * Creature and skill definitions.
 *
 * A creature is a technology. Its six stats are its real engineering
 * characteristics, expressed on a 1-200 scale where 100 is "unremarkable".
 * Nothing here is tuned for game balance first: the stats are written to be
 * true, and balance is handled by the cost and cooldown of skills, by the
 * role system, and by what the enemy scenarios demand.
 */

/**
 * The six stats.
 *
 * These map one-to-one onto the axes engineers actually argue about, which
 * is what lets a player transfer what they learn here to real decisions.
 */
export interface Stats {
  /** Work handled per tick. Raw volume. The attack stat. */
  throughput: number;
  /**
   * Response time, in arbitrary units where lower is faster.
   *
   * Inverted relative to every other stat, deliberately: latency is a cost,
   * not a virtue, and a player reading a stat block should feel that.
   */
  latency: number;
  /** How much punishment it takes before it goes down. Effective HP. */
  durability: number;
  /** Buffer capacity. How much overflow it can hold instead of dropping. */
  memory: number;
  /** Correctness under stress. Resistance to corruption and debuffs. */
  consistency: number;
  /** How much it gains from scaling out rather than up. */
  scalability: number;
}

/**
 * Where a creature sits in the pipeline.
 *
 * A pipeline runs INGEST -> PROCESS -> STORE. Every creature can stand in
 * any slot, but it works at full strength only in the roles it is actually
 * built for. Putting Redis in STORE is legal, effective, and will eventually
 * cost you everything you put in it - which is the lesson.
 */
export type Role = 'ingest' | 'process' | 'store';

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  ingest: {
    label: 'INGEST',
    description: 'Accepts incoming load. What it cannot absorb is dropped.',
  },
  process: {
    label: 'PROCESS',
    description: 'Transforms what ingest accepted. The work itself happens here.',
  },
  store: {
    label: 'STORE',
    description: 'Persists and serves results. What it loses is lost for good.',
  },
};

export type SkillTarget =
  | 'enemy' // the incident
  | 'self'
  | 'ally' // another creature in your pipeline
  | 'pipeline'; // the whole pipeline at once

export type StatKey = keyof Stats;

/**
 * What a skill does. A discriminated union rather than a script, so the
 * simulator stays pure and every effect is inspectable by tests and by the
 * balance tooling.
 */
export type Effect =
  | {
      kind: 'damage';
      /** Base power. Final damage also scales with the stat named below. */
      power: number;
      scaling?: StatKey;
      /** Multi-hit skills roll effectiveness per hit. */
      hits?: number;
      /** Ignores shields and buffers. Used by poison-pill style attacks. */
      piercing?: boolean;
    }
  | {
      kind: 'buffer';
      /** Extra overflow capacity, as a fraction of the creature's memory. */
      amount: number;
      turns: number;
    }
  | { kind: 'repair'; amount: number; target: SkillTarget }
  | { kind: 'shield'; amount: number; turns: number; target: SkillTarget }
  | { kind: 'cleanse'; target: SkillTarget }
  | {
      kind: 'statMod';
      stat: StatKey;
      /** Multiplier. 1.5 is +50%; 0.7 is -30%. */
      mult: number;
      turns: number;
      target: SkillTarget;
    }
  | { kind: 'drain'; power: number; scaling?: StatKey; /** Fraction healed. */ leech: number }
  | { kind: 'overTime'; power: number; turns: number; label: string }
  | {
      kind: 'replay';
      /** Fraction of max durability restored to a downed ally. */
      amount: number;
    }
  | { kind: 'budget'; amount: number };

export interface Skill {
  id: string;
  name: string;
  type: TypeId;
  target: SkillTarget;
  effects: Effect[];
  /** Memory spent to use it. Gates the strong skills behind resource planning. */
  cost: number;
  /** Turns before it can be used again. */
  cooldown: number;
  /** Priority beats latency for turn order. Most skills are 0. */
  priority?: number;
  /** Flavour, but accurate flavour. This is where the teaching lands. */
  description: string;
  /** The real mechanism this skill is modelling, shown in the codex. */
  realWorld: string;
}

export interface Evolution {
  /** Creature id it becomes. */
  into: string;
  /** Level required. */
  level: number;
  /** Human-readable unlock condition, if there is one beyond level. */
  condition?: string;
}

export interface CreatureSpec {
  id: string;
  name: string;
  /** The actual technology, spelled properly, for the codex. */
  realName: string;
  type: TypeId;
  /** A creature can be competent in more than one slot. */
  roles: Role[];
  /** Base stats at level 1. */
  base: Stats;
  /** Per-level gain, applied linearly. Shapes how a creature ages. */
  growth: Stats;
  skills: string[];
  /** How often it appears in the wild. Higher is more common. */
  rarity: number;
  /** Biomes it spawns in. */
  habitats: string[];
  evolution?: Evolution;
  /** One paragraph the player reads on capture. Must be true. */
  codex: string;
  /** The single most important thing to know about it. */
  keyInsight: string;
}

/** Stats at a given level, derived from base and growth. */
export function statsAtLevel(spec: CreatureSpec, level: number): Stats {
  const n = Math.max(0, level - 1);
  return {
    throughput: Math.round(spec.base.throughput + spec.growth.throughput * n),
    // Latency improves as a creature levels, so growth is subtracted here.
    // Clamped so nothing ever reaches zero latency, which would break turn
    // order and is a lie anyway.
    latency: Math.max(1, Math.round(spec.base.latency - spec.growth.latency * n)),
    durability: Math.round(spec.base.durability + spec.growth.durability * n),
    memory: Math.round(spec.base.memory + spec.growth.memory * n),
    consistency: Math.round(spec.base.consistency + spec.growth.consistency * n),
    scalability: Math.round(spec.base.scalability + spec.growth.scalability * n),
  };
}

/** Maximum durability points at a level. */
export function maxHp(spec: CreatureSpec, level: number): number {
  const s = statsAtLevel(spec, level);
  // Durability dominates, with memory contributing a little: a system with
  // headroom takes longer to fall over than one running at its limit.
  return Math.round(s.durability * 2.2 + s.memory * 0.35 + level * 4);
}

/** Overflow a creature can hold before it starts dropping work. */
export function bufferCapacity(spec: CreatureSpec, level: number): number {
  return Math.round(statsAtLevel(spec, level).memory * 0.8);
}
