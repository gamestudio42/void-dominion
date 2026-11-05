import { MAP_SIZE, isBuildingKind, isUnitKind } from '@void-dominion/content';
import {
  decodeRuns,
  parseCommand,
  RejectReason,
  type ClientView,
  type Command,
  type RejectReasonName,
} from '@void-dominion/simulation';

/** Bumped on any change a peer on the previous version could misread. */
export const PROTOCOL_VERSION = 1;

/** Commands are small; a guest message past this is refused before it is parsed. In characters. */
export const MAX_GUEST_MESSAGE = 8 * 1024;
/** A view of 200 riflemen a side is about 28 KB of JSON; this leaves room for several times that. */
export const MAX_HOST_MESSAGE = 256 * 1024;

const MAP_CELLS = MAP_SIZE * MAP_SIZE;

export type Side = 'host' | 'guest';

/** A command as the guest sends it. The host fills in the guest's seat; any `playerId` sent is dropped. */
export type CommandBody = Command extends infer Each ? (Each extends Command ? Omit<Each, 'playerId'> : never) : never;

export interface HelloMessage {
  t: 'hello';
  v: number;
  build: string;
}

export interface SeatedMessage {
  t: 'seated';
  v: number;
  seat: number;
  seed: number;
  tick: number;
}

export interface CommandMessage {
  t: 'cmd';
  v: number;
  seq: number;
  cmd: CommandBody;
}

export interface AckMessage {
  t: 'ack';
  v: number;
  seq: number;
  /** The tick the command was applied on: the same tick its replay entry carries. */
  tick: number;
  reason: RejectReasonName | null;
}

export interface ViewMessage {
  t: 'view';
  v: number;
  view: ClientView;
}

export interface EndMessage {
  t: 'end';
  v: number;
  winner: number;
  tick: number;
  hash: number;
  /** A version 2 replay file, for the guest's audit. */
  replay: string;
}

export interface PingMessage {
  t: 'ping' | 'pong';
  v: number;
  at: number;
}

export type GuestMessage = HelloMessage | CommandMessage | PingMessage;
export type HostMessage = SeatedMessage | AckMessage | ViewMessage | EndMessage | PingMessage;
export type Message = GuestMessage | HostMessage;

export type DecodeError = 'too_large' | 'not_json' | 'version' | 'shape' | 'direction';

export type Decoded<M> = { ok: true; message: M } | { ok: false; error: DecodeError };

/** Which messages each side may send. A message from the wrong side is refused, whatever it says. */
const SENDS: Record<Side, ReadonlySet<string>> = {
  guest: new Set(['hello', 'cmd', 'ping', 'pong']),
  host: new Set(['seated', 'ack', 'view', 'end', 'ping', 'pong']),
};

export function encode(message: Message): string {
  return JSON.stringify(message);
}

/** Read a message sent by `from`. Never throws: anything unexpected is an error value. */
export function decode(raw: string, from: 'guest'): Decoded<GuestMessage>;
export function decode(raw: string, from: 'host'): Decoded<HostMessage>;
export function decode(raw: string, from: Side): Decoded<Message> {
  if (raw.length > (from === 'guest' ? MAX_GUEST_MESSAGE : MAX_HOST_MESSAGE)) return { ok: false, error: 'too_large' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (!isRecord(value) || typeof value.t !== 'string') return { ok: false, error: 'shape' };
  if (value.v !== PROTOCOL_VERSION) return { ok: false, error: 'version' };
  if (!SENDS[from].has(value.t)) return { ok: false, error: 'direction' };
  const message = readMessage(value);
  return message ? { ok: true, message } : { ok: false, error: 'shape' };
}

/** The command a guest's body becomes on the host, owned by the guest's seat. */
export function stamp(body: CommandBody, seat: number): Command {
  return parseCommand({ ...body, playerId: seat })!;
}

function readMessage(value: Record<string, unknown>): Message | null {
  const v = PROTOCOL_VERSION;
  switch (value.t) {
    case 'hello':
      if (typeof value.build !== 'string' || value.build.length > 64) return null;
      return { t: 'hello', v, build: value.build };
    case 'seated':
      if (!isSeat(value.seat) || !isUint32(value.seed) || !isCount(value.tick)) return null;
      return { t: 'seated', v, seat: value.seat, seed: value.seed, tick: value.tick };
    case 'cmd': {
      if (!isCount(value.seq) || !isRecord(value.cmd)) return null;
      /** Validate as the engine would, with a placeholder seat; the host stamps the real one. */
      const parsed = parseCommand({ ...value.cmd, playerId: 0 });
      if (!parsed) return null;
      const { playerId: _dropped, ...body } = parsed;
      return { t: 'cmd', v, seq: value.seq, cmd: body as CommandBody };
    }
    case 'ack':
      if (!isCount(value.seq) || !isCount(value.tick)) return null;
      if (value.reason !== null && !REASONS.has(value.reason as string)) return null;
      return { t: 'ack', v, seq: value.seq, tick: value.tick, reason: value.reason as RejectReasonName | null };
    case 'view': {
      const view = readView(value.view);
      return view ? { t: 'view', v, view } : null;
    }
    case 'end':
      if (!isWinner(value.winner) || !isCount(value.tick) || !isUint32(value.hash) || typeof value.replay !== 'string') return null;
      return { t: 'end', v, winner: value.winner, tick: value.tick, hash: value.hash, replay: value.replay };
    case 'ping':
    case 'pong':
      if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
      return { t: value.t, v, at: value.at };
    default:
      return null;
  }
}

const REASONS: ReadonlySet<string> = new Set(Object.values(RejectReason));
const ORDERS: ReadonlySet<string> = new Set(['idle', 'move', 'gather', 'return', 'build', 'attack', 'attack_move']);

/**
 * The guest trusts the host's rules but not its bytes: a view that would not draw is
 * refused here instead of failing inside the renderer.
 */
function readView(value: unknown): ClientView | null {
  if (!isRecord(value) || !isSeat(value.seat) || !isCount(value.tick) || !isWinner(value.winner)) return null;
  for (const key of ['ore', 'aether', 'supplyUsed', 'supplyCap', 'powerGive', 'powerTake'] as const) {
    if (!isFinite(value[key])) return null;
  }
  if (!list(value.units, isViewUnit) || !list(value.buildings, isViewBuilding) || !list(value.memory, isGhost) || !list(value.nodes, isViewNode)) {
    return null;
  }
  if (!isRuns(value.visible)) return null;
  if (value.explored !== undefined && !isRuns(value.explored)) return null;
  return value as unknown as ClientView;
}

function isViewUnit(value: Record<string, unknown>): boolean {
  if (!isCount(value.id) || !isSeat(value.owner) || typeof value.kind !== 'string' || !isUnitKind(value.kind)) return false;
  if (!isFinite(value.x) || !isFinite(value.y) || !isFinite(value.hp) || !isCount(value.cooldown)) return false;
  if (value.order !== undefined && !ORDERS.has(value.order as string)) return false;
  return optionalFinite(value.carryOre) && optionalFinite(value.carryAether);
}

function isViewBuilding(value: Record<string, unknown>): boolean {
  if (!isCount(value.id) || !isSeat(value.owner) || typeof value.kind !== 'string' || !isBuildingKind(value.kind)) return false;
  if (!isCount(value.x) || !isCount(value.y) || !isFinite(value.hp) || !isCount(value.progress) || !isCount(value.cooldown)) return false;
  if (value.queue !== undefined && !(Array.isArray(value.queue) && value.queue.every((kind) => typeof kind === 'string' && isUnitKind(kind)))) {
    return false;
  }
  if (value.prod !== undefined && value.prod !== null && !(typeof value.prod === 'string' && isUnitKind(value.prod))) return false;
  return optionalFinite(value.prodLeft);
}

function isGhost(value: Record<string, unknown>): boolean {
  if (!isCount(value.id) || !isSeat(value.owner) || typeof value.kind !== 'string' || !isBuildingKind(value.kind)) return false;
  return isCount(value.x) && isCount(value.y) && isFinite(value.hp) && isCount(value.progress) && typeof value.wreck === 'boolean';
}

function isViewNode(value: Record<string, unknown>): boolean {
  if (!isCount(value.id) || (value.kind !== 'ore' && value.kind !== 'aether')) return false;
  return isCount(value.x) && isCount(value.y) && optionalFinite(value.amount);
}

function isRuns(value: unknown): boolean {
  return Array.isArray(value) && value.every((run) => typeof run === 'number') && decodeRuns(value as number[], MAP_CELLS) !== null;
}

function list(value: unknown, item: (entry: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && item(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalFinite(value: unknown): boolean {
  return value === undefined || isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isUint32(value: unknown): value is number {
  return isCount(value) && value <= 0xffffffff;
}

function isSeat(value: unknown): value is number {
  return value === 1 || value === 2;
}

/** 0 while playing, a seat when decided, -1 for a draw. */
function isWinner(value: unknown): value is number {
  return value === 0 || value === 1 || value === 2 || value === -1;
}
