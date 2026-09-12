import type { Role } from '@stackmon/content';
import { capacity, totalBuffer } from './formulas.js';
import type { BattleState, Combatant } from './state.js';

/**
 * Load flow through the pipeline.
 *
 * This is the mechanical heart of the game, and it is deliberately a
 * simulation of the real thing rather than an abstraction over it.
 *
 * Work enters at INGEST. Each stage handles what it can, buffers what it
 * cannot up to its capacity, and drops the rest. What a stage handles is
 * what it passes downstream - so a fast STORE behind a slow PROCESS is
 * idle, and the bottleneck is wherever the smallest capacity is, exactly as
 * in a real pipeline.
 *
 * Two consequences fall out of this without being coded for, and both are
 * things engineers have to learn the hard way:
 *
 *   1. Adding capacity anywhere except the bottleneck does nothing at all.
 *   2. A buffer does not add capacity. It converts a burst you would have
 *      dropped into work you do later, and only if the burst is temporary.
 *      Sustained overload drains the buffer and then drops anyway.
 */

export interface StageResult {
  role: Role;
  occupantUid: string | null;
  incoming: number;
  /** Work taken out of the buffer this turn and processed. */
  fromBuffer: number;
  handled: number;
  buffered: number;
  dropped: number;
  capacity: number;
  /** True when this stage handled less than it received - the bottleneck. */
  saturated: boolean;
}

export interface FlowResult {
  stages: StageResult[];
  /** Work that came out of the far end of the pipeline. */
  delivered: number;
  totalDropped: number;
  /** Index of the tightest stage, or -1 if nothing was saturated. */
  bottleneck: number;
}

export function runFlow(state: BattleState, incomingLoad: number): FlowResult {
  const stages: StageResult[] = [];
  let carried = incomingLoad;
  let totalDropped = 0;

  for (const slot of state.pipeline) {
    const occupant = slot.occupant;

    if (!occupant || occupant.downed || occupant.isolatedTurns > 0) {
      // An empty or isolated stage has no capacity and no buffer. Everything
      // arriving at it is lost, and nothing continues downstream - which is
      // why losing your PROCESS creature ends the fight rather than slowing it.
      stages.push({
        role: slot.role,
        occupantUid: occupant?.uid ?? null,
        incoming: carried,
        fromBuffer: 0,
        handled: 0,
        buffered: 0,
        dropped: carried,
        capacity: 0,
        saturated: carried > 0,
      });
      totalDropped += carried;
      carried = 0;
      continue;
    }

    const cap = capacity(occupant, slot.role);
    const bufCap = totalBuffer(occupant);

    // Buffered work is drained first. A queue that keeps taking new work
    // while older work waits is not a queue, it is a memory leak.
    const fromBuffer = Math.min(occupant.buffer, cap);
    const capLeft = cap - fromBuffer;

    const handledNew = Math.min(carried, capLeft);
    const overflow = carried - handledNew;

    const roomInBuffer = Math.max(0, bufCap - (occupant.buffer - fromBuffer));
    const buffered = Math.min(overflow, roomInBuffer);
    const dropped = overflow - buffered;

    occupant.buffer = occupant.buffer - fromBuffer + buffered;

    const handled = fromBuffer + handledNew;
    stages.push({
      role: slot.role,
      occupantUid: occupant.uid,
      incoming: carried,
      fromBuffer,
      handled,
      buffered,
      dropped,
      capacity: cap,
      saturated: dropped > 0 || buffered > 0,
    });

    totalDropped += dropped;
    carried = handled;
  }

  let bottleneck = -1;
  let worst = 0;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]!;
    const pressure = s.dropped + s.buffered;
    if (pressure > worst) {
      worst = pressure;
      bottleneck = i;
    }
  }

  return { stages, delivered: carried, totalDropped, bottleneck };
}

/**
 * Human-readable explanation of what the flow just did.
 *
 * Written as an explanation rather than a stat dump, because this line is
 * where the player is supposed to notice that their STORE is idle while
 * their PROCESS is on fire.
 */
export function explainFlow(result: FlowResult, pipeline: BattleState['pipeline']): string {
  if (result.bottleneck < 0) {
    return `Pipeline clear. ${Math.round(result.delivered)} ops served.`;
  }
  const stage = result.stages[result.bottleneck]!;
  const name = pipeline[result.bottleneck]?.occupant?.name ?? 'EMPTY SLOT';
  const role = stage.role.toUpperCase();

  if (stage.capacity === 0) {
    return `${role} is down. ${Math.round(stage.dropped)} ops dropped and nothing reached the rest of the pipeline.`;
  }
  if (stage.dropped > 0) {
    return (
      `${name} at ${role} is the bottleneck: ${Math.round(stage.incoming)} in, ` +
      `${Math.round(stage.capacity)} capacity, ${Math.round(stage.dropped)} dropped.`
    );
  }
  return (
    `${name} at ${role} is over capacity but buffering: ` +
    `${Math.round(stage.buffered)} ops held for later.`
  );
}

/** Buffer pressure across the pipeline, 0..1. Drives the UI warning state. */
export function bufferPressure(members: readonly Combatant[]): number {
  let used = 0;
  let cap = 0;
  for (const c of members) {
    used += c.buffer;
    cap += totalBuffer(c);
  }
  return cap === 0 ? 0 : Math.min(1, used / cap);
}
