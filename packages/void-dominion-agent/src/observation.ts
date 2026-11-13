import { clientView, type Simulation } from '@void-dominion/simulation';
import type { ObservationBuilding, ObservationNode, ObservationUnit, ObserveRequest } from '@void-dominion/agent-sdk';

/**
 * Build an observation for a seat using clientView (not observe, which leaks resource amounts).
 * The Arena uses this to construct the agent.observe request.
 */
export function buildObservation(sim: Simulation, seat: number, requestId: string): ObserveRequest {
  const view = clientView(sim.world, seat, false);
  const player = sim.world.players.find((p) => p.id === seat);

  const units: ObservationUnit[] = view.units.map((unit) => ({
    id: unit.id,
    owner: unit.owner,
    kind: unit.kind,
    x: unit.x,
    y: unit.y,
    hp: unit.hp,
  }));

  const buildings: ObservationBuilding[] = view.buildings.map((building) => ({
    id: building.id,
    owner: building.owner,
    kind: building.kind,
    x: building.x,
    y: building.y,
    hp: building.hp,
    wreck: false,
  }));

  for (const ghost of view.memory) {
    buildings.push({
      id: ghost.id,
      owner: ghost.owner,
      kind: ghost.kind,
      x: ghost.x,
      y: ghost.y,
      hp: ghost.hp,
      wreck: ghost.wreck,
    });
  }

  const nodes: ObservationNode[] = view.nodes
    .filter((node) => node.amount === undefined)
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
    }));

  return {
    schemaVersion: '1.0.0',
    requestId,
    type: 'agent.observe',
    seat,
    tick: view.tick,
    ore: player?.ore ?? 0,
    aether: player?.aether ?? 0,
    units,
    buildings,
    nodes,
  };
}
