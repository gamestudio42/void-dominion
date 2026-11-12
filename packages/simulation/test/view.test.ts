import { BUILDINGS, ENEMY_ID, MAP_SIZE, MATCH, PLAYER_ID, buildingDef } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import {
  canSee,
  canSeeFootprint,
  clientView,
  decodeRuns,
  encodeRuns,
  makeUnit,
  Simulation,
  type ClientView,
} from '../src/index.ts';

const CELLS = MAP_SIZE * MAP_SIZE;
const SEATS = [PLAYER_ID, ENEMY_ID] as const;

/** Everything a view may hold about the other seat, checked against that seat's fog. Returns what leaked. */
function leaks(sim: Simulation, view: ClientView): string[] {
  const { world } = sim;
  const seat = view.seat;
  const found: string[] = [];
  for (const unit of view.units) {
    if (unit.owner === seat) continue;
    if (!canSee(world, seat, Math.floor(unit.x), Math.floor(unit.y))) found.push(`unit ${unit.id} out of sight`);
    if (unit.order !== undefined || unit.carryOre !== undefined || unit.path !== undefined) found.push(`unit ${unit.id} orders`);
  }
  for (const building of view.buildings) {
    if (building.owner === seat) continue;
    const def = buildingDef(building.kind);
    if (!canSeeFootprint(world, seat, building.x, building.y, def.width, def.height)) found.push(`building ${building.id} out of sight`);
    if (building.queue !== undefined || building.prod !== undefined) found.push(`building ${building.id} queue`);
  }
  const remembered = new Set(world.memory[seat - 1]!.map((ghost) => ghost.id));
  for (const ghost of view.memory) {
    if (ghost.owner === seat || !remembered.has(ghost.id)) found.push(`ghost ${ghost.id}`);
  }
  for (const node of view.nodes) {
    if (world.explored[seat - 1]![node.y * MAP_SIZE + node.x] !== 1) found.push(`node ${node.id} unexplored`);
    if ((node.amount !== undefined) !== canSee(world, seat, node.x, node.y)) found.push(`node ${node.id} amount`);
  }
  const player = world.players.find((entry) => entry.id === seat)!;
  if (view.ore !== player.ore || view.aether !== player.aether) found.push('stock');
  const grid = decodeRuns(view.visible, CELLS);
  const truth = world.visible[seat - 1]!;
  if (!grid || grid.some((cell, at) => cell !== truth[at])) found.push('visible grid');
  return found.map((entry) => `tick ${world.tick} seat ${seat}: ${entry}`);
}

describe('fog runs', () => {
  it('round-trips grids, including empty and full ones', () => {
    const grids = [new Uint8Array(CELLS), new Uint8Array(CELLS).fill(1)];
    const striped = new Uint8Array(CELLS);
    for (let cell = 0; cell < CELLS; cell += 7) striped[cell] = 1;
    grids.push(striped);
    for (const grid of grids) expect(decodeRuns(encodeRuns(grid), CELLS)).toEqual(grid);
    expect(encodeRuns(new Uint8Array(CELLS).fill(1))[0]).toBe(0);
  });

  it('refuses runs that do not cover the map exactly', () => {
    expect(decodeRuns([CELLS - 1], CELLS)).toBeNull();
    expect(decodeRuns([CELLS, 1], CELLS)).toBeNull();
    expect(decodeRuns([-1, CELLS + 1], CELLS)).toBeNull();
    expect(decodeRuns([0.5, CELLS - 0.5], CELLS)).toBeNull();
  });
});

describe('client view', () => {
  it('does not change when only hidden state changes', () => {
    const plain = Simulation.create();
    const secret = Simulation.create();
    for (let tick = 0; tick < 20; tick++) {
      plain.step();
      secret.step();
    }
    const { world } = secret;
    const center = world.buildings.find((building) => building.owner === ENEMY_ID && building.kind === 'command_center')!;
    const def = BUILDINGS.command_center;
    expect(canSeeFootprint(world, PLAYER_ID, center.x, center.y, def.width, def.height)).toBe(false);
    world.players.find((entry) => entry.id === ENEMY_ID)!.ore += 500;
    center.queue.push({ kind: 'engineer', ore: 50, aether: 0 });
    const worker = world.units.find((unit) => unit.owner === ENEMY_ID)!;
    worker.hp -= 5;
    worker.x += 1;
    world.units.push(makeUnit(world, ENEMY_ID, 'rifleman', center.x - 2, center.y));
    const node = world.nodes.find((entry) => entry.x === MATCH.bases[1]!.ore.x && entry.y === MATCH.bases[1]!.ore.y)!;
    expect(canSee(world, PLAYER_ID, node.x, node.y)).toBe(false);
    node.amount -= 100;
    expect(clientView(secret.world, PLAYER_ID, true)).toEqual(clientView(plain.world, PLAYER_ID, true));
    expect(clientView(secret.world, ENEMY_ID)).not.toEqual(clientView(plain.world, ENEMY_ID));
  });

  it('sends a march only to the unit owner', () => {
    const sim = Simulation.create();
    const unit = sim.world.units.find((entry) => entry.owner === PLAYER_ID)!;
    unit.waypoints = [
      { x: unit.x + 1, y: unit.y },
      { x: unit.x + 3, y: unit.y },
    ];
    const own = clientView(sim.world, PLAYER_ID).units.find((entry) => entry.id === unit.id);
    expect(own?.path).toEqual(unit.waypoints);
    const many = Array.from({ length: 40 }, (_, index) => ({ x: index + 0.5, y: unit.y }));
    unit.waypoints = many;
    const thinned = clientView(sim.world, PLAYER_ID).units.find((entry) => entry.id === unit.id)?.path;
    expect(thinned).toHaveLength(24);
    expect(thinned?.[0]).toEqual(many[0]);
    expect(thinned?.at(-1)).toEqual(many.at(-1));
    const cell = Math.floor(unit.y) * MAP_SIZE + Math.floor(unit.x);
    sim.world.visible[ENEMY_ID - 1]![cell] = 1;
    const foreign = clientView(sim.world, ENEMY_ID).units.find((entry) => entry.id === unit.id);
    expect(foreign?.id).toBe(unit.id);
    expect(foreign?.path).toBeUndefined();
  });

  it('carries the explored grid only in a full view', () => {
    const sim = Simulation.create();
    expect(clientView(sim.world, PLAYER_ID).explored).toBeUndefined();
    expect(decodeRuns(clientView(sim.world, PLAYER_ID, true).explored!, CELLS)).toEqual(sim.world.explored[0]);
  });

  /** Views go out every second tick, so that is what this walks. */
  it('leaks nothing to either seat across a whole match, and survives JSON', () => {
    const sim = Simulation.create();
    const found: string[] = [];
    const sawEnemy = [false, false];
    let views = 0;
    while (sim.world.winner === 0 && sim.world.tick < 8000) {
      sim.step();
      if (sim.world.tick % 2 !== 0) continue;
      for (const seat of SEATS) {
        const full = sim.world.tick % 400 === 0;
        const view = clientView(sim.world, seat, full);
        views += 1;
        found.push(...leaks(sim, view));
        if (view.units.some((unit) => unit.owner !== seat)) sawEnemy[seat - 1] = true;
        if (full) expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      }
    }
    expect(found).toEqual([]);
    expect(sim.world.winner).not.toBe(0);
    expect(views).toBeGreaterThan(3000);
    /** The march brings both armies into each other's sight, so the checks above saw real fights. */
    expect(sawEnemy).toEqual([true, true]);
  }, 20_000);
});
