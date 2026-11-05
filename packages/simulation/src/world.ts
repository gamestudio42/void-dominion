import {
  BUILDINGS,
  MATCH,
  MAP_SIZE,
  UNITS,
  buildingDef,
  type BuildingKind,
  type UnitKind,
} from '@void-dominion/content';
import { Fnv1a } from '@void-dominion/kernel';
import { paintCells } from './grid.ts';

export interface Waypoint {
  x: number;
  y: number;
}

export type OrderKind = 'idle' | 'move' | 'gather' | 'return' | 'build' | 'attack' | 'attack_move';

export interface Unit {
  id: number;
  owner: number;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  waypoints: Waypoint[];
  order: OrderKind;
  targetId: number;
  goalX: number;
  goalY: number;
  carryOre: number;
  carryAether: number;
  timer: number;
  cooldown: number;
}

export interface TrainJob {
  kind: UnitKind;
  ore: number;
  aether: number;
}

export interface Building {
  id: number;
  owner: number;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  progress: number;
  queue: TrainJob[];
  prod: TrainJob | null;
  prodLeft: number;
  rallyX: number;
  rallyY: number;
  cooldown: number;
}

export interface ResourceNode {
  id: number;
  kind: 'ore' | 'aether';
  x: number;
  y: number;
  amount: number;
}

export interface PlayerState {
  id: number;
  ore: number;
  aether: number;
}

export interface MemoryBuilding {
  id: number;
  owner: number;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  progress: number;
  wreck: boolean;
}

export interface Marker {
  x: number;
  y: number;
}

export interface World {
  seed: number;
  tick: number;
  nextId: number;
  /** 0 still playing, -1 draw, otherwise the winning player id. */
  winner: number;
  players: PlayerState[];
  units: Unit[];
  buildings: Building[];
  nodes: ResourceNode[];
  rocks: { x: number; y: number; width: number; height: number }[];
  blocked: Uint8Array;
  marker: Marker | null;
  explored: [Uint8Array, Uint8Array];
  visible: [Uint8Array, Uint8Array];
  memory: [MemoryBuilding[], MemoryBuilding[]];
}

const ORDER_CODE: Record<OrderKind, number> = {
  idle: 0,
  move: 1,
  gather: 2,
  return: 3,
  build: 4,
  attack: 5,
  attack_move: 6,
};

const UNIT_CODE: Record<UnitKind, number> = {
  engineer: 1,
  rifleman: 2,
  rocketeer: 3,
  scout_rover: 4,
  assault_walker: 5,
};

const BUILDING_CODE: Record<BuildingKind, number> = {
  command_center: 1,
  ore_extractor: 2,
  aether_refinery: 3,
  power_generator: 4,
  barracks: 5,
  vehicle_factory: 6,
  defense_turret: 7,
};

export function playerOf(world: World, id: number): PlayerState | undefined {
  return world.players.find((player) => player.id === id);
}

export function rebake(world: World): void {
  world.blocked.fill(0);
  for (const rock of world.rocks) paintCells(world.blocked, rock.x, rock.y, rock.width, rock.height);
  for (const node of world.nodes) paintCells(world.blocked, node.x, node.y, 1, 1);
  for (const building of world.buildings) {
    const def = buildingDef(building.kind);
    paintCells(world.blocked, building.x, building.y, def.width, def.height);
  }
}

function makeUnit(world: World, owner: number, kind: UnitKind, x: number, y: number): Unit {
  const id = world.nextId;
  world.nextId += 1;
  return {
    id,
    owner,
    kind,
    x: x + 0.5,
    y: y + 0.5,
    hp: UNITS[kind].hp,
    waypoints: [],
    order: 'idle',
    targetId: 0,
    goalX: x,
    goalY: y,
    carryOre: 0,
    carryAether: 0,
    timer: 0,
    cooldown: 0,
  };
}

function makeBuilding(world: World, owner: number, kind: BuildingKind, x: number, y: number, done: boolean): Building {
  const def = BUILDINGS[kind];
  const id = world.nextId;
  world.nextId += 1;
  const centerX = x + Math.floor(def.width / 2);
  const centerY = y + Math.floor(def.height / 2);
  const dx = Math.sign(64 - centerX);
  const dy = Math.sign(64 - centerY);
  const rallyX = clampCell(centerX + dx * def.width);
  const rallyY = clampCell(centerY + dy * def.height);
  return {
    id,
    owner,
    kind,
    x,
    y,
    hp: def.hp,
    progress: done ? def.buildTicks : 0,
    queue: [],
    prod: null,
    prodLeft: 0,
    rallyX,
    rallyY,
    cooldown: 0,
  };
}

export function createWorld(seed: number = MATCH.seed): World {
  const explored = [new Uint8Array(MAP_SIZE * MAP_SIZE), new Uint8Array(MAP_SIZE * MAP_SIZE)] as [Uint8Array, Uint8Array];
  const visible = [new Uint8Array(MAP_SIZE * MAP_SIZE), new Uint8Array(MAP_SIZE * MAP_SIZE)] as [Uint8Array, Uint8Array];
  const world: World = {
    seed: seed >>> 0,
    tick: 0,
    nextId: 1,
    winner: 0,
    players: MATCH.bases.map((base) => ({ id: base.id, ore: MATCH.startOre, aether: MATCH.startAether })),
    units: [],
    buildings: [],
    nodes: [],
    rocks: MATCH.rocks.map((rock) => ({ ...rock })),
    blocked: new Uint8Array(MAP_SIZE * MAP_SIZE),
    marker: null,
    explored,
    visible,
    memory: [[], []],
  };
  for (const base of MATCH.bases) {
    world.buildings.push(makeBuilding(world, base.id, 'command_center', base.cc.x, base.cc.y, true));
    world.nodes.push({ id: world.nextId++, kind: 'ore', x: base.ore.x, y: base.ore.y, amount: MATCH.oreAmount });
    world.nodes.push({ id: world.nextId++, kind: 'aether', x: base.aether.x, y: base.aether.y, amount: MATCH.aetherAmount });
    for (const worker of base.workers) world.units.push(makeUnit(world, base.id, 'engineer', worker.x, worker.y));
  }
  rebake(world);
  for (const unit of world.units) {
    const node = nearestNode(world, unit.x, unit.y, 'ore');
    if (!node) continue;
    unit.order = 'gather';
    unit.targetId = node.id;
    unit.goalX = node.x;
    unit.goalY = node.y;
  }
  return world;
}

export function nearestNode(world: World, x: number, y: number, kind: 'ore' | 'aether'): ResourceNode | undefined {
  let best: ResourceNode | undefined;
  let bestDist = Infinity;
  for (const node of world.nodes) {
    if (node.kind !== kind || node.amount <= 0) continue;
    const dist = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

export function hashWorld(world: World): number {
  const hash = new Fnv1a();
  hash.u32(world.seed);
  hash.u32(world.tick);
  hash.u32(world.winner + 2);
  hash.bytes(world.blocked);
  if (world.marker) {
    hash.u32(1);
    hash.u32(world.marker.x);
    hash.u32(world.marker.y);
  } else hash.u32(0);
  for (const player of world.players) {
    hash.u32(player.id);
    hash.u32(player.ore);
    hash.u32(player.aether);
  }
  for (const node of world.nodes) {
    hash.u32(node.id);
    hash.u32(node.amount);
  }
  for (const building of world.buildings) {
    hash.u32(building.id);
    hash.u32(building.owner);
    hash.u32(BUILDING_CODE[building.kind]);
    hash.u32(building.x);
    hash.u32(building.y);
    hash.u32(building.hp);
    hash.u32(building.progress);
    hash.u32(building.prodLeft);
    hash.u32(building.queue.length);
    hash.u32(building.cooldown);
  }
  for (const unit of world.units) {
    hash.u32(unit.id);
    hash.u32(unit.owner);
    hash.u32(UNIT_CODE[unit.kind]);
    hash.u32(ORDER_CODE[unit.order]);
    hash.u32(unit.targetId);
    hash.u32(unit.hp);
    hash.u32(unit.carryOre);
    hash.u32(unit.carryAether);
    hash.u32(unit.timer);
    hash.u32(unit.cooldown);
    hash.f64Value(unit.x);
    hash.f64Value(unit.y);
    hash.u32(unit.waypoints.length);
    for (const point of unit.waypoints) {
      hash.f64Value(point.x);
      hash.f64Value(point.y);
    }
  }
  for (const memory of world.memory) {
    for (const ghost of memory) {
      hash.u32(ghost.id);
      hash.u32(ghost.hp);
      hash.u32(ghost.wreck ? 1 : 0);
    }
  }
  hash.bytes(world.explored[0]);
  hash.bytes(world.explored[1]);
  hash.bytes(world.visible[0]);
  hash.bytes(world.visible[1]);
  return hash.digest();
}

function clampCell(value: number): number {
  if (value < 0) return 0;
  if (value >= MAP_SIZE) return MAP_SIZE - 1;
  return value;
}

export function stepMovement(world: World): void {
  for (const unit of world.units) {
    let budget = UNITS[unit.kind].speed;
    while (budget > 0 && unit.waypoints.length > 0) {
      const point = unit.waypoints[0]!;
      const cellX = Math.floor(point.x);
      const cellY = Math.floor(point.y);
      if (world.blocked[cellY * MAP_SIZE + cellX]) {
        unit.waypoints.length = 0;
        break;
      }
      const dx = point.x - unit.x;
      const dy = point.y - unit.y;
      const distSq = dx * dx + dy * dy;
      if (distSq === 0) {
        unit.waypoints.shift();
        continue;
      }
      const dist = Math.sqrt(distSq);
      if (dist <= budget) {
        unit.x = point.x;
        unit.y = point.y;
        budget -= dist;
        unit.waypoints.shift();
      } else {
        const scale = budget / dist;
        unit.x += dx * scale;
        unit.y += dy * scale;
        budget = 0;
      }
    }
  }
}

export { makeBuilding, makeUnit };
