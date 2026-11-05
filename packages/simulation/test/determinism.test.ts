import { BUILDINGS, MATCH, PLAYER_ID, rectContains } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { RejectReason, Simulation, isWalkable } from '../src/index.ts';

const DESTINATION = { x: 30, y: 90 };
const TICKS = 180;

function engineers(sim: Simulation, owner = PLAYER_ID) {
  return sim.world.units.filter((unit) => unit.owner === owner && unit.kind === 'engineer').sort((a, b) => a.id - b.id);
}

function move(unitIds: number[], to: { x: number; y: number } = DESTINATION) {
  return { type: 'move' as const, playerId: PLAYER_ID, unitIds, to };
}

function runPair(issue: (sim: Simulation) => void, ticks = TICKS): [Simulation, Simulation] {
  const left = Simulation.create();
  const right = Simulation.create();
  issue(left);
  issue(right);
  for (let tick = 0; tick < ticks; tick++) {
    left.step();
    right.step();
    expect(left.hashState()).toBe(right.hashState());
    for (const unit of left.world.units) {
      expect(isWalkable(left.world.blocked, Math.floor(unit.x), Math.floor(unit.y))).toBe(true);
    }
  }
  return [left, right];
}

describe('deterministic match', () => {
  it('keeps two runs with the same orders on the same checksum', () => {
    const [left] = runPair((sim) => sim.enqueue(move(engineers(sim).slice(0, 3).map((unit) => unit.id))));
    expect(left.lastRejection).toBeNull();
    const moved = engineers(left).slice(0, 3);
    for (const unit of moved) {
      expect(unit.waypoints).toHaveLength(0);
      expect(Math.abs(unit.x - (DESTINATION.x + 0.5)) < 4 && Math.abs(unit.y - (DESTINATION.y + 0.5)) < 4).toBe(true);
    }
  });

  it('assigns the same slots regardless of selection order', () => {
    const probe = Simulation.create();
    const ids = engineers(probe).slice(0, 3).map((unit) => unit.id);
    const [ordered] = runPair((sim) => sim.enqueue(move(ids)), 120);
    const reversed = Simulation.create();
    reversed.enqueue(move([...ids].reverse()));
    for (let tick = 0; tick < 120; tick++) reversed.step();
    expect(reversed.hashState()).toBe(ordered.hashState());
  });

  it('does not change the checksum when the destination is blocked', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    const id = engineers(refused)[0]!.id;
    const rock = MATCH.rocks[0]!;
    refused.enqueue(move([id], { x: rock.x, y: rock.y }));
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.blocked);
    expect(refused.hashState()).toBe(clean.hashState());
  });

  it('does not change the checksum for an unknown unit', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    refused.enqueue(move([99]));
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.unknownUnit);
    expect(refused.hashState()).toBe(clean.hashState());
  });

  it('answers a hidden foreign unit like a missing one', () => {
    const sim = Simulation.create();
    const id = engineers(sim)[0]!.id;
    sim.enqueue({ type: 'move', playerId: 2, unitIds: [id], to: DESTINATION });
    const before = sim.hashState();
    sim.step();
    expect(sim.lastRejection).toBe(RejectReason.unknownUnit);
    const clean = Simulation.create();
    clean.step();
    expect(sim.hashState()).toBe(clean.hashState());
    expect(sim.hashState()).not.toBe(before);
  });

  it('refuses an attack on a base the player cannot see', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    const enemy = refused.world.buildings.find((building) => building.owner !== PLAYER_ID && building.kind === 'command_center');
    refused.enqueue({
      type: 'attack',
      playerId: PLAYER_ID,
      unitIds: engineers(refused).map((unit) => unit.id),
      targetId: enemy!.id,
    });
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.notVisible);
    expect(refused.hashState()).toBe(clean.hashState());
    expect(rectContains({ x: enemy!.x, y: enemy!.y, width: BUILDINGS.command_center.width, height: BUILDINGS.command_center.height }, enemy!.x, enemy!.y)).toBe(true);
  });
});
