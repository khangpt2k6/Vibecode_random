/**
 * @stackmon/util
 *
 * The leaf of the dependency graph. Everything in here is pure, has no
 * platform dependency, and is needed by more than one package.
 *
 * It exists so that @stackmon/core can have a deterministic RNG without
 * depending on @stackmon/engine. Core is the game rules and must stay
 * runnable in Node with no DOM; engine is the renderer. Neither should have
 * to import the other to share forty lines of arithmetic.
 */
export * from './rng.js';
export * from './scalar.js';
