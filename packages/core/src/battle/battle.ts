import {
  effectivenessLabel,
  getCreature,
  getIncident,
  getSkill,
  type Effect,
  type IncidentMove,
  type IncidentSpec,
  type Skill,
  type SkillTarget,
} from '@stackmon/content';
import { Rng } from '@stackmon/util';
import {
  budgetBurn,
  actionOrder,
  incidentDamage,
  memoryRegen,
  skillDamage,
  throughputDamage,
  totalBuffer,
} from './formulas.js';
import { explainFlow, runFlow } from './flow.js';
import {
  allMembers,
  createBattle,
  effectiveStat,
  incidentLoad,
  livingMembers,
  makeCombatant,
  slotOf,
  type BattleSetup,
  type BattleState,
  type Combatant,
  type LogEntry,
} from './state.js';

/**
 * Turn resolution.
 *
 * One player action per turn, then the incident acts, then the load flows.
 * The simulator mutates the state it is given and appends to its log; the
 * renderer replays that log as animation, which keeps presentation entirely
 * out of the rules and means a battle can be fast-forwarded, replayed from
 * its seed, or run ten thousand times by the balance tool.
 */

export type PlayerAction =
  | { kind: 'skill'; actorUid: string; skillId: string }
  | { kind: 'swap'; slotIndex: number; benchIndex: number }
  | { kind: 'hold' };

export class Battle {
  readonly state: BattleState;
  private readonly rng: Rng;
  private readonly spec: IncidentSpec;

  constructor(setup: BattleSetup) {
    this.state = createBattle(setup);
    this.rng = new Rng(setup.seed);
    this.spec = getIncident(setup.incidentId);
  }

  /** Restore a simulator around an existing state, e.g. after loading a save. */
  static resume(state: BattleState, rngState: number): Battle {
    const b = Object.create(Battle.prototype) as Battle;
    const rng = new Rng(state.seed);
    rng.setState(rngState);
    Object.assign(b, {
      state,
      rng,
      spec: getIncident(state.incident.specId),
    });
    return b;
  }

  get rngState(): number {
    return this.rng.getState();
  }

  /** Skills the given creature can actually use right now. */
  availableSkills(uid: string): Skill[] {
    const c = this.find(uid);
    if (!c || c.downed) return [];
    return getCreature(c.specId)
      .skills.map(getSkill)
      .filter((s) => (c.cooldowns[s.id] ?? 0) === 0 && c.mem >= s.cost);
  }

  /** Why a skill is unavailable, for the tooltip. Null if it is available. */
  skillBlockedReason(uid: string, skillId: string): string | null {
    const c = this.find(uid);
    if (!c) return 'Not in this battle';
    if (c.downed) return 'Down';
    const skill = getSkill(skillId);
    const cd = c.cooldowns[skillId] ?? 0;
    if (cd > 0) return `Cooling down (${cd})`;
    if (c.mem < skill.cost) return `Needs ${skill.cost} memory, has ${Math.floor(c.mem)}`;
    return null;
  }

  /**
   * Advance one turn.
   *
   * Returns only the entries added by this turn, so the UI can animate the
   * delta without diffing the whole log.
   */
  step(action: PlayerAction): LogEntry[] {
    const s = this.state;
    if (s.outcome !== 'ongoing') return [];

    const before = s.log.length;

    this.checkPhase();

    const playerFirst = this.playerActsFirst(action);
    if (playerFirst) {
      this.runPlayerAction(action);
      if (s.outcome === 'ongoing') this.runIncidentTurn();
    } else {
      this.runIncidentTurn();
      if (s.outcome === 'ongoing') this.runPlayerAction(action);
    }

    if (s.outcome === 'ongoing') this.runFlowPhase();
    if (s.outcome === 'ongoing') this.endOfTurn();

    this.checkOutcome();
    s.turn++;

    return s.log.slice(before);
  }

  // ------------------------------------------------------------ ordering

  /**
   * An incident has no latency stat, so it acts at a fixed speed that most
   * creatures beat and slow ones do not. Spark, at 175 latency, genuinely
   * does act after the outage - which is the correct thing for a batch
   * engine to do in an incident.
   */
  private static readonly INCIDENT_SPEED = 80;

  private playerActsFirst(action: PlayerAction): boolean {
    if (action.kind === 'swap') return true; // swapping is a free, instant action
    if (action.kind === 'hold') return false;
    const actor = this.find(action.actorUid);
    if (!actor) return false;
    const skill = getSkill(action.skillId);
    return actionOrder(actor, skill.priority ?? 0) < Battle.INCIDENT_SPEED;
  }

  // -------------------------------------------------------- player action

  private runPlayerAction(action: PlayerAction): void {
    const s = this.state;

    if (action.kind === 'hold') {
      this.log('info', 'Holding. Buffers drain, cooldowns tick.');
      return;
    }

    if (action.kind === 'swap') {
      this.doSwap(action.slotIndex, action.benchIndex);
      return;
    }

    const actor = this.find(action.actorUid);
    if (!actor || actor.downed) {
      this.log('info', 'That component is not available.');
      return;
    }

    const skill = getSkill(action.skillId);
    const blocked = this.skillBlockedReason(actor.uid, skill.id);
    if (blocked) {
      this.log('info', `${actor.name} cannot use ${skill.name}: ${blocked}`);
      return;
    }

    actor.mem -= skill.cost;
    if (skill.cooldown > 0) actor.cooldowns[skill.id] = skill.cooldown;

    this.log('skill', `${actor.name} uses ${skill.name}.`, {
      teach: skill.realWorld,
      actorUid: actor.uid,
    });

    for (const effect of skill.effects) {
      this.applyEffect(effect, actor, skill);
    }
  }

  private doSwap(slotIndex: number, benchIndex: number): void {
    const s = this.state;
    const slot = s.pipeline[slotIndex];
    const incoming = s.bench[benchIndex];
    if (!slot || !incoming) {
      this.log('info', 'Invalid swap.');
      return;
    }
    if (incoming.downed) {
      this.log('info', `${incoming.name} is down and cannot be deployed.`);
      return;
    }

    const outgoing = slot.occupant;
    slot.occupant = incoming;
    s.bench.splice(benchIndex, 1);
    if (outgoing) {
      // Buffered work does not survive being swapped out. Draining a queue
      // before a rolling restart is a real step for a real reason.
      if (outgoing.buffer > 0) {
        s.totalDropped += outgoing.buffer;
        this.log('drop', `${Math.round(outgoing.buffer)} buffered ops lost swapping out ${outgoing.name}.`, {
          teach:
            'In-flight work held in a component is lost when that component ' +
            'goes away. This is why graceful shutdown drains the queue first.',
        });
        outgoing.buffer = 0;
      }
      s.bench.push(outgoing);
    }

    const fit = incoming.roles.includes(slot.role) ? '' : ' (off-role)';
    this.log('info', `${incoming.name} deployed to ${slot.role.toUpperCase()}${fit}.`);
  }

  // -------------------------------------------------------------- effects

  private applyEffect(effect: Effect, actor: Combatant, skill: Skill): void {
    const s = this.state;

    switch (effect.kind) {
      case 'damage': {
        const hits = effect.hits ?? 1;
        let total = 0;
        let label = '';
        for (let i = 0; i < hits; i++) {
          const r = skillDamage(
            effect.power,
            actor,
            skill.type,
            s.incident.type,
            effect.scaling,
            this.rng,
          );
          total += r.amount;
          label = effectivenessLabel(r.multiplier);
        }
        s.incident.integrity = Math.max(0, s.incident.integrity - total);
        const hitText = hits > 1 ? ` (${hits} hits)` : '';
        this.log('damage', `${total} integrity damage${hitText}. ${label}`.trim(), {
          amount: total,
          actorUid: actor.uid,
        });
        break;
      }

      case 'buffer': {
        actor.bufferBonus += effect.amount;
        this.addModifierTimer(actor, 'bufferBonus', effect.turns, effect.amount);
        this.log('info', `${actor.name} buffer capacity +${Math.round(effect.amount * 100)}%.`);
        break;
      }

      case 'repair': {
        for (const t of this.resolveTargets(effect.target, actor)) {
          const amount = Math.round(effect.amount * (1 + actor.level * 0.03));
          const healed = Math.min(amount, t.maxHp - t.hp);
          t.hp += healed;
          if (healed > 0) {
            this.log('heal', `${t.name} recovers ${healed}.`, { amount: healed, actorUid: t.uid });
          }
        }
        break;
      }

      case 'shield': {
        for (const t of this.resolveTargets(effect.target, actor)) {
          t.shield += effect.amount;
          this.addModifierTimer(t, 'shield', effect.turns, effect.amount);
        }
        this.log('info', `Shield ${effect.amount} for ${effect.turns} turns.`);
        break;
      }

      case 'cleanse': {
        let removed = 0;
        for (const t of this.resolveTargets(effect.target, actor)) {
          removed += t.modifiers.filter((m) => m.mult < 1).length + t.overTime.length;
          t.modifiers = t.modifiers.filter((m) => m.mult >= 1);
          t.overTime = [];
        }
        this.log('info', removed > 0 ? `Cleared ${removed} negative effects.` : 'Nothing to clear.');
        break;
      }

      case 'statMod': {
        if (effect.target === 'enemy') {
          s.incident.modifiers.push({
            stat: effect.stat,
            mult: effect.mult,
            turnsLeft: effect.turns,
            source: skill.id,
          });
          const dir = effect.mult < 1 ? 'reduced' : 'raised';
          this.log('info', `${s.incident.name} ${effect.stat} ${dir} to ${Math.round(effect.mult * 100)}%.`);
        } else {
          for (const t of this.resolveTargets(effect.target, actor)) {
            t.modifiers.push({
              stat: effect.stat,
              mult: effect.mult,
              turnsLeft: effect.turns,
              source: skill.id,
            });
          }
          const dir = effect.mult < 1 ? 'down' : 'up';
          this.log('info', `${effect.stat} ${dir} ${Math.round(Math.abs(effect.mult - 1) * 100)}% for ${effect.turns} turns.`);
        }
        break;
      }

      case 'drain': {
        const r = skillDamage(
          effect.power,
          actor,
          skill.type,
          s.incident.type,
          effect.scaling,
          this.rng,
        );
        s.incident.integrity = Math.max(0, s.incident.integrity - r.amount);
        const healed = Math.min(Math.round(r.amount * effect.leech), actor.maxHp - actor.hp);
        actor.hp += healed;
        this.log('damage', `${r.amount} damage, ${healed} drained back.`, {
          amount: r.amount,
          actorUid: actor.uid,
        });
        break;
      }

      case 'overTime': {
        s.incident.overTime.push({
          label: effect.label,
          power: effect.power,
          turnsLeft: effect.turns,
          source: skill.id,
        });
        this.log('info', `${s.incident.name} is ${effect.label} for ${effect.turns} turns.`);
        break;
      }

      case 'replay': {
        const downed = allMembers(s)
          .concat(s.bench)
          .filter((c) => c.downed);
        if (downed.length === 0) {
          this.log('info', 'Nothing to replay - no component is down.');
          break;
        }
        const target = downed[0]!;
        target.downed = false;
        target.hp = Math.max(1, Math.round(target.maxHp * effect.amount));
        target.buffer = 0;
        this.log('heal', `${target.name} rebuilt from the log at ${Math.round(effect.amount * 100)}%.`, {
          amount: target.hp,
          actorUid: target.uid,
          teach:
            'A retained log means state can be rebuilt from scratch by ' +
            'replaying it. This is the single strongest argument for keeping ' +
            'the log as your source of truth.',
        });
        break;
      }

      case 'budget': {
        const gained = Math.min(effect.amount, s.maxErrorBudget - s.errorBudget);
        s.errorBudget += gained;
        this.log('heal', `Error budget +${gained}%.`, { amount: gained });
        break;
      }
    }
  }

  private resolveTargets(target: SkillTarget, actor: Combatant): Combatant[] {
    const s = this.state;
    switch (target) {
      case 'self':
        return [actor];
      case 'pipeline':
        return livingMembers(s);
      case 'ally': {
        // The ally in most need, which is almost always what the player meant
        // and saves a targeting step that would add clicks and no decision.
        const others = livingMembers(s).filter((c) => c.uid !== actor.uid);
        if (others.length === 0) return [actor];
        return [others.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b))];
      }
      case 'enemy':
        return [];
    }
  }

  /**
   * Shield and buffer bonuses are not stats, so they cannot ride on the
   * normal modifier list. They get a marker modifier whose expiry is what
   * actually removes the effect.
   */
  private addModifierTimer(
    c: Combatant,
    kind: 'shield' | 'bufferBonus',
    turns: number,
    amount: number,
  ): void {
    c.modifiers.push({
      stat: 'consistency',
      mult: 1, // neutral: this entry exists only to carry the timer
      turnsLeft: turns,
      source: `__${kind}:${amount}`,
    });
  }

  // ------------------------------------------------------------- incident

  private runIncidentTurn(): void {
    const s = this.state;
    const spec = this.spec;

    const pool = this.activeMoves();
    if (pool.length === 0) return;
    const move = this.rng.pick(pool);

    this.log('incident', `${s.incident.name}: ${move.name}.`, { teach: move.description });

    switch (move.kind) {
      case 'load': {
        s.incident.surge += move.power;
        this.log('info', `Incoming load surges to ${Math.round(incidentLoad(s.incident))}.`);
        break;
      }
      case 'strike': {
        for (const t of this.incidentTargets(move)) {
          this.damageCombatant(t, move.power, move.name);
        }
        break;
      }
      case 'corrupt': {
        for (const t of this.incidentTargets(move)) {
          const stat = move.stat ?? 'consistency';
          const resist = effectiveStat(t, 'consistency') / 200;
          // High consistency shortens corruption rather than blocking it, so
          // the stat always does something and never makes a fight trivial.
          const turns = Math.max(1, Math.round((move.turns ?? 2) * (1 - resist * 0.5)));
          t.modifiers.push({ stat, mult: 0.65, turnsLeft: turns, source: move.name });
          this.log('incident', `${t.name} ${stat} corrupted for ${turns} turns.`, {
            actorUid: t.uid,
          });
        }
        break;
      }
      case 'drain': {
        for (const t of this.incidentTargets(move)) {
          // A drain that names a stat degrades that stat; one that does not
          // eats the memory pool and whatever was buffered in it.
          if (move.stat && move.stat !== 'memory') {
            t.modifiers.push({
              stat: move.stat,
              mult: 0.6,
              turnsLeft: move.turns ?? 2,
              source: move.name,
            });
            this.log('incident', `${t.name} ${move.stat} degraded.`, { actorUid: t.uid });
          } else {
            const lost = Math.min(t.mem, move.power);
            t.mem -= lost;
            t.buffer = Math.max(0, t.buffer - move.power * 0.5);
            this.log('incident', `${t.name} loses ${Math.round(lost)} memory.`, { actorUid: t.uid });
          }
        }
        break;
      }
      case 'partition': {
        for (const t of this.incidentTargets(move)) {
          // Consistency shortens a partition the same way it shortens
          // corruption: a system that refuses divergent writes rejoins sooner
          // because there is less to reconcile.
          const resist = effectiveStat(t, 'consistency') / 200;
          const turns = Math.max(1, Math.round((move.turns ?? 1) * (1 - resist * 0.55)));
          t.isolatedTurns = Math.max(t.isolatedTurns, turns);
          this.log('incident', `${t.name} is cut off from the pipeline.`, {
            actorUid: t.uid,
            teach:
              'A partitioned component is still healthy and still running. ' +
              'It simply cannot be reached, which is worse than it being down ' +
              'because nothing has failed loudly enough to notice.',
          });
        }
        break;
      }
      case 'escalate': {
        s.incident.modifiers.push({
          stat: 'throughput',
          mult: 1 + move.power / 100,
          turnsLeft: move.turns ?? 3,
          source: move.name,
        });
        this.log('incident', `${s.incident.name} intensifies.`);
        break;
      }
    }

    void spec;
  }

  private activeMoves(): IncidentMove[] {
    const s = this.state;
    const moves = [...this.spec.moves];
    const fraction = s.incident.integrity / s.incident.maxIntegrity;
    for (const phase of this.spec.phases ?? []) {
      if (fraction <= phase.belowIntegrity) moves.push(...phase.moves);
    }
    return moves;
  }

  private incidentTargets(move: IncidentMove): Combatant[] {
    const s = this.state;
    const living = livingMembers(s);
    if (living.length === 0) return [];

    switch (move.target) {
      case 'all':
        return living;
      case 'weakest':
        return [living.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b))];
      default: {
        const slot = s.pipeline.find((p) => p.role === move.target);
        const occ = slot?.occupant;
        // If the named slot is empty or already down, the hit lands somewhere
        // rather than being wasted - an incident does not politely stop.
        if (!occ || occ.downed) return [living[0]!];
        return [occ];
      }
    }
  }

  private damageCombatant(target: Combatant, power: number, source: string): void {
    const s = this.state;
    const r = incidentDamage(power, s.incident.type, target, s.turn, this.rng);

    let remaining = r.amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
      if (absorbed > 0) this.log('info', `${target.name} shield absorbs ${absorbed}.`);
    }

    target.hp = Math.max(0, target.hp - remaining);
    const label = effectivenessLabel(r.multiplier);
    this.log('damage', `${target.name} takes ${remaining} from ${source}. ${label}`.trim(), {
      amount: remaining,
      actorUid: target.uid,
    });

    if (target.hp === 0 && !target.downed) {
      target.downed = true;
      // Whatever it was holding is gone with it. This is the moment a player
      // learns what "ephemeral" meant in the stat block.
      if (target.buffer > 0) {
        s.totalDropped += target.buffer;
        this.log('drop', `${Math.round(target.buffer)} buffered ops lost with ${target.name}.`);
        target.buffer = 0;
      }
      this.log('down', `${target.name} is DOWN.`, { actorUid: target.uid });
    }
  }

  // ----------------------------------------------------------------- flow

  private runFlowPhase(): void {
    const s = this.state;
    const load = incidentLoad(s.incident);
    const result = runFlow(s, load);

    s.totalHandled += result.delivered;
    s.totalDropped += result.totalDropped;

    this.log('flow', explainFlow(result, s.pipeline));

    const storeType = s.pipeline[2]?.occupant?.type ?? null;
    const dmg = throughputDamage(result.delivered, storeType, s.incident.type);
    if (dmg > 0) {
      s.incident.integrity = Math.max(0, s.incident.integrity - dmg);
      this.log('damage', `${dmg} integrity worn down by served traffic.`, {
        amount: dmg,
        teach:
          'Serving traffic successfully is how an incident ends. You are not ' +
          'attacking it - you are outlasting it.',
      });
    }

    if (result.totalDropped > 0) {
      // The denominator is everything that arrived this turn, including work
      // drained out of buffers, so the number the player sees is a real error
      // rate rather than a count they cannot calibrate against.
      const offered = load + result.stages.reduce((sum, st) => sum + st.fromBuffer, 0);
      const burn = budgetBurn(result.totalDropped, offered);
      const rate = Math.round((result.totalDropped / Math.max(1, offered)) * 100);
      s.errorBudget = Math.max(0, Math.round((s.errorBudget - burn) * 10) / 10);
      this.log(
        'drop',
        `${Math.round(result.totalDropped)} ops dropped (${rate}% error rate). Budget -${burn}%.`,
        { amount: burn },
      );
    }
  }

  // ----------------------------------------------------------- end of turn

  private endOfTurn(): void {
    const s = this.state;

    for (const c of allMembers(s).concat(s.bench)) {
      this.tickCombatant(c);
    }

    for (const dot of s.incident.overTime) {
      const dmg = Math.round(dot.power * (0.9 + this.rng.next() * 0.2));
      s.incident.integrity = Math.max(0, s.incident.integrity - dmg);
      this.log('damage', `${s.incident.name} takes ${dmg} from ${dot.label}.`, { amount: dmg });
      dot.turnsLeft--;
    }
    s.incident.overTime = s.incident.overTime.filter((d) => d.turnsLeft > 0);

    for (const m of s.incident.modifiers) m.turnsLeft--;
    s.incident.modifiers = s.incident.modifiers.filter((m) => m.turnsLeft > 0);

    // The incident gets worse whether or not you did anything about it, but a
    // burst passes: half the surge drains each turn, so a spike is survivable
    // if you buffer through it and lethal if you try to out-process it.
    s.incident.load += this.spec.loadRamp;
    s.incident.surge = Math.round(s.incident.surge * 0.5);
  }

  private tickCombatant(c: Combatant): void {
    if (c.downed) return;

    c.mem = Math.min(c.maxMem, c.mem + memoryRegen(c));

    for (const key of Object.keys(c.cooldowns)) {
      const v = (c.cooldowns[key] ?? 0) - 1;
      if (v <= 0) delete c.cooldowns[key];
      else c.cooldowns[key] = v;
    }

    if (c.isolatedTurns > 0) c.isolatedTurns--;

    for (const dot of c.overTime) {
      c.hp = Math.max(0, c.hp - dot.power);
      dot.turnsLeft--;
    }
    c.overTime = c.overTime.filter((d) => d.turnsLeft > 0);

    for (const m of c.modifiers) m.turnsLeft--;
    const expired = c.modifiers.filter((m) => m.turnsLeft <= 0);
    for (const m of expired) {
      // Unwind the non-stat effects the marker modifiers were holding open.
      if (m.source.startsWith('__shield:')) {
        c.shield = Math.max(0, c.shield - Number(m.source.split(':')[1] ?? 0));
      } else if (m.source.startsWith('__bufferBonus:')) {
        c.bufferBonus = Math.max(0, c.bufferBonus - Number(m.source.split(':')[1] ?? 0));
        c.buffer = Math.min(c.buffer, totalBuffer(c));
      }
    }
    c.modifiers = c.modifiers.filter((m) => m.turnsLeft > 0);

    if (c.hp === 0 && !c.downed) {
      c.downed = true;
      this.log('down', `${c.name} is DOWN.`, { actorUid: c.uid });
    }
  }

  // --------------------------------------------------------------- phases

  private checkPhase(): void {
    const s = this.state;
    const phases = this.spec.phases;
    if (!phases) return;
    const fraction = s.incident.integrity / s.incident.maxIntegrity;

    for (let i = s.incident.phasesTriggered; i < phases.length; i++) {
      const phase = phases[i]!;
      if (fraction <= phase.belowIntegrity) {
        s.incident.phasesTriggered = i + 1;
        this.log('phase', `PHASE: ${phase.name}`, { teach: phase.announce });
      }
    }
  }

  private checkOutcome(): void {
    const s = this.state;
    if (s.incident.integrity <= 0) {
      s.outcome = 'victory';
      this.log('result', `${s.incident.name} resolved. ${Math.round(s.totalHandled)} ops served.`, {
        teach: this.spec.counterHint,
      });
      return;
    }
    if (s.errorBudget <= 0) {
      s.outcome = 'defeat';
      this.log('result', 'Error budget exhausted. The incident won.', {
        teach: this.spec.counterHint,
      });
      return;
    }
    if (livingMembers(s).length === 0) {
      s.outcome = 'defeat';
      this.log('result', 'Every component is down. Nothing is serving.', {
        teach: this.spec.counterHint,
      });
    }
  }

  // ---------------------------------------------------------------- utils

  private find(uid: string): Combatant | null {
    for (const slot of this.state.pipeline) {
      if (slot.occupant?.uid === uid) return slot.occupant;
    }
    return this.state.bench.find((c) => c.uid === uid) ?? null;
  }

  private log(
    kind: LogEntry['kind'],
    text: string,
    extra: { teach?: string; amount?: number; actorUid?: string } = {},
  ): void {
    this.state.log.push({ turn: this.state.turn, kind, text, ...extra });
  }
}

export { makeCombatant, slotOf };
