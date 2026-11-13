#!/usr/bin/env node
/**
 * Deterministic agent example for Agent Arena.
 * This agent plays strategically using only its authorized observation.
 * All decisions are deterministic based on game state.
 * Run: node --experimental-transform-types examples/deterministic.ts
 */

import { MAP_SIZE } from '../packages/content/src/index.ts';
import { createJsonlReader, createJsonlWriter, SCHEMA_VERSION, validateObserveRequest, type ObserveRequest } from '../packages/agent-sdk/src/index.ts';

const reader = createJsonlReader(process.stdin);
const writer = createJsonlWriter(process.stdout);

interface GameState {
  seat: number;
  tick: number;
  ore: number;
  aether: number;
  ownUnits: Array<{ id: number; kind: string; x: number; y: number }>;
  ownBuildings: Array<{ id: number; kind: string; x: number; y: number; wreck: boolean }>;
  enemyBuildings: Array<{ id: number; kind: string; x: number; y: number; wreck: boolean }>;
  enemyUnits: Array<{ id: number; kind: string; x: number; y: number }>;
  nodes: Array<{ id: number; kind: 'ore' | 'aether'; x: number; y: number }>;
}

function parseState(obs: ObserveRequest): GameState {
  return {
    seat: obs.seat,
    tick: obs.tick,
    ore: obs.ore,
    aether: obs.aether,
    ownUnits: obs.units.filter((u) => u.owner === obs.seat),
    ownBuildings: obs.buildings.filter((b) => b.owner === obs.seat && !b.wreck),
    enemyBuildings: obs.buildings.filter((b) => b.owner !== obs.seat),
    enemyUnits: obs.units.filter((u) => u.owner !== obs.seat),
    nodes: obs.nodes,
  };
}

/**
 * Where the army should attack-move. A remembered or visible enemy command center
 * wins. Any other enemy building in the observation is next. With nothing seen,
 * march to the opposite corner of the map from our own command center.
 */
function attackTarget(state: GameState, ownBase: { x: number; y: number }): { x: number; y: number } {
  const standing = state.enemyBuildings.filter((building) => !building.wreck);
  const command = standing.find((building) => building.kind === 'command_center') ?? state.enemyBuildings.find((building) => building.kind === 'command_center');
  const known = command ?? standing[0];
  if (known) return { x: known.x, y: known.y };
  return { x: MAP_SIZE - 1 - ownBase.x, y: MAP_SIZE - 1 - ownBase.y };
}

function decide(state: GameState) {
  const actions = [];

  const engineers = state.ownUnits.filter((u) => u.kind === 'engineer');
  const riflemen = state.ownUnits.filter((u) => u.kind === 'rifleman');
  const walkers = state.ownUnits.filter((u) => u.kind === 'assault_walker');
  const commandCenter = state.ownBuildings.find((b) => b.kind === 'command_center');
  const barracks = state.ownBuildings.find((b) => b.kind === 'barracks');
  const vehicleFactory = state.ownBuildings.find((b) => b.kind === 'vehicle_factory');
  const refinery = state.ownBuildings.find((b) => b.kind === 'aether_refinery');

  if (!commandCenter) {
    actions.push({ type: 'noop' });
    return actions;
  }

  const oreNode = state.nodes.find((n) => n.kind === 'ore');
  const aetherNode = state.nodes.find((n) => n.kind === 'aether');
  // No progress field in the observation. A barracks with no trained unit is still going up,
  // so the engineer who placed it stays on that order.
  const builderBusy = Boolean(barracks && riflemen.length === 0 && walkers.length === 0);

  const gatheringEngineers = (builderBusy ? engineers.slice(1) : engineers).slice(0, 2);
  if (gatheringEngineers.length > 0 && oreNode && state.tick % 200 === 0) {
    actions.push({
      type: 'command',
      command: {
        type: 'gather',
        unitIds: gatheringEngineers.map((u) => u.id),
        nodeId: oreNode.id,
      },
    });
  }

  const towardCenter = commandCenter.x < MAP_SIZE / 2 ? 10 : -10;

  if (!barracks && state.ore >= 150 && state.tick > 100) {
    const builder = engineers[0];
    if (builder) {
      actions.push({
        type: 'command',
        command: {
          type: 'build',
          unitIds: [builder.id],
          kind: 'barracks',
          at: { x: commandCenter.x + towardCenter, y: commandCenter.y },
        },
      });
    }
  }

  if (!builderBusy && !refinery && aetherNode && state.ore >= 100 && state.tick > 200) {
    const builder = engineers[0];
    if (builder) {
      const buildX = aetherNode.x;
      const buildY = aetherNode.y;
      actions.push({
        type: 'command',
        command: {
          type: 'build',
          unitIds: [builder.id],
          kind: 'aether_refinery',
          at: { x: buildX, y: buildY },
        },
      });
    }
  }

  if (!builderBusy && !vehicleFactory && barracks && state.ore >= 200 && state.aether >= 50 && state.tick > 400) {
    const builder = engineers[0];
    if (builder) {
      actions.push({
        type: 'command',
        command: {
          type: 'build',
          unitIds: [builder.id],
          kind: 'vehicle_factory',
          at: { x: commandCenter.x + towardCenter, y: commandCenter.y + 6 },
        },
      });
    }
  }

  if (barracks && state.ore >= 50 && riflemen.length < 5 && state.tick % 100 === 0) {
    actions.push({
      type: 'command',
      command: {
        type: 'produce',
        buildingId: barracks.id,
        kind: 'rifleman',
      },
    });
  }

  if (vehicleFactory && state.ore >= 150 && state.aether >= 50 && walkers.length < 3 && state.tick % 100 === 0) {
    actions.push({
      type: 'command',
      command: {
        type: 'produce',
        buildingId: vehicleFactory.id,
        kind: 'assault_walker',
      },
    });
  }

  const army = [...riflemen, ...walkers];
  if (army.length >= 3) {
    const target = attackTarget(state, commandCenter);
    actions.push({
      type: 'command',
      command: {
        type: 'attack_move',
        unitIds: army.map((u) => u.id),
        to: target,
      },
    });
  }

  if (actions.length === 0) {
    actions.push({ type: 'noop' });
  }

  return actions;
}

async function main() {
  while (true) {
    const message = await reader.read();
    if (message === null) break;

    const request = validateObserveRequest(message);
    if (!request) {
      console.error('Invalid request received');
      continue;
    }

    const state = parseState(request);
    const actions = decide(state);

    await writer.write({
      schemaVersion: SCHEMA_VERSION,
      requestId: request.requestId,
      type: 'agent.act',
      actions,
    });
  }
}

main().catch((err) => {
  console.error('Deterministic agent error:', err);
  process.exit(1);
});
