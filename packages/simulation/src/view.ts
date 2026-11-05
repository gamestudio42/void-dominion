import { MAP_SIZE, buildingDef, type BuildingKind, type UnitKind } from '@void-dominion/content';
import { powerGive, powerTake, supplyCap, supplyUsed } from './query.ts';
import { canSee, canSeeFootprint } from './vision.ts';
import type { MemoryBuilding, OrderKind, World } from './world.ts';

/**
 * What one seat may know, shaped for a renderer on another machine. A host sends it to
 * the guest instead of the world. Nothing hidden by that seat's fog is in it: no unit or
 * building out of sight, no other player's stock or queue, no node amount out of sight.
 */
export interface ClientView {
  seat: number;
  tick: number;
  winner: number;
  ore: number;
  aether: number;
  supplyUsed: number;
  supplyCap: number;
  powerGive: number;
  powerTake: number;
  units: ViewUnit[];
  buildings: ViewBuilding[];
  /** Foreign buildings remembered but not in sight now, as last seen, or wrecked. */
  memory: MemoryBuilding[];
  nodes: ViewNode[];
  /** Run lengths over the map, row by row, starting with a run of hidden cells. */
  visible: number[];
  /** Same encoding. Sent in a full view only; a renderer adds `visible` to it after that. */
  explored?: number[];
}

export interface ViewUnit {
  id: number;
  owner: number;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  /** For the effect watcher: a reset cooldown is a shot it saw. */
  cooldown: number;
  /** The seat's own units only. */
  order?: OrderKind;
  carryOre?: number;
  carryAether?: number;
}

export interface ViewBuilding {
  id: number;
  owner: number;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  progress: number;
  cooldown: number;
  /** The seat's own buildings only. */
  queue?: UnitKind[];
  prod?: UnitKind | null;
  prodLeft?: number;
}

export interface ViewNode {
  id: number;
  kind: 'ore' | 'aether';
  x: number;
  y: number;
  /** Only while the node's cell is in sight. */
  amount?: number;
}

/** Encode a 0/1 grid as alternating run lengths, starting with zeros. */
export function encodeRuns(grid: Uint8Array): number[] {
  const runs: number[] = [];
  let value = 0;
  let length = 0;
  for (const cell of grid) {
    const bit = cell === 0 ? 0 : 1;
    if (bit === value) {
      length += 1;
      continue;
    }
    runs.push(length);
    value = bit;
    length = 1;
  }
  runs.push(length);
  return runs;
}

/** Decode runs back into a grid of `size` cells. Returns null when the runs do not cover it exactly. */
export function decodeRuns(runs: readonly number[], size: number): Uint8Array | null {
  const grid = new Uint8Array(size);
  let at = 0;
  for (let index = 0; index < runs.length; index++) {
    const length = runs[index]!;
    if (!Number.isInteger(length) || length < 0 || at + length > size) return null;
    if (index % 2 === 1) grid.fill(1, at, at + length);
    at += length;
  }
  return at === size ? grid : null;
}

/** Build the view for one seat. `full` adds the explored grid, for a first view or a reconnect. */
export function clientView(world: World, seat: number, full = false): ClientView {
  const index = seat - 1;
  if (index !== 0 && index !== 1) throw new Error(`no seat ${seat}`);
  const player = world.players.find((entry) => entry.id === seat);
  const units: ViewUnit[] = [];
  for (const unit of world.units) {
    const own = unit.owner === seat;
    if (!own && !canSee(world, seat, Math.floor(unit.x), Math.floor(unit.y))) continue;
    const drawn: ViewUnit = { id: unit.id, owner: unit.owner, kind: unit.kind, x: unit.x, y: unit.y, hp: unit.hp, cooldown: unit.cooldown };
    if (own) {
      drawn.order = unit.order;
      drawn.carryOre = unit.carryOre;
      drawn.carryAether = unit.carryAether;
    }
    units.push(drawn);
  }
  const buildings: ViewBuilding[] = [];
  const inSight = new Set<number>();
  for (const building of world.buildings) {
    const own = building.owner === seat;
    const def = buildingDef(building.kind);
    if (!own && !canSeeFootprint(world, seat, building.x, building.y, def.width, def.height)) continue;
    inSight.add(building.id);
    const drawn: ViewBuilding = {
      id: building.id,
      owner: building.owner,
      kind: building.kind,
      x: building.x,
      y: building.y,
      hp: building.hp,
      progress: building.progress,
      cooldown: building.cooldown,
    };
    if (own) {
      drawn.queue = building.queue.map((job) => job.kind);
      drawn.prod = building.prod ? building.prod.kind : null;
      drawn.prodLeft = building.prodLeft;
    }
    buildings.push(drawn);
  }
  const memory = world.memory[index]!.filter((ghost) => ghost.owner !== seat && !inSight.has(ghost.id)).map((ghost) => ({ ...ghost }));
  const explored = world.explored[index]!;
  const nodes: ViewNode[] = [];
  for (const node of world.nodes) {
    if (explored[node.y * MAP_SIZE + node.x] !== 1) continue;
    const drawn: ViewNode = { id: node.id, kind: node.kind, x: node.x, y: node.y };
    if (canSee(world, seat, node.x, node.y)) drawn.amount = node.amount;
    nodes.push(drawn);
  }
  const view: ClientView = {
    seat,
    tick: world.tick,
    winner: world.winner,
    ore: player?.ore ?? 0,
    aether: player?.aether ?? 0,
    supplyUsed: supplyUsed(world, seat),
    supplyCap: supplyCap(world, seat),
    powerGive: powerGive(world, seat),
    powerTake: powerTake(world, seat),
    units,
    buildings,
    memory,
    nodes,
    visible: encodeRuns(world.visible[index]!),
  };
  if (full) view.explored = encodeRuns(explored);
  return view;
}
