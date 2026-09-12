import type { CreatureSpec } from '../schema.js';

/**
 * INTEL family.
 *
 * Search, analytics, and inference. These answer questions no transactional
 * store can, over data that is minutes old, using a great deal of hardware.
 * Every one of them is a derived view: if it disagrees with the source of
 * truth, the source of truth is right.
 */
export const INTEL_CREATURES: CreatureSpec[] = [
  {
    id: 'elasticsearch',
    name: 'ELASTIC',
    realName: 'Elasticsearch / OpenSearch',
    type: 'intel',
    roles: ['store'],
    base: {
      throughput: 130,
      latency: 65,
      durability: 120,
      memory: 180,
      consistency: 80,
      scalability: 165,
    },
    growth: {
      throughput: 4.2,
      latency: 0.6,
      durability: 3.8,
      memory: 5.2,
      consistency: 1.2,
      scalability: 4.4,
    },
    skills: ['inverted-index', 'vector-search', 'anomaly-detect'],
    rarity: 30,
    habitats: ['index-spires'],
    codex:
      'Lucene, sharded and given an HTTP API. The inverted index maps every ' +
      'term to the documents containing it, which turns full-text search from ' +
      'a scan into a lookup - and costs a great deal of memory to hold. It is ' +
      'near-real-time, not real-time: a document is searchable after the next ' +
      'refresh, about a second later.',
    keyInsight:
      'It is a search engine, not a database. Using it as the system of ' +
      'record is the mistake it invites and punishes.',
  },
  {
    id: 'spark',
    name: 'SPARK',
    realName: 'Apache Spark',
    type: 'intel',
    roles: ['process'],
    base: {
      throughput: 175,
      latency: 175,
      durability: 110,
      memory: 190,
      consistency: 105,
      scalability: 196,
    },
    growth: {
      throughput: 5.4,
      latency: 1.4,
      durability: 3.4,
      memory: 5.6,
      consistency: 1.6,
      scalability: 5.4,
    },
    skills: ['map-reduce', 'lazy-evaluation', 'columnar-scan'],
    rarity: 22,
    habitats: ['index-spires'],
    codex:
      'Distributed computation over data that does not fit on one machine. ' +
      'Transformations are lazy: nothing runs until an action forces it, which ' +
      'lets the engine see the whole plan and optimise across stages. The ' +
      'shuffle between stages is where the network becomes the bottleneck and ' +
      'where most Spark tuning actually happens.',
    keyInsight:
      'Its latency is enormous and that is correct. It is built for throughput ' +
      'over terabytes, not for answering one question quickly.',
  },
  {
    id: 'clickhouse',
    name: 'CLICKHOUSE',
    realName: 'ClickHouse',
    type: 'intel',
    roles: ['store'],
    base: {
      throughput: 198,
      latency: 35,
      durability: 130,
      memory: 150,
      consistency: 90,
      scalability: 160,
    },
    growth: {
      throughput: 5.9,
      latency: 0.32,
      durability: 4.0,
      memory: 4.4,
      consistency: 1.4,
      scalability: 4.2,
    },
    skills: ['columnar-scan', 'lazy-evaluation', 'inverted-index'],
    rarity: 18,
    habitats: ['index-spires', 'relational-vale'],
    codex:
      'A columnar database that aggregates over billions of rows in under a ' +
      'second. Storing by column means an average over one field never reads ' +
      'the other ninety-nine, and values of a single type sitting together ' +
      'compress by an order of magnitude. Updates and deletes are awkward by ' +
      'design, because analytical data is append-only in practice.',
    keyInsight:
      'Row stores optimise for reading whole records; column stores optimise ' +
      'for reading one field of every record. That choice is the whole engine.',
  },
  {
    id: 'milvus',
    name: 'MILVUS',
    realName: 'Milvus / vector database',
    type: 'intel',
    roles: ['store'],
    base: {
      throughput: 140,
      latency: 45,
      durability: 100,
      memory: 185,
      consistency: 75,
      scalability: 155,
    },
    growth: {
      throughput: 4.4,
      latency: 0.4,
      durability: 3.2,
      memory: 5.4,
      consistency: 1.1,
      scalability: 4.0,
    },
    skills: ['vector-search', 'inverted-index', 'anomaly-detect'],
    rarity: 20,
    habitats: ['index-spires'],
    codex:
      'Stores embeddings and finds the nearest ones. Because meaning is a ' +
      'direction in a high-dimensional space, this matches on what text is ' +
      'about rather than on which characters it contains. Exact nearest ' +
      'neighbour search is too slow at scale, so the indexes are approximate ' +
      'and trade a little recall for enormous speed.',
    keyInsight:
      'Approximate is the point. Getting 95% of the right neighbours in 5ms ' +
      'beats all of them in 5 seconds for every use this has.',
  },
];
