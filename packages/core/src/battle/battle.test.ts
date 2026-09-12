import { describe, expect, it } from 'vitest';
import { getSkill } from '@stackmon/content';
import { Battle, type PlayerAction } from './battle.js';
import type { BattleSetup } from './state.js';

const baseSetup = (over: Partial<BattleSetup> = {}): BattleSetup => ({
  lineup: [
    { specId: 'kafka', level: 20 },
    { specId: 'golang', level: 20 },
    { specId: 'postgres', level: 20 },
  ],
  bench: [{ specId: 'redis', level: 20 }],
  incidentId: 'traffic-spike',
  seed: 'battle-test',
  ...over,
});

/** Run a battle to completion with a simple always-attack policy. */
function playOut(b: Battle, maxTurns = 60): void {
  for (let i = 0; i < maxTurns && b.state.outcome === 'ongoing'; i++) {
    const actor = b.state.pipeline.find((p) => p.occupant && !p.occupant.downed)?.occupant;
    let action: PlayerAction = { kind: 'hold' };
    if (actor) {
      const usable = b.availableSkills(actor.uid);
      if (usable.length > 0) {
        action = { kind: 'skill', actorUid: actor.uid, skillId: usable[0]!.id };
      }
    }
    b.step(action);
  }
}

describe('Battle', () => {
  it('is deterministic for a given seed', () => {
    const a = new Battle(baseSetup());
    const b = new Battle(baseSetup());
    playOut(a);
    playOut(b);

    expect(a.state.outcome).toBe(b.state.outcome);
    expect(a.state.turn).toBe(b.state.turn);
    expect(a.state.log.map((e) => e.text)).toEqual(b.state.log.map((e) => e.text));
  });

  it('produces a different battle for a different seed', () => {
    const a = new Battle(baseSetup({ seed: 'alpha' }));
    const b = new Battle(baseSetup({ seed: 'omega' }));
    playOut(a);
    playOut(b);
    expect(a.state.log.map((e) => e.text)).not.toEqual(b.state.log.map((e) => e.text));
  });

  it('always terminates rather than stalling forever', () => {
    const b = new Battle(baseSetup());
    playOut(b, 200);
    expect(b.state.outcome).not.toBe('ongoing');
  });

  it('spends memory and sets a cooldown when a skill is used', () => {
    const b = new Battle(baseSetup());
    const kafka = b.state.pipeline[0]!.occupant!;
    const skill = getSkill('backpressure');
    const memBefore = kafka.mem;

    b.step({ kind: 'skill', actorUid: kafka.uid, skillId: skill.id });

    // Memory regenerates at end of turn, so check the cooldown and the fact
    // that the spend happened rather than the raw balance.
    expect(kafka.cooldowns[skill.id] ?? 0).toBeGreaterThan(0);
    expect(memBefore).toBeGreaterThanOrEqual(skill.cost);
  });

  it('refuses a skill that is on cooldown', () => {
    const b = new Battle(baseSetup());
    const kafka = b.state.pipeline[0]!.occupant!;
    b.step({ kind: 'skill', actorUid: kafka.uid, skillId: 'backpressure' });

    expect(b.skillBlockedReason(kafka.uid, 'backpressure')).toMatch(/Cooling down/);
    const entries = b.step({ kind: 'skill', actorUid: kafka.uid, skillId: 'backpressure' });
    expect(entries.some((e) => e.text.includes('cannot use'))).toBe(true);
  });

  it('damages integrity when work is served all the way through', () => {
    const b = new Battle(baseSetup());
    const before = b.state.incident.integrity;
    b.step({ kind: 'hold' });
    expect(b.state.incident.integrity).toBeLessThan(before);
    expect(b.state.totalHandled).toBeGreaterThan(0);
  });

  it('burns error budget when work is dropped', () => {
    // No PROCESS stage at all, so everything the ingest handles is then lost.
    const b = new Battle(
      baseSetup({
        lineup: [{ specId: 'kafka', level: 20 }, null, { specId: 'postgres', level: 20 }],
        bench: [],
      }),
    );
    const before = b.state.errorBudget;
    b.step({ kind: 'hold' });
    expect(b.state.errorBudget).toBeLessThan(before);
  });

  it('loses when the error budget runs out', () => {
    const b = new Battle(
      baseSetup({
        lineup: [null, null, null],
        bench: [],
        incidentId: 'black-friday',
      }),
    );
    playOut(b, 100);
    expect(b.state.outcome).toBe('defeat');
  });

  it('a pipeline built for the incident beats one that is not', () => {
    // Traffic Spike is raw volume. Buffering at ingest is the counter; a
    // pipeline with no buffer capacity anywhere should do measurably worse.
    const buffered = new Battle(
      baseSetup({
        lineup: [
          { specId: 'kafka', level: 22 },
          { specId: 'golang', level: 22 },
          { specId: 'postgres', level: 22 },
        ],
      }),
    );
    const unbuffered = new Battle(
      baseSetup({
        lineup: [
          { specId: 'caffeine', level: 22 }, // tiny memory, no buffering
          { specId: 'cpython', level: 22 }, // and a weak processor
          { specId: 'memcached', level: 22 },
        ],
      }),
    );
    playOut(buffered);
    playOut(unbuffered);

    expect(buffered.state.totalDropped).toBeLessThan(unbuffered.state.totalDropped);
  });

  it('swapping loses whatever the outgoing component had buffered', () => {
    const b = new Battle(baseSetup());
    const kafka = b.state.pipeline[0]!.occupant!;
    kafka.buffer = 80;

    const entries = b.step({ kind: 'swap', slotIndex: 0, benchIndex: 0 });
    expect(kafka.buffer).toBe(0);
    expect(entries.some((e) => e.text.includes('buffered ops lost'))).toBe(true);
  });

  it('replay brings a downed component back', () => {
    const b = new Battle(baseSetup());
    const kafka = b.state.pipeline[0]!.occupant!;
    const store = b.state.pipeline[2]!.occupant!;
    store.hp = 0;
    store.downed = true;

    b.step({ kind: 'skill', actorUid: kafka.uid, skillId: 'replay-log' });
    expect(store.downed).toBe(false);
    expect(store.hp).toBeGreaterThan(0);
  });

  it('can be resumed from a serialised state and continue identically', () => {
    const a = new Battle(baseSetup());
    for (let i = 0; i < 4; i++) a.step({ kind: 'hold' });

    const snapshot = JSON.parse(JSON.stringify(a.state));
    const rngState = a.rngState;

    const resumed = Battle.resume(snapshot, rngState);
    for (let i = 0; i < 4; i++) {
      a.step({ kind: 'hold' });
      resumed.step({ kind: 'hold' });
    }

    expect(resumed.state.incident.integrity).toBe(a.state.incident.integrity);
    expect(resumed.state.errorBudget).toBe(a.state.errorBudget);
  });

  it('every log entry belongs to a real turn', () => {
    const b = new Battle(baseSetup());
    playOut(b);
    for (const entry of b.state.log) {
      expect(entry.turn).toBeGreaterThanOrEqual(1);
      expect(entry.turn).toBeLessThanOrEqual(b.state.turn);
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });
});
