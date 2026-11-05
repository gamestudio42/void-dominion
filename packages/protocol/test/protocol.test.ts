import { ENEMY_ID, MATCH, PLAYER_ID } from '@void-dominion/content';
import { clientView, serializeReplay, Simulation, type Seats } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import {
  auditMatch,
  COMMAND_BURST,
  CommandBudget,
  decode,
  encode,
  MAX_GUEST_MESSAGE,
  MAX_HOST_MESSAGE,
  PROTOCOL_VERSION,
  stamp,
  type AckedOrder,
  type EndMessage,
  type Message,
} from '../src/index.ts';

const v = PROTOCOL_VERSION;
const PVP: Seats = ['human', 'human'];

function guest(value: unknown) {
  return decode(JSON.stringify(value), 'guest');
}

function host(value: unknown) {
  return decode(JSON.stringify(value), 'host');
}

describe('messages', () => {
  it('round-trips every message through encode and decode', () => {
    const sim = Simulation.create();
    const fromGuest: Message[] = [
      { t: 'hello', v, build: 'abc123' },
      { t: 'cmd', v, seq: 3, cmd: { type: 'move', unitIds: [1, 2], to: { x: 30, y: 90 } } },
      { t: 'ping', v, at: 12.5 },
    ];
    const fromHost: Message[] = [
      { t: 'seated', v, seat: 2, seed: 0x5eed, tick: 0 },
      { t: 'ack', v, seq: 3, tick: 40, reason: null },
      { t: 'ack', v, seq: 4, tick: 41, reason: 'not_visible' },
      { t: 'view', v, view: clientView(sim.world, ENEMY_ID, true) },
      { t: 'end', v, winner: 1, tick: 3333, hash: 1794058122, replay: '{}' },
      { t: 'pong', v, at: 12.5 },
    ];
    for (const message of fromGuest) expect(decode(encode(message), 'guest')).toEqual({ ok: true, message });
    for (const message of fromHost) expect(decode(encode(message), 'host')).toEqual({ ok: true, message });
  });

  it('refuses another version, whatever the message says', () => {
    expect(guest({ t: 'hello', v: v + 1, build: 'x' })).toEqual({ ok: false, error: 'version' });
    expect(guest({ t: 'hello', build: 'x' })).toEqual({ ok: false, error: 'version' });
  });

  it('refuses a message from the wrong side', () => {
    expect(guest({ t: 'view', v, view: clientView(Simulation.create().world, PLAYER_ID) })).toEqual({ ok: false, error: 'direction' });
    expect(guest({ t: 'end', v, winner: 2, tick: 1, hash: 1, replay: '' })).toEqual({ ok: false, error: 'direction' });
    expect(host({ t: 'cmd', v, seq: 0, cmd: { type: 'stop', unitIds: [1] } })).toEqual({ ok: false, error: 'direction' });
  });

  it('refuses malformed and oversized input without throwing', () => {
    expect(decode('{', 'guest')).toEqual({ ok: false, error: 'not_json' });
    expect(decode('[]', 'guest')).toEqual({ ok: false, error: 'shape' });
    expect(decode('null', 'host')).toEqual({ ok: false, error: 'shape' });
    expect(guest({ t: 'teleport', v })).toEqual({ ok: false, error: 'direction' });
    expect(guest({ t: 'hello', v, build: 'x'.repeat(65) })).toEqual({ ok: false, error: 'shape' });
    expect(guest({ t: 'cmd', v, seq: -1, cmd: { type: 'stop', unitIds: [1] } })).toEqual({ ok: false, error: 'shape' });
    expect(guest({ t: 'cmd', v, seq: 0, cmd: { type: 'teleport', unitIds: [1] } })).toEqual({ ok: false, error: 'shape' });
    expect(guest({ t: 'cmd', v, seq: 0, cmd: { type: 'move', unitIds: ['1'], to: { x: 1, y: 1 } } })).toEqual({ ok: false, error: 'shape' });
    expect(host({ t: 'ack', v, seq: 1, tick: 1, reason: 'because' })).toEqual({ ok: false, error: 'shape' });
    expect(host({ t: 'seated', v, seat: 3, seed: 1, tick: 0 })).toEqual({ ok: false, error: 'shape' });
    expect(host({ t: 'end', v, winner: 7, tick: 1, hash: 1, replay: '' })).toEqual({ ok: false, error: 'shape' });
    expect(decode(' '.repeat(MAX_GUEST_MESSAGE + 1), 'guest')).toEqual({ ok: false, error: 'too_large' });
    expect(decode(' '.repeat(MAX_HOST_MESSAGE + 1), 'host')).toEqual({ ok: false, error: 'too_large' });
  });

  it('refuses a view that would not draw', () => {
    const view = clientView(Simulation.create().world, PLAYER_ID, true);
    const broken = [
      { ...view, seat: 0 },
      { ...view, visible: [1] },
      { ...view, explored: [5, 5] },
      { ...view, units: [{ ...view.units[0]!, kind: 'dragon' }] },
      { ...view, units: [{ ...view.units[0]!, x: 'left' }] },
      { ...view, buildings: [{ ...view.buildings[0]!, queue: ['dragon'] }] },
      { ...view, nodes: [{ ...view.nodes[0]!, kind: 'gold' }] },
      { ...view, ore: null },
    ];
    for (const entry of broken) expect(host({ t: 'view', v, view: entry })).toEqual({ ok: false, error: 'shape' });
  });

  it('drops the guest playerId and stamps the guest seat', () => {
    const decoded = guest({ t: 'cmd', v, seq: 0, cmd: { type: 'stop', playerId: PLAYER_ID, unitIds: [5] } });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.message.t !== 'cmd') return;
    expect('playerId' in decoded.message.cmd).toBe(false);
    expect(stamp(decoded.message.cmd, ENEMY_ID)).toEqual({ type: 'stop', playerId: ENEMY_ID, unitIds: [5] });
  });
});

describe('command budget', () => {
  it('allows a burst, then the steady rate, and drops the rest', () => {
    const budget = new CommandBudget();
    let allowed = 0;
    for (let index = 0; index < 100; index++) if (budget.take(0)) allowed += 1;
    expect(allowed).toBe(COMMAND_BURST);
    expect(budget.take(10)).toBe(false);
    expect(budget.take(60)).toBe(true);
    let second = 0;
    for (let ms = 100; ms <= 1100; ms += 10) if (budget.take(ms)) second += 1;
    expect(second).toBeLessThanOrEqual(21);
    expect(second).toBeGreaterThanOrEqual(19);
  });

  it('does not refill when the clock goes backwards', () => {
    const budget = new CommandBudget();
    for (let index = 0; index < COMMAND_BURST; index++) budget.take(1000);
    expect(budget.take(0)).toBe(false);
  });
});

describe('guest audit', () => {
  /** A short match between two people: the guest moves twice, the host once. */
  function played() {
    const sim = Simulation.create(MATCH.seed, PVP);
    const acked: AckedOrder[] = [];
    const ids = (owner: number) => sim.world.units.filter((unit) => unit.owner === owner).slice(0, 2).map((unit) => unit.id);
    for (let tick = 0; tick < 200; tick++) {
      if (tick === 10 || tick === 90) {
        const cmd = stamp({ type: 'move', unitIds: ids(ENEMY_ID), to: { x: 100, y: 40 + tick / 10 } }, ENEMY_ID);
        acked.push({ tick: sim.world.tick, cmd });
        sim.enqueue(cmd);
      }
      if (tick === 50) sim.enqueue({ type: 'move', playerId: PLAYER_ID, unitIds: ids(PLAYER_ID), to: { x: 30, y: 90 } });
      sim.step();
    }
    const end: EndMessage = {
      t: 'end',
      v,
      winner: sim.world.winner,
      tick: sim.world.tick,
      hash: sim.hashState(),
      replay: serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats }),
    };
    return { end, acked };
  }

  it('accepts an honest host', () => {
    const { end, acked } = played();
    expect(auditMatch(end, ENEMY_ID, acked)).toEqual({ ok: true });
  });

  it('catches a host that changed the result, the replay or the guest orders', () => {
    const { end, acked } = played();
    expect(auditMatch({ ...end, hash: end.hash ^ 1 }, ENEMY_ID, acked)).toEqual({ ok: false, reason: 'checksum' });
    expect(auditMatch({ ...end, winner: 1 }, ENEMY_ID, acked)).toEqual({ ok: false, reason: 'winner' });
    expect(auditMatch({ ...end, replay: 'nope' }, ENEMY_ID, acked)).toEqual({ ok: false, reason: 'replay_unreadable' });
    const file = JSON.parse(end.replay);
    expect(auditMatch({ ...end, replay: JSON.stringify({ ...file, seats: ['human', 'varek'], commands: file.commands.filter((entry: { cmd: { playerId: number } }) => entry.cmd.playerId === PLAYER_ID) }) }, ENEMY_ID, acked)).toEqual({ ok: false, reason: 'seat' });
    expect(auditMatch(end, ENEMY_ID, acked.slice(1))).toEqual({ ok: false, reason: 'extra_order' });
    expect(auditMatch(end, ENEMY_ID, [...acked, acked[0]!])).toEqual({ ok: false, reason: 'missing_order' });
    /** A replay that moved the guest's order to another tick no longer matches what was acknowledged. */
    const shifted = { ...file, commands: file.commands.map((entry: { tick: number; cmd: { playerId: number } }) => (entry.cmd.playerId === ENEMY_ID && entry.tick === 10 ? { ...entry, tick: 11 } : entry)) };
    const replayed = Simulation.replay(shifted.commands, shifted.ticks, shifted);
    expect(auditMatch({ ...end, replay: JSON.stringify(shifted), hash: replayed.hashState() }, ENEMY_ID, acked)).toEqual({ ok: false, reason: 'missing_order' });
  });
});
