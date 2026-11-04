import { inMap } from '@void-dominion/content';
import { isWalkable } from './grid.ts';
import { findPath, gatherSlots, type Cell } from './path.ts';
import type { World } from './world.ts';

export interface MoveCommand {
  type: 'move';
  playerId: number;
  unitIds: number[];
  /** Integer cell. */
  to: Cell;
}

export type Command = MoveCommand;

export const RejectReason = {
  unknownUnit: 'unknown_unit',
  notOwner: 'not_owner',
  outOfBounds: 'out_of_bounds',
  blocked: 'blocked',
  noPath: 'no_path',
} as const;

export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

function cellOf(position: number): number {
  return Math.floor(position);
}

/** Apply one command. Returns a reason key, or null when the order is accepted. */
export function applyCommand(world: World, cmd: Command): RejectReason | null {
  if (cmd.type !== 'move') return RejectReason.unknownUnit;
  const { x, y } = cmd.to;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inMap(x, y)) return RejectReason.outOfBounds;
  if (!isWalkable(world.blocked, x, y)) return RejectReason.blocked;
  if (cmd.unitIds.length === 0) return RejectReason.unknownUnit;

  const chosen = new Map<number, (typeof world.units)[number]>();
  for (const id of cmd.unitIds) {
    const unit = world.units.find((candidate) => candidate.id === id);
    if (!unit) return RejectReason.unknownUnit;
    if (unit.owner !== cmd.playerId) return RejectReason.notOwner;
    chosen.set(unit.id, unit);
  }
  const units = [...chosen.values()].sort((a, b) => a.id - b.id);
  const slots = gatherSlots(world.blocked, x, y, units.length);
  if (!slots) return RejectReason.noPath;

  const plans: { unit: (typeof units)[number]; path: Cell[] }[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const slot = slots[i]!;
    const path = findPath(world.blocked, cellOf(unit.x), cellOf(unit.y), slot.x, slot.y);
    if (!path) return RejectReason.noPath;
    plans.push({ unit, path });
  }

  for (const plan of plans) {
    plan.unit.waypoints = plan.path.map((cell) => ({ x: cell.x + 0.5, y: cell.y + 0.5 }));
  }
  world.marker = { x, y };
  return null;
}
