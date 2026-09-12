/**
 * Balance sweep.
 *
 * Runs every incident against a range of party levels and reports win rate,
 * average turns, and how much work was dropped. This exists because balance
 * in this game cannot be eyeballed: the stats are fixed by what the
 * technologies actually are, so the only knobs left are incident numbers and
 * the tier-to-level curve, and those have to be measured.
 *
 * Run with:  npx tsx packages/tools/src/balance.ts
 */

import { ALL_INCIDENTS, getCreature, type IncidentSpec } from '@stackmon/content';
import { Battle, type PlayerAction, type BattleSetup } from '@stackmon/core';

/** A reasonable, non-expert pipeline: a buffer, a worker, a store. */
const STANDARD_LINEUP = ['kafka', 'golang', 'postgres'];
const STANDARD_BENCH = ['redis', 'nginx'];

/**
 * The policy a competent-but-not-optimal player would follow: use the
 * highest-cost skill available on the healthiest component, else hold.
 * Measuring against a greedy baseline is the point - if a greedy player
 * cannot clear a tier-1 incident, it is not a tier-1 incident.
 */
function greedyAction(b: Battle): PlayerAction {
  const candidates = b.state.pipeline
    .map((p) => p.occupant)
    .filter((c): c is NonNullable<typeof c> => c !== null && !c.downed);

  let best: PlayerAction = { kind: 'hold' };
  let bestCost = -1;
  for (const c of candidates) {
    for (const skill of b.availableSkills(c.uid)) {
      if (skill.cost > bestCost) {
        bestCost = skill.cost;
        best = { kind: 'skill', actorUid: c.uid, skillId: skill.id };
      }
    }
  }
  return best;
}

interface Sample {
  won: boolean;
  turns: number;
  dropped: number;
  handled: number;
  budgetLeft: number;
}

function runOne(incident: IncidentSpec, level: number, seed: string): Sample {
  const setup: BattleSetup = {
    lineup: STANDARD_LINEUP.map((specId) => ({ specId, level })),
    bench: STANDARD_BENCH.map((specId) => ({ specId, level })),
    incidentId: incident.id,
    seed,
  };
  const b = new Battle(setup);
  let guard = 0;
  while (b.state.outcome === 'ongoing' && guard++ < 150) {
    b.step(greedyAction(b));
  }
  return {
    won: b.state.outcome === 'victory',
    turns: b.state.turn,
    dropped: Math.round(b.state.totalDropped),
    handled: Math.round(b.state.totalHandled),
    budgetLeft: b.state.errorBudget,
  };
}

function sweep(runs = 40): void {
  const levels = [5, 10, 15, 20, 25, 30, 40];

  console.log('\nSTACKMON balance sweep');
  console.log(`${runs} runs per cell, greedy policy, lineup ${STANDARD_LINEUP.join(' / ')}\n`);

  const header = ['incident'.padEnd(20), 'tier', ...levels.map((l) => `L${l}`.padStart(7))];
  console.log(header.join(' '));
  console.log('-'.repeat(header.join(' ').length));

  for (const incident of ALL_INCIDENTS) {
    const cells: string[] = [];
    for (const level of levels) {
      let wins = 0;
      for (let i = 0; i < runs; i++) {
        if (runOne(incident, level, `sweep-${incident.id}-${level}-${i}`).won) wins++;
      }
      const rate = Math.round((wins / runs) * 100);
      cells.push(`${rate}%`.padStart(7));
    }
    console.log(
      [incident.name.padEnd(20), String(incident.tier).padEnd(4), ...cells].join(' '),
    );
  }

  console.log('\nA healthy curve reads near 0% well below the intended level and');
  console.log('near 100% well above it, crossing 50% around tier * 8.\n');
}

function detail(incidentId: string, level: number): void {
  const incident = ALL_INCIDENTS.find((i) => i.id === incidentId);
  if (!incident) {
    console.error(`No such incident: ${incidentId}`);
    process.exit(1);
  }
  const samples = Array.from({ length: 60 }, (_, i) =>
    runOne(incident, level, `detail-${incidentId}-${level}-${i}`),
  );
  const wins = samples.filter((s) => s.won).length;
  const avg = (f: (s: Sample) => number) =>
    Math.round((samples.reduce((sum, s) => sum + f(s), 0) / samples.length) * 10) / 10;

  console.log(`\n${incident.name} (tier ${incident.tier}) at level ${level}`);
  console.log(`  win rate     ${Math.round((wins / samples.length) * 100)}%`);
  console.log(`  avg turns    ${avg((s) => s.turns)}`);
  console.log(`  avg dropped  ${avg((s) => s.dropped)}`);
  console.log(`  avg handled  ${avg((s) => s.handled)}`);
  console.log(`  avg budget   ${avg((s) => s.budgetLeft)}%`);
  console.log(`  counter      ${incident.counterHint}\n`);
}

const [, , mode, arg1, arg2] = process.argv;
if (mode === 'detail' && arg1) {
  detail(arg1, Number(arg2 ?? 10));
} else {
  sweep(Number(arg1 ?? 40));
}

// Referenced so the import is not elided; the roster is validated elsewhere.
void getCreature;
