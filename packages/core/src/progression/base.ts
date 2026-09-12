import {
  BUILDINGS,
  availableBuildings,
  getBuilding,
  getCrop,
  unlockTotal,
  unlockedCrops,
  unlockedTier,
  type Cost,
  type ResourceId,
} from '@stackmon/content';
import type { PlayerState } from './player.js';

/**
 * The base: farm plots, construction, and what they unlock.
 *
 * Time is wall-clock and stored as absolute timestamps, so a crop planted
 * before closing the tab is ready when it reopens. That is the only sane
 * model for an idle layer - a tick-counting one either has to run while the
 * page is closed, which it cannot, or silently pauses the whole economy,
 * which players correctly read as the game being broken.
 *
 * All of it is pure functions over plain data, so the whole economy can be
 * fast-forwarded in a test by passing a different `now`.
 */

export const PLOT_BASE = 0;

export interface Plot {
  id: number;
  /** null when empty. */
  cropId: string | null;
  /** Epoch ms when it was planted. */
  plantedAt: number;
  /** Epoch ms when it becomes harvestable. */
  readyAt: number;
}

export interface Construction {
  buildingId: string;
  startedAt: number;
  doneAt: number;
}

export interface BaseState {
  plots: Plot[];
  built: string[];
  /** At most one thing under construction at a time. */
  building: Construction | null;
  /** Ids of buildings whose "why it was gated" card has been shown. */
  seenGates: string[];
}

export function newBase(): BaseState {
  return { plots: [], built: [], building: null, seenGates: [] };
}

// --------------------------------------------------------------- costs

export function canAfford(p: PlayerState, cost: Cost): boolean {
  for (const [k, v] of Object.entries(cost) as Array<[ResourceId, number]>) {
    if ((p.resources[k] ?? 0) < v) return false;
  }
  return true;
}

export function spend(p: PlayerState, cost: Cost): boolean {
  if (!canAfford(p, cost)) return false;
  for (const [k, v] of Object.entries(cost) as Array<[ResourceId, number]>) {
    p.resources[k] -= v;
  }
  return true;
}

export function gain(p: PlayerState, amount: Cost): void {
  for (const [k, v] of Object.entries(amount) as Array<[ResourceId, number]>) {
    p.resources[k] = (p.resources[k] ?? 0) + v;
  }
}

/** Missing resources for a cost, for the "you need N more storage" line. */
export function shortfall(p: PlayerState, cost: Cost): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(cost) as Array<[ResourceId, number]>) {
    const missing = v - (p.resources[k] ?? 0);
    if (missing > 0) out[k] = missing;
  }
  return out;
}

// --------------------------------------------------------------- plots

/** How many plots the player has earned. Grows as buildings go up. */
export function plotCapacity(base: BaseState): number {
  return PLOT_BASE + unlockTotal(base.built, 'plots');
}

/** Create or remove plots so the array matches capacity. */
export function syncPlots(base: BaseState): void {
  const want = plotCapacity(base);
  while (base.plots.length < want) {
    base.plots.push({ id: base.plots.length, cropId: null, plantedAt: 0, readyAt: 0 });
  }
  if (base.plots.length > want) base.plots.length = want;
}

export type PlantResult =
  | { ok: true; plot: Plot }
  | { ok: false; reason: 'no-plot' | 'occupied' | 'locked' | 'cost' };

export function plant(
  p: PlayerState, base: BaseState, plotId: number, cropId: string, now: number,
): PlantResult {
  const plot = base.plots.find((x) => x.id === plotId);
  if (!plot) return { ok: false, reason: 'no-plot' };
  if (plot.cropId) return { ok: false, reason: 'occupied' };
  if (!unlockedCrops(base.built).includes(cropId)) return { ok: false, reason: 'locked' };

  const crop = getCrop(cropId);
  if (!spend(p, crop.seedCost)) return { ok: false, reason: 'cost' };

  plot.cropId = cropId;
  plot.plantedAt = now;
  plot.readyAt = now + crop.growSeconds * 1000;
  return { ok: true, plot };
}

export const isReady = (plot: Plot, now: number): boolean =>
  plot.cropId !== null && now >= plot.readyAt;

/** 0 to 1. Drives the plant's growth animation. */
export function growth(plot: Plot, now: number): number {
  if (!plot.cropId) return 0;
  const span = plot.readyAt - plot.plantedAt;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (now - plot.plantedAt) / span));
}

export interface HarvestResult {
  ok: boolean;
  cropId?: string;
  gained?: Cost;
}

export function harvest(p: PlayerState, base: BaseState, plotId: number, now: number): HarvestResult {
  const plot = base.plots.find((x) => x.id === plotId);
  if (!plot || !plot.cropId || !isReady(plot, now)) return { ok: false };

  const crop = getCrop(plot.cropId);
  gain(p, crop.yield);
  const cropId = plot.cropId;
  plot.cropId = null;
  plot.plantedAt = 0;
  plot.readyAt = 0;
  return { ok: true, cropId, gained: crop.yield };
}

/** Harvest everything ready in one action. Returns the total gained. */
export function harvestAll(p: PlayerState, base: BaseState, now: number): { count: number; gained: Cost } {
  const gained: Cost = {};
  let count = 0;
  for (const plot of base.plots) {
    if (!isReady(plot, now)) continue;
    const r = harvest(p, base, plot.id, now);
    if (!r.ok || !r.gained) continue;
    count++;
    for (const [k, v] of Object.entries(r.gained) as Array<[ResourceId, number]>) {
      gained[k] = (gained[k] ?? 0) + v;
    }
  }
  return { count, gained };
}

// ----------------------------------------------------------- buildings

export type StartBuildResult =
  | { ok: true; construction: Construction }
  | { ok: false; reason: 'busy' | 'already-built' | 'locked' | 'cost'; missing?: Cost };

export function startBuild(
  p: PlayerState, base: BaseState, buildingId: string, now: number,
): StartBuildResult {
  if (base.building) return { ok: false, reason: 'busy' };
  if (base.built.includes(buildingId)) return { ok: false, reason: 'already-built' };

  const spec = getBuilding(buildingId);
  if (!spec.requires.every((r) => base.built.includes(r))) return { ok: false, reason: 'locked' };
  if (!canAfford(p, spec.cost)) {
    return { ok: false, reason: 'cost', missing: shortfall(p, spec.cost) };
  }

  spend(p, spec.cost);
  base.building = { buildingId, startedAt: now, doneAt: now + spec.buildSeconds * 1000 };
  return { ok: true, construction: base.building };
}

/** 0 to 1 through the current construction, or 0 if idle. */
export function buildProgress(base: BaseState, now: number): number {
  const c = base.building;
  if (!c) return 0;
  const span = c.doneAt - c.startedAt;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (now - c.startedAt) / span));
}

/**
 * Finish any construction whose timer has elapsed.
 *
 * Called every frame and on load, so a build completes while the tab is
 * closed exactly as it would with it open.
 */
export function tickBuild(base: BaseState, now: number): string | null {
  const c = base.building;
  if (!c || now < c.doneAt) return null;
  base.building = null;
  if (!base.built.includes(c.buildingId)) base.built.push(c.buildingId);
  syncPlots(base);
  return c.buildingId;
}

/** Rush the current construction for scrap. Ten scrap per remaining minute. */
export function rushCost(base: BaseState, now: number): number {
  const c = base.building;
  if (!c) return 0;
  const remainingMs = Math.max(0, c.doneAt - now);
  return Math.max(1, Math.ceil((remainingMs / 60000) * 10));
}

export function rushBuild(p: PlayerState, base: BaseState, now: number): boolean {
  const cost = rushCost(base, now);
  if (!base.building || cost === 0) return false;
  if (!spend(p, { scrap: cost })) return false;
  base.building.doneAt = now;
  return true;
}

// ------------------------------------------------------------- derived

export interface BaseSummary {
  plots: number;
  plotsUsed: number;
  plotsReady: number;
  built: number;
  buildable: number;
  tier: number;
  levelCapBonus: number;
  benchSlots: number;
  captureBonus: number;
}

export function summarise(p: PlayerState, base: BaseState, now: number): BaseSummary {
  return {
    plots: base.plots.length,
    plotsUsed: base.plots.filter((x) => x.cropId !== null).length,
    plotsReady: base.plots.filter((x) => isReady(x, now)).length,
    built: base.built.length,
    buildable: availableBuildings(base.built).filter((b) => canAfford(p, b.cost)).length,
    tier: unlockedTier(base.built),
    levelCapBonus: unlockTotal(base.built, 'levelCap'),
    benchSlots: unlockTotal(base.built, 'benchSlot'),
    captureBonus: unlockTotal(base.built, 'captureBonus'),
  };
}

/** Every building, with whether it is built, available, or still gated. */
export function buildMenu(p: PlayerState, base: BaseState): Array<{
  id: string;
  state: 'built' | 'available' | 'unaffordable' | 'locked';
  missing: Cost;
  missingRequires: string[];
}> {
  return BUILDINGS.map((spec) => {
    const built = base.built.includes(spec.id);
    const missingRequires = spec.requires.filter((r) => !base.built.includes(r));
    const missing = shortfall(p, spec.cost);
    const state: 'built' | 'available' | 'unaffordable' | 'locked' = built
      ? 'built'
      : missingRequires.length > 0
        ? 'locked'
        : Object.keys(missing).length > 0
          ? 'unaffordable'
          : 'available';
    return { id: spec.id, state, missing, missingRequires };
  });
}
