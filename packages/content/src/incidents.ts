import type { TypeId } from './types.js';
import type { StatKey } from './schema.js';

/**
 * Incidents - the things you fight.
 *
 * Not monsters. Every enemy in this game is a production failure mode, and
 * beating one means having built a pipeline that survives it. The intended
 * experience is that a player loses to Thundering Herd, reads why, puts a
 * buffer at ingest, and wins - which is the same loop as actually learning
 * this, only faster and with fewer pagers involved.
 *
 * An incident has a `type` so the effectiveness chart applies to it: a
 * traffic spike behaves like raw volume, a corruption behaves like a data
 * problem, and so on.
 */

export type IncidentMoveKind =
  | 'load' // pushes work through the pipeline
  | 'corrupt' // damages consistency, can poison a creature
  | 'drain' // eats memory / buffer
  | 'strike' // direct damage to one slot
  | 'partition' // cuts the pipeline, isolating a slot
  | 'escalate'; // buffs itself

export interface IncidentMove {
  kind: IncidentMoveKind;
  name: string;
  /** Magnitude. Meaning depends on kind. */
  power: number;
  /** Which pipeline slot it hits, or 'all'. */
  target: 'ingest' | 'process' | 'store' | 'all' | 'weakest';
  /** Stat it degrades, for corrupt/drain. */
  stat?: StatKey;
  turns?: number;
  description: string;
}

export interface IncidentPhase {
  /** Integrity fraction at or below which this phase activates. */
  belowIntegrity: number;
  name: string;
  moves: IncidentMove[];
  /** Shown once when the phase begins. */
  announce: string;
}

export interface IncidentSpec {
  id: string;
  name: string;
  type: TypeId;
  integrity: number;
  /** Baseline load per turn, before moves. */
  baseLoad: number;
  /** How fast baseLoad grows each turn. Models an incident getting worse. */
  loadRamp: number;
  /** Error budget the player starts with for this fight. */
  errorBudget: number;
  tier: 1 | 2 | 3 | 4;
  moves: IncidentMove[];
  phases?: IncidentPhase[];
  description: string;
  realWorld: string;
  /** What actually counters it. Revealed after the first loss. */
  counterHint: string;
  rewards: { xp: number; scrap: number; unlocks?: string[] };
}

const incidents: IncidentSpec[] = [
  {
    id: 'traffic-spike',
    name: 'TRAFFIC SPIKE',
    type: 'stream',
    integrity: 1100,
    baseLoad: 95,
    loadRamp: 30,
    errorBudget: 100,
    tier: 1,
    moves: [
      {
        kind: 'load',
        name: 'Burst',
        power: 168,
        target: 'ingest',
        description: 'A wall of requests arrives at the front door at once.',
      },
      {
        kind: 'strike',
        name: 'Queue Overflow',
        power: 108,
        target: 'weakest',
        description: 'Whatever had the least headroom starts dropping work.',
      },
    ],
    description:
      'Load arrives faster than the pipeline can process it, and keeps ' +
      'climbing. Nothing is broken. There is simply more work than capacity.',
    realWorld:
      'A launch, a sale, a link on the front page. The system was fine at 1x ' +
      'and is on fire at 40x, and no single component has failed.',
    counterHint:
      'You cannot out-process a spike, so stop trying. Put something at ' +
      'INGEST that buffers - a broker absorbs the burst and lets PROCESS ' +
      'drain it at its own pace. Rate limiting at the edge works too: load ' +
      'you shed costs nothing.',
    rewards: { xp: 120, scrap: 40 },
  },
  {
    id: 'thundering-herd',
    name: 'THUNDERING HERD',
    type: 'cache',
    integrity: 1200,
    baseLoad: 80,
    loadRamp: 34,
    errorBudget: 95,
    tier: 1,
    moves: [
      {
        kind: 'drain',
        name: 'Cache Flush',
        power: 104,
        target: 'all',
        stat: 'memory',
        turns: 2,
        description: 'Every cached entry expires at the same instant.',
      },
      {
        kind: 'load',
        name: 'Stampede',
        power: 228,
        target: 'store',
        description: 'Every client that just missed goes to the origin simultaneously.',
      },
    ],
    description:
      'The cache empties all at once and every request that it was absorbing ' +
      'lands on the thing behind it in the same second.',
    realWorld:
      'Entries written together expire together. A deploy, a restart, or a ' +
      'uniform TTL sets up the stampede; the first miss lets a thousand ' +
      'identical requests through before the first one finishes repopulating.',
    counterHint:
      'The store cannot take the origin load alone. Either put something ' +
      'durable and high-throughput in STORE, or shield it: a request ' +
      'coalescer, a circuit breaker, or jittered TTLs so the entries do not ' +
      'all die on the same tick.',
    rewards: { xp: 150, scrap: 55 },
  },
  {
    id: 'poison-pill',
    name: 'POISON PILL',
    type: 'data',
    integrity: 1650,
    baseLoad: 120,
    loadRamp: 34,
    errorBudget: 90,
    tier: 2,
    moves: [
      {
        kind: 'corrupt',
        name: 'Malformed Payload',
        power: 114,
        target: 'process',
        stat: 'consistency',
        turns: 3,
        description: 'A message no consumer can parse, redelivered forever.',
      },
      {
        kind: 'strike',
        name: 'Head-of-Line Block',
        power: 132,
        target: 'ingest',
        description: 'Everything behind the bad message stops moving.',
      },
    ],
    description:
      'One unprocessable message, retried endlessly, holding up the partition ' +
      'behind it. Throughput is fine. Progress is zero.',
    realWorld:
      'A consumer crashes on a message, does not commit the offset, restarts, ' +
      'reads the same message, and crashes again. The queue depth grows ' +
      'forever while the system reports itself healthy.',
    counterHint:
      'Retrying harder makes it worse. You need somewhere to put the message ' +
      'that is not the queue - a dead-letter queue - and you need consistency ' +
      'high enough to survive the corruption while you do it.',
    rewards: { xp: 200, scrap: 70, unlocks: ['dead-letter'] },
  },
  {
    id: 'netsplit',
    name: 'NETWORK PARTITION',
    type: 'infra',
    integrity: 1800,
    baseLoad: 125,
    loadRamp: 32,
    errorBudget: 85,
    tier: 2,
    moves: [
      {
        kind: 'partition',
        name: 'Split Brain',
        power: 1,
        target: 'process',
        turns: 2,
        description: 'The pipeline is cut in half. Each side thinks it is the survivor.',
      },
      {
        kind: 'corrupt',
        name: 'Divergent Write',
        power: 133,
        target: 'store',
        stat: 'consistency',
        turns: 3,
        description: 'Both halves accepted writes. Now they disagree.',
      },
    ],
    description:
      'The network between your components fails while every component stays ' +
      'up. Each half is healthy, serving traffic, and wrong.',
    realWorld:
      'The P in CAP. When a partition happens you choose consistency - refuse ' +
      'writes on the minority side - or availability - accept them and have a ' +
      'merge problem later. You do not get to choose neither.',
    counterHint:
      'Consistency is the stat that matters here, not throughput. Something ' +
      'in STORE that refuses divergent writes beats something fast that ' +
      'accepts them both.',
    rewards: { xp: 260, scrap: 90 },
  },
  {
    id: 'memory-leak',
    name: 'MEMORY LEAK',
    type: 'runtime',
    integrity: 1700,
    baseLoad: 115,
    loadRamp: 38,
    errorBudget: 100,
    tier: 2,
    moves: [
      {
        kind: 'drain',
        name: 'Heap Creep',
        power: 57,
        target: 'all',
        stat: 'memory',
        turns: 4,
        description: 'Available memory falls a little every single turn.',
      },
      {
        kind: 'strike',
        name: 'OOM Kill',
        power: 216,
        target: 'weakest',
        description: 'The kernel picks the biggest process and ends it.',
      },
    ],
    description:
      'Memory that is allocated and never released. It looks completely fine ' +
      'for hours, and then everything dies at once.',
    realWorld:
      'A cache with no bound, a listener never removed, a connection pool that ' +
      'only grows. Restarting fixes it, which is why leaks survive for years ' +
      'in services that deploy every day.',
    counterHint:
      'Something has to reclaim. A runtime with a real garbage collector, or ' +
      'a liveness probe that restarts the leaking component before the kernel ' +
      'makes that choice for you.',
    rewards: { xp: 240, scrap: 85 },
  },
  {
    id: 'cascading-failure',
    name: 'CASCADING FAILURE',
    type: 'infra',
    integrity: 2600,
    baseLoad: 170,
    loadRamp: 40,
    errorBudget: 80,
    tier: 3,
    moves: [
      {
        kind: 'strike',
        name: 'Retry Storm',
        power: 156,
        target: 'all',
        description: 'Every failed call is retried, tripling the load that caused the failure.',
      },
      {
        kind: 'escalate',
        name: 'Timeout Pileup',
        power: 22,
        target: 'all',
        turns: 3,
        description: 'Threads block on calls that will never return.',
      },
    ],
    phases: [
      {
        belowIntegrity: 0.5,
        name: 'TOTAL OUTAGE',
        announce: 'Every dependency is now failing. The retries are the outage.',
        moves: [
          {
            kind: 'strike',
            name: 'Full Collapse',
            power: 252,
            target: 'all',
            description: 'Nothing is serving. Everything is retrying.',
          },
        ],
      },
    ],
    description:
      'One slow dependency becomes a total outage, because every caller ' +
      'retried into it and the retries were the load.',
    realWorld:
      'Service A slows down. B times out and retries, tripling A load. A dies. ' +
      'C depends on B, and so on up the graph. The original fault is long gone ' +
      'and irrelevant by the time anyone is looking.',
    counterHint:
      'Stop calling the thing that is failing. A circuit breaker that fails ' +
      'fast, plus rate limiting, plus enough error budget to survive the ' +
      'first phase. Adding capacity feeds the storm.',
    rewards: { xp: 420, scrap: 160, unlocks: ['circuit-breaker'] },
  },
  {
    id: 'hot-partition',
    name: 'HOT PARTITION',
    type: 'stream',
    integrity: 2400,
    baseLoad: 150,
    loadRamp: 38,
    errorBudget: 90,
    tier: 3,
    moves: [
      {
        kind: 'load',
        name: 'Skewed Key',
        power: 240,
        target: 'ingest',
        description: 'Ninety percent of traffic hashes to one partition.',
      },
      {
        kind: 'drain',
        name: 'Consumer Lag',
        power: 86,
        target: 'process',
        stat: 'throughput',
        turns: 3,
        description: 'One consumer falls behind and never catches up.',
      },
    ],
    description:
      'You sharded correctly and it did not help, because the key you sharded ' +
      'on is not uniformly distributed. One node is at 100% and the rest idle.',
    realWorld:
      'Partitioning by customer id works until one customer is a thousand ' +
      'times larger than the rest. Aggregate capacity is fine and the system ' +
      'is down anyway.',
    counterHint:
      'Scalability is the stat that matters, not raw throughput. You need ' +
      'something that rebalances partitions rather than something that is ' +
      'individually fast.',
    rewards: { xp: 380, scrap: 140 },
  },
  {
    id: 'schema-drift',
    name: 'SCHEMA DRIFT',
    type: 'data',
    integrity: 2500,
    baseLoad: 150,
    loadRamp: 38,
    errorBudget: 85,
    tier: 3,
    moves: [
      {
        kind: 'corrupt',
        name: 'Breaking Change',
        power: 152,
        target: 'store',
        stat: 'consistency',
        turns: 4,
        description: 'A producer starts sending a field the consumer cannot read.',
      },
      {
        kind: 'strike',
        name: 'Deserialise Error',
        power: 144,
        target: 'process',
        description: 'Every message in flight fails to parse.',
      },
    ],
    description:
      'Two services that agreed on a format stop agreeing, one deploy at a ' +
      'time, with no error until the data is already wrong.',
    realWorld:
      'This is why schema registries and compatibility rules exist. Adding a ' +
      'required field is a breaking change; removing one is worse; and the ' +
      'old messages in the log still have the old shape forever.',
    counterHint:
      'Consistency and cleansing. Something that can roll back a partial ' +
      'change, and something that can strip the corruption off the pipeline ' +
      'every couple of turns.',
    rewards: { xp: 400, scrap: 150 },
  },
  {
    id: 'black-friday',
    name: 'BLACK FRIDAY',
    type: 'stream',
    integrity: 4200,
    baseLoad: 230,
    loadRamp: 52,
    errorBudget: 75,
    tier: 4,
    moves: [
      {
        kind: 'load',
        name: 'Peak Load',
        power: 312,
        target: 'all',
        description: 'Forty times normal traffic, sustained, for hours.',
      },
      {
        kind: 'drain',
        name: 'Connection Exhaustion',
        power: 114,
        target: 'store',
        stat: 'memory',
        turns: 3,
        description: 'The connection pool is empty and everything is queuing for one.',
      },
    ],
    phases: [
      {
        belowIntegrity: 0.6,
        name: 'CHECKOUT SURGE',
        announce: 'Writes now dominate. Nothing you cached helps any more.',
        moves: [
          {
            kind: 'strike',
            name: 'Write Amplification',
            power: 228,
            target: 'store',
            description: 'Every order is a transaction across four tables.',
          },
        ],
      },
      {
        belowIntegrity: 0.25,
        name: 'INVENTORY CONTENTION',
        announce: 'Ten thousand people are buying the same item. Row lock queue.',
        moves: [
          {
            kind: 'corrupt',
            name: 'Oversell',
            power: 171,
            target: 'store',
            stat: 'consistency',
            turns: 3,
            description: 'Stock count goes negative. Money has changed hands.',
          },
        ],
      },
    ],
    description:
      'Everything at once, for hours, with real money on every dropped ' +
      'request. Reads first, then writes, then contention on a single row.',
    realWorld:
      'The scenario every e-commerce platform designs its entire year around. ' +
      'Each phase needs a different answer, which is why one perfectly tuned ' +
      'component does not save you.',
    counterHint:
      'No single pipeline wins every phase. You need bench depth and you need ' +
      'to swap: buffer the reads, then harden the writes, then fight ' +
      'contention with consistency.',
    rewards: { xp: 900, scrap: 400, unlocks: ['exactly-once'] },
  },
];

export const INCIDENTS: Record<string, IncidentSpec> = Object.fromEntries(
  incidents.map((i) => [i.id, i]),
);

export function getIncident(id: string): IncidentSpec {
  const i = INCIDENTS[id];
  if (!i) throw new Error(`Unknown incident: ${id}`);
  return i;
}

export const ALL_INCIDENTS: readonly IncidentSpec[] = incidents;

export const incidentsOfTier = (tier: number): IncidentSpec[] =>
  incidents.filter((i) => i.tier === tier);
