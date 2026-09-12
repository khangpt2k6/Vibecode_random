/**
 * @stackmon/core
 *
 * The game rules. Pure TypeScript with no DOM and no renderer: every
 * simulation in here runs in Node, which is what makes the combat testable,
 * replayable from a seed, and sweepable by the balance tool.
 *
 * Nothing in this package may import @stackmon/engine.
 */
export * from './battle/index.js';

export const CORE_VERSION = 1;
