import { isUnitKind, unitDef } from '@void-dominion/content';
import { RejectReason, type Command, type RejectReason as RejectReasonName, type Simulation } from '@void-dominion/simulation';
import type { Action, ActionResult, DecisionFeedback, StrategicPlan } from '@void-dominion/agent-sdk';

/** One action of the decision in flight: refused here, or waiting for the engine's answer. */
interface Sent {
  /** The number `enqueue` returned, or null when nothing was queued. */
  seq: number | null;
  reason: RejectReasonName | null;
}

/**
 * CommanderAdapter validates and translates agent actions into engine commands.
 * Unlike considerCommander, this:
 * - Works with clientView observations (no leaked information)
 * - Injects playerId from the seat (never trusts the agent)
 * - Submits via Simulation.enqueue() (goes into replay)
 * - Is used for external agents, while Varek continues to use stepAi
 *
 * It also keeps what became of each action, so the next observation can tell the
 * agent: `beginDecision`, then `applyAction` per action, `step()`, then `settle`.
 */
export class CommanderAdapter {
  private pending: { requestId: string; fallback: boolean; sent: Sent[] } | null = null;
  private last: DecisionFeedback | null = null;

  constructor(
    private readonly sim: Simulation,
    private readonly seat: number,
  ) {}

  /** Start recording the actions of one decision. A decision never settled is dropped. */
  beginDecision(requestId: string, fallback: boolean): void {
    this.pending = { requestId, fallback, sent: [] };
  }

  /**
   * Apply one action from an agent. Returns a reason when the action is refused before
   * it reaches the engine, or null when it was queued (or was a noop). The engine's own
   * verdict is read by `settle` after the next step.
   */
  applyAction(action: Action): RejectReasonName | null {
    const sent = this.translate(action);
    this.pending?.sent.push(sent);
    return sent.reason;
  }

  /** Call after the step that applied the queued commands. Reads each one's result once. */
  settle(): void {
    if (!this.pending) return;
    const results: ActionResult[] = this.pending.sent.map((sent, index) => {
      const reason = sent.seq === null ? sent.reason : (this.sim.results.get(sent.seq) ?? null);
      return reason === null ? { index, accepted: true } : { index, accepted: false, reason };
    });
    this.last = { requestId: this.pending.requestId, fallback: this.pending.fallback, results };
    this.pending = null;
  }

  /** The settled outcome of the previous decision, for the next observation. */
  lastDecision(): DecisionFeedback | null {
    return this.last;
  }

  private translate(action: Action): Sent {
    if (action.type === 'noop') return { seq: null, reason: null };
    if (action.type === 'strategic_plan') return this.applyStrategicPlan(action.plan);
    if (action.type === 'command') return this.queue({ ...action.command, playerId: this.seat } as Command);
    return { seq: null, reason: RejectReason.unknownUnit };
  }

  private queue(command: Command): Sent {
    return { seq: this.sim.enqueue(command), reason: null };
  }

  private applyStrategicPlan(plan: StrategicPlan): Sent {
    if (plan.type === 'produce') {
      if (!isUnitKind(plan.kind)) return { seq: null, reason: RejectReason.cannotProduce };
      return this.queue({ type: 'produce', playerId: this.seat, buildingId: plan.buildingId, kind: plan.kind });
    }
    if (plan.type === 'group') {
      return this.queue({ type: 'move', playerId: this.seat, unitIds: plan.unitIds, to: plan.to });
    }
    if (plan.type === 'defend') {
      const unitIds = this.getSoldiers();
      if (unitIds.length === 0) return { seq: null, reason: RejectReason.unknownUnit };
      return this.queue({ type: 'attack_move', playerId: this.seat, unitIds, to: plan.at });
    }
    return { seq: null, reason: RejectReason.unknownUnit };
  }

  private getSoldiers(): number[] {
    return this.sim.world.units
      .filter((unit) => unit.owner === this.seat && unitDef(unit.kind).damage > 0)
      .map((unit) => unit.id);
  }
}
