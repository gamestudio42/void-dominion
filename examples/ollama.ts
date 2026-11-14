#!/usr/bin/env node
/**
 * Optional language-model agent. Not used by tests or CI.
 *
 * The model sees only the authorized observation, restated as a short prompt,
 * and must answer with JSON actions. A bad or late answer becomes one noop,
 * which is still this process's own decision. The Arena fallback runs only
 * when the process misses the decision deadline or breaks the protocol.
 *
 *   ollama pull qwen2.5:1.5b
 *   OLLAMA_MODEL=qwen2.5:1.5b node --experimental-transform-types --no-warnings examples/ollama.ts
 *
 * OLLAMA_API          default http://127.0.0.1:11434
 * OLLAMA_MODEL        default qwen2.5:1.5b
 * OLLAMA_TIMEOUT_MS   default 20000. Abort and answer noop before the Arena deadline.
 * OLLAMA_TRACE        if set, append one JSON line per decision to this path.
 */

import { appendFileSync } from 'node:fs';
import { BUILDINGS, MAP_SIZE, UNITS, isBuildingKind, isUnitKind } from '../packages/content/src/index.ts';
import {
  SCHEMA_VERSION,
  createJsonlReader,
  createJsonlWriter,
  validateObserveRequest,
  type Action,
  type ObserveRequest,
} from '../packages/agent-sdk/src/index.ts';

const OLLAMA_API = process.env.OLLAMA_API ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 20_000);

export interface ModelClient {
  complete(prompt: string): Promise<string>;
}

export interface PlanMemory {
  failed: Set<string>;
  attempt: { kind: string; x: number; y: number } | null;
}

export function createPlanMemory(): PlanMemory {
  return { failed: new Set(), attempt: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function cell(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value) || !isInt(value.x) || !isInt(value.y)) return null;
  if (value.x < 0 || value.y < 0 || value.x >= MAP_SIZE || value.y >= MAP_SIZE) return null;
  return { x: value.x, y: value.y };
}

function idList(value: unknown, allowed: Set<number>): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) return null;
  const ids: number[] = [];
  for (const id of value) {
    if (!isInt(id) || !allowed.has(id)) return null;
    ids.push(id);
  }
  return ids;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const list = body.indexOf('[');
  const open = start === -1 ? list : list === -1 ? start : Math.min(start, list);
  if (open < 0) return null;
  const slice = body.slice(open);
  try {
    return JSON.parse(slice);
  } catch {
    const end = Math.max(slice.lastIndexOf('}'), slice.lastIndexOf(']'));
    if (end <= 0) return null;
    try {
      return JSON.parse(slice.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}

interface Allowed {
  units: Set<number>;
  buildings: Set<number>;
  nodes: Set<number>;
  enemies: Set<number>;
}

function allowedIds(obs: ObserveRequest): Allowed {
  const units = new Set<number>();
  const buildings = new Set<number>();
  const nodes = new Set<number>();
  const enemies = new Set<number>();
  for (const unit of obs.units) {
    if (unit.owner === obs.seat) units.add(unit.id);
    else enemies.add(unit.id);
  }
  for (const building of obs.buildings) {
    if (building.owner === obs.seat && !building.wreck) buildings.add(building.id);
    else enemies.add(building.id);
  }
  for (const node of obs.nodes) nodes.add(node.id);
  return { units, buildings, nodes, enemies };
}

function commandFrom(value: Record<string, unknown>, allowed: Allowed): Action | null {
  const type = value.type;
  if (type === 'gather') {
    const unitIds = idList(value.unitIds, allowed.units);
    if (!unitIds || !isInt(value.nodeId) || !allowed.nodes.has(value.nodeId)) return null;
    return { type: 'command', command: { type: 'gather', unitIds, nodeId: value.nodeId } };
  }
  if (type === 'build') {
    const unitIds = idList(value.unitIds, allowed.units);
    const at = cell(value.at);
    if (!unitIds || !at || typeof value.kind !== 'string' || !isBuildingKind(value.kind)) return null;
    return { type: 'command', command: { type: 'build', unitIds, kind: value.kind, at } };
  }
  if (type === 'produce') {
    if (!isInt(value.buildingId) || !allowed.buildings.has(value.buildingId)) return null;
    if (typeof value.kind !== 'string' || !isUnitKind(value.kind)) return null;
    return { type: 'command', command: { type: 'produce', buildingId: value.buildingId, kind: value.kind } };
  }
  if (type === 'attack_move' || type === 'move') {
    const unitIds = idList(value.unitIds, allowed.units);
    const to = cell(value.to);
    if (!unitIds || !to) return null;
    return { type: 'command', command: { type, unitIds, to } };
  }
  if (type === 'attack') {
    const unitIds = idList(value.unitIds, allowed.units);
    if (!unitIds || !isInt(value.targetId) || !allowed.enemies.has(value.targetId)) return null;
    return { type: 'command', command: { type: 'attack', unitIds, targetId: value.targetId } };
  }
  if (type === 'stop') {
    const unitIds = idList(value.unitIds, allowed.units);
    if (!unitIds) return null;
    return { type: 'command', command: { type: 'stop', unitIds } };
  }
  return null;
}

function oneAction(value: unknown, allowed: Allowed): Action | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'noop') return { type: 'noop' };
  if (value.type === 'command' && isRecord(value.command)) return commandFrom(value.command, allowed);
  return commandFrom(value, allowed);
}

const VERBS = ['gather', 'build_extractor', 'build_barracks', 'produce_rifle', 'produce_engineer', 'attack', 'noop'] as const;
type Verb = (typeof VERBS)[number];

function verbOf(value: unknown): Verb | null {
  if (!isRecord(value)) return null;
  const name = value.action ?? value.type;
  if (typeof name !== 'string') return null;
  return VERBS.find((verb) => verb === name) ?? null;
}

function engineers(obs: ObserveRequest): number[] {
  return obs.units
    .filter((unit) => unit.owner === obs.seat && unit.kind === 'engineer')
    .map((unit) => unit.id)
    .sort((left, right) => left - right);
}

function rifles(obs: ObserveRequest): number[] {
  return obs.units
    .filter((unit) => unit.owner === obs.seat && unit.kind === 'rifleman')
    .map((unit) => unit.id)
    .sort((left, right) => left - right);
}

function ownBuilding(obs: ObserveRequest, kind: string): { id: number; x: number; y: number } | null {
  const building = obs.buildings.find((entry) => entry.owner === obs.seat && !entry.wreck && entry.kind === kind);
  return building ? { id: building.id, x: building.x, y: building.y } : null;
}

function rememberAttempt(memory: PlanMemory | undefined, kind: string, at: { x: number; y: number }): void {
  if (!memory) return;
  memory.attempt = { kind, x: at.x, y: at.y };
}

/** A previous build that never appeared was rejected. Skip that cell next time. */
export function noteBuildResult(obs: ObserveRequest, memory: PlanMemory): void {
  const attempt = memory.attempt;
  if (!attempt) return;
  const found = obs.buildings.some(
    (building) =>
      building.owner === obs.seat && !building.wreck && building.kind === attempt.kind && building.x === attempt.x && building.y === attempt.y,
  );
  if (!found) memory.failed.add(`${attempt.kind}:${attempt.x},${attempt.y}`);
  memory.attempt = null;
}

function extractorSites(x: number, y: number): { x: number; y: number }[] {
  const width = BUILDINGS.ore_extractor.width;
  const height = BUILDINGS.ore_extractor.height;
  const sites: { x: number; y: number }[] = [];
  for (let sy = y - height; sy <= y + 1; sy++) {
    for (let sx = x - width; sx <= x + 1; sx++) {
      const inside = x >= sx && x < sx + width && y >= sy && y < sy + height;
      const near = x >= sx - 1 && x <= sx + width && y >= sy - 1 && y <= sy + height;
      if (!near || inside) continue;
      if (sx < 0 || sy < 0 || sx + width > MAP_SIZE || sy + height > MAP_SIZE) continue;
      sites.push({ x: sx, y: sy });
    }
  }
  return sites;
}

/** Bind a verb the model chose to ids that are actually in this observation. */
export function groundVerb(obs: ObserveRequest, verb: Verb, memory?: PlanMemory): Action[] {
  const workers = engineers(obs);
  const ore = nearestOre(obs);
  const hall = ownBuilding(obs, 'barracks');
  const center = ownBuilding(obs, 'command_center');
  const soldiers = rifles(obs);
  if (verb === 'gather' && workers.length > 0 && ore) {
    return [{ type: 'command', command: { type: 'gather', unitIds: workers.slice(0, 3), nodeId: ore.id } }];
  }
  if (verb === 'build_extractor' && workers.length > 0 && ore) {
    const site = extractorSites(ore.x, ore.y).find((candidate) => !memory?.failed.has(`ore_extractor:${candidate.x},${candidate.y}`));
    if (!site) return [{ type: 'noop' }];
    rememberAttempt(memory, 'ore_extractor', site);
    return [{ type: 'command', command: { type: 'build', unitIds: [workers[0]!], kind: 'ore_extractor', at: site } }];
  }
  if (verb === 'build_barracks' && workers.length > 0 && center) {
    const candidates = [
      { x: center.x, y: center.y >= 6 ? center.y - 4 : center.y + 5 },
      { x: center.x + 4, y: center.y },
      { x: center.x, y: center.y + 5 },
      { x: center.x - 4, y: center.y },
    ];
    const site = candidates.find(
      (candidate) =>
        candidate.x >= 0 &&
        candidate.y >= 0 &&
        candidate.x + BUILDINGS.barracks.width <= MAP_SIZE &&
        candidate.y + BUILDINGS.barracks.height <= MAP_SIZE &&
        !memory?.failed.has(`barracks:${candidate.x},${candidate.y}`),
    );
    if (!site) return [{ type: 'noop' }];
    rememberAttempt(memory, 'barracks', site);
    return [{ type: 'command', command: { type: 'build', unitIds: [workers[0]!], kind: 'barracks', at: site } }];
  }
  if (verb === 'produce_rifle' && hall) {
    return [{ type: 'command', command: { type: 'produce', buildingId: hall.id, kind: 'rifleman' } }];
  }
  if (verb === 'produce_engineer' && center) {
    return [{ type: 'command', command: { type: 'produce', buildingId: center.id, kind: 'engineer' } }];
  }
  if (verb === 'attack' && soldiers.length > 0) {
    const enemy = obs.buildings.find((building) => building.owner !== obs.seat && !building.wreck && building.kind === 'command_center');
    const to = enemy
      ? { x: Math.min(MAP_SIZE - 1, enemy.x + 5), y: enemy.y }
      : center
        ? { x: MAP_SIZE - 1 - center.x, y: MAP_SIZE - 1 - center.y }
        : { x: 64, y: 64 };
    return [{ type: 'command', command: { type: 'attack_move', unitIds: soldiers, to } }];
  }
  return [{ type: 'noop' }];
}

/** Turn model text into protocol actions. Unknown ids and shapes are dropped. */
export function actionsFromModelText(text: string, obs: ObserveRequest, memory?: PlanMemory): Action[] {
  const parsed = extractJson(text);
  if (parsed === null) return [];
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.actions)
      ? parsed.actions
      : [parsed];
  const allowed = allowedIds(obs);
  const actions: Action[] = [];
  for (const item of raw) {
    const verb = verbOf(item);
    if (verb && verb !== 'noop') return groundVerb(obs, verb, memory);
    const action = oneAction(item, allowed);
    if (!action || action.type === 'noop') continue;
    actions.push(action);
    if (actions.length >= 3) break;
  }
  if (actions.length > 0) return actions;
  const verb = isRecord(parsed) ? verbOf(parsed) : null;
  if (verb) return groundVerb(obs, verb, memory);
  return [];
}

function listUnits(obs: ObserveRequest, kind: string): string {
  const rows = obs.units
    .filter((unit) => unit.owner === obs.seat && unit.kind === kind)
    .sort((left, right) => left.id - right.id)
    .slice(0, 8)
    .map((unit) => `${unit.id}@${Math.floor(unit.x)},${Math.floor(unit.y)}`);
  return rows.length > 0 ? rows.join(' ') : 'none';
}

function listBuildings(obs: ObserveRequest): string {
  const rows = obs.buildings
    .filter((building) => !building.wreck)
    .sort((left, right) => left.id - right.id)
    .slice(0, 8)
    .map((building) => `${building.owner === obs.seat ? 'own' : 'enemy'} ${building.kind}#${building.id}@${building.x},${building.y}`);
  return rows.length > 0 ? rows.join('; ') : 'none';
}

function nearestOre(obs: ObserveRequest): { id: number; x: number; y: number } | null {
  const home = obs.buildings.find((building) => building.owner === obs.seat && building.kind === 'command_center' && !building.wreck);
  const originX = home?.x ?? 0;
  const originY = home?.y ?? 0;
  let best: { id: number; x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const node of obs.nodes) {
    if (node.kind !== 'ore') continue;
    const dist = (node.x - originX) ** 2 + (node.y - originY) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

/** One 2x2 site that touches the ore cell. A hint for the prompt, not a command. */
function extractorHint(x: number, y: number): string {
  const width = BUILDINGS.ore_extractor.width;
  const height = BUILDINGS.ore_extractor.height;
  for (let sy = y - height; sy <= y + 1; sy++) {
    for (let sx = x - width; sx <= x + 1; sx++) {
      const inside = x >= sx && x < sx + width && y >= sy && y < sy + height;
      const near = x >= sx - 1 && x <= sx + width && y >= sy - 1 && y <= sy + height;
      if (!near || inside) continue;
      if (sx < 0 || sy < 0 || sx + width > MAP_SIZE || sy + height > MAP_SIZE) continue;
      return `${sx},${sy}`;
    }
  }
  return `${x},${y}`;
}

/** Short restatement of the observation plus the action grammar. */
export function buildPrompt(obs: ObserveRequest): string {
  const ore = nearestOre(obs);
  const home = obs.buildings.find((building) => building.owner === obs.seat && building.kind === 'command_center' && !building.wreck);
  const far = home ? `${MAP_SIZE - 1 - home.x},${MAP_SIZE - 1 - home.y}` : '64,64';
  return [
    `Seat ${obs.seat} tick ${obs.tick}. Ore ${obs.ore}. Aether ${obs.aether}.`,
    `Engineers: ${listUnits(obs, 'engineer')}`,
    `Buildings: ${listBuildings(obs)}`,
    ore ? `Nearest ore node #${ore.id} at ${ore.x},${ore.y}. Extractor hint ${extractorHint(ore.x, ore.y)} (costs ${BUILDINGS.ore_extractor.ore}).` : 'No ore node.',
    `Barracks cost ${BUILDINGS.barracks.ore}. Rifleman cost ${UNITS.rifleman.ore}. Engineer cost ${UNITS.engineer.ore}.`,
    `Riflemen: ${listUnits(obs, 'rifleman')}. Far corner ${far}.`,
    `Choices: ${choices(obs).join('|')}.`,
    `Prefer ${preference(obs)}.`,
    'Reply with JSON only: {"action":"<one choice>"}',
  ].join('\n');
}

function choices(obs: ObserveRequest): string[] {
  const open: string[] = [];
  if (engineers(obs).length > 0 && nearestOre(obs) && !ownBuilding(obs, 'ore_extractor')) open.push('build_extractor');
  if (engineers(obs).length > 0 && !ownBuilding(obs, 'barracks')) open.push('build_barracks');
  if (ownBuilding(obs, 'barracks')) open.push('produce_rifle');
  if (rifles(obs).length > 0) open.push('attack');
  if (engineers(obs).length > 0 && nearestOre(obs)) open.push('gather');
  open.push('noop');
  return open;
}

function preference(obs: ObserveRequest): string {
  if (!ownBuilding(obs, 'ore_extractor') && obs.ore >= BUILDINGS.ore_extractor.ore && choices(obs).includes('build_extractor')) {
    return 'build_extractor';
  }
  if (!ownBuilding(obs, 'barracks') && obs.ore >= BUILDINGS.barracks.ore && choices(obs).includes('build_barracks')) {
    return 'build_barracks';
  }
  if (ownBuilding(obs, 'barracks') && rifles(obs).length < 8 && obs.ore >= UNITS.rifleman.ore) return 'produce_rifle';
  if (rifles(obs).length >= 4) return 'attack';
  if (choices(obs).includes('gather')) return 'gather';
  return 'noop';
}

export async function decide(obs: ObserveRequest, client: ModelClient, memory: PlanMemory = createPlanMemory()): Promise<Action[]> {
  noteBuildResult(obs, memory);
  let actions: Action[] = [{ type: 'noop' }];
  try {
    const text = await client.complete(buildPrompt(obs));
    const parsed = actionsFromModelText(text, obs, memory);
    if (parsed.length > 0) actions = parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`model decision failed: ${message}`);
  }
  const trace = process.env.OLLAMA_TRACE;
  if (trace) {
    appendFileSync(
      trace,
      `${JSON.stringify({ tick: obs.tick, actions: actions.map((action) => (action.type === 'command' ? action.command.type : action.type)) })}\n`,
    );
  }
  return actions;
}

export function ollamaClient(timeoutMs = OLLAMA_TIMEOUT_MS): ModelClient {
  return {
    async complete(prompt: string): Promise<string> {
      const response = await fetch(`${OLLAMA_API}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          system: 'You output one JSON object and nothing else.',
          stream: false,
          format: 'json',
          keep_alive: '30m',
          options: { temperature: 0, seed: 1, num_predict: 32 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      const data = (await response.json()) as { response?: string };
      if (typeof data.response !== 'string') throw new Error('Ollama API returned no response text');
      return data.response;
    },
  };
}

async function main(): Promise<void> {
  const reader = createJsonlReader(process.stdin);
  const writer = createJsonlWriter(process.stdout);
  const client = ollamaClient();
  const memory = createPlanMemory();
  while (true) {
    const message = await reader.read();
    if (message === null) break;
    const request = validateObserveRequest(message);
    if (!request) {
      console.error('Invalid request received');
      continue;
    }
    const actions = await decide(request, client, memory);
    await writer.write({
      schemaVersion: SCHEMA_VERSION,
      requestId: request.requestId,
      type: 'agent.act',
      actions,
    });
  }
}

const invoked = process.argv[1]?.endsWith('ollama.ts') || process.argv[1]?.endsWith('ollama.js');
if (invoked) {
  main().catch((err: unknown) => {
    console.error('Ollama agent error:', err);
    process.exit(1);
  });
}
