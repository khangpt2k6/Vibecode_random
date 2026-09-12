import { describe, expect, it } from 'vitest';
import { runFlow } from './flow.js';
import { createBattle, type BattleState } from './state.js';

/**
 * Flow tests.
 *
 * These pin down the behaviour the whole game is trying to teach, so they
 * are written as statements about pipelines rather than about code: adding
 * capacity away from the bottleneck does nothing, a buffer defers work
 * rather than creating capacity, and a dead stage stops everything behind it.
 *
 * If one of these ever has to be relaxed to make a fight winnable, the fight
 * is wrong, not the test.
 */

function build(
  lineup: Array<{ specId: string; level: number } | null>,
  incidentId = 'traffic-spike',
): BattleState {
  return createBattle({ lineup, bench: [], incidentId, seed: 'test' });
}

describe('runFlow', () => {
  it('passes load straight through when every stage has spare capacity', () => {
    const s = build([
      { specId: 'kafka', level: 20 },
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);
    const result = runFlow(s, 40);

    expect(result.totalDropped).toBe(0);
    expect(result.delivered).toBe(40);
    expect(result.bottleneck).toBe(-1);
  });

  it('is limited by the smallest stage, not the largest', () => {
    // Kafka ingests enormously, CPython processes very little. Total capacity
    // is irrelevant: the pipeline delivers what CPython can handle.
    const s = build([
      { specId: 'kafka', level: 30 },
      { specId: 'cpython', level: 5 },
      { specId: 'postgres', level: 30 },
    ]);
    const result = runFlow(s, 400);

    const process = result.stages[1]!;
    expect(result.delivered).toBeLessThanOrEqual(process.capacity);
    expect(result.bottleneck).toBe(1);
  });

  it('adding capacity away from the bottleneck changes nothing', () => {
    const weak = build([
      { specId: 'nginx', level: 10 },
      { specId: 'cpython', level: 5 },
      { specId: 'postgres', level: 10 },
    ]);
    const strongerEdge = build([
      { specId: 'nginx', level: 40 }, // far more ingest capacity
      { specId: 'cpython', level: 5 }, // same bottleneck
      { specId: 'postgres', level: 10 },
    ]);

    const a = runFlow(weak, 300);
    const b = runFlow(strongerEdge, 300);

    expect(b.delivered).toBeCloseTo(a.delivered, 5);
  });

  it('buffers overflow instead of dropping it, up to capacity', () => {
    const s = build([
      { specId: 'kafka', level: 20 },
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);
    const kafka = s.pipeline[0]!.occupant!;
    const cap = kafka.bufferCap;

    // Push in far more than Kafka can handle, but less than it can hold.
    const load = kafka.base.throughput + cap * 0.5;
    const result = runFlow(s, load);

    expect(result.stages[0]!.dropped).toBe(0);
    expect(kafka.buffer).toBeGreaterThan(0);
    expect(kafka.buffer).toBeLessThanOrEqual(cap);
  });

  it('drops what it cannot buffer', () => {
    const s = build([
      { specId: 'nats', level: 5 }, // tiny memory, so a tiny buffer
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);
    const nats = s.pipeline[0]!.occupant!;
    const result = runFlow(s, nats.base.throughput + nats.bufferCap + 500);

    expect(result.stages[0]!.dropped).toBeGreaterThan(0);
    expect(result.totalDropped).toBeGreaterThan(0);
  });

  it('drains the buffer before accepting new work', () => {
    const s = build([
      { specId: 'kafka', level: 20 },
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);
    const kafka = s.pipeline[0]!.occupant!;
    kafka.buffer = 50;

    const result = runFlow(s, 10);
    expect(result.stages[0]!.fromBuffer).toBe(50);
    expect(kafka.buffer).toBe(0);
  });

  it('a buffer defers work, it does not create capacity', () => {
    const s = build([
      { specId: 'kafka', level: 25 },
      { specId: 'golang', level: 25 },
      { specId: 'postgres', level: 25 },
    ]);
    const kafka = s.pipeline[0]!.occupant!;
    const sustained = kafka.base.throughput * 3;

    // Sustained overload: the buffer absorbs the first wave and then fills.
    const first = runFlow(s, sustained);
    let lastDropped = first.totalDropped;
    for (let i = 0; i < 6; i++) {
      lastDropped = runFlow(s, sustained).totalDropped;
    }

    expect(first.totalDropped).toBeLessThan(lastDropped);
    expect(lastDropped).toBeGreaterThan(0);
  });

  it('an empty stage drops everything and starves everything downstream', () => {
    const s = build([
      { specId: 'kafka', level: 20 },
      null, // no PROCESS
      { specId: 'postgres', level: 20 },
    ]);
    const result = runFlow(s, 100);

    expect(result.delivered).toBe(0);
    expect(result.stages[2]!.incoming).toBe(0);
    expect(result.totalDropped).toBeGreaterThan(0);
  });

  it('a downed stage behaves like an empty one', () => {
    const s = build([
      { specId: 'kafka', level: 20 },
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);
    s.pipeline[1]!.occupant!.downed = true;

    const result = runFlow(s, 100);
    expect(result.delivered).toBe(0);
  });

  it('an off-role creature has reduced capacity', () => {
    // Postgres is a STORE. Standing it at INGEST costs it real throughput.
    const onRole = build([
      { specId: 'kafka', level: 20 },
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);
    const offRole = build([
      { specId: 'postgres', level: 20 },
      { specId: 'golang', level: 20 },
      { specId: 'postgres', level: 20 },
    ]);

    const a = runFlow(onRole, 10).stages[0]!.capacity;
    const b = runFlow(offRole, 10).stages[0]!.capacity;
    expect(b).toBeLessThan(a);
  });
});
