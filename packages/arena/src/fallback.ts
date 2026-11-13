import { SCHEMA_VERSION, type ActResponse } from '@void-dominion/agent-sdk';
import type { Simulation } from '@void-dominion/simulation';
import { buildObservation } from '@void-dominion/agent';

/**
 * Fallback agent provides a simple defensive strategy.
 * It receives only the authorized observation and submits via the Arena.
 * This is distinguishable from the agent under test.
 * Strategy: keep engineers gathering ore, defend base with available units.
 */
export class FallbackAgent {
  constructor(
    private readonly seat: number,
  ) {}

  decide(sim: Simulation, requestId: string): ActResponse {
    const obs = buildObservation(sim, this.seat, requestId);
    const actions = [];

    const ownUnits = obs.units.filter((u) => u.owner === this.seat);
    const engineers = ownUnits.filter((u) => u.kind === 'engineer');
    const soldiers = ownUnits.filter((u) => u.kind !== 'engineer');
    const oreNode = obs.nodes.find((n) => n.kind === 'ore');
    const commandCenter = obs.buildings.find((b) => b.owner === this.seat && b.kind === 'command_center' && !b.wreck);

    if (engineers.length > 0 && oreNode && obs.tick % 300 === 0) {
      actions.push({
        type: 'command',
        command: {
          type: 'gather',
          unitIds: engineers.map((u) => u.id),
          nodeId: oreNode.id,
        },
      });
    }

    if (soldiers.length > 0 && commandCenter) {
      actions.push({
        type: 'command',
        command: {
          type: 'attack_move',
          unitIds: soldiers.map((u) => u.id),
          to: { x: commandCenter.x, y: commandCenter.y },
        },
      });
    }

    if (actions.length === 0) {
      actions.push({ type: 'noop' });
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'fallback',
      type: 'agent.act',
      actions,
    };
  }
}
