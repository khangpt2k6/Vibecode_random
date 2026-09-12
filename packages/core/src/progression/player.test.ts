import { describe, expect, it } from 'vitest';
import { getCreature } from '@stackmon/content';
import { Rng } from '@stackmon/util';
import {
  MAX_LEVEL,
  addToRoster,
  applyBattle,
  assignToParty,
  attemptCapture,
  battleLineup,
  captureChance,
  captureCost,
  giveStarterParty,
  grantXp,
  newPlayer,
  normalise,
  xpToNext,
} from './player.js';

describe('progression', () => {
  it('starts a new player with a usable party and bench', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    expect(p.roster).toHaveLength(5);
    expect(p.party.every((u) => u !== null)).toBe(true);
    expect(p.bench).toHaveLength(2);
    const { lineup, bench } = battleLineup(p);
    expect(lineup.filter(Boolean)).toHaveLength(3);
    expect(bench).toHaveLength(2);
  });

  it('levels up when XP crosses the threshold and carries the remainder', () => {
    const p = newPlayer('t');
    const c = addToRoster(p, 'redis', 1);
    const need = xpToNext(1);
    const up = grantXp(c, need + 10);
    expect(up).toEqual({ uid: c.uid, from: 1, to: 2 });
    expect(c.xp).toBe(10);
  });

  it('never exceeds the level cap', () => {
    const p = newPlayer('t');
    const c = addToRoster(p, 'redis', MAX_LEVEL - 1);
    grantXp(c, 10_000_000);
    expect(c.level).toBe(MAX_LEVEL);
    expect(grantXp(c, 1000)).toBeNull();
  });

  it('XP requirements grow with level', () => {
    expect(xpToNext(10)).toBeGreaterThan(xpToNext(5));
    expect(xpToNext(30)).toBeGreaterThan(xpToNext(10));
  });

  it('a win pays full rewards and records the clear', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    const scrapBefore = p.resources.scrap;
    const rewards = applyBattle(p, {
      incidentId: 'traffic-spike',
      won: true,
      turns: 8,
      opsServed: 900,
      opsDropped: 100,
      participants: p.roster.map((c) => c.uid),
    });
    expect(rewards.firstClear).toBe(true);
    expect(p.resources.scrap).toBeGreaterThan(scrapBefore);
    expect(p.incidents['traffic-spike']?.won).toBe(1);
    expect(p.incidents['traffic-spike']?.bestTurns).toBe(8);
    expect(p.stats.victories).toBe(1);
    for (const c of p.roster) expect(c.battles).toBe(1);
  });

  it('a loss still pays something, but less', () => {
    const win = newPlayer('a');
    giveStarterParty(win);
    const lose = newPlayer('b');
    giveStarterParty(lose);
    const participants = (p: typeof win) => p.roster.map((c) => c.uid);

    const w = applyBattle(win, { incidentId: 'traffic-spike', won: true, turns: 8, opsServed: 1, opsDropped: 1, participants: participants(win) });
    const l = applyBattle(lose, { incidentId: 'traffic-spike', won: false, turns: 8, opsServed: 1, opsDropped: 1, participants: participants(lose) });

    expect(l.xpEach).toBeGreaterThan(0);
    expect(l.xpEach).toBeLessThan(w.xpEach);
    expect(l.scrap).toBeLessThan(w.scrap);
    expect(lose.incidents['traffic-spike']?.lost).toBe(1);
  });

  it('unlocks skills on a first clear, once', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    const report = { incidentId: 'poison-pill', won: true, turns: 10, opsServed: 1, opsDropped: 0, participants: [] as string[] };
    const first = applyBattle(p, report);
    const second = applyBattle(p, report);
    expect(first.unlocked).toContain('dead-letter');
    expect(second.unlocked).toHaveLength(0);
    expect(p.unlockedSkills).toEqual(['dead-letter']);
  });

  it('rarer creatures cost more and are harder to catch', () => {
    const kafka = getCreature('kafka'); // rarity 26
    const sqlite = getCreature('sqlite'); // rarity 55
    expect(captureCost(kafka, 10)).toBeGreaterThan(captureCost(sqlite, 10));
    expect(captureChance(kafka, 10, captureCost(kafka, 10))).toBeLessThan(
      captureChance(sqlite, 10, captureCost(sqlite, 10)),
    );
  });

  it('overpaying improves the odds, with a ceiling', () => {
    const spec = getCreature('kafka');
    const cost = captureCost(spec, 10);
    const base = captureChance(spec, 10, cost);
    const paid = captureChance(spec, 10, cost * 3);
    expect(paid).toBeGreaterThan(base);
    expect(paid).toBeLessThanOrEqual(0.98);
  });

  it('a successful capture spends scrap, joins the roster, and lands on the bench', () => {
    const p = newPlayer('t');
    p.resources.scrap = 10_000;
    const rng = new Rng('lucky');
    // Cheap common creature with heavy overpay: effectively guaranteed.
    const spec = getCreature('sqlite');
    const result = attemptCapture(p, { specId: spec.id, level: 5, scrapOffered: captureCost(spec, 5) * 4 }, rng);
    expect(result.success).toBe(true);
    expect(result.owned).toBeDefined();
    expect(p.roster.some((c) => c.uid === result.owned!.uid)).toBe(true);
    expect(p.bench).toContain(result.owned!.uid);
    expect(p.resources.scrap).toBe(10_000 - result.scrapSpent);
    expect(p.stats.captures).toBe(1);
  });

  it('refuses a capture the player cannot afford', () => {
    const p = newPlayer('t');
    p.resources.scrap = 1;
    const result = attemptCapture(p, { specId: 'kafka', level: 20, scrapOffered: 1 }, new Rng('x'));
    expect(result.success).toBe(false);
    expect(result.scrapSpent).toBe(0);
    expect(p.resources.scrap).toBe(1);
  });

  it('is deterministic for a given rng seed', () => {
    const run = () => {
      const p = newPlayer('t');
      p.resources.scrap = 500;
      const rng = new Rng('same-seed');
      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(attemptCapture(p, { specId: 'kafka', level: 10, scrapOffered: 30 }, rng).success);
      }
      return results;
    };
    expect(run()).toEqual(run());
  });

  it('assigning to a party slot moves the displaced member to the bench', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    const newcomer = addToRoster(p, 'clickhouse', 8);
    const displaced = p.party[2]!;
    assignToParty(p, newcomer.uid, 2);
    expect(p.party[2]).toBe(newcomer.uid);
    expect(p.bench).toContain(displaced);
    expect(p.party.filter((u) => u === newcomer.uid)).toHaveLength(1);
  });

  it('normalise repairs a save that references missing creatures', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    p.party[1] = 'ghost#999';
    p.bench.push('ghost#1000');
    p.roster[0]!.level = 999;
    normalise(p);
    expect(p.party[1]).toBeNull();
    expect(p.bench).not.toContain('ghost#1000');
    expect(p.roster[0]!.level).toBe(MAX_LEVEL);
  });

  it('survives a JSON round trip unchanged', () => {
    const p = newPlayer('t');
    giveStarterParty(p);
    applyBattle(p, { incidentId: 'traffic-spike', won: true, turns: 5, opsServed: 10, opsDropped: 2, participants: p.roster.map((c) => c.uid) });
    const copy = normalise(JSON.parse(JSON.stringify(p)));
    expect(copy).toEqual(p);
  });
});
