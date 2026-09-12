import type { CreatureSpec } from '../schema.js';
import type { TypeId } from '../types.js';
import { DATA_CREATURES } from './data.js';
import { STREAM_CREATURES } from './stream.js';
import { RUNTIME_CREATURES } from './runtime.js';
import { INFRA_CREATURES } from './infra.js';
import { CACHE_CREATURES } from './cache.js';
import { INTEL_CREATURES } from './intel.js';

export const ALL_CREATURES: readonly CreatureSpec[] = [
  ...DATA_CREATURES,
  ...STREAM_CREATURES,
  ...RUNTIME_CREATURES,
  ...INFRA_CREATURES,
  ...CACHE_CREATURES,
  ...INTEL_CREATURES,
];

const byId = new Map<string, CreatureSpec>(ALL_CREATURES.map((c) => [c.id, c]));

export function getCreature(id: string): CreatureSpec {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown creature: ${id}`);
  return c;
}

export function hasCreature(id: string): boolean {
  return byId.has(id);
}

export function creaturesOfType(type: TypeId): CreatureSpec[] {
  return ALL_CREATURES.filter((c) => c.type === type);
}

export function creaturesInHabitat(habitat: string): CreatureSpec[] {
  return ALL_CREATURES.filter((c) => c.habitats.includes(habitat));
}

export {
  DATA_CREATURES,
  STREAM_CREATURES,
  RUNTIME_CREATURES,
  INFRA_CREATURES,
  CACHE_CREATURES,
  INTEL_CREATURES,
};
