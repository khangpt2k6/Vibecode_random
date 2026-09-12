import { getBuilding, unlockedTier } from '@stackmon/content';
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
}

export const OBJECTIVES: Objective[] = [
  {
    id: 'look-around',
    title: 'Look around the island',
    why: 'Every creature here is a real technology, and its stats are its real trade-offs.',
    how: 'Drag or use WASD to pan, scroll to zoom. Press G to open the codex.',
    done: (p) => p.seen.length > 5,
    progress: (p) => Math.min(1, p.seen.length / 6),
  },
  {
    id: 'first-capture',
    title: 'Capture a wild technology',
    why: 'Your roster is your stack. You cannot build a pipeline out of things you do not have.',
    how: 'Hover a wandering creature and click it. Capturing costs scrap.',
    done: (p) => p.stats.captures >= 1,
  },
  {
    id: 'first-battle',
    title: 'Respond to an incident',
    why: 'Incidents are real production failures. Beating one means you built something that survives it.',
    how: 'Click the Ops Centre in the middle of the island.',
    done: (p) => p.stats.battles >= 1,
  },
  {
    id: 'first-win',
    title: 'Resolve an incident',
    why: 'You win by serving traffic through it, not by attacking it. Throughput is the weapon.',
    how: 'Keep the pipeline flowing. Buffer at INGEST so a spike does not become dropped requests.',
    done: (p) => p.stats.victories >= 1,
  },
  {
    id: 'power-grid',
    title: 'Build the Power Grid',
    why: 'Nothing runs without power. It opens your first farm plots.',
    how: 'Press B to open the build menu. The grid costs scrap, which incidents pay out.',
    done: (p) => p.base.built.includes('power-grid'),
  },
  {
    id: 'first-plant',
    title: 'Plant something',
    why: 'Compute, memory, bandwidth and storage are the four currencies of every system you will ever build.',
    how: 'Click an empty plot next to the Ops Centre and pick a crop.',
    done: (p) => p.base.plots.some((x) => x.cropId !== null) || p.resources.compute > 60,
  },
  {
    id: 'first-harvest',
    title: 'Harvest a crop',
    why: 'Resources are what the build tree spends. Everything above the grid needs them.',
    how: 'Click a plot once it is ready. Crops keep growing while the tab is closed.',
    done: (p) => p.resources.compute > 60 || p.resources.storage > 40,
  },
  {
    id: 'runtime-forge',
    title: 'Build the Runtime Forge',
    why: 'A runtime is the floor of every stack. Before you have one you have source code and a wish.',
    how: 'Press B. It needs compute and memory, so farm those first.',
    done: (p) => p.base.built.includes('runtime-forge'),
  },
  {
    id: 'branch-out',
    title: 'Build a Data Vault or a Message Broker',
    why: 'Storage and streaming are the two branches every architecture grows from. Pick one.',
    how: 'Press B. Both only need the Power Grid, so either is open to you now.',
    done: (p) => p.base.built.includes('data-vault') || p.base.built.includes('message-broker'),
  },
  {
    id: 'tier-two',
    title: 'Unlock tier 2 incidents',
    why: 'Tier 1 is raw volume. Tier 2 is corruption, partitions and leaks - different problems, different stacks.',
    how: 'Build the Message Broker.',
    done: (p) => unlockedTier(p.base.built) >= 2,
  },
  {
    id: 'containers',
    title: 'Reach the Container Yard',
    why: 'Registry, then containers, then orchestration. That order is not arbitrary - each one needs the last.',
    how: 'Image Registry needs the Runtime Forge. The Container Yard needs the Registry.',
    done: (p) => p.base.built.includes('container-yard'),
  },
  {
    id: 'six-families',
    title: 'Own a creature from every family',
    why: 'No single family answers every incident. Bench depth is what lets you swap mid-fight.',
    how: 'Keep capturing. The codex (G) shows which families you are missing.',
    done: (p, _now) => familiesOwned(p) >= 6,
    progress: (p) => familiesOwned(p) / 6,
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

  return out;
}
