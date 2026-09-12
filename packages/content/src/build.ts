import type { ResourceId } from './biomes.js';

/**
 * Farming and building.
 *
 * The base-building layer, and the part of the game that teaches
 * architecture rather than components.
 *
 * Every prerequisite below is architecturally true. You cannot run a
 * container before you can build an image. Kubernetes with nothing
 * containerised has nothing to schedule. A cache in front of nothing is a
 * slower way to get a null. A search index is a derived view and needs both a
 * source of truth and a way to feed it. A player who unlocks this tree in
 * order has walked up a real dependency graph, and every gate carries the
 * sentence explaining why it is a gate.
 *
 * That is the whole design: the tech tree is not flavour on top of a cost
 * curve, the tech tree IS the lesson and the costs are flavour on top of it.
 */

export type Cost = Partial<Record<ResourceId, number>>;

// ---------------------------------------------------------------- crops

export interface CropSpec {
  id: string;
  name: string;
  /** Seconds to mature. */
  growSeconds: number;
  /** What planting it costs. */
  seedCost: Cost;
  /** What harvesting it returns. */
  yield: Cost;
  /** Colour of the plant, drawn from primitives. */
  tint: number;
  description: string;
  /** The real thing this models. Shown on the plot and in the codex. */
  realWorld: string;
}

export const CROPS: CropSpec[] = [
  {
    id: 'cpu-cycles',
    name: 'CPU CYCLES',
    growSeconds: 25,
    seedCost: { scrap: 4 },
    yield: { compute: 12 },
    tint: 0xff8a3d,
    description: 'The base unit of work. Fast to grow, cheap, needed by everything.',
    realWorld:
      'Compute is the one resource you can always buy more of and the one ' +
      'that most often is not the bottleneck. Measure before you scale it.',
  },
  {
    id: 'ram-bank',
    name: 'RAM BANK',
    growSeconds: 40,
    seedCost: { scrap: 6 },
    yield: { memory: 12 },
    tint: 0x4d8cff,
    description: 'Volatile and fast. Gone the moment the power goes.',
    realWorld:
      'Memory is the fastest storage you have and the only one that forgets. ' +
      'Everything that trades durability for latency is spending this.',
  },
  {
    id: 'fibre-line',
    name: 'FIBRE LINE',
    growSeconds: 55,
    seedCost: { scrap: 8 },
    yield: { bandwidth: 10 },
    tint: 0x18cfb0,
    description: 'The network between your machines. Slow to lay, hard to widen.',
    realWorld:
      'Bandwidth is the resource people forget to count until a shuffle or a ' +
      'replication stream saturates it, and then it is the only one that matters.',
  },
  {
    id: 'disk-array',
    name: 'DISK ARRAY',
    growSeconds: 80,
    seedCost: { scrap: 10 },
    yield: { storage: 10 },
    tint: 0xa87bff,
    description: 'Durable and slow. The only thing that survives a restart.',
    realWorld:
      'Disk is where durability actually lives. An fsync is the moment a ' +
      'write stops being a promise and starts being a fact.',
  },
  {
    id: 'log-stream',
    name: 'LOG STREAM',
    growSeconds: 70,
    seedCost: { scrap: 12 },
    yield: { bandwidth: 6, storage: 6 },
    tint: 0xa855f7,
    description: 'Yields both bandwidth and storage. A log costs you each of them.',
    realWorld:
      'Retaining a log is a standing bill in two currencies: the network to ' +
      'ship the events and the disk to keep them. Retention policy is where ' +
      'you decide how much of each you are willing to pay.',
  },
];

const cropById = new Map(CROPS.map((c) => [c.id, c]));

export function getCrop(id: string): CropSpec {
  const c = cropById.get(id);
  if (!c) throw new Error(`Unknown crop: ${id}`);
  return c;
}

// ------------------------------------------------------------ buildings

export type BuildingUnlock =
  | { kind: 'plots'; amount: number }
  | { kind: 'benchSlot'; amount: number }
  | { kind: 'levelCap'; amount: number }
  | { kind: 'crop'; cropId: string }
  | { kind: 'incidentTier'; tier: number }
  | { kind: 'captureBonus'; amount: number };

export interface BuildingSpec {
  id: string;
  name: string;
  /** Building ids that must exist first. */
  requires: string[];
  cost: Cost;
  /** Seconds to construct. */
  buildSeconds: number;
  /** Tiles wide on the island. Everything is square. */
  footprint: number;
  /** Roof colour. Not a family colour - these are player structures. */
  tint: number;
  description: string;
  /**
   * Why the prerequisite is real.
   *
   * The single most important string in this file. Shown when the building
   * is still locked, so the player reads the architectural reason before
   * they have the resources to ignore it.
   */
  whyGated: string;
  unlocks: BuildingUnlock[];
}

export const BUILDINGS: BuildingSpec[] = [
  {
    id: 'power-grid',
    name: 'POWER GRID',
    requires: [],
    cost: { scrap: 30 },
    buildSeconds: 10,
    footprint: 1,
    tint: 0xffd029,
    description: 'Powers the island. Opens your first farm plots.',
    whyGated: 'Nothing runs without power. This is the only free-standing structure.',
    unlocks: [{ kind: 'plots', amount: 4 }],
  },
  {
    id: 'runtime-forge',
    name: 'RUNTIME FORGE',
    requires: ['power-grid'],
    cost: { compute: 40, memory: 20, scrap: 20 },
    buildSeconds: 30,
    footprint: 1,
    tint: 0xff9d2e,
    description: 'Somewhere your code can actually execute. Raises the level cap.',
    whyGated:
      'A runtime is the floor of every stack. Before you have one, you have ' +
      'source code and a wish.',
    unlocks: [{ kind: 'levelCap', amount: 6 }, { kind: 'plots', amount: 2 }],
  },
  {
    id: 'image-registry',
    name: 'IMAGE REGISTRY',
    requires: ['runtime-forge'],
    cost: { storage: 40, compute: 20, scrap: 25 },
    buildSeconds: 45,
    footprint: 1,
    tint: 0x14c7a8,
    description: 'Stores built images. Unlocks the Container Yard.',
    whyGated:
      'You cannot ship a container before you can build an image. The image ' +
      'is the artefact; the container is that artefact running.',
    unlocks: [{ kind: 'crop', cropId: 'log-stream' }],
  },
  {
    id: 'container-yard',
    name: 'CONTAINER YARD',
    requires: ['image-registry'],
    cost: { compute: 60, bandwidth: 30, scrap: 30 },
    buildSeconds: 60,
    footprint: 2,
    tint: 0x2496ed,
    description: 'Runs images as isolated processes. The unit of deployment.',
    whyGated:
      'A container is an image plus namespaces and cgroups. No registry means ' +
      'nothing to run, which is why this is gated behind one.',
    unlocks: [{ kind: 'benchSlot', amount: 1 }, { kind: 'plots', amount: 2 }],
  },
  {
    id: 'orchestrator',
    name: 'ORCHESTRATOR',
    requires: ['container-yard'],
    cost: { compute: 80, bandwidth: 60, memory: 40, scrap: 50 },
    buildSeconds: 120,
    footprint: 2,
    tint: 0x326ce5,
    description: 'Schedules and heals your containers. Opens tier 3 incidents.',
    whyGated:
      'An orchestrator schedules containers. With nothing containerised it ' +
      'has nothing to schedule, which is the mistake behind every cluster ' +
      'built before the workload was ready for one.',
    unlocks: [{ kind: 'incidentTier', tier: 3 }, { kind: 'benchSlot', amount: 1 }],
  },
  {
    id: 'message-broker',
    name: 'MESSAGE BROKER',
    requires: ['power-grid'],
    cost: { storage: 40, bandwidth: 40, scrap: 25 },
    buildSeconds: 50,
    footprint: 1,
    tint: 0xa855f7,
    description: 'Buffers work between producers and consumers. Opens tier 2.',
    whyGated:
      'A broker is disk plus network: somewhere to keep events and a way to ' +
      'move them. It needs no runtime of its own, which is why it branches ' +
      'off the grid rather than the forge.',
    unlocks: [{ kind: 'incidentTier', tier: 2 }, { kind: 'plots', amount: 2 }],
  },
  {
    id: 'data-vault',
    name: 'DATA VAULT',
    requires: ['power-grid'],
    cost: { storage: 70, memory: 20, scrap: 30 },
    buildSeconds: 70,
    footprint: 2,
    tint: 0x3d7ff0,
    description: 'Durable, consistent storage. Your source of truth.',
    whyGated:
      'Durability is disk. The memory is for the page cache, which is why a ' +
      'database still wants RAM even though the point of it is the disk.',
    unlocks: [{ kind: 'levelCap', amount: 6 }, { kind: 'plots', amount: 2 }],
  },
  {
    id: 'cache-farm',
    name: 'CACHE FARM',
    requires: ['data-vault'],
    cost: { memory: 80, scrap: 30 },
    buildSeconds: 40,
    footprint: 1,
    tint: 0xff5470,
    description: 'Serves hot data from memory. Pure speed, zero durability.',
    whyGated:
      'A cache is only useful in front of something slower. Build the store ' +
      'first - a cache with nothing behind it is a faster way to get a miss.',
    unlocks: [{ kind: 'captureBonus', amount: 0.1 }, { kind: 'plots', amount: 2 }],
  },
  {
    id: 'search-spire',
    name: 'SEARCH SPIRE',
    requires: ['message-broker', 'data-vault'],
    cost: { storage: 60, memory: 60, compute: 40, scrap: 45 },
    buildSeconds: 100,
    footprint: 2,
    tint: 0x00bfb3,
    description: 'Indexes everything you own. Finds it in milliseconds.',
    whyGated:
      'An index is a derived view. It needs a source of truth to derive from ' +
      'and a stream to keep it current - which is exactly why it is gated ' +
      'behind both, and why an index that disagrees with the database is the ' +
      'index being wrong.',
    unlocks: [{ kind: 'captureBonus', amount: 0.12 }, { kind: 'levelCap', amount: 8 }],
  },
  {
    id: 'analytics-rig',
    name: 'ANALYTICS RIG',
    requires: ['message-broker'],
    cost: { compute: 100, storage: 70, scrap: 50 },
    buildSeconds: 110,
    footprint: 2,
    tint: 0xffcc01,
    description: 'Answers questions over everything that has ever happened.',
    whyGated:
      'Analytics reads the stream. Without ingestion there is nothing to ' +
      'analyse, which is why every data platform is built ingestion-first ' +
      'and every one that is not gets rebuilt.',
    unlocks: [{ kind: 'plots', amount: 3 }],
  },
  {
    id: 'observability-tower',
    name: 'OBSERVABILITY TOWER',
    requires: ['orchestrator'],
    cost: { bandwidth: 80, storage: 60, compute: 40, scrap: 60 },
    buildSeconds: 140,
    footprint: 2,
    tint: 0xffb020,
    description: 'Metrics, logs, traces. Opens tier 4 incidents.',
    whyGated:
      'You cannot operate what you cannot see. This is last not because it ' +
      'is advanced but because it is what you add once the system is big ' +
      'enough that you have stopped understanding it by reading the code.',
    unlocks: [{ kind: 'incidentTier', tier: 4 }, { kind: 'captureBonus', amount: 0.15 }],
  },
];

const buildingById = new Map(BUILDINGS.map((b) => [b.id, b]));

export function getBuilding(id: string): BuildingSpec {
  const b = buildingById.get(id);
  if (!b) throw new Error(`Unknown building: ${id}`);
  return b;
}

/** Buildings whose prerequisites are all satisfied by `built`. */
export function availableBuildings(built: readonly string[]): BuildingSpec[] {
  return BUILDINGS.filter(
    (b) => !built.includes(b.id) && b.requires.every((r) => built.includes(r)),
  );
}

/** Buildings still gated, with the one prerequisite to blame. */
export function lockedBuildings(built: readonly string[]): Array<{ spec: BuildingSpec; missing: string[] }> {
  return BUILDINGS.filter((b) => !built.includes(b.id))
    .map((spec) => ({ spec, missing: spec.requires.filter((r) => !built.includes(r)) }))
    .filter((e) => e.missing.length > 0);
}

/** Total of every unlock of a kind granted by what has been built. */
export function unlockTotal(built: readonly string[], kind: BuildingUnlock['kind']): number {
  let total = 0;
  for (const id of built) {
    const spec = buildingById.get(id);
    if (!spec) continue;
    for (const u of spec.unlocks) {
      if (u.kind === kind && 'amount' in u) total += u.amount;
      if (u.kind === kind && u.kind === 'incidentTier') total = Math.max(total, u.tier);
    }
  }
  return total;
}

/** Highest incident tier unlocked. Tier 1 is always available. */
export function unlockedTier(built: readonly string[]): number {
  let tier = 1;
  for (const id of built) {
    for (const u of buildingById.get(id)?.unlocks ?? []) {
      if (u.kind === 'incidentTier') tier = Math.max(tier, u.tier);
    }
  }
  return tier;
}

/** Crop ids the player can plant. The first four need no unlock. */
export function unlockedCrops(built: readonly string[]): string[] {
  const base = ['cpu-cycles', 'ram-bank', 'fibre-line', 'disk-array'];
  for (const id of built) {
    for (const u of buildingById.get(id)?.unlocks ?? []) {
      if (u.kind === 'crop' && !base.includes(u.cropId)) base.push(u.cropId);
    }
  }
  return base;
}
