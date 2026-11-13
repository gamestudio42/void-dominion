import { MATCH } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/index.ts';

function layout(seed: number, variation: 'none' | 'seeded' = 'seeded') {
  const sim = Simulation.create(seed, ['human', 'human'], variation);
  return sim.world.nodes.map((node) => ({ kind: node.kind, x: node.x, y: node.y, amount: node.amount }));
}

describe('seeded scenario variation', () => {
  it('leaves the default skirmish on the published layout and checksum', () => {
    const plain = Simulation.create();
    const explicit = Simulation.create(MATCH.seed, ['human', 'varek'], 'none');
    expect(plain.world.nodes.map((node) => [node.x, node.y, node.amount])).toEqual(
      explicit.world.nodes.map((node) => [node.x, node.y, node.amount]),
    );
    for (const base of MATCH.bases) {
      expect(plain.world.nodes.some((node) => node.kind === 'ore' && node.x === base.ore.x && node.y === base.ore.y)).toBe(true);
      expect(plain.world.nodes.some((node) => node.kind === 'ore' && node.amount === MATCH.oreAmount)).toBe(true);
    }
    expect(plain.hashState()).toBe(explicit.hashState());
  });

  it('is deterministic for one seed and differs across seeds', () => {
    expect(layout(MATCH.seed)).toEqual(layout(MATCH.seed));
    expect(layout(MATCH.seed)).not.toEqual(layout(MATCH.seed + 1));
    const left = Simulation.create(MATCH.seed, ['human', 'varek'], 'seeded');
    const right = Simulation.create(MATCH.seed, ['human', 'varek'], 'seeded');
    for (let tick = 0; tick < 30; tick++) {
      left.step();
      right.step();
    }
    expect(left.hashState()).toBe(right.hashState());
    const other = Simulation.create(MATCH.seed + 1, ['human', 'varek'], 'seeded');
    for (let tick = 0; tick < 30; tick++) other.step();
    expect(other.hashState()).not.toBe(left.hashState());
  });

  it('keeps the nudge mirror-symmetric and inside the field', () => {
    for (let index = 0; index < 10; index++) {
      const nodes = layout((MATCH.seed + index) >>> 0);
      const seat1Ore = nodes.find((node) => node.kind === 'ore' && node.x < 64)!;
      const seat2Ore = nodes.find((node) => node.kind === 'ore' && node.x >= 64)!;
      const seat1Aether = nodes.find((node) => node.kind === 'aether' && node.x < 64)!;
      const seat2Aether = nodes.find((node) => node.kind === 'aether' && node.x >= 64)!;
      const base1 = MATCH.bases[0]!;
      const base2 = MATCH.bases[1]!;
      expect(seat1Ore.x - base1.ore.x + (seat2Ore.x - base2.ore.x)).toBe(0);
      expect(seat1Ore.y - base1.ore.y + (seat2Ore.y - base2.ore.y)).toBe(0);
      expect(seat1Aether.x - base1.aether.x + (seat2Aether.x - base2.aether.x)).toBe(0);
      expect(seat1Aether.y - base1.aether.y + (seat2Aether.y - base2.aether.y)).toBe(0);
      expect(seat1Ore.amount).toBe(seat2Ore.amount);
      expect(seat1Aether.amount).toBe(seat2Aether.amount);
      expect(Math.abs(seat1Ore.x - base1.ore.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(seat1Ore.y - base1.ore.y)).toBeLessThanOrEqual(1);
    }
  });
});
