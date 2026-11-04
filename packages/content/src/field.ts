/** Logical cells on a side. One cell is the pathfinding and building grid. */
export const MAP_SIZE = 128;

/** Orthogonal and diagonal step costs. Fixed so every path search agrees. */
export const ORTHOGONAL_COST = 10;
export const DIAGONAL_COST = 14;

export const DEMO_SEED = 0x5eed;
export const PLAYER_ID = 1;
export const ENEMY_ID = 2;

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Kept for path tests. The match uses MATCH.rocks instead. */
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

export interface StartBase {
  id: number;
  cc: { x: number; y: number };
  ore: { x: number; y: number };
  aether: { x: number; y: number };
  workers: { x: number; y: number }[];
}

/** Two known starts. Both players can see them on the briefing; vision still hides units. */
export const MATCH: {
  seed: number;
  startOre: number;
  startAether: number;
  oreAmount: number;
  aetherAmount: number;
  rocks: CellRect[];
  bases: StartBase[];
  ai: { id: string; aggression: number; army: number; period: number; marchTick: number };
} = {
  seed: DEMO_SEED,
  startOre: 50,
  startAether: 0,
  oreAmount: 8000,
  aetherAmount: 4000,
  rocks: [
    { x: 58, y: 30, width: 10, height: 24 },
    { x: 58, y: 74, width: 10, height: 24 },
  ],
  bases: [
    {
      id: PLAYER_ID,
      cc: { x: 8, y: 96 },
      ore: { x: 16, y: 100 },
      aether: { x: 20, y: 92 },
      workers: [
        { x: 14, y: 98 },
        { x: 15, y: 98 },
        { x: 14, y: 99 },
        { x: 15, y: 99 },
      ],
    },
    {
      id: ENEMY_ID,
      cc: { x: 112, y: 24 },
      ore: { x: 104, y: 28 },
      aether: { x: 108, y: 18 },
      workers: [
        { x: 108, y: 25 },
        { x: 109, y: 25 },
        { x: 108, y: 26 },
        { x: 109, y: 26 },
      ],
    },
  ],
  ai: { id: 'general_varek', aggression: 0.85, army: 6, period: 20, marchTick: 2400 },
};
