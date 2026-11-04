import { buildingDef, unitDef } from '@void-dominion/content';
import { inRange, nearestEnemy, powered, seesAim, aimOf } from './query.ts';
import { playerOf, rebake, type World } from './world.ts';

/** Shoot, then remove the dead and decide the match. */
export function stepCombat(world: World): void {
  const units = world.units.slice();
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    if (unit.cooldown > 0) unit.cooldown -= 1;
    const def = unitDef(unit.kind);
    if (def.damage <= 0 || def.range <= 0) continue;
    const ordered = unit.order === 'attack' ? aimOf(world, unit.targetId) : null;
    const target = ordered && seesAim(world, unit.owner, ordered) ? ordered : nearestEnemy(world, unit.owner, unit.x, unit.y, def.range);
    if (!target || target.hp <= 0) continue;
    if (!inRange(unit.x, unit.y, target, def.range)) continue;
    if (unit.cooldown > 0) continue;
    const amount = def.damage > target.armor ? def.damage - target.armor : 1;
    hurt(world, target.id, amount);
    unit.cooldown = def.cooldown;
  }
  for (const building of world.buildings.slice()) {
    if (building.hp <= 0) continue;
    const def = buildingDef(building.kind);
    if (def.damage <= 0 || def.range <= 0) continue;
    if (building.progress < def.buildTicks || !powered(world, building.owner)) continue;
    if (building.cooldown > 0) building.cooldown -= 1;
    const cx = building.x + def.width / 2;
    const cy = building.y + def.height / 2;
    const target = nearestEnemy(world, building.owner, cx, cy, def.range);
    if (!target || building.cooldown > 0) continue;
    const amount = def.damage > target.armor ? def.damage - target.armor : 1;
    hurt(world, target.id, amount);
    building.cooldown = def.cooldown;
  }
}

function hurt(world: World, id: number, amount: number): void {
  const unit = world.units.find((candidate) => candidate.id === id);
  if (unit) {
    if (unit.hp > 0) unit.hp -= amount;
    return;
  }
  const building = world.buildings.find((candidate) => candidate.id === id);
  if (building && building.hp > 0) building.hp -= amount;
}

export function resolveCasualties(world: World): void {
  world.units = world.units.filter((unit) => unit.hp > 0);
  const dead = world.buildings.filter((building) => building.hp <= 0);
  if (dead.length > 0) {
    for (const building of dead) refund(world, building);
    world.buildings = world.buildings.filter((building) => building.hp > 0);
    rebake(world);
  }
  const aliveIds = new Set<number>();
  for (const unit of world.units) aliveIds.add(unit.id);
  for (const building of world.buildings) aliveIds.add(building.id);
  for (const unit of world.units) {
    if (unit.targetId === 0) continue;
    if (unit.order !== 'attack' && unit.order !== 'build' && unit.order !== 'gather') continue;
    if (unit.order === 'gather') {
      const node = world.nodes.find((candidate) => candidate.id === unit.targetId);
      if (!node) {
        unit.order = 'idle';
        unit.targetId = 0;
      }
      continue;
    }
    if (!aliveIds.has(unit.targetId)) {
      unit.order = unit.carryOre > 0 || unit.carryAether > 0 ? 'return' : 'idle';
      unit.targetId = 0;
      unit.waypoints = [];
    }
  }
  const owners = [1, 2].filter((id) =>
    world.buildings.some((building) => building.owner === id && building.kind === 'command_center' && building.hp > 0),
  );
  if (owners.length === 1) world.winner = owners[0]!;
  else if (owners.length === 0) world.winner = -1;
}

function refund(world: World, building: World['buildings'][number]): void {
  const player = playerOf(world, building.owner);
  if (!player) return;
  const jobs = building.prod ? [building.prod, ...building.queue] : building.queue;
  for (const job of jobs) {
    player.ore += job.ore;
    player.aether += job.aether;
  }
  building.queue = [];
  building.prod = null;
}
