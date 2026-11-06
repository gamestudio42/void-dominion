import { buildingDef, unitDef, type UnitKind } from '@void-dominion/content';
import { createWorld, decodeRuns, rebake, type ClientView, type TrainJob, type World } from '@void-dominion/simulation';

/**
 * A guest has no simulation, only the host's views. It keeps a World shaped like the
 * host's but filled from those views, so the field reads the same fields in every mode:
 * its own units and buildings, what it sees of the other seat, what it remembers, and
 * its own fog. Nothing here decides a rule; the host's simulation does.
 */
export interface Mirror {
  world: World;
  /** Copy the newest view in. `explored` is the guest session's grid. */
  apply(view: ClientView, explored: Uint8Array | null): void;
}

export function createMirror(seed: number, seat: number): Mirror {
  const world = createWorld(seed);
  const index = seat - 1;
  /** Last amount seen per node, kept while the node is out of sight, as the fog keeps it. */
  const amounts = new Map<number, number>();
  world.units = [];
  world.buildings = [];
  world.nodes = [];
  world.memory = [[], []];
  return {
    world,
    apply(view, explored) {
      world.tick = view.tick;
      world.winner = view.winner;
      world.players = world.players.map((player) =>
        player.id === seat ? { id: seat, ore: view.ore, aether: view.aether } : { id: player.id, ore: 0, aether: 0 },
      );
      world.units = view.units.map((unit) => ({
        id: unit.id,
        owner: unit.owner,
        kind: unit.kind,
        x: unit.x,
        y: unit.y,
        hp: unit.hp,
        waypoints: [],
        order: unit.order ?? 'idle',
        targetId: 0,
        goalX: unit.x,
        goalY: unit.y,
        carryOre: unit.carryOre ?? 0,
        carryAether: unit.carryAether ?? 0,
        timer: 0,
        cooldown: unit.cooldown,
      }));
      world.buildings = view.buildings.map((building) => ({
        id: building.id,
        owner: building.owner,
        kind: building.kind,
        x: building.x,
        y: building.y,
        hp: building.hp,
        progress: building.progress,
        queue: (building.queue ?? []).map(job),
        prod: building.prod ? job(building.prod) : null,
        prodLeft: building.prodLeft ?? 0,
        rallyX: building.x + buildingDef(building.kind).width / 2,
        rallyY: building.y + buildingDef(building.kind).height,
        cooldown: building.cooldown,
      }));
      world.memory[index] = view.memory.map((ghost) => ({ ...ghost }));
      world.nodes = view.nodes.map((node) => {
        if (node.amount !== undefined) amounts.set(node.id, node.amount);
        return { id: node.id, kind: node.kind, x: node.x, y: node.y, amount: amounts.get(node.id) ?? 1 };
      });
      const visible = decodeRuns(view.visible, world.visible[index]!.length);
      if (visible) world.visible[index] = visible;
      if (explored) world.explored[index] = explored;
      rebake(world);
    },
  };
}

function job(kind: UnitKind): TrainJob {
  const def = unitDef(kind);
  return { kind, ore: def.ore, aether: def.aether };
}
