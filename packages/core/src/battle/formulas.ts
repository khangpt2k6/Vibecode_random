import { effectiveness, type Role, type StatKey, type TypeId } from '@stackmon/content';
import type { Rng } from '@stackmon/util';
import { effectiveStat, type Combatant } from './state.js';

/**
 * The numbers.
 *
 * Every formula lives here rather than being scattered through the turn
 * resolver, because balance work means changing these and only these, and
 * because a test that pins down "a level 20 Postgres in STORE survives
 * Thundering Karma for six turns" needs one place to read the reasoning.
 */

/**
 * How well a creature does in a pipeline slot it was not built for.
 *
 * 0.55 rather than something harsher: putting Redis in STORE has to be a
 * viable, tempting, ultimately costly choice, not an instant loss. The real
 * punishment for a bad placement comes from the creature's own stats - a
 * cache in STORE has plenty of throughput and no durability, so it holds the
 * line beautifully right up until something hits it.
 */
export const OFF_ROLE_PENALTY = 0.55;

export function roleFit(c: Combatant, role: Role): number {
  return c.roles.includes(role) ? 1 : OFF_ROLE_PENALTY;
}

/** Work a creature can process in one turn, in that slot. */
export function capacity(c: Combatant, role: Role): number {
  if (c.downed || c.isolatedTurns > 0) return 0;
  return effectiveStat(c, 'throughput') * roleFit(c, role);
}

/** Total overflow a creature can hold, including temporary skill bonuses. */
export function totalBuffer(c: Combatant): number {
  if (c.downed) return 0;
  return c.bufferCap * (1 + c.bufferBonus);
}

/**
 * Damage variance.
 *
 * Plus or minus 10%. Enough that an identical turn does not produce an
 * identical number and the fight feels alive, small enough that a player can
 * still plan two turns ahead. Anything wider and the strategy stops mattering.
 */
export function variance(rng: Rng): number {
  return rng.range(0.9, 1.1);
}

export interface DamageResult {
  amount: number;
  multiplier: number;
  /** True when the type chart gave a meaningful bonus. Drives the hit VFX. */
  effective: boolean;
  resisted: boolean;
}

/**
 * Damage a skill does to the incident.
 *
 * Scales off whichever stat the skill names, so Inverted Index hitting for
 * `memory` genuinely rewards putting it on something with a big index, and
 * Sharded Write scaling off `scalability` rewards the creature that actually
 * shards. Tying each skill to the stat that drives it in reality is what
 * stops the stat block from being decoration.
 */
export function skillDamage(
  power: number,
  attacker: Combatant,
  attackerType: TypeId,
  defenderType: TypeId,
  scaling: StatKey | undefined,
  rng: Rng,
): DamageResult {
  const stat = scaling ? effectiveStat(attacker, scaling) : 100;
  // Latency scaling is inverted: a skill that scales off latency should get
  // stronger as latency falls, so it is expressed as how much faster than
  // baseline the creature is.
  const scale = scaling === 'latency' ? clampScale(120 / Math.max(1, stat)) : clampScale(stat / 100);

  const mult = effectiveness(attackerType, defenderType);
  const levelFactor = 1 + attacker.level * 0.035;

  return {
    amount: Math.max(1, Math.round(power * scale * mult * levelFactor * variance(rng))),
    multiplier: mult,
    effective: mult > 1.0,
    resisted: mult < 1.0,
  };
}

/**
 * Damage an incident move does to a creature.
 *
 * Durability is a denominator rather than a flat subtraction, so a very
 * durable creature scales gracefully instead of becoming immune at some
 * threshold, and a fragile one takes heavy but never infinite damage.
 */
export function incidentDamage(
  power: number,
  incidentType: TypeId,
  target: Combatant,
  turn: number,
  rng: Rng,
): DamageResult {
  const mult = effectiveness(incidentType, target.type);
  const durability = effectiveStat(target, 'durability');
  const mitigation = 1 + durability / 210;
  // Incidents get worse the longer they run. Six percent a turn compounds to
  // roughly double by turn twelve, which is the pressure that stops a stall
  // strategy from being correct in every fight.
  const escalation = 1 + turn * 0.06;

  return {
    amount: Math.max(1, Math.round((power * mult * escalation * variance(rng)) / mitigation)),
    multiplier: mult,
    effective: mult > 1.0,
    resisted: mult < 1.0,
  };
}

/**
 * Integrity damage from work that made it through the whole pipeline.
 *
 * This is the main damage source in a well-built pipeline, and it is the
 * mechanical statement of the game's thesis: you beat an incident by
 * successfully serving traffic through it, not by attacking it.
 */
export function throughputDamage(handledAtStore: number, storeType: TypeId | null, incidentType: TypeId): number {
  if (handledAtStore <= 0) return 0;
  const mult = storeType ? effectiveness(storeType, incidentType) : 1;
  return Math.round(handledAtStore * 0.42 * mult);
}

/**
 * Error budget burned by dropped work.
 *
 * Driven by the error RATE, not the absolute number of dropped requests,
 * because that is what an error budget actually measures. Dropping four
 * hundred requests out of five hundred is an outage; dropping four hundred
 * out of forty thousand is a rounding error, and a formula that treats those
 * the same makes every large incident mathematically unwinnable no matter
 * what you build.
 *
 * The exponent is above 1 so the burn is forgiving of a small error rate and
 * punishing of a large one - a 5% error rate costs half a percent a turn and
 * you can fight through it for a long time; a 100% error rate ends the fight
 * in four.
 */
export function budgetBurn(dropped: number, totalIncoming: number): number {
  if (dropped <= 0 || totalIncoming <= 0) return 0;
  const errorRate = Math.min(1, dropped / totalIncoming);
  return Math.round(Math.pow(errorRate, 1.3) * 22 * 10) / 10;
}

/** Memory regenerated per turn, so skills stay usable without being free. */
export function memoryRegen(c: Combatant): number {
  return Math.round(c.maxMem * 0.18 + 4);
}

/**
 * Turn order. Lower goes first.
 *
 * Priority dominates latency entirely, which is what makes Reverse Proxy and
 * O(1) Lookup feel like what they are - things that happen before you have
 * finished asking.
 */
export function actionOrder(c: Combatant, priority: number): number {
  return -priority * 10000 + effectiveStat(c, 'latency');
}

/** Keep stat scaling from producing absurd numbers at the extremes. */
function clampScale(v: number): number {
  return Math.min(2.4, Math.max(0.3, v));
}
