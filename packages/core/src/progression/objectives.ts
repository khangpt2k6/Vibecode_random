import { CROPS, getBuilding, unlockedTier } from '@stackmon/content';
import type { PlayerState } from './player.js';
import { isReady } from './base.js';

/**
 * Objectives - the tutorial, and the answer to "what do I do now".
 *
 * A chain of one-at-a-time goals, each a function over player state rather
 * than a flag that something has to remember to set. That matters: a flag
 * can be missed, a save from an older version can lack it, and a player who
 * did the thing before the game asked gets stuck staring at a goal they have
 * already completed. Deriving from state means the tracker is always correct,
 * including for a save that has never seen it.
 *
 * The order is the intended first hour: look around, catch something, fight
 * something, build the grid, farm, then the real build tree opens up.
 */

/**
 * The smallest thing scrap can still buy.
 *
 * Read off the crop table rather than written as a number, so the warning
 * below stays true if seed prices move.
 */
const CHEAPEST_SEED_COST = Math.min(...CROPS.map((c) => c.seedCost.scrap ?? 0));

/** Where the "GO" button on a quest should send the player. */
export type ObjectiveTarget = 'wild' | 'ops' | 'plot' | 'build' | 'codex';

export interface Objective {
  id: string;
  /** What the player is asked to do. Imperative, short. */
  title: string;
  /** Why it matters, in one line. This is where the teaching goes. */
  why: string;
  /** How to do it, mechanically. */
  how: string;
  /** True when this objective is finished. */
  done: (p: PlayerState, now: number) => boolean;
  /** 0..1 for a progress bar, when the goal is countable. */
  progress?: (p: PlayerState, now: number) => number;
  /** "2 / 6" under the progress bar, when a count reads better than a ratio. */
  count?: (p: PlayerState, now: number) => { have: number; need: number };
  /** Paid once, the first time it is seen complete. */
  reward: { xp: number; scrap: number };
  /** What the quest log's GO button does. */
  target: ObjectiveTarget;
}

export const OBJECTIVES: Objective[] = [
  {
    id: 'look-around',
    reward: { xp: 20, scrap: 25 },
    target: 'codex',
    title: 'Look around the island',
    why: 'Every creature here is a real technology, and its stats are its real trade-offs.',
    how: 'Drag or use WASD to pan, scroll to zoom. Press G to open the codex.',
    done: (p) => p.seen.length > 5,
    progress: (p) => Math.min(1, p.seen.length / 6),
    count: (p) => ({ have: Math.min(6, p.seen.length), need: 6 }),
  },
  {
    id: 'first-capture',
    reward: { xp: 40, scrap: 40 },
    target: 'wild',
    title: 'Capture a wild technology',
    why: 'Your roster is your stack. You cannot build a pipeline out of things you do not have.',
    how: 'Hover a wandering creature and click it. Capturing costs scrap.',
    done: (p) => p.stats.captures >= 1,
  },
  {
    id: 'first-battle',
    reward: { xp: 40, scrap: 30 },
    target: 'ops',
    title: 'Respond to an incident',
    why: 'Incidents are real production failures. Beating one means you built something that survives it.',
    how: 'Click the Ops Centre in the middle of the island.',
    done: (p) => p.stats.battles >= 1,
  },
  {
    id: 'first-win',
    reward: { xp: 80, scrap: 60 },
    target: 'ops',
    title: 'Resolve an incident',
    why: 'You win by serving traffic through it, not by attacking it. Throughput is the weapon.',
    how: 'Keep the pipeline flowing. Buffer at INGEST so a spike does not become dropped requests.',
    done: (p) => p.stats.victories >= 1,
  },
  {
    id: 'power-grid',
    reward: { xp: 60, scrap: 40 },
    target: 'build',
    title: 'Build the Power Grid',
    why: 'Nothing runs without power. It opens your first farm plots.',
    how: 'Press B to open the build menu. The grid costs scrap, which incidents pay out.',
    done: (p) => p.base.built.includes('power-grid'),
  },
  {
    id: 'first-plant',
    reward: { xp: 50, scrap: 30 },
    target: 'plot',
    title: 'Plant something',
    why: 'Compute, memory, bandwidth and storage are the four currencies of every system you will ever build.',
    how: 'Click an empty plot next to the Ops Centre and pick a crop.',
    done: (p) => p.base.plots.some((x) => x.cropId !== null) || p.resources.compute > 60,
  },
  {
    id: 'first-harvest',
    reward: { xp: 50, scrap: 35 },
    target: 'plot',
    title: 'Harvest a crop',
    why: 'Resources are what the build tree spends. Everything above the grid needs them.',
    how: 'Click a plot once it is ready. Crops keep growing while the tab is closed.',
    done: (p) => p.resources.compute > 60 || p.resources.storage > 40,
  },
  {
    id: 'runtime-forge',
    reward: { xp: 90, scrap: 60 },
    target: 'build',
    title: 'Build the Runtime Forge',
    why: 'A runtime is the floor of every stack. Before you have one you have source code and a wish.',
    how: 'Press B. It needs compute and memory, so farm those first.',
    done: (p) => p.base.built.includes('runtime-forge'),
  },
  {
    id: 'branch-out',
    reward: { xp: 110, scrap: 70 },
    target: 'build',
    title: 'Build a Data Vault or a Message Broker',
    why: 'Storage and streaming are the two branches every architecture grows from. Pick one.',
    how: 'Press B. Both only need the Power Grid, so either is open to you now.',
    done: (p) => p.base.built.includes('data-vault') || p.base.built.includes('message-broker'),
  },
  {
    id: 'tier-two',
    reward: { xp: 120, scrap: 80 },
    target: 'build',
    title: 'Unlock tier 2 incidents',
    why: 'Tier 1 is raw volume. Tier 2 is corruption, partitions and leaks - different problems, different stacks.',
    how: 'Build the Message Broker.',
    done: (p) => unlockedTier(p.base.built) >= 2,
  },
  {
    id: 'containers',
    reward: { xp: 160, scrap: 110 },
    target: 'build',
    title: 'Reach the Container Yard',
    why: 'Registry, then containers, then orchestration. That order is not arbitrary - each one needs the last.',
    how: 'Image Registry needs the Runtime Forge. The Container Yard needs the Registry.',
    done: (p) => p.base.built.includes('container-yard'),
  },
  {
    id: 'six-families',
    reward: { xp: 220, scrap: 150 },
    target: 'wild',
    title: 'Own a creature from every family',
    why: 'No single family answers every incident. Bench depth is what lets you swap mid-fight.',
    how: 'Keep capturing. The codex (G) shows which families you are missing.',
    done: (p, _now) => familiesOwned(p) >= 6,
    progress: (p) => familiesOwned(p) / 6,
    count: (p) => ({ have: familiesOwned(p), need: 6 }),
  },
];

/** Distinct families represented in the roster. */
function familiesOwned(p: PlayerState): number {
  const families = new Set<string>();
  for (const c of p.roster) {
    // The family is derivable from the spec, but importing the whole creature
    // table here would make this module depend on content it does not need.
    // The id prefix is enough: the caller passes specIds that exist.
    families.add(FAMILY_OF[c.specId] ?? '?');
  }
  families.delete('?');
  return families.size;
}

/**
 * specId -> family.
 *
 * A small duplicated table rather than a content import, so the objective
 * list stays a pure function of PlayerState and can be evaluated in a test
 * without loading the creature roster. It is checked against content by a
 * test, so it cannot drift silently.
 */
export const FAMILY_OF: Record<string, string> = {
  postgres: 'data', mysql: 'data', mongo: 'data', sqlite: 'data',
  kafka: 'stream', rabbitmq: 'stream', pulsar: 'stream', nats: 'stream',
  jvm: 'runtime', cpython: 'runtime', node: 'runtime', golang: 'runtime',
  docker: 'infra', kubernetes: 'infra', nginx: 'infra', envoy: 'infra',
  redis: 'cache', memcached: 'cache', varnish: 'cache', caffeine: 'cache',
  elasticsearch: 'intel', spark: 'intel', clickhouse: 'intel', milvus: 'intel',
};

/** The first unfinished objective, or null when they are all done. */
export function currentObjective(p: PlayerState, now: number): Objective | null {
  return OBJECTIVES.find((o) => !o.done(p, now)) ?? null;
}

export function objectivesDone(p: PlayerState, now: number): number {
  return OBJECTIVES.filter((o) => o.done(p, now)).length;
}

/**
 * 1-based position of the current objective in the chain.
 *
 * Not the same as the number completed: a player can finish a later goal
 * early - catching something before being asked to - and then the count and
 * the position disagree. Showing the count next to the first unfinished title
 * reads as a bug, because it is one.
 */
export function objectivePosition(p: PlayerState, now: number): number {
  const i = OBJECTIVES.findIndex((o) => !o.done(p, now));
  return i < 0 ? OBJECTIVES.length : i + 1;
}

export interface ClaimedObjective {
  id: string;
  title: string;
  xp: number;
  scrap: number;
}

/**
 * Pay out every finished objective that has not been paid yet.
 *
 * Objectives are derived from state, so "finished" is recomputed constantly
 * and cannot itself carry a paid flag. The list of claimed ids lives on the
 * player instead, which also means a save from before rewards existed pays
 * out its backlog once on load rather than silently swallowing it.
 *
 * XP is spread over the roster rather than going to one creature, because a
 * quest is something the whole stack did.
 */
export function claimObjectiveRewards(p: PlayerState, now: number): ClaimedObjective[] {
  p.claimedObjectives ??= [];
  const claimed: ClaimedObjective[] = [];

  for (const o of OBJECTIVES) {
    if (p.claimedObjectives.includes(o.id)) continue;
    if (!o.done(p, now)) continue;
    p.claimedObjectives.push(o.id);
    p.resources.scrap += o.reward.scrap;
    claimed.push({ id: o.id, title: o.title, xp: o.reward.xp, scrap: o.reward.scrap });
  }
  return claimed;
}

/** Total scrap and XP still unclaimed, for the quest log header. */
export function outstandingRewards(p: PlayerState, now: number): { xp: number; scrap: number } {
  let xp = 0;
  let scrap = 0;
  for (const o of OBJECTIVES) {
    if (o.done(p, now)) continue;
    xp += o.reward.xp;
    scrap += o.reward.scrap;
  }
  return { xp, scrap };
}

/**
 * Hints that fire on the current world state rather than on progress.
 *
 * These are the "you have crops ready" nudges: true right now, gone once
 * acted on, and never blocking. Kept separate from objectives so a player
 * who is mid-chain still gets told their farm is full.
 */
export interface Nudge {
  id: string;
  text: string;
  tone: 'good' | 'info' | 'warn';
}

export function nudges(p: PlayerState, now: number): Nudge[] {
  const out: Nudge[] = [];

  const ready = p.base.plots.filter((x) => isReady(x, now)).length;
  if (ready > 0) {
    out.push({ id: 'harvest', text: `${ready} crop${ready > 1 ? 's' : ''} ready to harvest`, tone: 'good' });
  }

  const empty = p.base.plots.filter((x) => x.cropId === null).length;
  if (empty > 0 && p.base.plots.length > 0) {
    out.push({ id: 'plant', text: `${empty} empty plot${empty > 1 ? 's' : ''}`, tone: 'info' });
  }

  if (p.base.building && now >= p.base.building.doneAt) {
    out.push({ id: 'built', text: `${getBuilding(p.base.building.buildingId).name} is finished`, tone: 'good' });
  }

  if (p.party.some((u) => u === null)) {
    out.push({ id: 'party', text: 'An empty pipeline slot - nothing flows through a gap', tone: 'warn' });
  }

  // The one dead end the game can actually walk a player into. Scrap pays for
  // captures, seeds and structures, and nothing on the island grows it - the
  // only tap is clearing an incident. A player who spends down to nothing has
  // no way to find that out from the world, so it has to be said here.
  if (p.resources.scrap < CHEAPEST_SEED_COST) {
    out.push({
      id: 'broke',
      text: 'Out of scrap - clear an incident at the Ops Centre to earn more',
      tone: 'warn',
    });
  }

  return out;
}
