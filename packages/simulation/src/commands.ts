import {
  BUILDINGS,
  QUEUE_LIMIT,
  inMap,
  buildingDef,
  isBuildingKind,
  isUnitKind,
  unitDef,
  type BuildingKind,
  type UnitKind,
} from '@void-dominion/content';
import { cellIndex, isWalkable } from './grid.ts';
import { findPath, gatherSlots, type Cell } from './path.ts';
import {
  aimOf,
  approachPath,
  cellOf,
  complete,
  dropoffFor,
  footprintClear,
  inRange,
  nearFootprint,
  nearNode,
  nearestEnemy,
  nodeTouches,
  refineryTouches,
  seesAim,
  supplyCap,
  supplyUsed,
  toWaypoints,
  type Aim,
} from './query.ts';
import { canSee, canSeeFootprint, footprintSeen } from './vision.ts';
import { makeBuilding, playerOf, rebake, type Unit, type World } from './world.ts';

export interface MoveCommand {
  type: 'move';
  playerId: number;
  unitIds: number[];
  to: Cell;
}

export interface StopCommand {
  type: 'stop';
  playerId: number;
  unitIds: number[];
}

export interface AttackCommand {
  type: 'attack';
  playerId: number;
  unitIds: number[];
  targetId: number;
}

export interface AttackMoveCommand {
  type: 'attack_move';
  playerId: number;
  unitIds: number[];
  to: Cell;
}

export interface GatherCommand {
  type: 'gather';
  playerId: number;
  unitIds: number[];
  nodeId: number;
}

export interface BuildCommand {
  type: 'build';
  playerId: number;
  unitIds: number[];
  kind: BuildingKind;
  at: Cell;
}

export interface ProduceCommand {
  type: 'produce';
  playerId: number;
  buildingId: number;
  kind: UnitKind;
}

export type Command =
  | MoveCommand
  | StopCommand
  | AttackCommand
  | AttackMoveCommand
  | GatherCommand
  | BuildCommand
  | ProduceCommand;

export const RejectReason = {
  unknownUnit: 'unknown_unit',
  notOwner: 'not_owner',
  outOfBounds: 'out_of_bounds',
  blocked: 'blocked',
  noPath: 'no_path',
  noOre: 'no_ore',
  noAether: 'no_aether',
  noSupply: 'no_supply',
  footprint: 'footprint',
  noRefinery: 'no_refinery',
  notVisible: 'not_visible',
  cannotProduce: 'cannot_produce',
  notEngineer: 'not_engineer',
  ownTarget: 'own_target',
} as const;

export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

function takeUnits(world: World, playerId: number, ids: number[]): Unit[] | RejectReason {
  if (ids.length === 0) return RejectReason.unknownUnit;
  const chosen = new Map<number, Unit>();
  for (const id of ids) {
    const unit = world.units.find((candidate) => candidate.id === id);
    /** A foreign unit the player cannot see answers like a missing one, so a refusal never reveals it. */
    if (!unit || (unit.owner !== playerId && !canSee(world, playerId, cellOf(unit.x), cellOf(unit.y)))) {
      return RejectReason.unknownUnit;
    }
    if (unit.owner !== playerId) return RejectReason.notOwner;
    chosen.set(unit.id, unit);
  }
  return [...chosen.values()].sort((a, b) => a.id - b.id);
}

function isUnits(value: Unit[] | RejectReason): value is Unit[] {
  return Array.isArray(value);
}

function requireEngineers(units: Unit[]): RejectReason | null {
  for (const unit of units) {
    if (unit.kind !== 'engineer') return RejectReason.notEngineer;
  }
  return null;
}

function cellOk(cell: Cell): boolean {
  return Number.isInteger(cell.x) && Number.isInteger(cell.y) && inMap(cell.x, cell.y);
}

function assignSlots(world: World, units: Unit[], to: Cell, order: 'move' | 'attack_move'): RejectReason | null {
  if (!cellOk(to)) return RejectReason.outOfBounds;
  if (!isWalkable(world.blocked, to.x, to.y)) return RejectReason.blocked;
  const slots = gatherSlots(world.blocked, to.x, to.y, units.length);
  if (!slots) return RejectReason.noPath;
  const plans: { unit: Unit; path: Cell[]; slot: Cell }[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const slot = slots[i]!;
    const path = findPath(world.blocked, cellOf(unit.x), cellOf(unit.y), slot.x, slot.y);
    if (!path) return RejectReason.noPath;
    plans.push({ unit, path, slot });
  }
  for (const plan of plans) {
    plan.unit.order = order;
    plan.unit.targetId = 0;
    plan.unit.goalX = plan.slot.x;
    plan.unit.goalY = plan.slot.y;
    plan.unit.timer = 0;
    plan.unit.waypoints = toWaypoints(plan.path);
  }
  world.marker = { x: to.x, y: to.y };
  return null;
}

function chase(world: World, unit: Unit, aim: Aim): void {
  const range = unitDef(unit.kind).range;
  if (range > 0 && inRange(unit.x, unit.y, aim, range)) return;
  const path = approachPath(world.blocked, cellOf(unit.x), cellOf(unit.y), aim.cellX, aim.cellY, aim.w, aim.h);
  if (path) unit.waypoints = toWaypoints(path);
}

function pathToGoal(world: World, unit: Unit): void {
  if (cellOf(unit.x) === unit.goalX && cellOf(unit.y) === unit.goalY) return;
  if (!isWalkable(world.blocked, unit.goalX, unit.goalY)) return;
  const path = findPath(world.blocked, cellOf(unit.x), cellOf(unit.y), unit.goalX, unit.goalY);
  if (path) unit.waypoints = toWaypoints(path);
}

/** Recompute a path when the next cell is blocked or the order has nowhere to walk. */
export function steerAll(world: World): void {
  for (const unit of world.units) {
    if (unit.waypoints.length > 0) {
      const next = unit.waypoints[0]!;
      if (!isWalkable(world.blocked, cellOf(next.x), cellOf(next.y))) unit.waypoints.length = 0;
    }
    if (unit.order === 'idle') continue;
    if (unit.order === 'move') {
      if (unit.waypoints.length === 0) pathToGoal(world, unit);
      continue;
    }
    if (unit.order === 'attack') {
      const aim = aimOf(world, unit.targetId);
      if (!aim) {
        unit.order = 'idle';
        unit.targetId = 0;
        continue;
      }
      if (seesAim(world, unit.owner, aim)) {
        unit.goalX = aim.cellX;
        unit.goalY = aim.cellY;
        if (unit.waypoints.length === 0) chase(world, unit, aim);
        continue;
      }
      if (unit.waypoints.length === 0) pathToGoal(world, unit);
      continue;
    }
    if (unit.order === 'attack_move') {
      const sight = unitDef(unit.kind).sight;
      const threat = sight > 0 ? nearestEnemy(world, unit.owner, unit.x, unit.y, sight) : null;
      if (threat) {
        if (unit.targetId !== threat.id) {
          unit.targetId = threat.id;
          unit.waypoints.length = 0;
        }
        if (unit.waypoints.length === 0) chase(world, unit, threat);
        continue;
      }
      if (unit.targetId !== 0) {
        unit.targetId = 0;
        unit.waypoints.length = 0;
      }
      if (unit.waypoints.length === 0) pathToGoal(world, unit);
      continue;
    }
    if (unit.waypoints.length > 0) continue;
    if (unit.order === 'gather') {
      const node = world.nodes.find((candidate) => candidate.id === unit.targetId);
      if (!node || nearNode(unit, node.x, node.y)) continue;
      const path = approachPath(world.blocked, cellOf(unit.x), cellOf(unit.y), node.x, node.y, 1, 1);
      if (path) unit.waypoints = toWaypoints(path);
      continue;
    }
    if (unit.order === 'return') {
      const drop = dropoffFor(world, unit);
      if (!drop) continue;
      const def = buildingDef(drop.kind);
      if (nearFootprint(unit, drop.x, drop.y, def.width, def.height)) continue;
      const path = approachPath(world.blocked, cellOf(unit.x), cellOf(unit.y), drop.x, drop.y, def.width, def.height);
      if (path) unit.waypoints = toWaypoints(path);
      continue;
    }
    if (unit.order === 'build') {
      const building = world.buildings.find((candidate) => candidate.id === unit.targetId);
      if (!building) continue;
      const def = buildingDef(building.kind);
      if (nearFootprint(unit, building.x, building.y, def.width, def.height)) continue;
      const path = approachPath(world.blocked, cellOf(unit.x), cellOf(unit.y), building.x, building.y, def.width, def.height);
      if (path) unit.waypoints = toWaypoints(path);
    }
  }
}

/** Apply one command. Returns a reason key, or null when the order is accepted. */
export function applyCommand(world: World, cmd: Command): RejectReason | null {
  if (cmd.type === 'produce') return produce(world, cmd);
  const units = takeUnits(world, cmd.playerId, cmd.unitIds);
  if (!isUnits(units)) return units;
  if (cmd.type === 'stop') {
    for (const unit of units) {
      unit.waypoints = [];
      unit.timer = 0;
      unit.targetId = 0;
      unit.order = unit.carryOre > 0 || unit.carryAether > 0 ? 'return' : 'idle';
    }
    return null;
  }
  if (cmd.type === 'move') return assignSlots(world, units, cmd.to, 'move');
  if (cmd.type === 'attack_move') return assignSlots(world, units, cmd.to, 'attack_move');
  if (cmd.type === 'attack') return attack(world, units, cmd);
  if (cmd.type === 'gather') return gather(world, units, cmd);
  return build(world, units, cmd);
}

function attack(world: World, units: Unit[], cmd: AttackCommand): RejectReason | null {
  const aim = aimOf(world, cmd.targetId);
  /** Missing and hidden targets share one answer, so an id cannot be probed through the fog. */
  if (!aim || !seesAim(world, cmd.playerId, aim)) return RejectReason.notVisible;
  if (aim.owner === cmd.playerId) return RejectReason.ownTarget;
  for (const unit of units) {
    unit.order = 'attack';
    unit.targetId = aim.id;
    unit.goalX = aim.cellX;
    unit.goalY = aim.cellY;
    unit.timer = 0;
    unit.waypoints = [];
  }
  world.marker = { x: aim.cellX, y: aim.cellY };
  return null;
}

function gather(world: World, units: Unit[], cmd: GatherCommand): RejectReason | null {
  const engineers = requireEngineers(units);
  if (engineers) return engineers;
  const node = world.nodes.find((candidate) => candidate.id === cmd.nodeId);
  if (!node || !explored(world, cmd.playerId, node.x, node.y)) return RejectReason.unknownUnit;
  if (node.amount <= 0) return node.kind === 'ore' ? RejectReason.noOre : RejectReason.noAether;
  if (node.kind === 'aether' && !refineryTouches(world, cmd.playerId, node.x, node.y)) return RejectReason.noRefinery;
  const carry = unitDef('engineer').carry;
  for (const unit of units) {
    unit.targetId = node.id;
    unit.goalX = node.x;
    unit.goalY = node.y;
    unit.timer = 0;
    unit.waypoints = [];
    const full = unit.carryOre + unit.carryAether >= carry;
    unit.order = full ? 'return' : 'gather';
  }
  world.marker = { x: node.x, y: node.y };
  return null;
}

function build(world: World, units: Unit[], cmd: BuildCommand): RejectReason | null {
  const engineers = requireEngineers(units);
  if (engineers) return engineers;
  const player = playerOf(world, cmd.playerId);
  if (!player) return RejectReason.notOwner;
  const site = siteRefusal(world, cmd.playerId, cmd.kind, cmd.at);
  if (site) return site;
  const def = BUILDINGS[cmd.kind];
  if (player.ore < def.ore) return RejectReason.noOre;
  if (player.aether < def.aether) return RejectReason.noAether;
  player.ore -= def.ore;
  player.aether -= def.aether;
  const building = makeBuilding(world, cmd.playerId, cmd.kind, cmd.at.x, cmd.at.y, false);
  world.buildings.push(building);
  rebake(world);
  for (const unit of units) {
    unit.order = 'build';
    unit.targetId = building.id;
    unit.goalX = cmd.at.x;
    unit.goalY = cmd.at.y;
    unit.timer = 0;
    unit.waypoints = [];
  }
  world.marker = { x: cmd.at.x, y: cmd.at.y };
  return null;
}

function explored(world: World, playerId: number, x: number, y: number): boolean {
  const index = playerId - 1;
  if (index !== 0 && index !== 1) return false;
  return world.explored[index]![cellIndex(x, y)] === 1;
}

/**
 * Whether `kind` can stand at `at` for this player. The whole footprint has to be in sight
 * before units or buildings are consulted, so a refusal never reveals what the fog hides.
 */
export function siteRefusal(world: World, playerId: number, kind: BuildingKind, at: Cell): RejectReason | null {
  if (!cellOk(at)) return RejectReason.outOfBounds;
  const def = BUILDINGS[kind];
  if (!inMap(at.x + def.width - 1, at.y + def.height - 1)) return RejectReason.footprint;
  if (!footprintSeen(world, playerId, at.x, at.y, def.width, def.height)) return RejectReason.notVisible;
  if (!footprintClear(world, at.x, at.y, def.width, def.height)) return RejectReason.footprint;
  if (kind === 'ore_extractor' && !nodeTouches(world, 'ore', at.x, at.y, def.width, def.height)) return RejectReason.footprint;
  if (kind === 'aether_refinery' && !nodeTouches(world, 'aether', at.x, at.y, def.width, def.height)) {
    return RejectReason.footprint;
  }
  return null;
}

function produce(world: World, cmd: ProduceCommand): RejectReason | null {
  const player = playerOf(world, cmd.playerId);
  if (!player) return RejectReason.notOwner;
  const building = world.buildings.find((candidate) => candidate.id === cmd.buildingId);
  if (!building) return RejectReason.unknownUnit;
  if (building.owner !== cmd.playerId) {
    const def = buildingDef(building.kind);
    const seen = canSeeFootprint(world, cmd.playerId, building.x, building.y, def.width, def.height);
    return seen ? RejectReason.notOwner : RejectReason.unknownUnit;
  }
  const def = buildingDef(building.kind);
  if (!complete(building) || !def.produces.includes(cmd.kind)) return RejectReason.cannotProduce;
  const queued = building.queue.length + (building.prod ? 1 : 0);
  if (queued >= QUEUE_LIMIT) return RejectReason.cannotProduce;
  const cost = unitDef(cmd.kind);
  if (player.ore < cost.ore) return RejectReason.noOre;
  if (player.aether < cost.aether) return RejectReason.noAether;
  if (supplyUsed(world, cmd.playerId) + cost.supply > supplyCap(world, cmd.playerId)) return RejectReason.noSupply;
  player.ore -= cost.ore;
  player.aether -= cost.aether;
  building.queue.push({ kind: cmd.kind, ore: cost.ore, aether: cost.aether });
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCell(value: unknown): value is Cell {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'number');
}

/** Strict reader for a replay entry. Returns null when the file is not a command log. */
export function parseLogged(value: unknown): { tick: number; cmd: Command } | null {
  if (!isRecord(value) || typeof value.tick !== 'number' || !Number.isInteger(value.tick) || value.tick < 0) return null;
  const cmd = parseCommand(value.cmd);
  if (!cmd) return null;
  return { tick: value.tick, cmd };
}

function parseCommand(value: unknown): Command | null {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.playerId !== 'number') return null;
  const playerId = value.playerId;
  if (value.type === 'produce') {
    if (typeof value.buildingId !== 'number' || typeof value.kind !== 'string' || !isUnitKind(value.kind)) return null;
    return { type: 'produce', playerId, buildingId: value.buildingId, kind: value.kind };
  }
  if (!isIdList(value.unitIds)) return null;
  const unitIds = value.unitIds;
  if (value.type === 'stop') return { type: 'stop', playerId, unitIds };
  if (value.type === 'attack') {
    if (typeof value.targetId !== 'number') return null;
    return { type: 'attack', playerId, unitIds, targetId: value.targetId };
  }
  if (value.type === 'gather') {
    if (typeof value.nodeId !== 'number') return null;
    return { type: 'gather', playerId, unitIds, nodeId: value.nodeId };
  }
  if (value.type === 'build') {
    if (typeof value.kind !== 'string' || !isBuildingKind(value.kind) || !isCell(value.at)) return null;
    return { type: 'build', playerId, unitIds, kind: value.kind, at: { x: value.at.x, y: value.at.y } };
  }
  if ((value.type === 'move' || value.type === 'attack_move') && isCell(value.to)) {
    return { type: value.type, playerId, unitIds: [...unitIds], to: { x: value.to.x, y: value.to.y } };
  }
  return null;
}

export function cloneCommand(cmd: Command): Command {
  if (cmd.type === 'produce') return { ...cmd };
  if (cmd.type === 'move' || cmd.type === 'attack_move') return { ...cmd, unitIds: [...cmd.unitIds], to: { ...cmd.to } };
  if (cmd.type === 'build') return { ...cmd, unitIds: [...cmd.unitIds], at: { ...cmd.at } };
  if (cmd.type === 'stop') return { ...cmd, unitIds: [...cmd.unitIds] };
  if (cmd.type === 'attack') return { ...cmd, unitIds: [...cmd.unitIds] };
  return { ...cmd, unitIds: [...cmd.unitIds] };
}
