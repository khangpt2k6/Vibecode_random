import { describe, expect, it } from 'vitest';
import { ALL_CREATURES, getCrop } from '@stackmon/content';
import { gain, plant, startBuild, syncPlots, tickBuild } from './base.js';
import { giveStarterParty, newPlayer } from './player.js';
import {
  FAMILY_OF,
  OBJECTIVES,
  currentObjective,
  nudges,
  objectivePosition,
  objectivesDone,
} from './objectives.js';

const T0 = 1_700_000_000_000;

describe('objectives', () => {
  it('the family table matches the creature roster exactly', () => {
    // This table is duplicated so objectives stay a pure function of player
    // state. That is only safe if something checks it cannot drift.
    for (const spec of ALL_CREATURES) {
      expect(FAMILY_OF[spec.id]).toBe(spec.type);
    }
    expect(Object.keys(FAMILY_OF)).toHaveLength(ALL_CREATURES.length);
  });

  it('every objective explains what, why and how', () => {
    for (const o of OBJECTIVES) {
      expect(o.title.length).toBeGreaterThan(5);
      expect(o.why.length).toBeGreaterThan(20);
      expect(o.how.length).toBeGreaterThan(15);
    }
  });

  it('objective ids are unique', () => {
    const ids = new Set(OBJECTIVES.map((o) => o.id));
    expect(ids.size).toBe(OBJECTIVES.length);
  });

  it('a brand new player is pointed at the first objective', () => {
    const p = newPlayer('t');
    const o = currentObjective(p, T0);
    expect(o?.id).toBe('look-around');
    expect(objectivesDone(p, T0)).toBe(0);
  });

  it('advances as the player actually does things', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    // The starter party marks five creatures seen; one more clears the first.
    p.seen.push('docker');
    expect(currentObjective(p, T0)?.id).toBe('first-capture');

    p.stats.captures = 1;
    expect(currentObjective(p, T0)?.id).toBe('first-battle');

    p.stats.battles = 1;
    expect(currentObjective(p, T0)?.id).toBe('first-win');

    p.stats.victories = 1;
    expect(currentObjective(p, T0)?.id).toBe('power-grid');
  });

  it('the displayed position tracks the current goal, not the count finished', () => {
    // A player who caught and won before being asked has three done but is
    // still on goal one. Showing "4 / 12" next to "Look around" reads as a bug.
    const p = newPlayer('t');
    p.stats = { battles: 2, victories: 1, opsServed: 0, opsDropped: 0, captures: 1 };
    expect(currentObjective(p, T0)?.id).toBe('look-around');
    expect(objectivePosition(p, T0)).toBe(1);
    expect(objectivesDone(p, T0)).toBeGreaterThan(1);
  });

  it('never points at something already done, even on a save that skipped ahead', () => {
    // A player who captured and won before the tracker ever rendered must not
    // be told to go do those things.
    const p = newPlayer('t');
    p.seen = ['a', 'b', 'c', 'd', 'e', 'f'];
    p.stats = { battles: 3, victories: 2, opsServed: 1, opsDropped: 1, captures: 4 };
    const o = currentObjective(p, T0);
    expect(o?.id).toBe('power-grid');
  });

  it('counts progress on the countable ones', () => {
    const p = newPlayer('t');
    const first = OBJECTIVES[0]!;
    expect(first.progress?.(p, T0)).toBe(0);
    p.seen = ['a', 'b', 'c'];
    expect(first.progress?.(p, T0)).toBeCloseTo(0.5, 2);
  });

  it('the six-families goal needs one from each family', () => {
    const p = newPlayer('t');
    const goal = OBJECTIVES.find((o) => o.id === 'six-families')!;
    p.roster = ['postgres', 'kafka', 'golang', 'docker', 'redis'].map((specId, i) => ({
      uid: `${specId}#${i}`, specId, level: 5, xp: 0, battles: 0, caughtOn: i,
    }));
    expect(goal.done(p, T0)).toBe(false);
    expect(goal.progress?.(p, T0)).toBeCloseTo(5 / 6, 3);

    p.roster.push({ uid: 'spark#9', specId: 'spark', level: 5, xp: 0, battles: 0, caughtOn: 9 });
    expect(goal.done(p, T0)).toBe(true);
  });

  it('runs out of objectives once everything is done', () => {
    const p = newPlayer('t');
    p.seen = ALL_CREATURES.map((c) => c.id);
    p.stats = { battles: 9, victories: 9, opsServed: 1, opsDropped: 1, captures: 9 };
    p.resources = { compute: 999, memory: 999, bandwidth: 999, storage: 999, scrap: 999 };
    p.base.built = ['power-grid', 'runtime-forge', 'image-registry', 'container-yard', 'message-broker', 'data-vault'];
    p.roster = ['postgres', 'kafka', 'golang', 'docker', 'redis', 'spark'].map((specId, i) => ({
      uid: `${specId}#${i}`, specId, level: 5, xp: 0, battles: 0, caughtOn: i,
    }));
    expect(currentObjective(p, T0)).toBeNull();
    expect(objectivesDone(p, T0)).toBe(OBJECTIVES.length);
  });
});

describe('nudges', () => {
  it('says nothing useful for a player with no base yet', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    expect(nudges(p, T0).map((n) => n.id)).not.toContain('harvest');
  });

  it('reports ready crops and empty plots', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    gain(p, { scrap: 500 });
    p.base.built = ['power-grid'];
    syncPlots(p.base);

    plant(p, p.base, 0, 'cpu-cycles', T0);
    const at = T0 + getCrop('cpu-cycles').growSeconds * 1000;
    const ids = nudges(p, at).map((n) => n.id);
    expect(ids).toContain('harvest');
    expect(ids).toContain('plant');
  });

  it('warns about an empty pipeline slot', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    p.party[1] = null;
    expect(nudges(p, T0).map((n) => n.id)).toContain('party');
  });

  it('announces a finished construction', () => {
    const p = newPlayer('t');
    gain(p, { scrap: 500 });
    startBuild(p, p.base, 'power-grid', T0);
    const done = p.base.building!.doneAt;
    expect(nudges(p, done).map((n) => n.id)).toContain('built');
    tickBuild(p.base, done);
    expect(nudges(p, done).map((n) => n.id)).not.toContain('built');
  });
});
