import { isUnitKind, unitDef } from '@void-dominion/content';
import { cellIndex } from './grid.ts';
import { applyCommand, RejectReason, type RejectReason as RejectReasonName } from './commands.ts';
import type { Cell } from './path.ts';
import { canSee } from './vision.ts';
import type { World } from './world.ts';

/**
 * A commander proposes a plan between ticks. step() never calls this module.
 * A missing, malformed or refused plan leaves the conventional policy running.
 */

export interface PlanProduce {
  type: 'produce';
  playerId: number;
  buildingId: number;
  kind: string;
}

export interface PlanGroup {
  type: 'group';
  playerId: number;
  unitIds: number[];
  to: Cell;
}

export interface PlanDefend {
  type: 'defend';
  playerId: number;
  at: Cell;
}

export type Plan = PlanProduce | PlanGroup | PlanDefend;

export interface CommanderUnit {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
}

export interface CommanderBuilding {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  wreck: boolean;
}

export interface CommanderNode {
  id: number;
  kind: 'ore' | 'aether';
  x: number;
  y: number;
  /** Current stock. Present only while the cell is in sight, matching `clientView`. */
  amount?: number;
}

/** What one player is allowed to know. Hidden units and nodes are omitted. */
export interface CommanderView {
  playerId: number;
  tick: number;
  ore: number;
  aether: number;
  units: CommanderUnit[];
  buildings: CommanderBuilding[];
  nodes: CommanderNode[];
}

export interface CommanderSource {
  propose(view: CommanderView): unknown;
}

export type Consideration =
  | { status: 'fallback' }
  | { status: 'accepted' }
  | { status: 'refused'; reason: RejectReasonName };

function seat(playerId: number): 0 | 1 | null {
  if (playerId === 1) return 0;
  if (playerId === 2) return 1;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isCell(value: unknown): value is Cell {
  return isRecord(value) && isWhole(value.x) && isWhole(value.y);
}

function isIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((id) => isWhole(id));
}

/** Copy a plan into known fields. Anything else is malformed. */
export function parsePlan(value: unknown): Plan | null {
  if (!isRecord(value) || !isWhole(value.playerId)) return null;
  const playerId = value.playerId;
  if (value.type === 'produce') {
    if (!isWhole(value.buildingId) || typeof value.kind !== 'string' || !isUnitKind(value.kind)) return null;
    return { type: 'produce', playerId, buildingId: value.buildingId, kind: value.kind };
  }
  if (value.type === 'group') {
    if (!isIdList(value.unitIds) || !isCell(value.to)) return null;
    return { type: 'group', playerId, unitIds: [...value.unitIds], to: { x: value.to.x, y: value.to.y } };
  }
  if (value.type === 'defend') {
    if (!isCell(value.at)) return null;
    return { type: 'defend', playerId, at: { x: value.at.x, y: value.at.y } };
  }
  return null;
}

/** Build the view for one player. Enemy units appear only on a visible cell. */
export function observe(world: World, playerId: number): CommanderView {
  const index = seat(playerId);
  const player = world.players.find((entry) => entry.id === playerId);
  const units: CommanderUnit[] = [];
  for (const unit of world.units) {
    const own = unit.owner === playerId;
    const seen = canSee(world, playerId, Math.floor(unit.x), Math.floor(unit.y));
    if (!own && !seen) continue;
    units.push({ id: unit.id, owner: unit.owner, kind: unit.kind, x: unit.x, y: unit.y, hp: unit.hp });
  }
  const buildings: CommanderBuilding[] = [];
  const listed = new Set<number>();
  for (const building of world.buildings) {
    if (building.owner !== playerId) continue;
    listed.add(building.id);
    buildings.push({
      id: building.id,
      owner: building.owner,
      kind: building.kind,
      x: building.x,
      y: building.y,
      hp: building.hp,
      wreck: false,
    });
  }
  if (index !== null) {
    for (const ghost of world.memory[index]!) {
      if (listed.has(ghost.id)) continue;
      buildings.push({
        id: ghost.id,
        owner: ghost.owner,
        kind: ghost.kind,
        x: ghost.x,
        y: ghost.y,
        hp: ghost.hp,
        wreck: ghost.wreck,
      });
    }
  }
  const nodes: CommanderNode[] = [];
  if (index !== null) {
    for (const node of world.nodes) {
      if (world.explored[index]![cellIndex(node.x, node.y)] !== 1) continue;
      const drawn: CommanderNode = { id: node.id, kind: node.kind, x: node.x, y: node.y };
      if (canSee(world, playerId, node.x, node.y)) drawn.amount = node.amount;
      nodes.push(drawn);
    }
  }
  return {
    playerId,
    tick: world.tick,
    ore: player?.ore ?? 0,
    aether: player?.aether ?? 0,
    units,
    buildings,
    nodes,
  };
}

function soldiers(world: World, playerId: number): number[] {
  return world.units.filter((unit) => unit.owner === playerId && unitDef(unit.kind).damage > 0).map((unit) => unit.id);
}

/** Turn one plan into ordinary commands. A refusal writes nothing. */
export function applyPlan(world: World, plan: Plan): RejectReasonName | null {
  if (plan.type === 'produce') {
    if (!isUnitKind(plan.kind)) return RejectReason.cannotProduce;
    return applyCommand(world, {
      type: 'produce',
      playerId: plan.playerId,
      buildingId: plan.buildingId,
      kind: plan.kind,
    });
  }
  if (plan.type === 'group') {
    return applyCommand(world, {
      type: 'move',
      playerId: plan.playerId,
      unitIds: plan.unitIds,
      to: plan.to,
    });
  }
  const unitIds = soldiers(world, plan.playerId);
  if (unitIds.length === 0) return RejectReason.unknownUnit;
  return applyCommand(world, {
    type: 'attack_move',
    playerId: plan.playerId,
    unitIds,
    to: plan.at,
  });
}

/**
 * Ask a source for one plan and apply it. Exceptions, null and malformed
 * payloads fall back without touching the world. The conventional opponent
 * still runs on the next tick.
 */
export function considerCommander(world: World, playerId: number, source: CommanderSource): Consideration {
  let proposed: unknown;
  try {
    proposed = source.propose(observe(world, playerId));
  } catch {
    return { status: 'fallback' };
  }
  if (proposed === null || proposed === undefined) return { status: 'fallback' };
  const plan = parsePlan(proposed);
  if (!plan) return { status: 'fallback' };
  if (plan.playerId !== playerId) return { status: 'refused', reason: RejectReason.notOwner };
  const reason = applyPlan(world, plan);
  if (reason) return { status: 'refused', reason };
  return { status: 'accepted' };
}
