import {
  CELLS_PER_TICK,
  DEMO_OBSTACLE,
  DEMO_SEED,
  PLAYER_ID,
  demoSpawns,
} from '@void-dominion/content';
import { Fnv1a } from '@void-dominion/kernel';
import { createBlocked } from './grid.ts';

export interface Waypoint {
  x: number;
  y: number;
}

export interface Unit {
  id: number;
  owner: number;
  /** Cell-space position. Integer cells sit on centres (n + 0.5). */
  x: number;
  y: number;
  waypoints: Waypoint[];
}

export interface Marker {
  x: number;
  y: number;
}

export interface World {
  seed: number;
  tick: number;
  units: Unit[];
  blocked: Uint8Array;
  /** Cell of the last accepted order. Rejections do not write this. */
  marker: Marker | null;
}

export function createWorld(): World {
  return {
    seed: DEMO_SEED,
    tick: 0,
    blocked: createBlocked(DEMO_OBSTACLE),
    marker: null,
    units: demoSpawns().map((spawn) => ({
      id: spawn.id,
      owner: PLAYER_ID,
      x: spawn.cellX + 0.5,
      y: spawn.cellY + 0.5,
      waypoints: [],
    })),
  };
}

export function hashWorld(world: World): number {
  const hash = new Fnv1a();
  hash.u32(world.seed);
  hash.u32(world.tick);
  hash.bytes(world.blocked);
  if (world.marker) {
    hash.u32(1);
    hash.u32(world.marker.x);
    hash.u32(world.marker.y);
  } else {
    hash.u32(0);
  }
  for (const unit of world.units) {
    hash.u32(unit.id);
    hash.u32(unit.owner);
    hash.f64Value(unit.x);
    hash.f64Value(unit.y);
    hash.u32(unit.waypoints.length);
    for (const point of unit.waypoints) {
      hash.f64Value(point.x);
      hash.f64Value(point.y);
    }
  }
  return hash.digest();
}

export function stepMovement(world: World): void {
  for (const unit of world.units) {
    let budget = CELLS_PER_TICK;
    while (budget > 0 && unit.waypoints.length > 0) {
      const point = unit.waypoints[0]!;
      const dx = point.x - unit.x;
      const dy = point.y - unit.y;
      const distSq = dx * dx + dy * dy;
      if (distSq === 0) {
        unit.waypoints.shift();
        continue;
      }
      const dist = Math.sqrt(distSq);
      if (dist <= budget) {
        unit.x = point.x;
        unit.y = point.y;
        budget -= dist;
        unit.waypoints.shift();
      } else {
        const scale = budget / dist;
        unit.x += dx * scale;
        unit.y += dy * scale;
        budget = 0;
      }
    }
  }
}
