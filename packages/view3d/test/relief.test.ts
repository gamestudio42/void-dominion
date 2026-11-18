import { describe, expect, it } from 'vitest';
import { bakeRelief, sampleRelief, terrainHeight } from '../src/relief.ts';

describe('relief', () => {
  it('keeps the whole field level', () => {
    for (let z = 0; z <= 128; z += 8) {
      for (let x = 0; x <= 128; x += 8) {
        expect(terrainHeight(x, z)).toBe(0);
      }
    }
    expect(terrainHeight(10, 98)).toBe(terrainHeight(114, 26));
  });

  it('keeps a building pad level', () => {
    const heights = bakeRelief(128, [{ x: 8, z: 96, width: 4, depth: 4 }]);
    expect(sampleRelief(heights, 128, 8, 96)).toBeCloseTo(0);
    expect(sampleRelief(heights, 128, 12, 100)).toBeCloseTo(0);
    expect(sampleRelief(heights, 128, 40, 40)).toBeCloseTo(0);
  });
});
