/**
 * @stackmon/content
 *
 * Pure data: creatures, skills, incidents, biomes, and the type chart.
 * No logic beyond lookups and derived-stat maths, no rendering, no DOM.
 *
 * Everything in here is required to be true about the technology it models.
 * Where balance and accuracy conflicted, accuracy won and balance was fixed
 * somewhere else - that constraint is the entire point of the project.
 */

export * from './types.js';
export * from './schema.js';
export * from './skills.js';
export * from './incidents.js';
export * from './biomes.js';
export * from './brands.js';
export * from './build.js';
export * from './creatures/index.js';

export const CONTENT_VERSION = 1;
