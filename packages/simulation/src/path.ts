import { DIAGONAL_COST, MAP_SIZE, ORTHOGONAL_COST } from '@void-dominion/content';
import { cellIndex, isWalkable } from './grid.ts';

/** Eight neighbours. Orthogonal 10, diagonal 14. Order is part of the search. */
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, ORTHOGONAL_COST],
  [-1, 0, ORTHOGONAL_COST],
  [0, 1, ORTHOGONAL_COST],
  [0, -1, ORTHOGONAL_COST],
  [1, 1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
];

export interface Cell {
  x: number;
  y: number;
}

class Heap {
  private readonly nodes: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, score: number): void {
    this.nodes.push(node);
    this.scores.push(score);
    this.siftUp(this.nodes.length - 1);
  }

  pop(): number {
    const top = this.nodes[0]!;
    const lastNode = this.nodes.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.scores[0] = lastScore;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.scores[index]! >= this.scores[parent]!) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(index: number): void {
    const length = this.nodes.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < length && this.scores[left]! < this.scores[best]!) best = left;
      if (right < length && this.scores[right]! < this.scores[best]!) best = right;
      if (best === index) break;
      this.swap(index, best);
      index = best;
    }
  }

  private swap(a: number, b: number): void {
    const node = this.nodes[a]!;
    this.nodes[a] = this.nodes[b]!;
    this.nodes[b] = node;
    const score = this.scores[a]!;
    this.scores[a] = this.scores[b]!;
    this.scores[b] = score;
  }
}

function canStep(blocked: Uint8Array, x: number, y: number, dx: number, dy: number): boolean {
  if (!isWalkable(blocked, x + dx, y + dy)) return false;
  if (dx !== 0 && dy !== 0) {
    return isWalkable(blocked, x + dx, y) && isWalkable(blocked, x, y + dy);
  }
  return true;
}

function heuristic(x: number, y: number, targetX: number, targetY: number): number {
  const dx = Math.abs(x - targetX);
  const dy = Math.abs(y - targetY);
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;
  return diagonal * DIAGONAL_COST + straight * ORTHOGONAL_COST;
}

function reconstruct(parent: Int32Array, start: number, goal: number): Cell[] {
  const cells: Cell[] = [];
  let current = goal;
  while (current !== start) {
    cells.push({ x: current % MAP_SIZE, y: (current / MAP_SIZE) | 0 });
    const previous = parent[current]!;
    if (previous < 0) break;
    current = previous;
  }
  cells.reverse();
  return cells;
}

/**
 * Cell path from start to goal, excluding the start cell.
 * Returns an empty list when start and goal are the same walkable cell.
 * Returns null when either cell is blocked or no route exists.
 */
export function findPath(blocked: Uint8Array, fromX: number, fromY: number, toX: number, toY: number): Cell[] | null {
  if (!isWalkable(blocked, fromX, fromY) || !isWalkable(blocked, toX, toY)) return null;
  if (fromX === toX && fromY === toY) return [];

  const start = cellIndex(fromX, fromY);
  const goal = cellIndex(toX, toY);
  const limit = MAP_SIZE * MAP_SIZE;
  const gScore = new Float64Array(limit);
  gScore.fill(Number.POSITIVE_INFINITY);
  gScore[start] = 0;
  const parent = new Int32Array(limit);
  parent.fill(-1);
  const closed = new Uint8Array(limit);
  const open = new Heap();
  open.push(start, heuristic(fromX, fromY, toX, toY));

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goal) return reconstruct(parent, start, goal);
    const x = current % MAP_SIZE;
    const y = (current / MAP_SIZE) | 0;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      if (!canStep(blocked, x, y, dx, dy)) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      const next = cellIndex(nextX, nextY);
      if (closed[next]) continue;
      const tentative = gScore[current]! + cost;
      if (tentative >= gScore[next]!) continue;
      parent[next] = current;
      gScore[next] = tentative;
      open.push(next, tentative + heuristic(nextX, nextY, toX, toY));
    }
  }
  return null;
}

/** Walkable cells in spiral order, starting at the origin. Null when there are not enough. */
export function gatherSlots(blocked: Uint8Array, x: number, y: number, count: number): Cell[] | null {
  if (count <= 0) return [];
  const found: Cell[] = [];
  if (isWalkable(blocked, x, y)) found.push({ x, y });
  const dirs: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let cx = x;
  let cy = y;
  let dir = 0;
  let leg = 1;
  while (found.length < count && leg < MAP_SIZE * 2) {
    for (let turn = 0; turn < 2; turn++) {
      const step = dirs[dir]!;
      for (let i = 0; i < leg; i++) {
        cx += step[0];
        cy += step[1];
        if (isWalkable(blocked, cx, cy)) found.push({ x: cx, y: cy });
        if (found.length >= count) return found;
      }
      dir = (dir + 1) % 4;
    }
    leg += 1;
  }
  return found.length >= count ? found : null;
}
