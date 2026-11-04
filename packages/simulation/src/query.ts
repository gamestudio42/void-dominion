import {
  BUILDINGS,
  buildingDef,
  unitDef,
  type BuildingKind,
} from '@void-dominion/content';
import { isWalkable } from './grid.ts';
import { findPath, type Cell } from './path.ts';
import { canSee, canSeeFootprint } from './vision.ts';
import type { Building, Unit, World } from './world.ts';

export interface Aim {
  id: number;
  owner: number;
  x: number;
  y: number;
  cellX: number;
  cellY: number;
  armor: number;
  hp: number;
  body: 'unit' | 'building';
  w: number;
  h: number;
}

export function cellOf(position: number): number {
  return Math.floor(position);
}

export function complete(building: Building): boolean {
  return building.progress >= buildingDef(building.kind).buildTicks;
}

export function toWaypoints(path: Cell[]): { x: number; y: number }[] {
  return path.map((cell) => ({ x: cell.x + 0.5, y: cell.y + 0.5 }));
}

export function supplyCap(world: World, playerId: number): number {
  let total = 0;
  for (const building of world.buildings) {
    if (building.owner !== playerId || !complete(building)) continue;
    total += buildingDef(building.kind).supply;
  }
  return total;
}

export function supplyUsed(world: World, playerId: number): number {
  let total = 0;
  for (const unit of world.units) {
    if (unit.owner === playerId) total += unitDef(unit.kind).supply;
  }
  for (const building of world.buildings) {
    if (building.owner !== playerId) continue;
    if (building.prod) total += unitDef(building.prod.kind).supply;
    for (const job of building.queue) total += unitDef(job.kind).supply;
  }
  return total;
}

export function powerGive(world: World, playerId: number): number {
  let total = 0;
  for (const building of world.buildings) {
    if (building.owner !== playerId || !complete(building)) continue;
    total += buildingDef(building.kind).powerGive;
  }
  return total;
}

export function powerTake(world: World, playerId: number): number {
  let total = 0;
  for (const building of world.buildings) {
    if (building.owner !== playerId || !complete(building)) continue;
    total += buildingDef(building.kind).powerTake;
  }
  return total;
}

export function powered(world: World, playerId: number): boolean {
  return powerGive(world, playerId) >= powerTake(world, playerId);
}

export function footprintClear(world: World, x: number, y: number, width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      if (!isWalkable(world.blocked, cx, cy)) return false;
    }
  }
  for (const unit of world.units) {
    const cx = cellOf(unit.x);
    const cy = cellOf(unit.y);
    if (cx >= x && cx < x + width && cy >= y && cy < y + height) return false;
  }
  return true;
}

export function touches(x: number, y: number, width: number, height: number, nx: number, ny: number): boolean {
  if (nx < x - 1 || nx > x + width || ny < y - 1 || ny > y + height) return false;
  const inside = nx >= x && nx < x + width && ny >= y && ny < y + height;
  return !inside;
}

export function nearFootprint(unit: Unit, x: number, y: number, width: number, height: number): boolean {
  return touches(x, y, width, height, cellOf(unit.x), cellOf(unit.y));
}

export function nearNode(unit: Unit, x: number, y: number): boolean {
  const cx = cellOf(unit.x);
  const cy = cellOf(unit.y);
  if (cx === x && cy === y) return false;
  const dx = cx > x ? cx - x : x - cx;
  const dy = cy > y ? cy - y : y - cy;
  return dx <= 1 && dy <= 1;
}

export function inRange(x: number, y: number, aim: Aim, range: number): boolean {
  const dx = x - aim.x;
  const dy = y - aim.y;
  return dx * dx + dy * dy <= range * range;
}

export function dropoffFor(world: World, unit: Unit): Building | undefined {
  const wantAether = unit.carryAether > 0;
  let best: Building | undefined;
  let bestDist = Infinity;
  for (const building of world.buildings) {
    if (building.owner !== unit.owner || !complete(building)) continue;
    const oreDrop = building.kind === 'command_center' || building.kind === 'ore_extractor';
    const aetherDrop = building.kind === 'aether_refinery';
    if (wantAether ? !aetherDrop : !oreDrop) continue;
    const def = buildingDef(building.kind);
    const cx = building.x + def.width / 2;
    const cy = building.y + def.height / 2;
    const dx = cx - unit.x;
    const dy = cy - unit.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = building;
    }
  }
  return best;
}

export function refineryTouches(world: World, playerId: number, x: number, y: number): boolean {
  for (const building of world.buildings) {
    if (building.owner !== playerId || building.kind !== 'aether_refinery' || !complete(building)) continue;
    const def = buildingDef(building.kind);
    if (touches(building.x, building.y, def.width, def.height, x, y)) return true;
  }
  return false;
}

export function nodeTouches(world: World, kind: 'ore' | 'aether', x: number, y: number, width: number, height: number): boolean {
  for (const node of world.nodes) {
    if (node.kind !== kind || node.amount <= 0) continue;
    if (touches(x, y, width, height, node.x, node.y)) return true;
  }
  return false;
}

/** Nearest walkable ring cell, then a path that does not include the start. */
export function approachPath(
  blocked: Uint8Array,
  fromX: number,
  fromY: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Cell[] | null {
  let best: Cell | null = null;
  let bestScore = Infinity;
  for (let cy = y - 1; cy <= y + height; cy++) {
    for (let cx = x - 1; cx <= x + width; cx++) {
      if (cx >= x && cx < x + width && cy >= y && cy < y + height) continue;
      if (!isWalkable(blocked, cx, cy)) continue;
      const dx = cx - fromX;
      const dy = cy - fromY;
      const score = dx * dx + dy * dy;
      const closer = score < bestScore;
      const tie = score === bestScore && best !== null && (cy < best.y || (cy === best.y && cx < best.x));
      if (closer || tie) {
        bestScore = score;
        best = { x: cx, y: cy };
      }
    }
  }
  if (!best) return null;
  if (best.x === fromX && best.y === fromY) return [];
  return findPath(blocked, fromX, fromY, best.x, best.y);
}

export function findTouchingSite(world: World, kind: BuildingKind, nx: number, ny: number): Cell | null {
  const def = BUILDINGS[kind];
  let best: Cell | null = null;
  let bestScore = Infinity;
  for (let y = ny - def.height; y <= ny + 1; y++) {
    for (let x = nx - def.width; x <= nx + 1; x++) {
      if (!footprintClear(world, x, y, def.width, def.height)) continue;
      if (!touches(x, y, def.width, def.height, nx, ny)) continue;
      const score = y * 1000 + x;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

export function findOpenSite(world: World, kind: BuildingKind, originX: number, originY: number): Cell | null {
  const def = BUILDINGS[kind];
  for (let radius = 0; radius < 18; radius++) {
    for (let y = originY - radius; y <= originY + radius; y++) {
      for (let x = originX - radius; x <= originX + radius; x++) {
        const onEdge = radius === 0 || Math.abs(x - originX) === radius || Math.abs(y - originY) === radius;
        if (!onEdge) continue;
        if (footprintClear(world, x, y, def.width, def.height)) return { x, y };
      }
    }
  }
  return null;
}

export function aimOf(world: World, id: number): Aim | null {
  for (const unit of world.units) {
    if (unit.id !== id || unit.hp <= 0) continue;
    return {
      id: unit.id,
      owner: unit.owner,
      x: unit.x,
      y: unit.y,
      cellX: cellOf(unit.x),
      cellY: cellOf(unit.y),
      armor: unitDef(unit.kind).armor,
      hp: unit.hp,
      body: 'unit',
      w: 1,
      h: 1,
    };
  }
  for (const building of world.buildings) {
    if (building.id !== id || building.hp <= 0) continue;
    const def = buildingDef(building.kind);
    return {
      id: building.id,
      owner: building.owner,
      x: building.x + def.width / 2,
      y: building.y + def.height / 2,
      cellX: building.x,
      cellY: building.y,
      armor: def.armor,
      hp: building.hp,
      body: 'building',
      w: def.width,
      h: def.height,
    };
  }
  return null;
}

export function seesAim(world: World, playerId: number, aim: Aim): boolean {
  if (aim.body === 'building') return canSeeFootprint(world, playerId, aim.cellX, aim.cellY, aim.w, aim.h);
  return canSee(world, playerId, aim.cellX, aim.cellY);
}

/** Closest enemy the player can currently see, within `range` of a point. */
export function nearestEnemy(world: World, owner: number, x: number, y: number, range: number): Aim | null {
  const limit = range * range;
  let best: Aim | null = null;
  let bestDist = limit + 1;
  for (const unit of world.units) {
    if (unit.owner === owner || unit.hp <= 0) continue;
    const cellX = cellOf(unit.x);
    const cellY = cellOf(unit.y);
    if (!canSee(world, owner, cellX, cellY)) continue;
    const dx = unit.x - x;
    const dy = unit.y - y;
    const dist = dx * dx + dy * dy;
    if (dist <= limit && dist < bestDist) {
      bestDist = dist;
      best = {
        id: unit.id,
        owner: unit.owner,
        x: unit.x,
        y: unit.y,
        cellX,
        cellY,
        armor: unitDef(unit.kind).armor,
        hp: unit.hp,
        body: 'unit',
        w: 1,
        h: 1,
      };
    }
  }
  for (const building of world.buildings) {
    if (building.owner === owner || building.hp <= 0) continue;
    const def = buildingDef(building.kind);
    if (!canSeeFootprint(world, owner, building.x, building.y, def.width, def.height)) continue;
    const cx = building.x + def.width / 2;
    const cy = building.y + def.height / 2;
    const dx = cx - x;
    const dy = cy - y;
    const dist = dx * dx + dy * dy;
    if (dist <= limit && dist < bestDist) {
      bestDist = dist;
      best = {
        id: building.id,
        owner: building.owner,
        x: cx,
        y: cy,
        cellX: building.x,
        cellY: building.y,
        armor: def.armor,
        hp: building.hp,
        body: 'building',
        w: def.width,
        h: def.height,
      };
    }
  }
  return best;
}
