import type { CreatureSpec } from '../schema.js';

/**
 * DATA family.
 *
 * Systems whose job is to still have your bytes tomorrow, and to agree with
 * themselves about what those bytes are. They all pay for that in latency and
 * in how badly they scale writes horizontally.
 *
 * Stat scale: 100 is unremarkable, 200 is best-in-class. Latency is inverted -
 * lower is faster - because latency is a cost, not a virtue.
 */
export const DATA_CREATURES: CreatureSpec[] = [
  {
    id: 'postgres',
    name: 'POSTGRES',
    realName: 'PostgreSQL',
    type: 'data',
    roles: ['store'],
    base: {
      throughput: 95,
      latency: 55,
      durability: 175,
      memory: 90,
      consistency: 195,
      scalability: 45,
    },
    growth: {
      throughput: 3.2,
      latency: 0.45,
      durability: 5.4,
      memory: 2.8,
      consistency: 2.2,
      scalability: 1.1,
    },
    skills: ['acid-transaction', 'wal-checkpoint', 'row-lock', 'vacuum'],
    rarity: 40,
    habitats: ['relational-vale'],
    evolution: { into: 'postgres-cluster', level: 28, condition: 'Win 5 battles in STORE' },
    codex:
      'The default answer. Full ACID transactions, serialisable isolation if ' +
      'you ask for it, and a write-ahead log that means a power cut costs you ' +
      'nothing committed. It will not shard your writes for you, and it will ' +
      'not be the fastest thing in the pipeline, and it will still be running ' +
      'and correct long after the clever alternative has been replaced twice.',
    keyInsight:
      'Its weakness is not performance, it is horizontal write scale. One ' +
      'primary takes all the writes. Everything else is a read replica.',
  },
  {
    id: 'mysql',
    name: 'MYSQL',
    realName: 'MySQL / MariaDB',
    type: 'data',
    roles: ['store'],
    base: {
      throughput: 108,
      latency: 48,
      durability: 158,
      memory: 85,
      consistency: 168,
      scalability: 58,
    },
    growth: {
      throughput: 3.6,
      latency: 0.42,
      durability: 4.9,
      memory: 2.6,
      consistency: 1.9,
      scalability: 1.4,
    },
    skills: ['acid-transaction', 'row-lock', 'sharded-write', 'vacuum'],
    rarity: 42,
    habitats: ['relational-vale'],
    codex:
      'Faster than Postgres on simple reads, and for two decades the thing ' +
      'the entire web ran on. InnoDB gives it real transactions; the defaults ' +
      'around character sets and strict mode have historically been willing to ' +
      'silently accept data you did not mean to store.',
    keyInsight:
      'Read-heavy workloads with simple queries are where it wins. Complex ' +
      'analytical SQL is where Postgres pulls ahead.',
  },
  {
    id: 'mongo',
    name: 'MONGO',
    realName: 'MongoDB',
    type: 'data',
    roles: ['store', 'process'],
    base: {
      throughput: 132,
      latency: 40,
      durability: 112,
      memory: 122,
      consistency: 96,
      scalability: 152,
    },
    growth: {
      throughput: 4.4,
      latency: 0.38,
      durability: 3.6,
      memory: 4.0,
      consistency: 1.3,
      scalability: 4.2,
    },
    skills: ['sharded-write', 'vacuum', 'row-lock'],
    rarity: 45,
    habitats: ['relational-vale', 'index-spires'],
    codex:
      'Documents instead of rows, so the shape of the data is the shape of ' +
      'the object, and a schema change is a deploy rather than a migration. ' +
      'Shards natively, which is the real reason to reach for it. Multi-document ' +
      'transactions exist now but are not what it is built around.',
    keyInsight:
      'Schemaless does not mean no schema. It means the schema lives in your ' +
      'application code, where the database cannot enforce it for you.',
  },
  {
    id: 'sqlite',
    name: 'SQLITE',
    realName: 'SQLite',
    type: 'data',
    roles: ['store'],
    base: {
      throughput: 72,
      latency: 12,
      durability: 142,
      memory: 30,
      consistency: 165,
      scalability: 10,
    },
    growth: {
      throughput: 2.4,
      latency: 0.1,
      durability: 4.4,
      memory: 0.9,
      consistency: 1.8,
      scalability: 0.2,
    },
    skills: ['acid-transaction', 'wal-checkpoint'],
    rarity: 55,
    habitats: ['relational-vale', 'runtime-foundry'],
    codex:
      'A real relational database that is a single file and no server at all. ' +
      'Because there is no network hop, its latency is in a different class ' +
      'from anything else in this family. It is also the most widely deployed ' +
      'database in existence, by a margin that is not close.',
    keyInsight:
      'The absence of a server is the whole trade. No network latency, and ' +
      'also no concurrent writers and nothing to scale out to.',
  },
];
