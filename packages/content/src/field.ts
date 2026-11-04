/** Logical cells on a side. One cell is the pathfinding and building grid. */
export const MAP_SIZE = 128;

/** Cells travelled each simulation tick. Six cells per second at 20 Hz. */
export const CELLS_PER_TICK = 0.3;

/** Orthogonal and diagonal step costs. Fixed so every path search agrees. */
export const ORTHOGONAL_COST = 10;
export const DIAGONAL_COST = 14;

export const DEMO_SEED = 0x5eed;
export const PLAYER_ID = 1;

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Blocks the straight line between the demo spawns and the far side of the field. */
export const DEMO_OBSTACLE: CellRect = { x: 28, y: 52, width: 18, height: 20 };

export interface Spawn {
  id: number;
  cellX: number;
  cellY: number;
}

/** Twenty engineers in two columns, clear of the obstacle. */
export function demoSpawns(): Spawn[] {
  const spawns: Spawn[] = [];
  let id = 1;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 10; col++) {
      spawns.push({ id: id++, cellX: 8 + row * 2, cellY: 55 + col });
    }
  }
  return spawns;
}

export function inMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
}

export function rectContains(rect: CellRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}
