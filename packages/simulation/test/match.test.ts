import {
  BUILDINGS,
  ENEMY_ID,
  MATCH,
  PLAYER_ID,
  UNITS,
  rectContains,
} from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import {
  RejectReason,
  Simulation,
  canSee,
  deserializeReplay,
  makeBuilding,
  makeUnit,
  rebake,
  serializeReplay,
} from '../src/index.ts';

function player(sim: Simulation, id = PLAYER_ID) {
  return sim.world.players.find((entry) => entry.id === id)!;
}

function engineers(sim: Simulation, owner = PLAYER_ID) {
  return sim.world.units.filter((unit) => unit.owner === owner && unit.kind === 'engineer');
}

function run(sim: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) sim.step();
}

describe('skirmish', () => {
  it('mines ore and raises the stockpile', () => {
    const sim = Simulation.create();
    expect(player(sim).ore).toBe(MATCH.startOre);
    expect(player(sim).aether).toBe(0);
    run(sim, 80);
    expect(player(sim).ore).toBeGreaterThan(MATCH.startOre);
  });

  it('refuses a barracks the player cannot afford', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    refused.enqueue({
      type: 'build',
      playerId: PLAYER_ID,
      unitIds: [engineers(refused)[0]!.id],
      kind: 'barracks',
      at: { x: 24, y: 110 },
    });
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.noOre);
    expect(refused.hashState()).toBe(clean.hashState());
    expect(refused.world.buildings.some((building) => building.kind === 'barracks')).toBe(false);
  });

  it('refuses an aether gather until a refinery touches the node', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    const node = refused.world.nodes.find((entry) => entry.kind === 'aether' && entry.x === MATCH.bases[0]!.aether.x);
    refused.enqueue({
      type: 'gather',
      playerId: PLAYER_ID,
      unitIds: engineers(refused).map((unit) => unit.id),
      nodeId: node!.id,
    });
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.noRefinery);
    expect(refused.hashState()).toBe(clean.hashState());
  });

  it('builds when the footprint is clear and the ore is paid', () => {
    const sim = Simulation.create();
    player(sim).ore = 500;
    const at = { x: 18, y: 96 };
    sim.enqueue({
      type: 'build',
      playerId: PLAYER_ID,
      unitIds: engineers(sim).map((unit) => unit.id),
      kind: 'barracks',
      at,
    });
    sim.step();
    expect(sim.lastRejection).toBeNull();
    const barracks = sim.world.buildings.find((building) => building.kind === 'barracks');
    expect(barracks).toBeDefined();
    expect(player(sim).ore).toBe(500 - BUILDINGS.barracks.ore);
    run(sim, 80);
    expect(barracks!.progress).toBeGreaterThan(0);
  });

  it('pauses production while power demand exceeds supply', () => {
    const starved = Simulation.create();
    const fed = Simulation.create();
    for (const sim of [starved, fed]) {
      player(sim).ore = 500;
      sim.enqueue({
        type: 'produce',
        playerId: PLAYER_ID,
        buildingId: sim.world.buildings.find((building) => building.owner === PLAYER_ID)!.id,
        kind: 'engineer',
      });
    }
    for (let i = 0; i < 7; i++) {
      starved.world.buildings.push(makeBuilding(starved.world, PLAYER_ID, 'defense_turret', 30 + i * 3, 80, true));
    }
    rebake(starved.world);
    starved.step();
    fed.step();
    const paused = starved.world.buildings.find((building) => building.owner === PLAYER_ID && building.kind === 'command_center');
    const running = fed.world.buildings.find((building) => building.owner === PLAYER_ID && building.kind === 'command_center');
    expect(paused!.prodLeft).toBe(UNITS.engineer.trainTicks);
    expect(running!.prodLeft).toBe(UNITS.engineer.trainTicks - 1);
  });

  it('refunds a queue when the building is destroyed', () => {
    const lost = Simulation.create();
    const kept = Simulation.create();
    for (const sim of [lost, kept]) {
      player(sim).ore = 200;
      for (const unit of sim.world.units) {
        if (unit.owner === PLAYER_ID) unit.order = 'idle';
      }
      sim.enqueue({
        type: 'produce',
        playerId: PLAYER_ID,
        buildingId: sim.world.buildings.find((building) => building.owner === PLAYER_ID)!.id,
        kind: 'engineer',
      });
      sim.step();
    }
    const spent = player(lost).ore;
    expect(spent).toBe(player(kept).ore);
    lost.world.buildings.find((building) => building.owner === PLAYER_ID && building.kind === 'command_center')!.hp = 0;
    lost.step();
    kept.step();
    expect(player(lost).ore - player(kept).ore).toBe(UNITS.engineer.ore);
    expect(lost.world.winner).toBe(ENEMY_ID);
  });

  it('refuses production that would exceed supply', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    for (const sim of [clean, refused]) {
      for (let i = 0; i < 8; i++) sim.world.units.push(makeUnit(sim.world, PLAYER_ID, 'engineer', 30 + i, 110));
    }
    const cc = refused.world.buildings.find((building) => building.owner === PLAYER_ID)!;
    refused.world.players[0]!.ore = 500;
    clean.world.players[0]!.ore = 500;
    refused.enqueue({ type: 'produce', playerId: PLAYER_ID, buildingId: cc.id, kind: 'engineer' });
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.noSupply);
    expect(refused.hashState()).toBe(clean.hashState());
  });

  it('trades shots when two soldiers can see each other', () => {
    const sim = Simulation.create();
    sim.world.units.push(makeUnit(sim.world, PLAYER_ID, 'rifleman', 40, 60));
    sim.world.units.push(makeUnit(sim.world, ENEMY_ID, 'rifleman', 42, 60));
    sim.step();
    const rifles = sim.world.units.filter((unit) => unit.kind === 'rifleman');
    expect(rifles).toHaveLength(2);
    for (const rifle of rifles) expect(rifle.hp).toBeLessThan(UNITS.rifleman.hp);
  });

  it('hides the enemy base until it has been seen', () => {
    const sim = Simulation.create();
    const enemy = sim.world.buildings.find((building) => building.owner === ENEMY_ID && building.kind === 'command_center')!;
    expect(canSee(sim.world, PLAYER_ID, enemy.x, enemy.y)).toBe(false);
    expect(sim.world.memory[0]!.some((ghost) => ghost.owner === ENEMY_ID)).toBe(false);
    const own = sim.world.units.find((unit) => unit.owner === PLAYER_ID)!;
    expect(canSee(sim.world, PLAYER_ID, Math.floor(own.x), Math.floor(own.y))).toBe(true);
  });

  it('keeps a wreck in memory when a seen building dies out of sight', () => {
    const sim = Simulation.create();
    const enemy = sim.world.buildings.find((building) => building.owner === ENEMY_ID && building.kind === 'command_center')!;
    sim.world.units.push(makeUnit(sim.world, PLAYER_ID, 'scout_rover', enemy.x - 2, enemy.y));
    sim.step();
    expect(sim.world.memory[0]!.some((ghost) => ghost.id === enemy.id && !ghost.wreck)).toBe(true);
    const scout = sim.world.units.find((unit) => unit.kind === 'scout_rover')!;
    sim.enqueue({ type: 'move', playerId: PLAYER_ID, unitIds: [scout.id], to: { x: 20, y: 110 } });
    run(sim, 400);
    expect(canSee(sim.world, PLAYER_ID, enemy.x, enemy.y)).toBe(false);
    enemy.hp = 0;
    sim.step();
    const ghost = sim.world.memory[0]!.find((entry) => entry.id === enemy.id);
    expect(ghost?.wreck).toBe(true);
    expect(rectContains(MATCH.rocks[0]!, enemy.x, enemy.y)).toBe(false);
  });

  it('replays a human log to the same checksum', () => {
    const live = Simulation.create();
    const ids = engineers(live).slice(0, 2).map((unit) => unit.id);
    live.enqueue({ type: 'move', playerId: PLAYER_ID, unitIds: ids, to: { x: 30, y: 90 } });
    run(live, 150);
    const raw = serializeReplay(live.log, live.world.tick);
    const restored = deserializeReplay(raw);
    expect(restored).not.toBeNull();
    const replay = Simulation.replay(restored!.commands, restored!.ticks);
    expect(replay.hashState()).toBe(live.hashState());
  });
});
