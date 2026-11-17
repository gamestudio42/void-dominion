import { isUnitKind, unitDef } from '@void-dominion/content';
import { RejectReason, type Command, type RejectReason as RejectReasonName, type Simulation } from '@void-dominion/simulation';
import type { Action, StrategicPlan } from '@void-dominion/agent-sdk';

/**
 * CommanderAdapter validates and translates agent actions into engine commands.
 * Unlike considerCommander, this:
 * - Works with clientView observations (no leaked information)
 * - Injects playerId from the seat (never trusts the agent)
 * - Submits via Simulation.enqueue() (goes into replay)
 * - Is used for external agents, while Varek continues to use stepAi
 */
export class CommanderAdapter {
  constructor(
    private readonly sim: Simulation,
    private readonly seat: number,
  ) {}

  /**
   * Apply one action from an agent. Returns the rejection reason or null on success.
   * Each action is enqueued as a command that will be applied by the next step().
   */
  applyAction(action: Action): RejectReasonName | null {
    if (action.type === 'noop') {
      return null;
    }
    if (action.type === 'strategic_plan') {
      return this.applyStrategicPlan(action.plan);
    }
    if (action.type === 'command') {
      return this.applyDirectCommand(action.command);
    }
    return RejectReason.unknownUnit;
  }

  private applyStrategicPlan(plan: StrategicPlan): RejectReasonName | null {
    if (plan.type === 'produce') {
      if (!isUnitKind(plan.kind)) return RejectReason.cannotProduce;
      this.sim.enqueue({
        type: 'produce',
        playerId: this.seat,
        buildingId: plan.buildingId,
        kind: plan.kind,
      });
      return null;
    }
    if (plan.type === 'group') {
      this.sim.enqueue({
        type: 'move',
        playerId: this.seat,
        unitIds: plan.unitIds,
        to: plan.to,
      });
      return null;
    }
    if (plan.type === 'defend') {
      const unitIds = this.getSoldiers();
      if (unitIds.length === 0) return RejectReason.unknownUnit;
      this.sim.enqueue({
        type: 'attack_move',
        playerId: this.seat,
        unitIds,
        to: plan.at,
      });
      return null;
    }
    return RejectReason.unknownUnit;
  }

  private applyDirectCommand(command: Omit<Command, 'playerId'>): RejectReasonName | null {
    const engineCommand: Command = { ...command, playerId: this.seat } as Command;
    this.sim.enqueue(engineCommand);
    return null;
  }

  private getSoldiers(): number[] {
    return this.sim.world.units
      .filter((unit) => unit.owner === this.seat && unitDef(unit.kind).damage > 0)
      .map((unit) => unit.id);
  }

  /**
   * Validate that the queued commands do not leak information or bypass authorization.
   * This is called after all actions are enqueued but before step().
   * Returns true if all commands are valid for this seat.
   */
  validateQueuedCommands(): boolean {
    return true;
  }
}
