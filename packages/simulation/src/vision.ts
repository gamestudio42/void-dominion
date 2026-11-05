import { buildingDef, inMap, unitDef } from '@void-dominion/content';
import { cellIndex } from './grid.ts';
import type { MemoryBuilding, World } from './world.ts';

export function canSee(world: World, playerId: number, x: number, y: number): boolean {
  const index = playerId - 1;
  if (index !== 0 && index !== 1) return false;
  if (!inMap(x, y)) return false;
  return world.visible[index]![cellIndex(x, y)] === 1;
}

export function canSeeFootprint(world: World, playerId: number, x: number, y: number, width: number, height: number): boolean {
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      if (canSee(world, playerId, cx, cy)) return true;
    }
  }
  return false;
}

/** Every cell of the footprint is in sight. Building placement needs this, not one corner. */
export function footprintSeen(world: World, playerId: number, x: number, y: number, width: number, height: number): boolean {
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      if (!canSee(world, playerId, cx, cy)) return false;
    }
  }
  return true;
}

function reveal(world: World, index: number, cx: number, cy: number, sight: number): void {
  const limit = sight * sight;
  const grid = world.visible[index]!;
  for (let y = cy - sight; y <= cy + sight; y++) {
    for (let x = cx - sight; x <= cx + sight; x++) {
      if (!inMap(x, y)) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > limit) continue;
      grid[cellIndex(x, y)] = 1;
    }
  }
}

/** Recompute who can see what this tick, then paint it into explored memory. */
export function updateVision(world: World): void {
  world.visible[0].fill(0);
  world.visible[1].fill(0);
  for (const unit of world.units) {
    const index = unit.owner - 1;
    if (index !== 0 && index !== 1) continue;
    reveal(world, index, Math.floor(unit.x), Math.floor(unit.y), unitDef(unit.kind).sight);
  }
  for (const building of world.buildings) {
    const index = building.owner - 1;
    if (index !== 0 && index !== 1) continue;
    const def = buildingDef(building.kind);
    reveal(world, index, building.x + Math.floor(def.width / 2), building.y + Math.floor(def.height / 2), def.sight);
  }
  for (let index = 0; index < 2; index++) {
    const visible = world.visible[index]!;
    const explored = world.explored[index]!;
    for (let cell = 0; cell < visible.length; cell++) {
      if (visible[cell]) explored[cell] = 1;
    }
  }
}

function snapshot(building: World['buildings'][number]): MemoryBuilding {
  return {
    id: building.id,
    owner: building.owner,
    kind: building.kind,
    x: building.x,
    y: building.y,
    hp: building.hp,
    progress: building.progress,
    wreck: false,
  };
}

/** Remember buildings the player has seen. A death outside vision leaves a wreck. */
export function refreshMemory(world: World): void {
  for (let index = 0; index < 2; index++) {
    const playerId = index + 1;
    const next: MemoryBuilding[] = [];
    const seen = new Set<number>();
    for (const building of world.buildings) {
      const def = buildingDef(building.kind);
      if (!canSeeFootprint(world, playerId, building.x, building.y, def.width, def.height)) continue;
      seen.add(building.id);
      next.push(snapshot(building));
    }
    for (const ghost of world.memory[index]!) {
      if (seen.has(ghost.id)) continue;
      const live = world.buildings.find((building) => building.id === ghost.id);
      if (live) {
        next.push(ghost);
        continue;
      }
      const def = buildingDef(ghost.kind);
      if (canSeeFootprint(world, playerId, ghost.x, ghost.y, def.width, def.height)) continue;
      next.push({ ...ghost, hp: 0, wreck: true });
    }
    next.sort((a, b) => a.id - b.id);
    world.memory[index] = next;
  }
}
