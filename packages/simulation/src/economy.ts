import { buildingDef, unitDef, type UnitKind } from '@void-dominion/content';
import { gatherSlots } from './path.ts';
import {
  complete,
  dropoffFor,
  nearFootprint,
  nearNode,
  powered,
  refineryTouches,
} from './query.ts';
import { makeUnit, playerOf, type Building, type World } from './world.ts';

/** Gather, deliver, construct and train. Movement has already happened this tick. */
export function stepEconomy(world: World): void {
  for (const unit of world.units) {
    if (unit.order === 'gather') gather(world, unit);
    else if (unit.order === 'return') deliver(world, unit);
  }
  construct(world);
  train(world);
}

function gather(world: World, unit: World['units'][number]): void {
  if (unit.kind !== 'engineer') {
    unit.order = 'idle';
    return;
  }
  const node = world.nodes.find((candidate) => candidate.id === unit.targetId);
  if (!node || node.amount <= 0) {
    unit.order = unit.carryOre > 0 || unit.carryAether > 0 ? 'return' : 'idle';
    unit.waypoints = [];
    return;
  }
  if (node.kind === 'aether' && !refineryTouches(world, unit.owner, node.x, node.y)) {
    unit.order = unit.carryOre > 0 || unit.carryAether > 0 ? 'return' : 'idle';
    return;
  }
  if (!nearNode(unit, node.x, node.y) || unit.waypoints.length > 0) return;
  unit.timer += 1;
  const def = unitDef('engineer');
  if (unit.timer < def.gatherTicks) return;
  unit.timer = 0;
  const room = def.carry - unit.carryOre - unit.carryAether;
  const take = room < node.amount ? room : node.amount;
  if (take > 0) {
    node.amount -= take;
    if (node.kind === 'ore') unit.carryOre += take;
    else unit.carryAether += take;
  }
  if (unit.carryOre + unit.carryAether >= def.carry || node.amount <= 0) {
    unit.order = 'return';
    unit.waypoints = [];
  }
}

function deliver(world: World, unit: World['units'][number]): void {
  const drop = dropoffFor(world, unit);
  if (!drop) return;
  const def = buildingDef(drop.kind);
  if (!nearFootprint(unit, drop.x, drop.y, def.width, def.height) || unit.waypoints.length > 0) return;
  const player = playerOf(world, unit.owner);
  if (!player) return;
  player.ore += unit.carryOre;
  player.aether += unit.carryAether;
  unit.carryOre = 0;
  unit.carryAether = 0;
  unit.timer = 0;
  unit.waypoints = [];
  const node = world.nodes.find((candidate) => candidate.id === unit.targetId);
  unit.order = node && node.amount > 0 && unit.kind === 'engineer' ? 'gather' : 'idle';
}

function construct(world: World): void {
  for (const building of world.buildings) {
    const def = buildingDef(building.kind);
    if (building.progress >= def.buildTicks) continue;
    let workers = 0;
    for (const unit of world.units) {
      if (unit.order !== 'build' || unit.targetId !== building.id) continue;
      if (!nearFootprint(unit, building.x, building.y, def.width, def.height) || unit.waypoints.length > 0) continue;
      workers += 1;
    }
    if (workers === 0) continue;
    building.progress += workers;
    if (building.progress > def.buildTicks) building.progress = def.buildTicks;
  }
}

function train(world: World): void {
  for (const building of world.buildings) {
    if (!complete(building)) continue;
    if (!building.prod && building.queue.length > 0) {
      const job = building.queue.shift();
      if (!job) continue;
      building.prod = job;
      building.prodLeft = unitDef(job.kind).trainTicks;
    }
    if (!building.prod || !powered(world, building.owner)) continue;
    building.prodLeft -= 1;
    if (building.prodLeft > 0) continue;
    spawn(world, building, building.prod.kind);
    building.prod = null;
    building.prodLeft = 0;
  }
}

function spawn(world: World, building: Building, kind: UnitKind): void {
  const slots = gatherSlots(world.blocked, building.rallyX, building.rallyY, 1);
  const cell = slots?.[0];
  if (!cell) {
    const player = playerOf(world, building.owner);
    const job = building.prod;
    if (player && job) {
      player.ore += job.ore;
      player.aether += job.aether;
    }
    return;
  }
  world.units.push(makeUnit(world, building.owner, kind, cell.x, cell.y));
}
