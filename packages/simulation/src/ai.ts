import { ENEMY_ID, MATCH, PLAYER_ID, VAREK_LEVELS, buildingDef, unitDef, type VarekLevel } from '@void-dominion/content';
import type { BuildingKind } from '@void-dominion/content';
import { applyCommand } from './commands.ts';
import { complete, findOpenSite, findTouchingSite, nearestEnemy } from './query.ts';
import { nearestNode, type Building, type Unit, type World } from './world.ts';

/**
 * Conventional opponent. Personality weights only: no language model, no hidden positions.
 * The enemy start cell is public scenario data. Units still have to be seen to be shot.
 * `level` picks a plan from `VAREK_LEVELS`; `normal` is the skirmish opponent, and its
 * orders come out in the same sequence as before levels existed, so pinned checksums hold.
 */
export function stepAi(world: World, playerId: number = ENEMY_ID, level: VarekLevel = 'normal'): void {
  if (MATCH.ai.aggression <= 0) return;
  const plan = VAREK_LEVELS[level];
  const cc = world.buildings.find(
    (building) => building.owner === playerId && building.kind === 'command_center' && complete(building),
  );
  if (!cc) return;
  const def = buildingDef(cc.kind);
  const threat = nearestEnemy(world, playerId, cc.x + def.width / 2, cc.y + def.height / 2, 14);
  const army = world.units.filter((unit) => unit.owner === playerId && unitDef(unit.kind).damage > 0);
  if (threat && army.length > 0) {
    applyCommand(world, { type: 'attack', playerId, unitIds: army.map((unit) => unit.id), targetId: threat.id });
  }
  for (const unit of world.units) {
    if (unit.owner !== playerId || unit.kind !== 'engineer' || unit.order !== 'idle') continue;
    const node = nearestNode(world, unit.x, unit.y, 'ore');
    if (!node) continue;
    applyCommand(world, { type: 'gather', playerId, unitIds: [unit.id], nodeId: node.id });
  }
  const engineers = world.units.filter((unit) => unit.owner === playerId && unit.kind === 'engineer');
  if (engineers.length < plan.engineers) {
    applyCommand(world, { type: 'produce', playerId, buildingId: cc.id, kind: 'engineer' });
  }
  const oreNode = nearestNode(world, cc.x, cc.y, 'ore');
  const hasExtractor = world.buildings.some((building) => building.owner === playerId && building.kind === 'ore_extractor');
  if (!hasExtractor && oreNode) {
    const site = findTouchingSite(world, playerId, 'ore_extractor', oreNode.x, oreNode.y);
    const builder = engineers.find((unit) => unit.order === 'gather' || unit.order === 'idle' || unit.order === 'return');
    if (site && builder) {
      applyCommand(world, {
        type: 'build',
        playerId,
        unitIds: [builder.id],
        kind: 'ore_extractor',
        at: site,
      });
    }
  }
  const halls = owned(world, playerId, 'barracks');
  /** The next barracks waits until every earlier one is finished, so one engineer builds at a time. */
  if (hasExtractor && halls.length < plan.barracks && halls.every(complete)) {
    const site = findOpenSite(world, 'barracks', cc.x - 6, cc.y + halls.length * 5, playerId);
    const builder = world.units.find(
      (unit) => unit.owner === playerId && unit.kind === 'engineer' && unit.order !== 'build',
    );
    if (site && builder) {
      applyCommand(world, { type: 'build', playerId, unitIds: [builder.id], kind: 'barracks', at: site });
    }
  }
  const firstHall = halls.find(complete);
  if (firstHall) {
    const rival = MATCH.bases.find((base) => base.id !== playerId);
    const toward = rival && rival.cc.x < cc.x ? -1 : 1;
    if (plan.turret) raise(world, playerId, 'defense_turret', cc.x + toward * 7, cc.y + 1);
    if (plan.generator) raise(world, playerId, 'power_generator', cc.x - toward * 6, cc.y + 5);
  }
  const rifles = world.units.filter((unit) => unit.owner === playerId && unit.kind === 'rifleman').length;
  if (level === 'normal') {
    /** The skirmish opponent as it always played: one order a period at the first finished hall. */
    if (firstHall && rifles < plan.armyCap) {
      applyCommand(world, { type: 'produce', playerId, buildingId: firstHall.id, kind: 'rifleman' });
    }
  } else {
    /** Count queued riflemen too, so two halls do not both train past the cap. */
    let planned = rifles + halls.reduce((sum, hall) => sum + queuedRifles(hall), 0);
    for (const hall of halls) {
      if (!complete(hall) || planned >= plan.armyCap) continue;
      applyCommand(world, { type: 'produce', playerId, buildingId: hall.id, kind: 'rifleman' });
      planned += 1;
    }
  }
  /** First march waits so the opening can finish a building before the army is committed. */
  if (!threat && world.tick >= plan.marchTick && rifles >= plan.wave && MATCH.ai.aggression >= 0.5) {
    const rival = playerId === PLAYER_ID ? ENEMY_ID : PLAYER_ID;
    const enemy = MATCH.bases.find((base) => base.id === rival);
    const soldiers = world.units.filter((unit) => unit.owner === playerId && unit.kind === 'rifleman');
    if (enemy && soldiers.length > 0) {
      const site = findOpenSite(world, 'defense_turret', enemy.cc.x + 5, enemy.cc.y);
      if (site) {
        applyCommand(world, {
          type: 'attack_move',
          playerId,
          unitIds: soldiers.map((unit) => unit.id),
          to: site,
        });
      }
    }
  }
}

function owned(world: World, playerId: number, kind: BuildingKind): Building[] {
  return world.buildings.filter((building) => building.owner === playerId && building.kind === kind);
}

function queuedRifles(hall: Building): number {
  const waiting = hall.queue.filter((job) => job.kind === 'rifleman').length;
  return waiting + (hall.prod?.kind === 'rifleman' ? 1 : 0);
}

/** One building of `kind` near the origin, raised by an engineer not already building. */
function raise(world: World, playerId: number, kind: BuildingKind, x: number, y: number): void {
  if (owned(world, playerId, kind).length > 0) return;
  const site = findOpenSite(world, kind, x, y, playerId);
  const builder = world.units.find(
    (unit: Unit) => unit.owner === playerId && unit.kind === 'engineer' && unit.order !== 'build',
  );
  if (site && builder) applyCommand(world, { type: 'build', playerId, unitIds: [builder.id], kind, at: site });
}
