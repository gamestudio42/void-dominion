import { describe, expect, it } from 'vitest';
import {
  DEMO_OBSTACLE,
  MAP_SIZE,
  demoSpawns,
  inMap,
  rectContains,
} from '../src/index.ts';

describe('demo field', () => {
  it('places twenty spawns on the map and off the obstacle', () => {
    const spawns = demoSpawns();
    expect(spawns).toHaveLength(20);
    const ids = new Set(spawns.map((spawn) => spawn.id));
    expect(ids.size).toBe(20);
    for (const spawn of spawns) {
      expect(inMap(spawn.cellX, spawn.cellY)).toBe(true);
      expect(rectContains(DEMO_OBSTACLE, spawn.cellX, spawn.cellY)).toBe(false);
    }
  });

  it('keeps the obstacle inside the map', () => {
    expect(DEMO_OBSTACLE.x).toBeGreaterThanOrEqual(0);
    expect(DEMO_OBSTACLE.y).toBeGreaterThanOrEqual(0);
    expect(DEMO_OBSTACLE.x + DEMO_OBSTACLE.width).toBeLessThanOrEqual(MAP_SIZE);
    expect(DEMO_OBSTACLE.y + DEMO_OBSTACLE.height).toBeLessThanOrEqual(MAP_SIZE);
  });
});
