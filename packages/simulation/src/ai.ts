import { ENEMY_ID, MATCH, PLAYER_ID, buildingDef, unitDef } from '@void-dominion/content';
import { applyCommand } from './commands.ts';
import { complete, findOpenSite, findTouchingSite, nearestEnemy } from './query.ts';
import { nearestNode, type World } from './world.ts';

/**
 * Conventional opponent. Personality weights only: no language model, no hidden positions.
 * The enemy start cell is public scenario data. Units still have to be seen to be shot.
 */
export function stepAi(world: World, playerId: number = ENEMY_ID): void {
  if (MATCH.ai.aggression <= 0) return;
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
  if (engineers.length < 5) {
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
  const hasBarracks = world.buildings.some((building) => building.owner === playerId && building.kind === 'barracks');
  if (hasExtractor && !hasBarracks) {
    const site = findOpenSite(world, 'barracks', cc.x - 6, cc.y, playerId);
    const builder = world.units.find(
      (unit) => unit.owner === playerId && unit.kind === 'engineer' && unit.order !== 'build',
    );
    if (site && builder) {
      applyCommand(world, { type: 'build', playerId, unitIds: [builder.id], kind: 'barracks', at: site });
    }
  }
  const rifles = world.units.filter((unit) => unit.owner === playerId && unit.kind === 'rifleman').length;
  const barracks = world.buildings.find(
    (building) => building.owner === playerId && building.kind === 'barracks' && complete(building),
  );
  if (barracks && rifles < MATCH.ai.army) {
    applyCommand(world, { type: 'produce', playerId, buildingId: barracks.id, kind: 'rifleman' });
  }
  /** First march waits so the opening can finish a building before the army is committed. */
  if (!threat && world.tick >= MATCH.ai.marchTick && rifles >= MATCH.ai.army && MATCH.ai.aggression >= 0.5) {
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
