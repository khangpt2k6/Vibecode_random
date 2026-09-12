import type { CreatureSpec } from '../schema.js';

/**
 * CACHE family.
 *
 * Memory-resident systems that answer before you have finished asking. Every
 * one of them is fast because it gave up durability, and every one of them
 * can be wrong because it gave up being the source of truth.
 */
export const CACHE_CREATURES: CreatureSpec[] = [
  {
    id: 'redis',
    name: 'REDIS',
    realName: 'Redis',
    type: 'cache',
    roles: ['store', 'process'],
    base: {
      throughput: 190,
      latency: 5,
      durability: 55,
      memory: 130,
      consistency: 85,
      scalability: 105,
    },
    growth: {
      throughput: 5.6,
      latency: 0.04,
      durability: 1.8,
      memory: 3.8,
      consistency: 1.3,
      scalability: 2.6,
    },
    skills: ['o1-lookup', 'cache-aside', 'lru-eviction', 'pipeline-burst'],
    rarity: 40,
    habitats: ['memory-flats'],
    evolution: { into: 'redis-cluster', level: 26, condition: 'Survive an eviction storm' },
    codex:
      'Sub-millisecond, single-threaded, and far more than a key-value store: ' +
      'sorted sets, streams, HyperLogLog, and atomic Lua scripting. Being ' +
      'single-threaded is a feature, because every command is atomic without ' +
      'any locking. It can persist, via snapshots or an append-only file, but ' +
      'persistence is a safety net bolted to a memory system rather than its ' +
      'foundation.',
    keyInsight:
      'Treat it as authoritative and you will eventually lose data. Treat it ' +
      'as a rebuildable accelerator and it is close to free performance.',
  },
  {
    id: 'memcached',
    name: 'MEMCACHED',
    realName: 'Memcached',
    type: 'cache',
    roles: ['store'],
    base: {
      throughput: 196,
      latency: 4,
      durability: 20,
      memory: 100,
      consistency: 60,
      scalability: 115,
    },
    growth: {
      throughput: 5.8,
      latency: 0.03,
      durability: 0.6,
      memory: 3.0,
      consistency: 0.9,
      scalability: 2.8,
    },
    skills: ['o1-lookup', 'lru-eviction', 'cold-start'],
    rarity: 48,
    habitats: ['memory-flats'],
    codex:
      'Strings in, strings out, multithreaded, and nothing else. No ' +
      'persistence, no data structures, no replication. It is on this list ' +
      'because doing one thing with no features is a real design position: ' +
      'there is almost nothing to configure wrong and almost nothing to break.',
    keyInsight:
      'When Redis and Memcached both fit, Memcached is simpler and Redis is ' +
      'more useful. That is genuinely the whole comparison.',
  },
  {
    id: 'varnish',
    name: 'VARNISH',
    realName: 'Varnish Cache',
    type: 'cache',
    roles: ['ingest'],
    base: {
      throughput: 180,
      latency: 9,
      durability: 40,
      memory: 110,
      consistency: 70,
      scalability: 100,
    },
    growth: {
      throughput: 5.4,
      latency: 0.08,
      durability: 1.3,
      memory: 3.2,
      consistency: 1.1,
      scalability: 2.4,
    },
    skills: ['ttl-expiry', 'o1-lookup', 'cache-aside'],
    rarity: 38,
    habitats: ['memory-flats', 'container-yards'],
    codex:
      'An HTTP cache that sits in front of the application and answers a large ' +
      'share of requests without the application ever hearing about them. The ' +
      'hard part was never the caching, it is invalidation: deciding when a ' +
      'cached page has stopped being true.',
    keyInsight:
      'Cache invalidation is hard because it is a distributed consensus ' +
      'problem wearing a hat. TTLs are the cheap approximate answer.',
  },
  {
    id: 'caffeine',
    name: 'CAFFEINE',
    realName: 'Caffeine (in-process cache)',
    type: 'cache',
    roles: ['process'],
    base: {
      throughput: 200,
      latency: 2,
      durability: 15,
      memory: 60,
      consistency: 75,
      scalability: 30,
    },
    growth: {
      throughput: 6.0,
      latency: 0.02,
      durability: 0.5,
      memory: 1.8,
      consistency: 1.0,
      scalability: 0.6,
    },
    skills: ['o1-lookup', 'lru-eviction', 'write-through', 'cold-start'],
    rarity: 42,
    habitats: ['memory-flats', 'runtime-foundry'],
    codex:
      'A cache inside the process itself, so a hit is a hash lookup and not a ' +
      'network call - two orders of magnitude faster than reaching Redis. Its ' +
      'eviction policy uses frequency as well as recency, which survives a ' +
      'scan that would flush a pure LRU. Every instance has its own copy, and ' +
      'they do not agree with each other.',
    keyInsight:
      'No network hop is the fastest cache there is. The cost is that ' +
      'invalidation across N instances is now your problem.',
  },
];
