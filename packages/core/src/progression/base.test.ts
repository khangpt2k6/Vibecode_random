import { describe, expect, it } from 'vitest';
import { BUILDINGS, getBuilding, getCrop, unlockedCrops, unlockedTier } from '@stackmon/content';
import { newPlayer, type PlayerState } from './player.js';
import {
  buildMenu,
  canAfford,
  gain,
  growth,
  harvest,
  harvestAll,
  isReady,
  newBase,
  plant,
  plotCapacity,
  rushBuild,
  rushCost,
  spend,
  startBuild,
  summarise,
  syncPlots,
  tickBuild,
  type BaseState,
} from './base.js';

const T0 = 1_700_000_000_000;

function rich(): PlayerState {
  const p = newPlayer('t');
  gain(p, { compute: 999, memory: 999, bandwidth: 999, storage: 999, scrap: 999 });
  return p;
}

/** A base with the given buildings already up and its plots synced. */
function baseWith(...built: string[]): BaseState {
  const b = newBase();
  b.built = built;
  syncPlots(b);
  return b;
}

describe('build tree', () => {
  it('starts with no plots until the grid is up', () => {
    const base = newBase();
    expect(plotCapacity(base)).toBe(0);
    syncPlots(base);
    expect(base.plots).toHaveLength(0);
  });

  it('every building except the grid has a prerequisite', () => {
    for (const spec of BUILDINGS) {
      if (spec.id === 'power-grid') continue;
      expect(spec.requires.length).toBeGreaterThan(0);
    }
  });

  it('every prerequisite names a building that exists', () => {
    const ids = new Set(BUILDINGS.map((b) => b.id));
    for (const spec of BUILDINGS) {
      for (const r of spec.requires) expect(ids.has(r)).toBe(true);
    }
  });

  it('every gated building explains why it is gated', () => {
    for (const spec of BUILDINGS) {
      expect(spec.whyGated.length).toBeGreaterThan(30);
    }
  });

  it('the whole tree is reachable from nothing', () => {
    // If some building can never be unlocked, the content is broken.
    const built: string[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const spec of BUILDINGS) {
        if (built.includes(spec.id)) continue;
        if (spec.requires.every((r: string) => built.includes(r))) {
          built.push(spec.id);
          progressed = true;
        }
      }
    }
    expect(built).toHaveLength(BUILDINGS.length);
  });

  it('a cache cannot be built before a store', () => {
    const p = rich();
    const base = baseWith('power-grid');
    expect(startBuild(p, base, 'cache-farm', T0)).toEqual({ ok: false, reason: 'locked' });
    expect(getBuilding('cache-farm').requires).toContain('data-vault');
  });

  it('an orchestrator cannot be built before containers', () => {
    const p = rich();
    const base = baseWith('power-grid', 'runtime-forge');
    expect(startBuild(p, base, 'orchestrator', T0)).toEqual({ ok: false, reason: 'locked' });
  });

  it('search needs both a source of truth and a stream', () => {
    const spec = getBuilding('search-spire');
    expect(spec.requires).toContain('data-vault');
    expect(spec.requires).toContain('message-broker');

    const p = rich();
    const onlyVault = baseWith('power-grid', 'data-vault');
    expect(startBuild(p, onlyVault, 'search-spire', T0)).toEqual({ ok: false, reason: 'locked' });
  });
});

describe('construction', () => {
  it('spends the cost up front and completes on its timer', () => {
    const p = rich();
    const base = newBase();
    const spec = getBuilding('power-grid');
    const before = p.resources.scrap;

    const started = startBuild(p, base, 'power-grid', T0);
    expect(started.ok).toBe(true);
    expect(p.resources.scrap).toBe(before - (spec.cost.scrap ?? 0));

    expect(tickBuild(base, T0 + 1000)).toBeNull();
    expect(tickBuild(base, T0 + spec.buildSeconds * 1000)).toBe('power-grid');
    expect(base.built).toContain('power-grid');
    expect(base.building).toBeNull();
    expect(base.plots.length).toBeGreaterThan(0);
  });

  it('only one thing builds at a time', () => {
    const p = rich();
    const base = baseWith('power-grid');
    expect(startBuild(p, base, 'runtime-forge', T0).ok).toBe(true);
    expect(startBuild(p, base, 'message-broker', T0)).toEqual({ ok: false, reason: 'busy' });
  });

  it('reports exactly what is missing when it cannot afford a build', () => {
    const p = newPlayer('t');
    p.resources = { compute: 0, memory: 0, bandwidth: 0, storage: 0, scrap: 0 };
    const base = baseWith('power-grid');
    const result = startBuild(p, base, 'runtime-forge', T0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('cost');
      expect(result.missing?.compute).toBe(getBuilding('runtime-forge').cost.compute);
    }
  });

  it('rushing costs scrap and finishes immediately', () => {
    const p = rich();
    const base = baseWith('power-grid');
    // data-vault only needs the grid; orchestrator would be refused as locked
    // and there would be nothing to rush.
    expect(startBuild(p, base, 'data-vault', T0).ok).toBe(true);
    const cost = rushCost(base, T0);
    expect(cost).toBeGreaterThan(0);

    const scrapBefore = p.resources.scrap;
    expect(rushBuild(p, base, T0)).toBe(true);
    expect(p.resources.scrap).toBe(scrapBefore - cost);
    expect(tickBuild(base, T0)).toBe('data-vault');
  });

  it('there is nothing to rush when no build was actually started', () => {
    const p = rich();
    const base = baseWith('power-grid');
    expect(startBuild(p, base, 'orchestrator', T0)).toEqual({ ok: false, reason: 'locked' });
    expect(rushCost(base, T0)).toBe(0);
    expect(rushBuild(p, base, T0)).toBe(false);
  });

  it('finishes a build that completed while the tab was closed', () => {
    const p = rich();
    const base = newBase();
    startBuild(p, base, 'power-grid', T0);
    // Come back an hour later.
    expect(tickBuild(base, T0 + 3_600_000)).toBe('power-grid');
  });
});

describe('farming', () => {
  it('planting costs seed and sets a ready time', () => {
    const p = rich();
    const base = baseWith('power-grid');
    const crop = getCrop('cpu-cycles');
    const scrapBefore = p.resources.scrap;

    const result = plant(p, base, 0, 'cpu-cycles', T0);
    expect(result.ok).toBe(true);
    expect(p.resources.scrap).toBe(scrapBefore - (crop.seedCost.scrap ?? 0));
    expect(base.plots[0]!.readyAt).toBe(T0 + crop.growSeconds * 1000);
  });

  it('is not harvestable before it is ready', () => {
    const p = rich();
    const base = baseWith('power-grid');
    plant(p, base, 0, 'cpu-cycles', T0);
    expect(isReady(base.plots[0]!, T0 + 1000)).toBe(false);
    expect(harvest(p, base, 0, T0 + 1000).ok).toBe(false);
  });

  it('harvesting pays the yield and frees the plot', () => {
    const p = rich();
    const base = baseWith('power-grid');
    const crop = getCrop('cpu-cycles');
    plant(p, base, 0, 'cpu-cycles', T0);

    const computeBefore = p.resources.compute;
    const result = harvest(p, base, 0, T0 + crop.growSeconds * 1000);
    expect(result.ok).toBe(true);
    expect(p.resources.compute).toBe(computeBefore + (crop.yield.compute ?? 0));
    expect(base.plots[0]!.cropId).toBeNull();
  });

  it('growth runs from 0 to 1 over the grow time', () => {
    const p = rich();
    const base = baseWith('power-grid');
    const crop = getCrop('disk-array');
    plant(p, base, 0, 'disk-array', T0);
    const plot = base.plots[0]!;
    expect(growth(plot, T0)).toBe(0);
    expect(growth(plot, T0 + (crop.growSeconds * 1000) / 2)).toBeCloseTo(0.5, 2);
    expect(growth(plot, T0 + crop.growSeconds * 1000 * 3)).toBe(1);
  });

  it('refuses to plant on an occupied plot', () => {
    const p = rich();
    const base = baseWith('power-grid');
    plant(p, base, 0, 'cpu-cycles', T0);
    expect(plant(p, base, 0, 'ram-bank', T0)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('refuses a crop that is still locked', () => {
    const p = rich();
    const base = baseWith('power-grid');
    expect(unlockedCrops(base.built)).not.toContain('log-stream');
    expect(plant(p, base, 0, 'log-stream', T0)).toEqual({ ok: false, reason: 'locked' });

    const withRegistry = baseWith('power-grid', 'runtime-forge', 'image-registry');
    expect(unlockedCrops(withRegistry.built)).toContain('log-stream');
    expect(plant(p, withRegistry, 0, 'log-stream', T0).ok).toBe(true);
  });

  it('harvest-all collects every ready plot and leaves the rest', () => {
    const p = rich();
    const base = baseWith('power-grid');
    plant(p, base, 0, 'cpu-cycles', T0);
    plant(p, base, 1, 'cpu-cycles', T0);
    plant(p, base, 2, 'disk-array', T0);

    const at = T0 + getCrop('cpu-cycles').growSeconds * 1000;
    const result = harvestAll(p, base, at);
    expect(result.count).toBe(2);
    expect(result.gained.compute).toBe((getCrop('cpu-cycles').yield.compute ?? 0) * 2);
    expect(base.plots[2]!.cropId).toBe('disk-array');
  });
});

describe('unlocks', () => {
  it('tier 1 is always available and climbs with the right buildings', () => {
    expect(unlockedTier([])).toBe(1);
    expect(unlockedTier(['power-grid', 'message-broker'])).toBe(2);
    expect(unlockedTier(['power-grid', 'message-broker', 'runtime-forge', 'image-registry', 'container-yard', 'orchestrator'])).toBe(3);
  });

  it('the build menu labels each building correctly', () => {
    const p = newPlayer('t');
    p.resources = { compute: 0, memory: 0, bandwidth: 0, storage: 0, scrap: 1000 };
    const base = baseWith('power-grid');
    const menu = new Map(buildMenu(p, base).map((e) => [e.id, e] as const));

    expect(menu.get('power-grid')!.state).toBe('built');
    expect(menu.get('message-broker')!.state).toBe('unaffordable');
    expect(menu.get('cache-farm')!.state).toBe('locked');
    expect(menu.get('cache-farm')!.missingRequires).toContain('data-vault');
  });

  it('summarise reports what the base has earned', () => {
    const p = rich();
    const base = baseWith('power-grid', 'data-vault', 'cache-farm');
    plant(p, base, 0, 'cpu-cycles', T0);
    const s = summarise(p, base, T0 + 999_999);
    expect(s.plots).toBe(plotCapacity(base));
    expect(s.plotsReady).toBe(1);
    expect(s.built).toBe(3);
    expect(s.captureBonus).toBeGreaterThan(0);
  });
});

describe('resources', () => {
  it('spend refuses and changes nothing when short', () => {
    const p = newPlayer('t');
    p.resources = { compute: 5, memory: 0, bandwidth: 0, storage: 0, scrap: 0 };
    expect(canAfford(p, { compute: 10 })).toBe(false);
    expect(spend(p, { compute: 10 })).toBe(false);
    expect(p.resources.compute).toBe(5);
  });

  it('survives a JSON round trip', () => {
    const p = rich();
    const base = baseWith('power-grid');
    plant(p, base, 0, 'cpu-cycles', T0);
    startBuild(p, base, 'runtime-forge', T0);
    const copy = JSON.parse(JSON.stringify(base)) as BaseState;
    expect(copy).toEqual(base);
    expect(tickBuild(copy, T0 + 999_999)).toBe('runtime-forge');
  });
});
