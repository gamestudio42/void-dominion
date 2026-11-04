import { MAP_SIZE, inMap, type CellRect } from '@void-dominion/content';

export function cellIndex(x: number, y: number): number {
  return y * MAP_SIZE + x;
}

export function createBlocked(obstacle: CellRect): Uint8Array {
  const blocked = new Uint8Array(MAP_SIZE * MAP_SIZE);
  for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) {
    for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) {
      blocked[cellIndex(x, y)] = 1;
    }
  }
  return blocked;
}

export function isWalkable(blocked: Uint8Array, x: number, y: number): boolean {
  return inMap(x, y) && blocked[cellIndex(x, y)] === 0;
}

export const ADJACENT: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export function paintCells(blocked: Uint8Array, x: number, y: number, width: number, height: number): void {
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      if (inMap(cx, cy)) blocked[cellIndex(cx, cy)] = 1;
    }
  }
}
