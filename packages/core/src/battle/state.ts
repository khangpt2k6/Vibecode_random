import {
  bufferCapacity,
  getCreature,
  getIncident,
  maxHp,
  statsAtLevel,
  type IncidentSpec,
  type Role,
  type Stats,
  type StatKey,
  type TypeId,
} from '@stackmon/content';

/**
 * Battle state.
 *
 * Deliberately a plain data structure with no methods and no references back
 * into rendering. The simulator takes a state and an action and returns a new
 * state plus a log, which means the whole combat system runs in Node, can be
 * replayed from a seed, and can be swept by the balance tool across ten
 * thousand fights without a browser anywhere in sight.
 */

export const PIPELINE_ROLES: readonly Role[] = ['ingest', 'process', 'store'];

export interface Modifier {
  stat: StatKey;
  /** Multiplier applied to the base stat. 1.5 is +50%. */
  mult: number;
  turnsLeft: number;
  /** Skill or move that applied it, for the log and for cleanse targeting. */
  source: string;
}

export interface OverTimeEffect {
  label: string;
  power: number;
  turnsLeft: number;
  source: string;
}

export interface Combatant {
  /** Unique per battle, so two Redis can be told apart. */
  uid: string;
  specId: string;
  name: string;
  type: TypeId;
  level: number;
  roles: readonly Role[];

  /** Stats before modifiers. Never mutated during a battle. */
  base: Stats;

  hp: number;
  maxHp: number;
  /** Resource spent on skills. Regenerates each turn. */
  mem: number;
  maxMem: number;
  /** Work currently held rather than dropped. */
  buffer: number;
  bufferCap: number;
  /** Temporary extra buffer from skills, as a multiple of bufferCap. */
  bufferBonus: number;
  shield: number;

  modifiers: Modifier[];
  overTime: OverTimeEffect[];
  /** skillId -> turns remaining. Absent means ready. */
  cooldowns: Record<string, number>;

  downed: boolean;
  /** Set while a partition has cut this slot out of the pipeline. */
  isolatedTurns: number;
}

export interface PipelineSlot {
  role: Role;
  occupant: Combatant | null;
}

export interface IncidentState {
  specId: string;
  name: string;
  type: TypeId;
  integrity: number;
  maxIntegrity: number;
  /** Sustained baseline load. Grows every turn by the spec ramp. */
  load: number;
  /**
   * Temporary load on top of the baseline, from burst moves.
   *
   * Separate from `load` because a burst is not a permanent capacity
   * change - it is a wave that arrives, strains the pipeline, and passes.
   * Folding it into the baseline made every spike compound into an
   * unwinnable runaway, which is not what a spike is.
   */
  surge: number;
  modifiers: Modifier[];
  overTime: OverTimeEffect[];
  /** Index into the spec phases that have already fired. */
  phasesTriggered: number;
}

export type BattleOutcome = 'ongoing' | 'victory' | 'defeat';

export interface LogEntry {
  turn: number;
  /** Drives the presentation: colour, icon, whether it shakes the screen. */
  kind:
    | 'info'
    | 'skill'
    | 'damage'
    | 'heal'
    | 'incident'
    | 'flow'
    | 'drop'
    | 'down'
    | 'phase'
    | 'result';
  text: string;
  /** Set when the entry should teach something. Shown in the codex sidebar. */
  teach?: string;
  amount?: number;
  actorUid?: string;
}

export interface BattleState {
  turn: number;
  pipeline: PipelineSlot[];
  bench: Combatant[];
  incident: IncidentState;
  /** Player health, in effect. Runs out and the fight is lost. */
  errorBudget: number;
  maxErrorBudget: number;
  /** Cumulative work successfully carried all the way through the pipeline. */
  totalHandled: number;
  totalDropped: number;
  outcome: BattleOutcome;
  log: LogEntry[];
  /** Seed the battle was created from, so it can be replayed exactly. */
  seed: string;
}

export interface PartyMember {
  specId: string;
  level: number;
  /** Optional stable id so a save file can track an individual creature. */
  uid?: string;
}

let uidCounter = 0;

export function makeCombatant(member: PartyMember): Combatant {
  const spec = getCreature(member.specId);
  const stats = statsAtLevel(spec, member.level);
  const hp = maxHp(spec, member.level);
  const cap = bufferCapacity(spec, member.level);
  return {
    uid: member.uid ?? `${member.specId}-${++uidCounter}`,
    specId: spec.id,
    name: spec.name,
    type: spec.type,
    level: member.level,
    roles: spec.roles,
    base: stats,
    hp,
    maxHp: hp,
    mem: stats.memory,
    maxMem: stats.memory,
    buffer: 0,
    bufferCap: cap,
    bufferBonus: 0,
    shield: 0,
    modifiers: [],
    overTime: [],
    cooldowns: {},
    downed: false,
    isolatedTurns: 0,
  };
}

export interface BattleSetup {
  /** Up to three, in pipeline order: ingest, process, store. */
  lineup: (PartyMember | null)[];
  bench: PartyMember[];
  incidentId: string;
  seed: string;
}

export function createBattle(setup: BattleSetup): BattleState {
  const spec: IncidentSpec = getIncident(setup.incidentId);

  const pipeline: PipelineSlot[] = PIPELINE_ROLES.map((role, i) => ({
    role,
    occupant: setup.lineup[i] ? makeCombatant(setup.lineup[i]!) : null,
  }));

  return {
    turn: 1,
    pipeline,
    bench: setup.bench.map(makeCombatant),
    incident: {
      specId: spec.id,
      name: spec.name,
      type: spec.type,
      integrity: spec.integrity,
      maxIntegrity: spec.integrity,
      load: spec.baseLoad,
      surge: 0,
      modifiers: [],
      overTime: [],
      phasesTriggered: 0,
    },
    errorBudget: spec.errorBudget,
    maxErrorBudget: spec.errorBudget,
    totalHandled: 0,
    totalDropped: 0,
    outcome: 'ongoing',
    log: [
      {
        turn: 1,
        kind: 'info',
        text: `${spec.name} detected. Error budget ${spec.errorBudget}%.`,
        teach: spec.realWorld,
      },
    ],
    seed: setup.seed,
  };
}

/** Effective stat after modifiers. Modifiers are multiplicative and stack. */
export function effectiveStat(c: Combatant, stat: StatKey): number {
  let v = c.base[stat];
  for (const m of c.modifiers) {
    if (m.stat === stat) v *= m.mult;
  }
  // Latency below 1 would break turn ordering and is not a thing anyway.
  return stat === 'latency' ? Math.max(1, v) : Math.max(0, v);
}

/** Effective throughput of the incident, after any debuffs applied to it. */
export function incidentLoad(inc: IncidentState): number {
  let v = inc.load + inc.surge;
  for (const m of inc.modifiers) {
    if (m.stat === 'throughput') v *= m.mult;
  }
  return Math.max(0, v);
}

export const livingMembers = (s: BattleState): Combatant[] =>
  s.pipeline.map((p) => p.occupant).filter((c): c is Combatant => c !== null && !c.downed);

export const allMembers = (s: BattleState): Combatant[] =>
  s.pipeline.map((p) => p.occupant).filter((c): c is Combatant => c !== null);

export function findCombatant(s: BattleState, uid: string): Combatant | null {
  for (const slot of s.pipeline) {
    if (slot.occupant?.uid === uid) return slot.occupant;
  }
  return s.bench.find((c) => c.uid === uid) ?? null;
}

export function slotOf(s: BattleState, uid: string): number {
  return s.pipeline.findIndex((p) => p.occupant?.uid === uid);
}
