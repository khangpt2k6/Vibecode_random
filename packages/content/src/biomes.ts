import type { TypeId } from './types.js';

/**
 * Biomes.
 *
 * Each region of the world is where one family of technology actually lives,
 * and the terrain palette, ambient colour and spawn table all follow from
 * that. A player who has learned "brokers come from the Delta" has learned
 * something transferable by accident.
 */
export interface BiomeSpec {
  id: string;
  name: string;
  /** The family that dominates here. Others still appear, more rarely. */
  primaryType: TypeId;
  /** Encounter rate per hundred steps. */
  encounterRate: number;
  /** Level band of wild creatures found here. */
  levelRange: [number, number];
  description: string;
  /** Resource this region yields when harvested. */
  yields: ResourceId[];
}

export type ResourceId = 'compute' | 'memory' | 'bandwidth' | 'storage' | 'scrap';

export const RESOURCES: Record<ResourceId, { label: string; description: string }> = {
  compute: { label: 'COMPUTE', description: 'Cycles. Spent on training and on running anything.' },
  memory: { label: 'MEMORY', description: 'Working set. Spent on skills and on buffering.' },
  bandwidth: { label: 'BANDWIDTH', description: 'Throughput between structures. Gates expansion.' },
  storage: { label: 'STORAGE', description: 'Durable capacity. Gates how much you can keep.' },
  scrap: { label: 'SCRAP', description: 'Salvage from beaten incidents. The build currency.' },
};

export const BIOMES: BiomeSpec[] = [
  {
    id: 'relational-vale',
    name: 'THE RELATIONAL VALE',
    primaryType: 'data',
    encounterRate: 14,
    levelRange: [3, 12],
    description:
      'Terraced plateaus of layered rock, each stratum a table, joined by ' +
      'bridges that will not let you cross if the row on the other side does ' +
      'not exist. Slow, heavy, and still standing after everything else fell.',
    yields: ['storage', 'compute'],
  },
  {
    id: 'stream-delta',
    name: 'THE STREAM DELTA',
    primaryType: 'stream',
    encounterRate: 18,
    levelRange: [5, 16],
    description:
      'Channels of light running in one direction only, splitting into ' +
      'partitions and never merging back. Nothing here is deleted when it is ' +
      'read. The oldest channels are still legible at the bottom.',
    yields: ['bandwidth', 'storage'],
  },
  {
    id: 'runtime-foundry',
    name: 'THE RUNTIME FOUNDRY',
    primaryType: 'runtime',
    encounterRate: 16,
    levelRange: [2, 14],
    description:
      'Furnaces that run cold until the work arrives and then burn hotter the ' +
      'longer they run. Everything is being compiled, profiled, recompiled. ' +
      'The floor is littered with objects nobody references any more.',
    yields: ['compute', 'memory'],
  },
  {
    id: 'container-yards',
    name: 'THE CONTAINER YARDS',
    primaryType: 'infra',
    encounterRate: 15,
    levelRange: [6, 20],
    description:
      'Identical boxes stacked to the horizon, rearranged constantly by ' +
      'something you never see, according to a plan you declared and no ' +
      'longer remember. A box that stops answering is simply replaced.',
    yields: ['bandwidth', 'compute'],
  },
  {
    id: 'memory-flats',
    name: 'THE MEMORY FLATS',
    primaryType: 'cache',
    encounterRate: 22,
    levelRange: [1, 10],
    description:
      'Perfectly flat, perfectly fast, and it forgets. Everything here is ' +
      'within reach in a single step, and none of it survives the night. The ' +
      'creatures are the quickest in the world and the shortest-lived.',
    yields: ['memory', 'bandwidth'],
  },
  {
    id: 'index-spires',
    name: 'THE INDEX SPIRES',
    primaryType: 'intel',
    encounterRate: 12,
    levelRange: [10, 26],
    description:
      'Towers built entirely out of pointers to somewhere else. Ask a question ' +
      'at the base and the answer arrives from the top before you finish, ' +
      'having been true about a second ago.',
    yields: ['memory', 'storage'],
  },
];

const biomeById = new Map(BIOMES.map((b) => [b.id, b]));

export function getBiome(id: string): BiomeSpec {
  const b = biomeById.get(id);
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}
