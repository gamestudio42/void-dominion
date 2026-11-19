import { buildingDef } from '@void-dominion/content';
import { clientView, type Simulation } from '@void-dominion/simulation';
import type {
  DecisionFeedback,
  ObservationBuilding,
  ObservationNode,
  ObservationUnit,
  ObserveRequest,
} from '@void-dominion/agent-sdk';

/**
 * Build an observation for a seat from `clientView`, so nothing hidden by the seat's
 * fog reaches the agent: no foreign unit or building out of sight, no other player's
 * queue, orders or cargo, and no node stock out of sight. `lastDecision` tells the
 * agent what became of its previous actions.
 */
export function buildObservation(
  sim: Simulation,
  seat: number,
  requestId: string,
  lastDecision?: DecisionFeedback | null,
): ObserveRequest {
  const view = clientView(sim.world, seat, false);

  const units: ObservationUnit[] = view.units.map((unit) => {
    const drawn: ObservationUnit = {
      id: unit.id,
      owner: unit.owner,
      kind: unit.kind,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
    };
    if (unit.order !== undefined) drawn.order = unit.order;
    if (unit.carryOre !== undefined) drawn.carryOre = unit.carryOre;
    if (unit.carryAether !== undefined) drawn.carryAether = unit.carryAether;
    return drawn;
  });

  const buildings: ObservationBuilding[] = view.buildings.map((building) => {
    const ticks = buildingDef(building.kind).buildTicks;
    const drawn: ObservationBuilding = {
      id: building.id,
      owner: building.owner,
      kind: building.kind,
      x: building.x,
      y: building.y,
      hp: building.hp,
      wreck: false,
      progress: ticks > 0 ? Math.min(1, building.progress / ticks) : 1,
      complete: building.progress >= ticks,
    };
    if (building.queue !== undefined) drawn.queue = [...building.queue];
    if (building.prod !== undefined) drawn.producing = building.prod;
    if (building.prodLeft !== undefined) drawn.producingTicksLeft = building.prodLeft;
    return drawn;
  });

  for (const ghost of view.memory) {
    buildings.push({
      id: ghost.id,
      owner: ghost.owner,
      kind: ghost.kind,
      x: ghost.x,
      y: ghost.y,
      hp: ghost.hp,
      wreck: ghost.wreck,
      remembered: true,
    });
  }

  // clientView lists explored nodes and attaches the stock only while the cell is in sight.
  const nodes: ObservationNode[] = view.nodes.map((node) => {
    const drawn: ObservationNode = { id: node.id, kind: node.kind, x: node.x, y: node.y };
    if (node.amount !== undefined) drawn.amount = node.amount;
    return drawn;
  });

  const observation: ObserveRequest = {
    schemaVersion: '1.0.0',
    requestId,
    type: 'agent.observe',
    seat,
    tick: view.tick,
    ore: view.ore,
    aether: view.aether,
    supplyUsed: view.supplyUsed,
    supplyCap: view.supplyCap,
    powerGive: view.powerGive,
    powerTake: view.powerTake,
    units,
    buildings,
    nodes,
  };
  if (lastDecision) observation.lastDecision = lastDecision;
  return observation;
}
