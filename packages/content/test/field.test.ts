import { describe, expect, it } from 'vitest';
import { BUILDINGS, DEMO_OBSTACLE, MATCH, MAP_SIZE, demoSpawns, inMap, rectContains } from '../src/index.ts';

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

  it('places both bases off the rocks and off each other', () => {
    const cc = BUILDINGS.command_center;
    for (const base of MATCH.bases) {
      const footprint = { x: base.cc.x, y: base.cc.y, width: cc.width, height: cc.height };
      expect(inMap(base.cc.x, base.cc.y)).toBe(true);
      expect(inMap(base.cc.x + cc.width - 1, base.cc.y + cc.height - 1)).toBe(true);
      expect(rectContains(footprint, base.ore.x, base.ore.y)).toBe(false);
      expect(rectContains(footprint, base.aether.x, base.aether.y)).toBe(false);
      for (const rock of MATCH.rocks) {
        expect(rectContains(rock, base.ore.x, base.ore.y)).toBe(false);
        expect(rectContains(rock, base.aether.x, base.aether.y)).toBe(false);
        expect(rectContains(rock, base.cc.x, base.cc.y)).toBe(false);
      }
      for (const worker of base.workers) {
        expect(inMap(worker.x, worker.y)).toBe(true);
        expect(rectContains(footprint, worker.x, worker.y)).toBe(false);
        expect(worker.x === base.ore.x && worker.y === base.ore.y).toBe(false);
      }
    }
  });
});
