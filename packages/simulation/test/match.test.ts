import {
  BUILDINGS,
  ENEMY_ID,
  MAP_SIZE,
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
  type Command,
  type RejectReasonName,
} from '../src/index.ts';

function player(sim: Simulation, id = PLAYER_ID) {
  return sim.world.players.find((entry) => entry.id === id)!;
}

function engineers(sim: Simulation, owner = PLAYER_ID) {
  return sim.world.units.filter((unit) => unit.owner === owner && unit.kind === 'engineer');
}

/** Mark a cell explored for player 1, as if an engineer had walked there. */
function scout(sim: Simulation, x: number, y: number): void {
  sim.world.explored[PLAYER_ID - 1]![y * MAP_SIZE + x] = 1;
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
      at: { x: 18, y: 96 },
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
    for (const sim of [clean, refused]) scout(sim, node!.x, node!.y);
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

  it('names an attack on your own unit', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    const [first, second] = engineers(refused);
    refused.enqueue({ type: 'attack', playerId: PLAYER_ID, unitIds: [first!.id], targetId: second!.id });
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.ownTarget);
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

describe('refusals behind the fog', () => {
  function enemyAt(sim: Simulation, x: number, y: number) {
    const unit = makeUnit(sim.world, ENEMY_ID, 'rifleman', x, y);
    sim.world.units.push(unit);
    return unit;
  }

  function refusedLikeClean(setup: (sim: Simulation) => void, cmd: (sim: Simulation) => Command): RejectReasonName | null {
    const clean = Simulation.create();
    const refused = Simulation.create();
    setup(clean);
    setup(refused);
    refused.enqueue(cmd(refused));
    clean.step();
    refused.step();
    expect(refused.hashState()).toBe(clean.hashState());
    return refused.lastRejection;
  }

  it('answers a missing target and a hidden one alike', () => {
    const missing = refusedLikeClean(
      () => {},
      (sim) => ({ type: 'attack', playerId: PLAYER_ID, unitIds: [engineers(sim)[0]!.id], targetId: 9999 }),
    );
    const hidden = refusedLikeClean(
      (sim) => enemyAt(sim, 100, 30),
      (sim) => ({
        type: 'attack',
        playerId: PLAYER_ID,
        unitIds: [engineers(sim)[0]!.id],
        targetId: sim.world.units.find((unit) => unit.owner === ENEMY_ID && unit.kind === 'rifleman')!.id,
      }),
    );
    expect(missing).toBe(RejectReason.notVisible);
    expect(hidden).toBe(RejectReason.notVisible);
  });

  it('says not yours only for a foreign unit the player can see', () => {
    const sim = Simulation.create();
    const seen = enemyAt(sim, 16, 96);
    const hidden = enemyAt(sim, 100, 30);
    sim.step();
    expect(canSee(sim.world, PLAYER_ID, 16, 96)).toBe(true);
    sim.enqueue({ type: 'stop', playerId: PLAYER_ID, unitIds: [seen.id] });
    sim.step();
    expect(sim.lastRejection).toBe(RejectReason.notOwner);
    sim.enqueue({ type: 'stop', playerId: PLAYER_ID, unitIds: [hidden.id] });
    sim.step();
    expect(sim.lastRejection).toBe(RejectReason.unknownUnit);
  });

  it('does not reveal a hidden unit standing on a building site', () => {
    const site = { x: 104, y: 34 };
    const reason = refusedLikeClean(
      (sim) => {
        player(sim).ore = 500;
        enemyAt(sim, site.x + 1, site.y + 1);
      },
      (sim) => ({ type: 'build', playerId: PLAYER_ID, unitIds: [engineers(sim)[0]!.id], kind: 'barracks', at: site }),
    );
    expect(reason).toBe(RejectReason.notVisible);
  });

  it('refuses a build site the player cannot see', () => {
    const reason = refusedLikeClean(
      (sim) => {
        player(sim).ore = 500;
      },
      (sim) => ({ type: 'build', playerId: PLAYER_ID, unitIds: [engineers(sim)[0]!.id], kind: 'barracks', at: { x: 60, y: 64 } }),
    );
    expect(reason).toBe(RejectReason.notVisible);
  });

  it('answers production in a hidden enemy building like a missing building', () => {
    const reason = refusedLikeClean(
      () => {},
      (sim) => ({
        type: 'produce',
        playerId: PLAYER_ID,
        buildingId: sim.world.buildings.find((building) => building.owner === ENEMY_ID)!.id,
        kind: 'engineer',
      }),
    );
    expect(reason).toBe(RejectReason.unknownUnit);
  });

  it('refuses a gather on a node the player has not explored', () => {
    const reason = refusedLikeClean(
      () => {},
      (sim) => ({
        type: 'gather',
        playerId: PLAYER_ID,
        unitIds: [engineers(sim)[0]!.id],
        nodeId: sim.world.nodes.find((node) => node.kind === 'ore' && node.x === MATCH.bases[1]!.ore.x)!.id,
      }),
    );
    expect(reason).toBe(RejectReason.unknownUnit);
  });
});
