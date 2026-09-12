/**
 * Creature families and the effectiveness chart.
 *
 * The six families are not arbitrary colour-coded buckets. Each one groups
 * technologies that make the same core engineering trade-off, and the chart
 * between them encodes what actually happens when you point one at a problem
 * the other is built for.
 *
 * That is the whole pedagogical bet of this game: if the numbers are honest,
 * a player who gets good at the combat has necessarily internalised why you
 * do not put a cache where you needed a database.
 */

export type TypeId = 'data' | 'stream' | 'runtime' | 'infra' | 'cache' | 'intel';

export const TYPE_IDS: readonly TypeId[] = [
  'data',
  'stream',
  'runtime',
  'infra',
  'cache',
  'intel',
];

export interface TypeInfo {
  id: TypeId;
  label: string;
  tagline: string;
  /** The trade-off this family makes, stated plainly. Shown in the codex. */
  tradeoff: string;
}

export const TYPE_INFO: Record<TypeId, TypeInfo> = {
  data: {
    id: 'data',
    label: 'DATA',
    tagline: 'Durable, consistent, deliberate.',
    tradeoff:
      'Buys correctness and survival with latency. A write is not done until ' +
      'it is on disk and every reader agrees on it, and that costs time.',
  },
  stream: {
    id: 'stream',
    label: 'STREAM',
    tagline: 'Buffers everything, keeps the order, never forgets.',
    tradeoff:
      'Buys absorption and replay with staleness. Work is accepted instantly ' +
      'and done later, so the system survives spikes but is always behind.',
  },
  runtime: {
    id: 'runtime',
    label: 'RUNTIME',
    tagline: 'Where the work actually happens.',
    tradeoff:
      'Buys generality with resource cost. It can compute anything, which ' +
      'means it is optimal at nothing and it is what falls over first.',
  },
  infra: {
    id: 'infra',
    label: 'INFRA',
    tagline: 'Moves it, packs it, keeps it alive.',
    tradeoff:
      'Buys control and resilience with indirection. Every hop it adds is a ' +
      'hop that can fail, and a layer someone has to debug through.',
  },
  cache: {
    id: 'cache',
    label: 'CACHE',
    tagline: 'Blindingly fast, and forgets the moment it dies.',
    tradeoff:
      'Buys latency with durability and truth. The answer arrives before you ' +
      'finish asking, and it might be wrong, and it is gone after a restart.',
  },
  intel: {
    id: 'intel',
    label: 'INTEL',
    tagline: 'Finds the needle, learns the shape, answers the question.',
    tradeoff:
      'Buys insight with freshness and cost. It answers questions no store ' +
      'can, over data that is minutes old, using a great deal of hardware.',
  },
};

/**
 * Effectiveness multiplier: TYPE_CHART[attacker][defender].
 *
 * Every non-neutral entry below has a reason in the real world, and the
 * reason is what the codex shows the player when they land the hit. A chart
 * tuned only for balance would teach nothing, so where balance and truth
 * disagreed, truth won and the numbers were adjusted elsewhere.
 */
export const TYPE_CHART: Record<TypeId, Record<TypeId, number>> = {
  // Durable stores outlast anything ephemeral, and shrug off corruption.
  // They lose to raw volume, which is exactly what streams and caches are for.
  data: {
    data: 1.0,
    stream: 0.7, // a database cannot absorb a spike a log swallows whole
    runtime: 1.2, // stateful truth outlives any process that crashes
    infra: 1.0,
    cache: 1.5, // durability beats volatility: the cache dies, the data does not
    intel: 1.2, // the source of truth wins arguments with a derived index
  },

  // Buffers absorb bursts and replay history. They cannot answer a question,
  // and a store that fsyncs will outlast a broker that only holds a window.
  stream: {
    data: 1.3, // backpressure: the queue keeps accepting while the DB blocks
    stream: 1.0,
    runtime: 1.4, // a consumer that falls behind gets buried by its own lag
    infra: 1.0,
    cache: 1.1,
    intel: 0.7, // a log has no index; analytics reads it faster than it streams
  },

  // Generality. Good against problems that need logic, bad against problems
  // that are really about IO or scale.
  runtime: {
    data: 0.8, // no amount of application code out-writes a disk
    stream: 0.7, // a single consumer cannot outrun a partitioned producer
    runtime: 1.0,
    infra: 1.2, // the workload dictates terms to the platform, not the reverse
    cache: 1.2,
    intel: 0.9,
  },

  // Routing, packing, scheduling, failover. Strong against anything that
  // depends on the network or on staying up. Weak against data problems,
  // which it can only move, never solve.
  infra: {
    data: 0.8, // you cannot orchestrate your way out of a schema problem
    stream: 1.2, // partitioning and replication are an infra concern first
    runtime: 1.4, // the scheduler decides what runs and what gets evicted
    infra: 1.0,
    cache: 1.2,
    intel: 0.9,
  },

  // Latency as a weapon. Beats anything that has to wait for IO. Loses to
  // anything that outlives it or that invalidates it.
  cache: {
    data: 1.4, // reads served from memory never touch the disk at all
    stream: 0.8, // there is nothing to cache in a firehose you have not read
    runtime: 1.3, // memoised work is work the CPU never does
    infra: 0.9,
    cache: 1.0,
    intel: 1.2, // a cached aggregate beats recomputing it
  },

  // Search, analytics, inference. Beats unstructured mass. Loses to anything
  // demanding a transactional guarantee it does not offer.
  intel: {
    data: 0.7, // an index is eventually consistent; the ledger is not
    stream: 1.4, // this is what the stream was being buffered for
    runtime: 1.1,
    infra: 1.0,
    cache: 0.8,
    intel: 1.0,
  },
};

export const effectiveness = (attacker: TypeId, defender: TypeId): number =>
  TYPE_CHART[attacker][defender];

/** Wording for the battle log, keyed off the multiplier. */
export function effectivenessLabel(mult: number): string {
  if (mult >= 1.4) return 'CRITICAL ADVANTAGE';
  if (mult > 1.0) return 'effective';
  if (mult === 1.0) return '';
  if (mult > 0.75) return 'resisted';
  return 'HEAVILY RESISTED';
}
