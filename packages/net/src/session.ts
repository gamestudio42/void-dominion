import { MAP_SIZE } from '@void-dominion/content';
import {
  auditMatch,
  CommandBudget,
  decode,
  encode,
  MAX_HOST_MESSAGE,
  PROTOCOL_VERSION,
  stamp,
  type AckedOrder,
  type AckMessage,
  type Audit,
  type CommandBody,
  type EndMessage,
  type HostMessage,
} from '@void-dominion/protocol';
import { clientView, decodeRuns, serializeReplay, type ClientView, type Simulation } from '@void-dominion/simulation';
import { deflate, inflate } from './compress.ts';
import type { Channels } from './peer.ts';

const v = PROTOCOL_VERSION;
const HELLO_MS = 1000;
const CELLS = MAP_SIZE * MAP_SIZE;

interface Pending {
  seq: number;
  /** The number `Simulation.enqueue` returned, to read its result after the step. */
  queued: number;
  tick: number;
}

/**
 * The host's half of a match. Commands from the guest are stamped with its seat and
 * queued for the next step; after each step the host acknowledges them with their
 * results and, every second tick, sends the guest a compressed view. The first view, and
 * the one after a new `hello`, is full and goes on the reliable channel.
 */
export class HostSession {
  /** Guest messages refused by `decode` or past the command budget. */
  refused = 0;
  dropped = 0;
  private readonly budget = new CommandBudget();
  private pending: Pending[] = [];
  private seated = false;
  private wantFull = false;
  private ended = false;
  /** Entities in the last view sent, to tell the guest which of them died. */
  private lastSent = new Set<number>();
  private readonly detach: () => void;

  constructor(
    private readonly sim: Simulation,
    private readonly seat: number,
    private readonly channels: Channels,
    private readonly now: () => number = Date.now,
  ) {
    this.detach = channels.reliable.onMessage((data) => {
      if (typeof data === 'string') this.receive(data);
      else this.refused += 1;
    });
  }

  /** Stop listening. A field that is torn down must not keep queueing the guest's commands. */
  close(): void {
    this.detach();
  }

  /** Call after every `sim.step()`. */
  afterStep(): void {
    const { world } = this.sim;
    for (const entry of this.pending) {
      const ack: AckMessage = { t: 'ack', v, seq: entry.seq, tick: entry.tick, reason: this.sim.results.get(entry.queued) ?? null };
      this.channels.reliable.send(encode(ack));
    }
    this.pending = [];
    if (!this.seated) return;
    if (this.wantFull) {
      this.wantFull = false;
      this.sendView(true);
    } else if (world.tick % 2 === 0) this.sendView(false);
    if (world.winner !== 0 && !this.ended) {
      this.ended = true;
      const end: EndMessage = {
        t: 'end',
        v,
        winner: world.winner,
        tick: world.tick,
        hash: this.sim.hashState(),
        replay: serializeReplay(this.sim.log, world.tick, { seed: world.seed, seats: this.sim.seats }),
      };
      this.channels.reliable.send(encode(end));
    }
  }

  private receive(raw: string): void {
    const decoded = decode(raw, 'guest');
    if (!decoded.ok) {
      this.refused += 1;
      return;
    }
    const message = decoded.message;
    if (message.t === 'hello') {
      this.seated = true;
      this.wantFull = true;
      this.channels.reliable.send(encode({ t: 'seated', v, seat: this.seat, seed: this.sim.world.seed, tick: this.sim.world.tick }));
    } else if (message.t === 'cmd') {
      if (!this.seated || this.ended || !this.budget.take(this.now())) {
        this.dropped += 1;
        return;
      }
      const queued = this.sim.enqueue(stamp(message.cmd, this.seat));
      this.pending.push({ seq: message.seq, queued, tick: this.sim.world.tick });
    } else if (message.t === 'ping') {
      this.channels.reliable.send(encode({ t: 'pong', v, at: message.at }));
    }
  }

  private sendView(full: boolean): void {
    const view = clientView(this.sim.world, this.seat, full);
    const { world } = this.sim;
    const alive = new Set<number>();
    for (const unit of world.units) alive.add(unit.id);
    for (const building of world.buildings) alive.add(building.id);
    const dead = [...this.lastSent].filter((id) => !alive.has(id));
    if (dead.length > 0) view.dead = dead;
    this.lastSent = new Set([...view.units.map((unit) => unit.id), ...view.buildings.map((building) => building.id)]);
    const text = encode({ t: 'view', v, view });
    const channel = full ? this.channels.reliable : this.channels.views;
    void deflate(text).then((bytes) => channel.send(bytes));
  }
}

/**
 * The guest's half. It keeps the newest view, adds every visible grid to its explored
 * grid, records what the host acknowledged, and audits the host's replay at the end.
 */
export class GuestSession {
  seat = 0;
  seed = 0;
  view: ClientView | null = null;
  explored: Uint8Array | null = null;
  audit: Audit | null = null;
  end: EndMessage | null = null;
  refused = 0;
  /** Round trip of the latest answered ping, in milliseconds. */
  latency: number | null = null;
  onView: (view: ClientView) => void = () => {};
  onAck: (ack: AckMessage) => void = () => {};
  onEnd: (end: EndMessage, audit: Audit) => void = () => {};
  private seq = 0;
  private readonly sent = new Map<number, CommandBody>();
  /** `hello` repeats until a full view arrives: an early one can reach a host session that is torn down before it streams. */
  private hello: ReturnType<typeof setInterval> | null = null;
  private readonly acked: AckedOrder[] = [];

  constructor(
    private readonly channels: Channels,
    build = 'dev',
    private readonly now: () => number = () => performance.now(),
  ) {
    channels.reliable.onMessage((data) => void this.receive(data));
    channels.views.onMessage((data) => void this.receive(data));
    const hello = encode({ t: 'hello', v, build });
    channels.reliable.send(hello);
    this.hello = setInterval(() => channels.reliable.send(hello), HELLO_MS);
    channels.reliable.onClose(() => this.stopHello());
  }

  private stopHello(): void {
    if (this.hello !== null) clearInterval(this.hello);
    this.hello = null;
  }

  /** Send an order. The marker can show at once; the ack says whether it held. */
  command(body: CommandBody): number {
    const seq = this.seq++;
    this.sent.set(seq, body);
    this.channels.reliable.send(encode({ t: 'cmd', v, seq, cmd: body }));
    return seq;
  }

  /** Called when the reliable channel to the host closes. */
  onClose(handler: () => void): void {
    this.channels.reliable.onClose(handler);
  }

  /** Ask the host for a pong; `latency` updates when it comes back. */
  ping(nowMs: number): void {
    this.channels.reliable.send(encode({ t: 'ping', v, at: nowMs }));
  }

  private async receive(data: string | Uint8Array): Promise<void> {
    const text = typeof data === 'string' ? data : await inflate(data, MAX_HOST_MESSAGE);
    if (text === null) {
      this.refused += 1;
      return;
    }
    const decoded = decode(text, 'host');
    if (!decoded.ok) {
      this.refused += 1;
      return;
    }
    this.handle(decoded.message);
  }

  private handle(message: HostMessage): void {
    if (message.t === 'seated') {
      this.seat = message.seat;
      this.seed = message.seed;
    } else if (message.t === 'view') {
      const { view } = message;
      if (view.seat !== this.seat) {
        this.refused += 1;
        return;
      }
      if (view.explored) {
        this.explored = decodeRuns(view.explored, CELLS);
        /** A full view means a live host session has seated this guest, so `hello` can stop. */
        this.stopHello();
      }
      /** A view on the unordered channel can arrive after a newer one. */
      if (this.view && view.tick < this.view.tick) return;
      if (this.explored) {
        const visible = decodeRuns(view.visible, CELLS)!;
        for (let cell = 0; cell < CELLS; cell++) if (visible[cell]) this.explored[cell] = 1;
      }
      this.view = view;
      this.onView(view);
    } else if (message.t === 'ack') {
      const body = this.sent.get(message.seq);
      if (!body) {
        this.refused += 1;
        return;
      }
      this.sent.delete(message.seq);
      this.acked.push({ tick: message.tick, cmd: stamp(body, this.seat) });
      this.onAck(message);
    } else if (message.t === 'pong') {
      this.latency = Math.max(0, this.now() - message.at);
    } else if (message.t === 'end') {
      this.end = message;
      this.audit = auditMatch(message, this.seat, this.acked);
      this.onEnd(message, this.audit);
    }
  }
}
