#!/usr/bin/env node
/**
 * Reference agent. Plays only from the authorized observation and the public catalog.
 * Deterministic: no clock, no random, no world state.
 *
 * Opening: the engineers keep the gather order the match already gave them.
 * One engineer raises an ore extractor, a barracks, a turret on the side
 * General Varek marches toward, then a second barracks. Both halls train
 * riflemen. The army holds that approach until eight riflemen are up and the
 * turret is finished, then walks to a remembered enemy building. Once that
 * command center is in sight the army attacks it. Enemy units only pull the
 * army off that order when they are already on top of our own command center.
 *
 * Run: node --experimental-transform-types --no-warnings examples/reference.ts
 */

import { BUILDINGS, MAP_SIZE, UNITS, isBuildingKind, type BuildingKind } from '../packages/content/src/index.ts';
import {
  createJsonlReader,
  createJsonlWriter,
  SCHEMA_VERSION,
  validateObserveRequest,
  type ActResponse,
  type Action,
  type ObserveRequest,
} from '../packages/agent-sdk/src/index.ts';

const RIFLE_MARCH = 8;
const ENGINEER_CAP = 5;
const RIFLE_CAP = 16;
const HOME_THREAT_CELLS = 16;
/** Walk time the builder still needs after the order is given. Pulling him early freezes the site. */
const BUILD_SLACK = 160;

export interface AgentMemory {
  failed: Set<string>;
  readyAt: Map<number, number>;
  attempt: { kind: BuildingKind; x: number; y: number; tick: number } | null;
}

export function createMemory(): AgentMemory {
  return { failed: new Set(), readyAt: new Map(), attempt: null };
}

interface OwnUnit {
  id: number;
  kind: string;
  x: number;
  y: number;
}

interface OwnBuilding {
  id: number;
  kind: string;
  x: number;
  y: number;
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value >= MAP_SIZE) return MAP_SIZE - 1;
  return value;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function siteKey(kind: string, x: number, y: number): string {
  return `${kind}:${x},${y}`;
}

function syncMemory(obs: ObserveRequest, memory: AgentMemory): void {
  const attempt = memory.attempt;
  if (attempt) {
    const matched = obs.buildings.some(
      (building) =>
        building.owner === obs.seat &&
        !building.wreck &&
        building.kind === attempt.kind &&
        building.x === attempt.x &&
        building.y === attempt.y,
    );
    if (!matched) memory.failed.add(siteKey(attempt.kind, attempt.x, attempt.y));
    memory.attempt = null;
  }
  for (const building of obs.buildings) {
    if (building.owner !== obs.seat || building.wreck || memory.readyAt.has(building.id)) continue;
    if (building.kind === 'command_center') {
      memory.readyAt.set(building.id, 0);
      continue;
    }
    if (!isBuildingKind(building.kind)) continue;
    const started =
      attempt && attempt.kind === building.kind && attempt.x === building.x && attempt.y === building.y
        ? attempt.tick
        : obs.tick;
    memory.readyAt.set(building.id, started + BUILDINGS[building.kind].buildTicks + BUILD_SLACK);
  }
}

function ready(memory: AgentMemory, id: number, tick: number): boolean {
  const at = memory.readyAt.get(id);
  return at !== undefined && at <= tick;
}

function ownUnits(obs: ObserveRequest): OwnUnit[] {
  return obs.units
    .filter((unit) => unit.owner === obs.seat)
    .map((unit) => ({ id: unit.id, kind: unit.kind, x: unit.x, y: unit.y }))
    .sort((left, right) => left.id - right.id);
}

function ownBuildings(obs: ObserveRequest): OwnBuilding[] {
  return obs.buildings
    .filter((building) => building.owner === obs.seat && !building.wreck)
    .map((building) => ({ id: building.id, kind: building.kind, x: building.x, y: building.y }))
    .sort((left, right) => left.id - right.id);
}

function blockedCells(obs: ObserveRequest): Set<string> {
  const blocked = new Set<string>();
  for (const unit of obs.units) blocked.add(cellKey(Math.floor(unit.x), Math.floor(unit.y)));
  for (const node of obs.nodes) blocked.add(cellKey(node.x, node.y));
  for (const building of obs.buildings) {
    if (building.wreck || !isBuildingKind(building.kind)) continue;
    const def = BUILDINGS[building.kind];
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) blocked.add(cellKey(building.x + x, building.y + y));
    }
  }
  return blocked;
}

function cellSeen(obs: ObserveRequest, x: number, y: number): boolean {
  for (const unit of obs.units) {
    if (unit.owner !== obs.seat || !(unit.kind in UNITS)) continue;
    const sight = UNITS[unit.kind as keyof typeof UNITS].sight;
    const dx = x - Math.floor(unit.x);
    const dy = y - Math.floor(unit.y);
    if (dx * dx + dy * dy <= sight * sight) return true;
  }
  for (const building of obs.buildings) {
    if (building.owner !== obs.seat || building.wreck || !isBuildingKind(building.kind)) continue;
    const def = BUILDINGS[building.kind];
    const cx = building.x + Math.floor(def.width / 2);
    const cy = building.y + Math.floor(def.height / 2);
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= def.sight * def.sight) return true;
  }
  return false;
}

function footprintOk(obs: ObserveRequest, blocked: Set<string>, x: number, y: number, kind: BuildingKind): boolean {
  const def = BUILDINGS[kind];
  if (x < 0 || y < 0 || x + def.width > MAP_SIZE || y + def.height > MAP_SIZE) return false;
  for (let cy = y; cy < y + def.height; cy++) {
    for (let cx = x; cx < x + def.width; cx++) {
      if (blocked.has(cellKey(cx, cy)) || !cellSeen(obs, cx, cy)) return false;
    }
  }
  return true;
}

function extractorSite(obs: ObserveRequest, blocked: Set<string>, oreX: number, oreY: number, memory: AgentMemory): { x: number; y: number } | null {
  const def = BUILDINGS.ore_extractor;
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = oreY - def.height; y <= oreY + 1; y++) {
    for (let x = oreX - def.width; x <= oreX + 1; x++) {
      const inside = oreX >= x && oreX < x + def.width && oreY >= y && oreY < y + def.height;
      const near = oreX >= x - 1 && oreX <= x + def.width && oreY >= y - 1 && oreY <= y + def.height;
      if (!near || inside) continue;
      if (memory.failed.has(siteKey('ore_extractor', x, y))) continue;
      if (!footprintOk(obs, blocked, x, y, 'ore_extractor')) continue;
      const score = y * 1000 + x;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function openSite(
  obs: ObserveRequest,
  blocked: Set<string>,
  kind: BuildingKind,
  originX: number,
  originY: number,
  memory: AgentMemory,
): { x: number; y: number } | null {
  for (let radius = 0; radius < 12; radius++) {
    for (let y = originY - radius; y <= originY + radius; y++) {
      for (let x = originX - radius; x <= originX + radius; x++) {
        if (memory.failed.has(siteKey(kind, x, y))) continue;
        if (!footprintOk(obs, blocked, x, y, kind)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function nearestOre(obs: ObserveRequest, x: number, y: number): { id: number; x: number; y: number } | null {
  let best: { id: number; x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const node of obs.nodes) {
    if (node.kind !== 'ore') continue;
    const dist = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

function besideBuilding(obs: ObserveRequest, building: { kind: string; x: number; y: number }): { x: number; y: number } {
  if (!isBuildingKind(building.kind)) return { x: clamp(building.x), y: clamp(building.y) };
  const def = BUILDINGS[building.kind];
  const blocked = blockedCells(obs);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  const cx = building.x + def.width / 2;
  const cy = building.y + def.height / 2;
  for (let y = building.y - 2; y <= building.y + def.height + 1; y++) {
    for (let x = building.x - 2; x <= building.x + def.width + 1; x++) {
      if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) continue;
      if (x >= building.x && x < building.x + def.width && y >= building.y && y < building.y + def.height) continue;
      if (blocked.has(cellKey(x, y))) continue;
      const dx = x - MAP_SIZE / 2;
      const dy = y - MAP_SIZE / 2;
      const score = ((x - cx) ** 2 + (y - cy) ** 2) * 1000 + dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  if (best) return best;
  return { x: MAP_SIZE - 1 - building.x, y: MAP_SIZE - 1 - building.y };
}

export function decide(obs: ObserveRequest, memory: AgentMemory): Action[] {
  syncMemory(obs, memory);
  const actions: Action[] = [];
  const units = ownUnits(obs);
  const buildings = ownBuildings(obs);
  const commandCenter = buildings.find((building) => building.kind === 'command_center');
  if (!commandCenter) {
    actions.push({ type: 'noop' });
    return actions;
  }

  const engineers = units.filter((unit) => unit.kind === 'engineer');
  const rifles = units.filter((unit) => unit.kind === 'rifleman');
  const extractor = buildings.find((building) => building.kind === 'ore_extractor');
  const barracksAll = buildings.filter((building) => building.kind === 'barracks');
  const turret = buildings.find((building) => building.kind === 'defense_turret');
  const builder = engineers[0];
  const constructing = buildings.some((building) => building.kind !== 'command_center' && !ready(memory, building.id, obs.tick));
  const blocked = blockedCells(obs);
  let built = false;
  let budget = obs.ore;

  const issueBuild = (kind: BuildingKind, at: { x: number; y: number }) => {
    if (!builder || built || constructing) return;
    actions.push({
      type: 'command',
      command: { type: 'build', unitIds: [builder.id], kind, at },
    });
    memory.attempt = { kind, x: at.x, y: at.y, tick: obs.tick };
    built = true;
    budget -= BUILDINGS[kind].ore;
  };

  if (!extractor && budget >= BUILDINGS.ore_extractor.ore) {
    const ore = nearestOre(obs, commandCenter.x, commandCenter.y);
    if (ore) {
      const site = extractorSite(obs, blocked, ore.x, ore.y, memory);
      if (site) issueBuild('ore_extractor', site);
    }
  }

  if (barracksAll.length === 0 && budget >= BUILDINGS.barracks.ore) {
    const site = openSite(obs, blocked, 'barracks', commandCenter.x, commandCenter.y - 4, memory);
    if (site) issueBuild('barracks', site);
  }

  const readyBarracks = barracksAll.filter((building) => ready(memory, building.id, obs.tick));
  if (readyBarracks.length > 0 && !turret && budget >= BUILDINGS.defense_turret.ore) {
    const site = openSite(obs, blocked, 'defense_turret', commandCenter.x + 6, commandCenter.y, memory);
    if (site) issueBuild('defense_turret', site);
  }

  if (readyBarracks.length === 1 && turret && budget >= BUILDINGS.barracks.ore) {
    const site = openSite(obs, blocked, 'barracks', commandCenter.x, commandCenter.y + 5, memory);
    if (site) issueBuild('barracks', site);
  }

  if (!built && !constructing && builder && obs.tick > 0 && obs.tick % 400 === 0) {
    const ore = nearestOre(obs, commandCenter.x, commandCenter.y);
    if (ore) {
      actions.push({
        type: 'command',
        command: { type: 'gather', unitIds: [builder.id], nodeId: ore.id },
      });
    }
  }

  const reserve = barracksAll.length === 0 ? BUILDINGS.barracks.ore : 0;
  if (engineers.length < ENGINEER_CAP && budget - reserve >= UNITS.engineer.ore && ready(memory, commandCenter.id, obs.tick)) {
    actions.push({
      type: 'command',
      command: { type: 'produce', buildingId: commandCenter.id, kind: 'engineer' },
    });
    budget -= UNITS.engineer.ore;
  }

  for (const hall of readyBarracks) {
    if (rifles.length >= RIFLE_CAP || budget < UNITS.rifleman.ore) break;
    actions.push({
      type: 'command',
      command: { type: 'produce', buildingId: hall.id, kind: 'rifleman' },
    });
    budget -= UNITS.rifleman.ore;
  }

  if (rifles.length > 0) {
    const enemies = obs.units.filter((unit) => unit.owner !== obs.seat).sort((left, right) => left.id - right.id);
    const homeX = commandCenter.x + 2;
    const homeY = commandCenter.y + 2;
    let threat: (typeof enemies)[number] | null = null;
    let threatDist = HOME_THREAT_CELLS * HOME_THREAT_CELLS;
    for (const enemy of enemies) {
      const dist = (enemy.x - homeX) ** 2 + (enemy.y - homeY) ** 2;
      if (dist < threatDist) {
        threat = enemy;
        threatDist = dist;
      }
    }
    const turretReady = Boolean(turret && ready(memory, turret.id, obs.tick));
    const unitIds = rifles.map((rifle) => rifle.id);
    const standing = obs.buildings.filter((building) => building.owner !== obs.seat && !building.wreck);
    const enemyCommand = standing.find((building) => building.kind === 'command_center');
    const commandSeen = enemyCommand
      ? cellSeen(obs, enemyCommand.x, enemyCommand.y) || cellSeen(obs, enemyCommand.x + 1, enemyCommand.y + 1)
      : false;
    if (threat) {
      actions.push({ type: 'command', command: { type: 'attack', unitIds, targetId: threat.id } });
    } else if (rifles.length >= RIFLE_MARCH && (turretReady || obs.tick >= 2200) && enemyCommand && commandSeen) {
      actions.push({ type: 'command', command: { type: 'attack', unitIds, targetId: enemyCommand.id } });
    } else if (rifles.length >= RIFLE_MARCH && (turretReady || obs.tick >= 2200)) {
      const known = enemyCommand ?? standing[0];
      const to = known
        ? besideBuilding(obs, known)
        : { x: MAP_SIZE - 1 - commandCenter.x, y: MAP_SIZE - 1 - commandCenter.y };
      actions.push({ type: 'command', command: { type: 'attack_move', unitIds, to } });
    } else {
      actions.push({ type: 'command', command: { type: 'attack_move', unitIds, to: openHold(commandCenter, blocked) } });
    }
  }

  if (actions.length === 0) actions.push({ type: 'noop' });
  return actions;
}

function openHold(commandCenter: OwnBuilding, blocked: Set<string>): { x: number; y: number } {
  const candidates = [
    { x: commandCenter.x + 6, y: commandCenter.y + 1 },
    { x: commandCenter.x + 6, y: commandCenter.y },
    { x: commandCenter.x + 5, y: commandCenter.y + 2 },
    { x: commandCenter.x - 2, y: commandCenter.y + 1 },
  ];
  for (const candidate of candidates) {
    const x = clamp(candidate.x);
    const y = clamp(candidate.y);
    if (!blocked.has(cellKey(x, y))) return { x, y };
  }
  return { x: clamp(commandCenter.x + 6), y: clamp(commandCenter.y + 1) };
}

async function main(): Promise<void> {
  const reader = createJsonlReader(process.stdin);
  const writer = createJsonlWriter(process.stdout);
  const memory = createMemory();
  while (true) {
    const message = await reader.read();
    if (message === null) break;
    const request = validateObserveRequest(message);
    if (!request) {
      console.error('Invalid request received');
      continue;
    }
    const response: ActResponse = {
      schemaVersion: SCHEMA_VERSION,
      requestId: request.requestId,
      type: 'agent.act',
      actions: decide(request, memory),
    };
    await writer.write(response);
  }
}

const invoked = process.argv[1]?.endsWith('reference.ts') || process.argv[1]?.endsWith('reference.js');
if (invoked) {
  main().catch((err: unknown) => {
    console.error('Reference agent error:', err);
    process.exit(1);
  });
}
