import { PLAYER_ID, rectContains, DEMO_OBSTACLE } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { RejectReason, Simulation, isWalkable } from '../src/index.ts';

const DESTINATION = { x: 80, y: 60 };
const TICKS = 500;

function move(unitIds: number[], to: { x: number; y: number } = DESTINATION) {
  return { type: 'move' as const, playerId: PLAYER_ID, unitIds, to };
}

function runPair(issue: (sim: Simulation) => void): [Simulation, Simulation] {
  const left = Simulation.create();
  const right = Simulation.create();
  issue(left);
  issue(right);
  for (let tick = 0; tick < TICKS; tick++) {
    left.step();
    right.step();
    expect(left.hashState()).toBe(right.hashState());
  }
  return [left, right];
}

describe('deterministic movement', () => {
  it('keeps two runs with the same orders on the same checksum', () => {
    const ids = Array.from({ length: 20 }, (_, index) => index + 1);
    const [left] = runPair((sim) => sim.enqueue(move(ids)));
    expect(left.lastRejection).toBeNull();
    expect(left.world.marker).toEqual(DESTINATION);
    for (const unit of left.world.units) {
      expect(unit.waypoints).toHaveLength(0);
      expect(isWalkable(left.world.blocked, Math.floor(unit.x), Math.floor(unit.y))).toBe(true);
      expect(rectContains(DEMO_OBSTACLE, Math.floor(unit.x), Math.floor(unit.y))).toBe(false);
    }
    const occupied = new Set(left.world.units.map((unit) => `${Math.floor(unit.x)},${Math.floor(unit.y)}`));
    expect(occupied.size).toBe(20);
  });

  it('assigns the same slots regardless of selection order', () => {
    const [ordered] = runPair((sim) => sim.enqueue(move([1, 2, 3])));
    const reversed = Simulation.create();
    reversed.enqueue(move([3, 2, 1]));
    for (let tick = 0; tick < TICKS; tick++) reversed.step();
    expect(reversed.hashState()).toBe(ordered.hashState());
  });

  it('does not change the checksum when the destination is blocked', () => {
    const clean = Simulation.create();
    const refused = Simulation.create();
    refused.enqueue(move([1], { x: DEMO_OBSTACLE.x, y: DEMO_OBSTACLE.y }));
    clean.step();
    refused.step();
    expect(refused.lastRejection).toBe(RejectReason.blocked);
    expect(refused.hashState()).toBe(clean.hashState());
    expect(refused.world.units[0]!.waypoints).toHaveLength(0);
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

  it('refuses a unit owned by someone else', () => {
    const sim = Simulation.create();
    sim.enqueue({ type: 'move', playerId: 2, unitIds: [1], to: DESTINATION });
    const before = sim.hashState();
    sim.step();
    expect(sim.lastRejection).toBe(RejectReason.notOwner);
    const clean = Simulation.create();
    clean.step();
    expect(sim.hashState()).toBe(clean.hashState());
    expect(sim.hashState()).not.toBe(before);
  });
});
