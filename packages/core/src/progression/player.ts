import {
  getCreature,
  getIncident,
  type CreatureSpec,
  type ResourceId,
} from '@stackmon/content';
import { newBase, type BaseState } from './base.js';
import type { Rng } from '@stackmon/util';

/**
 * Player state and progression.
 *
 * Everything that persists between battles: the roster of owned creatures,
 * their levels and experience, the resource stockpile, which incidents have
 * been beaten, and which technologies have been seen. Pure data and pure
 * functions over it, so the save file is just this object serialised and the
 * rules are testable without a browser.
 *
 * Levelling is deliberately gentle and capped low. Stats are the truth about
 * a technology, so a level 40 SQLite must never out-shard a level 10 Mongo -
 * levels add competence, they do not change what a thing is.
 */

export const MAX_LEVEL = 40;
export const MAX_PARTY = 3;
export const MAX_BENCH = 3;

export interface OwnedCreature {
  /** Stable id for this individual, so two Redis can be told apart. */
  uid: string;
  specId: string;
  level: number;
  xp: number;
  /** Fights this individual has been part of. Shown in the codex. */
  battles: number;
  /** Turn the player caught it, for the roster order. */
  caughtOn: number;
  nickname?: string;
}

export interface PlayerState {
  version: 1;
  /** Save-scoped seed so world generation and encounters are reproducible. */
  seed: string;
  /** Monotonic counter of "things that happened", used for ordering. */
  clock: number;

  roster: OwnedCreature[];
  /** uids in pipeline order: ingest, process, store. null is an empty slot. */
  party: (string | null)[];
  /** uids available to swap in. */
  bench: string[];

  resources: Record<ResourceId, number>;
  /** Farm plots, construction, and everything built. */
  base: BaseState;

  /** incident id -> best result. */
  incidents: Record<string, { won: number; lost: number; bestTurns: number | null }>;
  /** Creature ids the player has encountered, caught or not. */
  seen: string[];
  /** Skill ids unlocked by beating incidents. */
  unlockedSkills: string[];

  stats: {
    battles: number;
    victories: number;
    opsServed: number;
    opsDropped: number;
    captures: number;
  };
}

export function newPlayer(seed: string): PlayerState {
  return {
    version: 1,
    seed,
    clock: 0,
    roster: [],
    party: [null, null, null],
    bench: [],
    resources: { compute: 40, memory: 40, bandwidth: 20, storage: 20, scrap: 60 },
    base: newBase(),
    incidents: {},
    seen: [],
    unlockedSkills: [],
    stats: { battles: 0, victories: 0, opsServed: 0, opsDropped: 0, captures: 0 },
  };
}

/**
 * The starter party: one buffer, one worker, one store, and a cache and an
 * edge proxy on the bench. Every family but INTEL is represented, and the
 * lineup is deliberately reasonable rather than optimal - the player should
 * beat tier one with it and lose tier two, then go looking for what is missing.
 */
export function giveStarterParty(p: PlayerState): void {
  const starters = ['kafka', 'golang', 'postgres', 'redis', 'nginx'];
  const uids = starters.map((id) => addToRoster(p, id, 6).uid);
  p.party = [uids[0]!, uids[1]!, uids[2]!];
  p.bench = [uids[3]!, uids[4]!];
}

// ----------------------------------------------------------------- roster

export function addToRoster(p: PlayerState, specId: string, level = 5): OwnedCreature {
  const spec = getCreature(specId);
  p.clock++;
  const owned: OwnedCreature = {
    uid: `${spec.id}#${p.clock}`,
    specId: spec.id,
    level: Math.max(1, Math.min(MAX_LEVEL, Math.round(level))),
    xp: 0,
    battles: 0,
    caughtOn: p.clock,
  };
  p.roster.push(owned);
  markSeen(p, spec.id);
  return owned;
}

export function markSeen(p: PlayerState, specId: string): void {
  if (!p.seen.includes(specId)) p.seen.push(specId);
}

export function findOwned(p: PlayerState, uid: string): OwnedCreature | undefined {
  return p.roster.find((c) => c.uid === uid);
}

export const owns = (p: PlayerState, specId: string): boolean =>
  p.roster.some((c) => c.specId === specId);

/** Put a roster member into a party slot, moving whoever was there to the bench. */
export function assignToParty(p: PlayerState, uid: string, slot: number): void {
  if (slot < 0 || slot >= MAX_PARTY) throw new Error(`Bad party slot ${slot}`);
  if (!findOwned(p, uid)) throw new Error(`Not in roster: ${uid}`);

  // Remove from wherever it currently is.
  p.party = p.party.map((u) => (u === uid ? null : u));
  p.bench = p.bench.filter((u) => u !== uid);

  const displaced = p.party[slot];
  p.party[slot] = uid;
  if (displaced && p.bench.length < MAX_BENCH) p.bench.push(displaced);
}

export function assignToBench(p: PlayerState, uid: string): boolean {
  if (!findOwned(p, uid)) return false;
  if (p.bench.includes(uid) || p.party.includes(uid)) return false;
  if (p.bench.length >= MAX_BENCH) return false;
  p.bench.push(uid);
  return true;
}

// ------------------------------------------------------------ experience

/**
 * XP needed to go from `level` to `level + 1`.
 *
 * Quadratic-ish. Early levels come every fight or two, so the first hour
 * feels generous; the last ten levels take real commitment.
 */
export function xpToNext(level: number): number {
  return Math.round(60 + level * level * 4.2);
}

export interface LevelUpResult {
  uid: string;
  from: number;
  to: number;
}

/** Grant XP, applying as many level-ups as it buys. */
export function grantXp(c: OwnedCreature, amount: number): LevelUpResult | null {
  if (c.level >= MAX_LEVEL) return null;
  c.xp += Math.max(0, Math.round(amount));
  const from = c.level;
  while (c.level < MAX_LEVEL && c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level++;
  }
  if (c.level === MAX_LEVEL) c.xp = 0;
  return c.level > from ? { uid: c.uid, from, to: c.level } : null;
}

// --------------------------------------------------------------- battles

export interface BattleReport {
  incidentId: string;
  won: boolean;
  turns: number;
  opsServed: number;
  opsDropped: number;
  /** uids of roster members who were in the pipeline or on the bench. */
  participants: string[];
}

export interface BattleRewards {
  xpEach: number;
  scrap: number;
  levelUps: LevelUpResult[];
  unlocked: string[];
  firstClear: boolean;
}

/**
 * Apply the outcome of a battle to the player.
 *
 * A loss still pays a little XP. Players learn most from the fights they
 * lose, and a game that hands out nothing for a loss teaches them to avoid
 * hard fights, which is the opposite of what this one wants.
 */
export function applyBattle(p: PlayerState, report: BattleReport): BattleRewards {
  const spec = getIncident(report.incidentId);
  const record = (p.incidents[report.incidentId] ??= { won: 0, lost: 0, bestTurns: null });
  const firstClear = report.won && record.won === 0;

  if (report.won) {
    record.won++;
    if (record.bestTurns === null || report.turns < record.bestTurns) record.bestTurns = report.turns;
  } else {
    record.lost++;
  }

  p.stats.battles++;
  if (report.won) p.stats.victories++;
  p.stats.opsServed += Math.round(report.opsServed);
  p.stats.opsDropped += Math.round(report.opsDropped);

  const xpEach = Math.round(report.won ? spec.rewards.xp : spec.rewards.xp * 0.3);
  const scrap = report.won ? spec.rewards.scrap : Math.round(spec.rewards.scrap * 0.15);
  p.resources.scrap += scrap;

  const levelUps: LevelUpResult[] = [];
  for (const uid of report.participants) {
    const c = findOwned(p, uid);
    if (!c) continue;
    c.battles++;
    const up = grantXp(c, xpEach);
    if (up) levelUps.push(up);
  }

  const unlocked: string[] = [];
  if (report.won) {
    for (const skill of spec.rewards.unlocks ?? []) {
      if (!p.unlockedSkills.includes(skill)) {
        p.unlockedSkills.push(skill);
        unlocked.push(skill);
      }
    }
  }

  p.clock++;
  return { xpEach, scrap, levelUps, unlocked, firstClear };
}

// --------------------------------------------------------------- capture

export interface CaptureAttempt {
  specId: string;
  /** Level of the wild creature. */
  level: number;
  /** Scrap the player is willing to spend. More scrap, better odds. */
  scrapOffered: number;
}

export interface CaptureResult {
  success: boolean;
  chance: number;
  scrapSpent: number;
  owned?: OwnedCreature;
}

/** Scrap it costs to make a capture attempt at all. */
export function captureCost(spec: CreatureSpec, level: number): number {
  // Rarer and higher-level creatures cost more to approach.
  const rarityFactor = 1 + (60 - Math.min(60, spec.rarity)) / 40;
  return Math.round((14 + level * 2.2) * rarityFactor);
}

/**
 * Probability of a capture succeeding.
 *
 * Common creatures are near-certain, rare ones are a real gamble, and paying
 * over the base cost buys odds at a steep discount so the player always has
 * something to do with spare scrap.
 */
export function captureChance(spec: CreatureSpec, level: number, scrapOffered: number): number {
  const base = 0.35 + Math.min(60, spec.rarity) / 100;
  const cost = captureCost(spec, level);
  const overpay = Math.max(0, scrapOffered - cost) / Math.max(1, cost);
  const bonus = Math.min(0.4, overpay * 0.35);
  return Math.max(0.05, Math.min(0.98, base + bonus));
}

export function attemptCapture(p: PlayerState, attempt: CaptureAttempt, rng: Rng): CaptureResult {
  const spec = getCreature(attempt.specId);
  const cost = captureCost(spec, attempt.level);
  const spent = Math.min(p.resources.scrap, Math.max(cost, attempt.scrapOffered));
  markSeen(p, spec.id);

  if (spent < cost) {
    return { success: false, chance: 0, scrapSpent: 0 };
  }

  const chance = captureChance(spec, attempt.level, spent);
  p.resources.scrap -= spent;
  p.clock++;

  if (!rng.chance(chance)) {
    return { success: false, chance, scrapSpent: spent };
  }

  const owned = addToRoster(p, spec.id, attempt.level);
  p.stats.captures++;
  // A caught creature goes straight to the bench if there is room, so the
  // player can use it in the very next fight without a menu trip.
  assignToBench(p, owned.uid);
  return { success: true, chance, scrapSpent: spent, owned };
}

// ---------------------------------------------------------------- lineup

/** The party and bench as the battle simulator wants them. */
export function battleLineup(p: PlayerState): {
  lineup: ({ specId: string; level: number; uid: string } | null)[];
  bench: { specId: string; level: number; uid: string }[];
} {
  const toMember = (uid: string) => {
    const c = findOwned(p, uid);
    return c ? { specId: c.specId, level: c.level, uid: c.uid } : null;
  };
  return {
    lineup: p.party.map((uid) => (uid ? toMember(uid) : null)),
    bench: p.bench.map(toMember).filter((m): m is NonNullable<typeof m> => m !== null),
  };
}

/** Sanity-check a loaded save and repair what can be repaired. */
export function normalise(p: PlayerState): PlayerState {
  // Saves written before the base layer existed have no base at all.
  p.base ??= newBase();
  p.base.plots ??= [];
  p.base.built ??= [];
  p.base.seenGates ??= [];
  p.base.building ??= null;

  const uids = new Set(p.roster.map((c) => c.uid));
  p.party = Array.from({ length: MAX_PARTY }, (_, i) => {
    const u = p.party[i] ?? null;
    return u && uids.has(u) ? u : null;
  });
  p.bench = p.bench.filter((u) => uids.has(u) && !p.party.includes(u)).slice(0, MAX_BENCH);
  for (const c of p.roster) {
    c.level = Math.max(1, Math.min(MAX_LEVEL, Math.round(c.level)));
    c.xp = Math.max(0, c.xp);
  }
  return p;
}
