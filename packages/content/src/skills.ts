import type { Skill } from './schema.js';

/**
 * The skill list.
 *
 * Every skill is a real mechanism. `description` is what it does in the game,
 * `realWorld` is what it is, and the two have to agree - if a skill's numbers
 * do not behave the way the real mechanism behaves, the skill is wrong and
 * gets changed, not the explanation.
 *
 * The consequence is that a few skills are deliberately bad. GIL Contention
 * is a downside attached to a creature, not an ability you would choose, and
 * Cold Start punishes you for the same reason it punishes you in production.
 * A roster where every ability is an upside teaches nothing about trade-offs.
 */

const skills: Skill[] = [
  // ---------------------------------------------------------------- DATA
  {
    id: 'acid-transaction',
    name: 'ACID Transaction',
    type: 'data',
    target: 'pipeline',
    cost: 30,
    cooldown: 3,
    effects: [
      { kind: 'cleanse', target: 'pipeline' },
      { kind: 'statMod', stat: 'consistency', mult: 1.4, turns: 3, target: 'pipeline' },
    ],
    description:
      'Wraps the pipeline in a transaction. Clears every corruption effect and ' +
      'hardens the whole line against the next one.',
    realWorld:
      'Atomicity means a failed operation leaves no partial state behind. ' +
      'Corruption that would have been half-applied is rolled back entirely.',
  },
  {
    id: 'wal-checkpoint',
    name: 'WAL Checkpoint',
    type: 'data',
    target: 'self',
    cost: 22,
    cooldown: 4,
    effects: [
      { kind: 'repair', amount: 32, target: 'self' },
      { kind: 'shield', amount: 25, turns: 2, target: 'self' },
    ],
    description: 'Flushes the write-ahead log to disk. Repairs damage and braces for more.',
    realWorld:
      'A checkpoint writes dirty pages out and truncates the log, so a crash ' +
      'replays far less. The cost is an IO spike at checkpoint time.',
  },
  {
    id: 'row-lock',
    name: 'Row-Level Lock',
    type: 'data',
    target: 'enemy',
    cost: 18,
    cooldown: 2,
    effects: [
      { kind: 'damage', power: 55, scaling: 'consistency' },
      { kind: 'statMod', stat: 'throughput', mult: 0.7, turns: 2, target: 'enemy' },
    ],
    description: 'Locks the contended rows. Damages and slows whatever was writing to them.',
    realWorld:
      'Fine-grained locking lets unrelated writes proceed while contending ' +
      'ones queue. Contention, not the lock, is what costs throughput.',
  },
  {
    id: 'vacuum',
    name: 'VACUUM',
    type: 'data',
    target: 'self',
    cost: 15,
    cooldown: 3,
    effects: [
      { kind: 'repair', amount: 18, target: 'self' },
      { kind: 'statMod', stat: 'throughput', mult: 1.25, turns: 3, target: 'self' },
    ],
    description: 'Reclaims dead tuples. Heals a little and speeds up for a while.',
    realWorld:
      'MVCC leaves dead row versions behind. Without vacuuming, tables bloat ' +
      'and every scan reads more pages than it needs to.',
  },
  {
    id: 'sharded-write',
    name: 'Sharded Write',
    type: 'data',
    target: 'enemy',
    cost: 26,
    cooldown: 2,
    effects: [{ kind: 'damage', power: 42, scaling: 'scalability', hits: 3 }],
    description: 'Splits the write across shards. Three smaller hits instead of one big one.',
    realWorld:
      'Sharding spreads writes over independent nodes, so total throughput ' +
      'scales with node count. The price is that cross-shard queries and ' +
      'transactions become hard or impossible.',
  },
  {
    id: 'foreign-key',
    name: 'Referential Integrity',
    type: 'data',
    target: 'pipeline',
    cost: 20,
    cooldown: 4,
    effects: [{ kind: 'shield', amount: 30, turns: 3, target: 'pipeline' }],
    description: 'Constrains the whole pipeline. Absorbs damage that would break invariants.',
    realWorld:
      'Foreign keys make invalid state unrepresentable rather than merely ' +
      'unlikely. The database refuses the write instead of trusting the app.',
  },

  // -------------------------------------------------------------- STREAM
  {
    id: 'replay-log',
    name: 'Replay Log',
    type: 'stream',
    target: 'ally',
    cost: 45,
    cooldown: 6,
    effects: [{ kind: 'replay', amount: 0.5 }],
    description: 'Replays the log from the last offset. Brings a downed teammate back at half.',
    realWorld:
      'A retained log is a time machine: consumers can reset their offset and ' +
      'rebuild state from scratch. This is why the log is the system of record.',
  },
  {
    id: 'partition-rebalance',
    name: 'Partition Rebalance',
    type: 'stream',
    target: 'enemy',
    cost: 28,
    cooldown: 3,
    effects: [
      { kind: 'damage', power: 60, scaling: 'scalability' },
      { kind: 'statMod', stat: 'latency', mult: 1.3, turns: 2, target: 'enemy' },
    ],
    description: 'Reassigns partitions across consumers. Hits hard and leaves the target lagging.',
    realWorld:
      'When the consumer group changes, partitions are reassigned. Throughput ' +
      'scales with partition count, but every rebalance stops the world briefly.',
  },
  {
    id: 'backpressure',
    name: 'Backpressure',
    type: 'stream',
    target: 'self',
    cost: 20,
    cooldown: 2,
    effects: [{ kind: 'buffer', amount: 1.5, turns: 3 }],
    description: 'Opens the buffer wide. Absorbs incoming load instead of dropping it.',
    realWorld:
      'A bounded queue that pushes back is what stops a spike from becoming an ' +
      'outage. Unbounded buffering just moves the failure to the memory limit.',
  },
  {
    id: 'dead-letter',
    name: 'Dead Letter Queue',
    type: 'stream',
    target: 'pipeline',
    cost: 24,
    cooldown: 4,
    effects: [
      { kind: 'cleanse', target: 'pipeline' },
      { kind: 'budget', amount: 12 },
    ],
    description: 'Routes poisoned messages aside. Clears corruption and recovers error budget.',
    realWorld:
      'A message that fails repeatedly is parked rather than retried forever. ' +
      'Without a DLQ, one bad payload blocks the partition behind it.',
  },
  {
    id: 'exactly-once',
    name: 'Exactly-Once Delivery',
    type: 'stream',
    target: 'enemy',
    cost: 40,
    cooldown: 5,
    effects: [{ kind: 'damage', power: 95, scaling: 'consistency', piercing: true }],
    description: 'A guaranteed hit. Ignores shields and buffers entirely.',
    realWorld:
      'Idempotent producers plus transactional commits mean a duplicate ' +
      'delivery has no effect. It is expensive, which is why at-least-once ' +
      'with idempotent consumers is usually the better trade.',
  },
  {
    id: 'fanout',
    name: 'Topic Fan-Out',
    type: 'stream',
    target: 'enemy',
    cost: 30,
    cooldown: 3,
    effects: [{ kind: 'damage', power: 34, scaling: 'throughput', hits: 4 }],
    description: 'Publishes to every subscriber at once. Four hits.',
    realWorld:
      'One publish, many independent consumers, each at its own pace. ' +
      'Decoupling producers from consumers is most of what a broker is for.',
  },
  {
    id: 'prefetch-limit',
    name: 'Prefetch Limit',
    type: 'stream',
    target: 'ally',
    cost: 16,
    cooldown: 3,
    effects: [{ kind: 'shield', amount: 22, turns: 3, target: 'ally' }],
    description: 'Caps how much a teammate takes on at once. Shields them from overload.',
    realWorld:
      'Limiting unacknowledged messages per consumer stops one worker grabbing ' +
      'a thousand messages and starving the others while it drowns.',
  },

  // ------------------------------------------------------------- RUNTIME
  {
    id: 'jit-warmup',
    name: 'JIT Warmup',
    type: 'runtime',
    target: 'self',
    cost: 18,
    cooldown: 5,
    effects: [{ kind: 'statMod', stat: 'throughput', mult: 1.8, turns: 4, target: 'self' }],
    description: 'Slow to start, then very fast. Big throughput gain that takes a turn to matter.',
    realWorld:
      'The JIT interprets first, profiles the hot paths, then compiles them to ' +
      'native code. Long-running services get fast; short scripts never do.',
  },
  {
    id: 'garbage-collect',
    name: 'Stop-the-World GC',
    type: 'runtime',
    target: 'self',
    cost: 12,
    cooldown: 3,
    effects: [
      { kind: 'repair', amount: 40, target: 'self' },
      { kind: 'statMod', stat: 'latency', mult: 1.6, turns: 1, target: 'self' },
    ],
    description: 'Reclaims a lot of health, but everything pauses for a turn.',
    realWorld:
      'A full collection frees memory but halts every application thread ' +
      'while it runs. This pause is why tail latency and GC tuning are the ' +
      'same conversation.',
  },
  {
    id: 'thread-pool',
    name: 'Thread Pool',
    type: 'runtime',
    target: 'enemy',
    cost: 22,
    cooldown: 2,
    effects: [{ kind: 'damage', power: 48, scaling: 'scalability', hits: 2 }],
    description: 'Parallel workers. Two solid hits.',
    realWorld:
      'A bounded pool reuses threads instead of paying creation cost per task, ' +
      'and its size bounds how much concurrency the machine actually sees.',
  },
  {
    id: 'gil-contention',
    name: 'GIL Contention',
    type: 'runtime',
    target: 'self',
    cost: 0,
    cooldown: 0,
    effects: [
      { kind: 'damage', power: 30, scaling: 'throughput' },
      { kind: 'statMod', stat: 'throughput', mult: 0.6, turns: 2, target: 'self' },
    ],
    description:
      'Free to use and actively harmful. Only one thread runs at a time, so ' +
      'the work lands but the pipeline chokes on itself.',
    realWorld:
      'The Global Interpreter Lock means CPU-bound threads cannot run in ' +
      'parallel in one process. Multiprocessing or a C extension is the way ' +
      'out; more threads is not.',
  },
  {
    id: 'async-io',
    name: 'Async Event Loop',
    type: 'runtime',
    target: 'self',
    cost: 20,
    cooldown: 3,
    effects: [
      { kind: 'statMod', stat: 'latency', mult: 0.6, turns: 3, target: 'self' },
      { kind: 'buffer', amount: 0.8, turns: 3 },
    ],
    description: 'Handles many waiting operations at once. Much faster, and buffers more.',
    realWorld:
      'A single thread can hold thousands of open sockets, because waiting on ' +
      'IO costs nothing. It does not help at all with CPU-bound work.',
  },
  {
    id: 'native-extension',
    name: 'Native Extension',
    type: 'runtime',
    target: 'enemy',
    cost: 34,
    cooldown: 4,
    effects: [{ kind: 'damage', power: 88, scaling: 'throughput' }],
    description: 'Drops into compiled code for the hot loop. Heavy single hit.',
    realWorld:
      'NumPy and its kin are thin Python over C and Fortran. The interpreter ' +
      'sets up the work; the hot loop never runs in it.',
  },
  {
    id: 'hot-reload',
    name: 'Hot Reload',
    type: 'runtime',
    target: 'ally',
    cost: 16,
    cooldown: 3,
    effects: [{ kind: 'repair', amount: 26, target: 'ally' }],
    description: 'Swaps the code under a running teammate without restarting them.',
    realWorld:
      'Replacing a module in a live process keeps connections and in-memory ' +
      'state. Wonderful in development, and a source of very strange bugs in ' +
      'production.',
  },

  // --------------------------------------------------------------- INFRA
  {
    id: 'autoscale',
    name: 'Horizontal Autoscale',
    type: 'infra',
    target: 'pipeline',
    cost: 38,
    cooldown: 5,
    effects: [{ kind: 'statMod', stat: 'throughput', mult: 1.55, turns: 3, target: 'pipeline' }],
    description: 'Adds replicas across the whole pipeline. Everyone hits harder for a while.',
    realWorld:
      'Scaling out multiplies capacity for stateless work. It does nothing for ' +
      'a bottleneck that is a single database, and new pods are not warm.',
  },
  {
    id: 'liveness-probe',
    name: 'Liveness Probe',
    type: 'infra',
    target: 'ally',
    cost: 18,
    cooldown: 3,
    effects: [
      { kind: 'repair', amount: 30, target: 'ally' },
      { kind: 'cleanse', target: 'ally' },
    ],
    description: 'Detects a wedged teammate and restarts them clean.',
    realWorld:
      'A failing probe kills and reschedules the container. It converts a hung ' +
      'process into a brief outage, which is usually the better failure.',
  },
  {
    id: 'rate-limit',
    name: 'Rate Limit',
    type: 'infra',
    target: 'enemy',
    cost: 20,
    cooldown: 2,
    effects: [
      { kind: 'statMod', stat: 'throughput', mult: 0.55, turns: 2, target: 'enemy' },
      { kind: 'damage', power: 30, scaling: 'consistency' },
    ],
    description: 'Caps what the incident can push. Cuts its throughput hard.',
    realWorld:
      'A token bucket at the edge is the cheapest protection there is: it ' +
      'sheds load before that load costs you anything downstream.',
  },
  {
    id: 'circuit-breaker',
    name: 'Circuit Breaker',
    type: 'infra',
    target: 'pipeline',
    cost: 26,
    cooldown: 4,
    effects: [
      { kind: 'shield', amount: 40, turns: 2, target: 'pipeline' },
      { kind: 'budget', amount: 8 },
    ],
    description: 'Trips open and stops calling the failing thing. Big shield, recovers budget.',
    realWorld:
      'After enough failures the breaker opens and fails fast instead of ' +
      'waiting on timeouts. Retrying into a struggling dependency is how a ' +
      'partial outage becomes a total one.',
  },
  {
    id: 'layer-cache',
    name: 'Layer Cache',
    type: 'infra',
    target: 'self',
    cost: 10,
    cooldown: 2,
    effects: [{ kind: 'statMod', stat: 'latency', mult: 0.65, turns: 3, target: 'self' }],
    description: 'Reuses unchanged layers. Much faster to act.',
    realWorld:
      'Every image layer is content-addressed, so an unchanged layer is never ' +
      'rebuilt or re-pulled. Ordering a Dockerfile so the volatile parts come ' +
      'last is most of build performance.',
  },
  {
    id: 'rolling-update',
    name: 'Rolling Update',
    type: 'infra',
    target: 'pipeline',
    cost: 30,
    cooldown: 5,
    effects: [
      { kind: 'repair', amount: 22, target: 'pipeline' },
      { kind: 'cleanse', target: 'pipeline' },
    ],
    description: 'Replaces the pipeline a piece at a time. Heals and cleans everyone.',
    realWorld:
      'Old and new versions run together while instances are replaced one by ' +
      'one, so there is no downtime - and both versions must be compatible ' +
      'with the same data at once.',
  },
  {
    id: 'reverse-proxy',
    name: 'Reverse Proxy',
    type: 'infra',
    target: 'enemy',
    cost: 16,
    cooldown: 1,
    priority: 1,
    effects: [{ kind: 'damage', power: 40, scaling: 'throughput' }],
    description: 'Always acts first. Absorbs and redirects the incoming hit.',
    realWorld:
      'Terminating TLS, routing, and buffering slow clients at the edge keeps ' +
      'all of that away from the application servers behind it.',
  },

  // --------------------------------------------------------------- CACHE
  {
    id: 'o1-lookup',
    name: 'O(1) Lookup',
    type: 'cache',
    target: 'enemy',
    cost: 8,
    cooldown: 0,
    priority: 2,
    effects: [{ kind: 'damage', power: 38, scaling: 'throughput' }],
    description: 'Instant. Cheap, no cooldown, and always goes first.',
    realWorld:
      'A hash lookup in memory does not depend on how much data is in there. ' +
      'Constant time is the entire pitch.',
  },
  {
    id: 'cache-aside',
    name: 'Cache Aside',
    type: 'cache',
    target: 'ally',
    cost: 18,
    cooldown: 2,
    effects: [
      { kind: 'statMod', stat: 'latency', mult: 0.55, turns: 3, target: 'ally' },
      { kind: 'shield', amount: 18, turns: 2, target: 'ally' },
    ],
    description: 'Serves a teammate from memory. They act much sooner and take less.',
    realWorld:
      'The application checks the cache, and on a miss reads through and ' +
      'populates it. Simple, and it means the first request after a deploy ' +
      'is always the slow one.',
  },
  {
    id: 'lru-eviction',
    name: 'LRU Eviction',
    type: 'cache',
    target: 'enemy',
    cost: 22,
    cooldown: 3,
    effects: [
      { kind: 'cleanse', target: 'self' },
      { kind: 'damage', power: 52, scaling: 'memory' },
    ],
    description: 'Throws out the coldest entries. Clears its own debuffs and hits back.',
    realWorld:
      'When memory fills, something has to go. Least-recently-used is a good ' +
      'guess about the future, right up until a scan touches everything once.',
  },
  {
    id: 'pipeline-burst',
    name: 'Command Pipelining',
    type: 'cache',
    target: 'enemy',
    cost: 26,
    cooldown: 3,
    effects: [{ kind: 'damage', power: 26, scaling: 'throughput', hits: 5 }],
    description: 'Sends the whole batch without waiting. Five rapid hits.',
    realWorld:
      'Pipelining removes a round trip per command. Over a network where RTT ' +
      'dominates, this is often a ten-fold improvement for free.',
  },
  {
    id: 'cold-start',
    name: 'Cold Start',
    type: 'cache',
    target: 'self',
    cost: 0,
    cooldown: 0,
    effects: [
      { kind: 'statMod', stat: 'throughput', mult: 0.45, turns: 2, target: 'self' },
      { kind: 'damage', power: 20, scaling: 'latency' },
    ],
    description:
      'Free, and it hurts. An empty cache sends every request to the thing ' +
      'behind it, which is what the cache was protecting.',
    realWorld:
      'After a restart the hit rate is zero, and the full load lands on the ' +
      'origin at once. Warming the cache before taking traffic is not optional ' +
      'at scale.',
  },
  {
    id: 'ttl-expiry',
    name: 'TTL Expiry',
    type: 'cache',
    target: 'enemy',
    cost: 20,
    cooldown: 3,
    effects: [{ kind: 'overTime', power: 22, turns: 3, label: 'EXPIRING' }],
    description: 'Sets a countdown on the target. Damage every turn until it runs out.',
    realWorld:
      'A time-to-live bounds how stale an entry can be. Picking it is a direct ' +
      'trade of freshness against load on whatever is behind the cache.',
  },
  {
    id: 'write-through',
    name: 'Write-Through',
    type: 'cache',
    target: 'self',
    cost: 24,
    cooldown: 4,
    effects: [
      { kind: 'statMod', stat: 'consistency', mult: 1.6, turns: 4, target: 'self' },
      { kind: 'statMod', stat: 'latency', mult: 1.25, turns: 4, target: 'self' },
    ],
    description: 'Writes to the store on every write. Far more consistent, noticeably slower.',
    realWorld:
      'Write-through keeps the cache and the store in step at the cost of ' +
      'store latency on the write path. Write-behind is faster and can lose ' +
      'the last few seconds on a crash.',
  },

  // --------------------------------------------------------------- INTEL
  {
    id: 'inverted-index',
    name: 'Inverted Index',
    type: 'intel',
    target: 'enemy',
    cost: 24,
    cooldown: 2,
    effects: [{ kind: 'damage', power: 62, scaling: 'memory' }],
    description: 'Finds the weak point instantly, however large the target.',
    realWorld:
      'Mapping every term to the documents containing it turns full-text ' +
      'search from a scan into a lookup. Building and holding that index is ' +
      'the cost.',
  },
  {
    id: 'map-reduce',
    name: 'Map-Reduce',
    type: 'intel',
    target: 'enemy',
    cost: 36,
    cooldown: 4,
    effects: [{ kind: 'damage', power: 30, scaling: 'scalability', hits: 4 }],
    description: 'Splits the work, runs it everywhere, combines the answers. Four hits.',
    realWorld:
      'Embarrassingly parallel work distributes almost perfectly. The shuffle ' +
      'between the map and reduce phases is where it stops being free.',
  },
  {
    id: 'lazy-evaluation',
    name: 'Lazy Evaluation',
    type: 'intel',
    target: 'self',
    cost: 14,
    cooldown: 3,
    effects: [
      { kind: 'buffer', amount: 1.2, turns: 3 },
      { kind: 'statMod', stat: 'throughput', mult: 1.3, turns: 3, target: 'self' },
    ],
    description: 'Builds the plan without running it, then runs it well. Buffers and speeds up.',
    realWorld:
      'Deferring execution lets the engine see the whole query and optimise ' +
      'across stages - pushing filters down, skipping columns nobody reads.',
  },
  {
    id: 'anomaly-detect',
    name: 'Anomaly Detection',
    type: 'intel',
    target: 'pipeline',
    cost: 28,
    cooldown: 4,
    effects: [
      { kind: 'statMod', stat: 'consistency', mult: 1.35, turns: 3, target: 'pipeline' },
      { kind: 'budget', amount: 10 },
    ],
    description: 'Spots the incident early. Hardens the pipeline and buys back error budget.',
    realWorld:
      'Catching a deviation before it breaches the SLO is the difference ' +
      'between a graph someone looks at and a page at three in the morning.',
  },
  {
    id: 'vector-search',
    name: 'Vector Search',
    type: 'intel',
    target: 'enemy',
    cost: 32,
    cooldown: 3,
    effects: [{ kind: 'drain', power: 58, scaling: 'memory', leech: 0.4 }],
    description: 'Finds what it resembles, not what it says. Damages and heals off it.',
    realWorld:
      'Nearest neighbours in embedding space match on meaning rather than on ' +
      'characters. Approximate indexes trade a little recall for enormous ' +
      'speed.',
  },
  {
    id: 'columnar-scan',
    name: 'Columnar Scan',
    type: 'intel',
    target: 'enemy',
    cost: 30,
    cooldown: 3,
    effects: [
      { kind: 'damage', power: 72, scaling: 'throughput' },
      { kind: 'statMod', stat: 'latency', mult: 1.2, turns: 2, target: 'enemy' },
    ],
    description: 'Reads only the columns that matter. Enormous hit across wide data.',
    realWorld:
      'Storing by column means an aggregate over one field never reads the ' +
      'other ninety-nine, and values of one type compress far better together.',
  },
];

export const SKILLS: Record<string, Skill> = Object.fromEntries(
  skills.map((s) => [s.id, s]),
);

export function getSkill(id: string): Skill {
  const s = SKILLS[id];
  if (!s) throw new Error(`Unknown skill: ${id}`);
  return s;
}

export const ALL_SKILLS: readonly Skill[] = skills;
