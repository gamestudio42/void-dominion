#!/usr/bin/env node
/**
 * Deterministic agent example for Agent Arena.
 * This agent plays strategically using only its authorized observation.
 * All decisions are deterministic based on game state.
 * Run: node --experimental-transform-types examples/deterministic.ts
 */

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
    enemyUnits: obs.units.filter((u) => u.owner !== obs.seat),
    nodes: obs.nodes,
  };
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

  if (engineers.length > 0 && oreNode && state.tick % 200 === 0) {
    const gatheringEngineers = engineers.slice(0, 2);
    actions.push({
      type: 'command',
      command: {
        type: 'gather',
        unitIds: gatheringEngineers.map((u) => u.id),
        nodeId: oreNode.id,
      },
    });
  }

  if (!barracks && state.ore >= 150 && state.tick > 100) {
    const builder = engineers[0];
    if (builder) {
      const buildX = commandCenter.x + 10;
      const buildY = commandCenter.y;
      actions.push({
        type: 'command',
        command: {
          type: 'build',
          unitIds: [builder.id],
          kind: 'barracks',
          at: { x: buildX, y: buildY },
        },
      });
    }
  }

  if (!refinery && aetherNode && state.ore >= 100 && state.tick > 200) {
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

  if (!vehicleFactory && barracks && state.ore >= 200 && state.aether >= 50 && state.tick > 400) {
    const builder = engineers[0];
    if (builder) {
      const buildX = commandCenter.x - 10;
      const buildY = commandCenter.y;
      actions.push({
        type: 'command',
        command: {
          type: 'build',
          unitIds: [builder.id],
          kind: 'vehicle_factory',
          at: { x: buildX, y: buildY },
        },
      });
    }
  }

  if (barracks && state.ore >= 50 && riflemen.length < 5 && state.tick % 100 === 50) {
    actions.push({
      type: 'command',
      command: {
        type: 'produce',
        buildingId: barracks.id,
        kind: 'rifleman',
      },
    });
  }

  if (vehicleFactory && state.ore >= 150 && state.aether >= 50 && walkers.length < 3 && state.tick % 150 === 75) {
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
  if (army.length >= 3 && state.enemyUnits.length > 0) {
    const target = state.enemyUnits[0]!;
    actions.push({
      type: 'command',
      command: {
        type: 'attack_move',
        unitIds: army.map((u) => u.id),
        to: { x: target.x, y: target.y },
      },
    });
  } else if (army.length >= 5 && state.tick > 600) {
    const attackX = state.seat === 1 ? 100 : 28;
    const attackY = state.seat === 1 ? 100 : 28;
    actions.push({
      type: 'command',
      command: {
        type: 'attack_move',
        unitIds: army.map((u) => u.id),
        to: { x: attackX, y: attackY },
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
