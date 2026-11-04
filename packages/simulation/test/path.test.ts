import { DEMO_OBSTACLE, rectContains } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { createBlocked, findPath, isWalkable } from '../src/index.ts';

describe('findPath', () => {
  const blocked = createBlocked(DEMO_OBSTACLE);

  it('walks a clear row without entering the start cell twice', () => {
    const path = findPath(blocked, 2, 2, 5, 2);
    expect(path).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
  });

  it('returns an empty path when the unit is already on the cell', () => {
    expect(findPath(blocked, 4, 4, 4, 4)).toEqual([]);
  });

  it('refuses a blocked goal', () => {
    expect(findPath(blocked, 8, 60, DEMO_OBSTACLE.x, DEMO_OBSTACLE.y)).toBeNull();
  });

  it('routes around the demo obstacle', () => {
    const path = findPath(blocked, 8, 60, 80, 60);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 80, y: 60 });
    for (const cell of path!) {
      expect(rectContains(DEMO_OBSTACLE, cell.x, cell.y)).toBe(false);
      expect(isWalkable(blocked, cell.x, cell.y)).toBe(true);
    }
    expect(path!.some((cell) => cell.y < DEMO_OBSTACLE.y || cell.y >= DEMO_OBSTACLE.y + DEMO_OBSTACLE.height)).toBe(true);
  });

  it('does not cut a blocked corner', () => {
    const grid = new Uint8Array(128 * 128);
    grid[1 * 128 + 2] = 1;
    const path = findPath(grid, 1, 1, 2, 2);
    expect(path).not.toBeNull();
    expect(path!.some((cell) => cell.x === 2 && cell.y === 1)).toBe(false);
  });
});
