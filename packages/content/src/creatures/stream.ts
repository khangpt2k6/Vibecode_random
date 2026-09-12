import type { CreatureSpec } from '../schema.js';

/**
 * STREAM family.
 *
 * Systems that accept work now and do it later. They are how a pipeline
 * survives a spike it cannot process, and how a consumer that fell over gets
 * to catch up instead of losing everything that happened while it was down.
 *
 * They all trade freshness for absorption. Nothing here answers a question.
 */
export const STREAM_CREATURES: CreatureSpec[] = [
  {
    id: 'kafka',
    name: 'KAFKA',
    realName: 'Apache Kafka',
    type: 'stream',
    roles: ['ingest'],
    base: {
      throughput: 195,
      latency: 70,
      durability: 165,
      memory: 190,
      consistency: 140,
      scalability: 185,
    },
    growth: {
      throughput: 5.8,
      latency: 0.55,
      durability: 4.6,
      memory: 5.5,
      consistency: 2.0,
      scalability: 4.8,
    },
    skills: ['replay-log', 'partition-rebalance', 'backpressure', 'exactly-once'],
    rarity: 26,
    habitats: ['stream-delta'],
    evolution: { into: 'kafka-cluster', level: 32, condition: 'Survive 3 spike incidents' },
    codex:
      'A distributed, append-only, replayable log. Producers write to the end, ' +
      'consumers read at their own offset, and nothing is deleted when it is ' +
      'read - it ages out on a retention policy instead. That single design ' +
      'decision is why a consumer can be rebuilt from scratch, why three teams ' +
      'can read the same events independently, and why the log ends up being ' +
      'the system of record rather than a pipe between two services.',
    keyInsight:
      'It is not a queue. A queue forgets a message once it is consumed; ' +
      'Kafka keeps it, which is what makes replay and fan-out possible.',
  },
  {
    id: 'rabbitmq',
    name: 'RABBITMQ',
    realName: 'RabbitMQ',
    type: 'stream',
    roles: ['ingest', 'process'],
    base: {
      throughput: 112,
      latency: 35,
      durability: 130,
      memory: 80,
      consistency: 162,
      scalability: 95,
    },
    growth: {
      throughput: 3.4,
      latency: 0.35,
      durability: 3.8,
      memory: 2.4,
      consistency: 2.6,
      scalability: 2.2,
    },
    skills: ['dead-letter', 'prefetch-limit', 'fanout', 'backpressure'],
    rarity: 44,
    habitats: ['stream-delta'],
    codex:
      'A real message broker, with per-message acknowledgement, flexible ' +
      'routing through exchanges, and a dead-letter queue for the ones that ' +
      'keep failing. Lower throughput than a log, and far better ergonomics ' +
      'when what you want is work distribution rather than an event history.',
    keyInsight:
      'Per-message ack and redelivery is what it has that Kafka does not. ' +
      'Use it for task queues; use a log for event streams.',
  },
  {
    id: 'pulsar',
    name: 'PULSAR',
    realName: 'Apache Pulsar',
    type: 'stream',
    roles: ['ingest'],
    base: {
      throughput: 178,
      latency: 58,
      durability: 172,
      memory: 176,
      consistency: 150,
      scalability: 196,
    },
    growth: {
      throughput: 5.2,
      latency: 0.5,
      durability: 4.9,
      memory: 5.0,
      consistency: 2.3,
      scalability: 5.4,
    },
    skills: ['partition-rebalance', 'replay-log', 'fanout', 'dead-letter'],
    rarity: 16,
    habitats: ['stream-delta'],
    codex:
      'Separates serving from storage: brokers are stateless and the data ' +
      'lives in BookKeeper underneath. That means adding a broker does not ' +
      'move any data, so scaling and rebalancing cost far less than they do ' +
      'when the broker owns the disk. It also means two systems to operate.',
    keyInsight:
      'Decoupled compute and storage is the architectural idea worth taking ' +
      'from it, and it shows up again in every modern data warehouse.',
  },
  {
    id: 'nats',
    name: 'NATS',
    realName: 'NATS',
    type: 'stream',
    roles: ['ingest', 'process'],
    base: {
      throughput: 160,
      latency: 8,
      durability: 45,
      memory: 50,
      consistency: 72,
      scalability: 140,
    },
    growth: {
      throughput: 4.8,
      latency: 0.08,
      durability: 1.5,
      memory: 1.6,
      consistency: 1.2,
      scalability: 3.8,
    },
    skills: ['fanout', 'backpressure', 'prefetch-limit'],
    rarity: 34,
    habitats: ['stream-delta', 'container-yards'],
    codex:
      'Fire and forget, in microseconds. Core NATS holds nothing: if no ' +
      'subscriber is listening, the message is simply gone. That is not a ' +
      'defect, it is the point - for service discovery, health signals, and ' +
      'request/reply between services, delivery guarantees would only cost ' +
      'you latency you did not want to spend.',
    keyInsight:
      'At-most-once delivery is a legitimate choice. Ask what it costs you ' +
      'when a message is lost before paying for a guarantee you do not need.',
  },
];
