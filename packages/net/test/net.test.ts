import { ENEMY_ID, PLAYER_ID } from '@void-dominion/content';
import { Simulation } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import {
  deflate,
  deriveKeys,
  fanOut,
  GuestSession,
  HostSession,
  hostMatch,
  inflate,
  joinMatch,
  matchLink,
  memoryHub,
  memoryPeers,
  newSecret,
  open,
  seal,
  secretFromLink,
  type Broker,
  type Channels,
} from '../src/index.ts';

const BASE = 'https://gamestudio42.github.io/void-dominion/';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round++) await flush();
}

/** A broker that accepts everything and delivers nothing, as a blocked one would. */
function deadBroker(): Broker {
  return { publish() {}, subscribe: () => () => {}, close() {} };
}

async function connect(): Promise<{ host: Channels; guest: Channels }> {
  const hub = memoryHub();
  const peers = memoryPeers();
  const secret = newSecret();
  const [host, guest] = await Promise.all([
    hostMatch({ secret, broker: hub.client(), peer: peers(), republishMs: 20, timeoutMs: 2000 }),
    joinMatch({ secret, broker: hub.client(), peer: peers(), timeoutMs: 2000 }),
  ]);
  return { host, guest };
}

describe('match link and sealing', () => {
  it('round-trips the secret through the link fragment', () => {
    const secret = newSecret();
    const link = matchLink(`${BASE}#old`, secret);
    expect(link.startsWith(`${BASE}#join=`)).toBe(true);
    expect(secretFromLink(link)).toEqual(secret);
    expect(secretFromLink(`${BASE}#join=short`)).toBeNull();
    expect(secretFromLink(BASE)).toBeNull();
  });

  it('opens only what this match sealed, unaltered', async () => {
    const mine = await deriveKeys(newSecret());
    const theirs = await deriveKeys(newSecret());
    expect(mine.topic).not.toBe(theirs.topic);
    const sealed = await seal(mine.key, { kind: 'offer', sdp: 'v=0' });
    expect(await open(mine.key, sealed)).toEqual({ kind: 'offer', sdp: 'v=0' });
    expect(await open(theirs.key, sealed)).toBeNull();
    const flipped = sealed.slice(0, 20) + (sealed[20] === 'A' ? 'B' : 'A') + sealed.slice(21);
    expect(await open(mine.key, flipped)).toBeNull();
    expect(await open(mine.key, '{"kind":"answer"}')).toBeNull();
    expect(sealed).not.toContain('offer');
  });

  it('keeps the secret out of the topic', async () => {
    const secret = newSecret();
    const { topic } = await deriveKeys(secret);
    expect(topic).toMatch(/^void-dominion\/v1\/[0-9a-f]{32}$/);
    expect(topic).not.toContain(matchLink('', secret).split('=')[1]);
  });
});

describe('view compression', () => {
  it('round-trips text and refuses oversized or broken input', async () => {
    const text = JSON.stringify({ units: Array.from({ length: 200 }, (_, id) => ({ id, kind: 'rifleman', x: 50.5, y: 60.5 })) });
    const packed = await deflate(text);
    expect(packed.length).toBeLessThan(text.length / 5);
    expect(await inflate(packed, text.length)).toBe(text);
    expect(await inflate(packed, text.length - 1)).toBeNull();
    expect(await inflate(new Uint8Array([1, 2, 3, 4, 5]), 1000)).toBeNull();
  });
});

describe('handshake over the broker', () => {
  it('connects a host and a guest that share the secret', async () => {
    const { host, guest } = await connect();
    const heard: string[] = [];
    guest.reliable.onMessage((data) => heard.push(String(data)));
    host.reliable.send('hello guest');
    await settle();
    expect(heard).toEqual(['hello guest']);
  });

  it('ignores a guest with another secret, and still takes the right one', async () => {
    const hub = memoryHub();
    const peers = memoryPeers();
    const secret = newSecret();
    const hosting = hostMatch({ secret, broker: hub.client(), peer: peers(), republishMs: 20, timeoutMs: 3000 });
    await expect(joinMatch({ secret: newSecret(), broker: hub.client(), peer: peers(), timeoutMs: 200 })).rejects.toThrow('timeout');
    await joinMatch({ secret, broker: hub.client(), peer: peers(), timeoutMs: 2000 });
    await expect(hosting).resolves.toBeDefined();
  });

  it('ignores noise and forged answers on the topic', async () => {
    const hub = memoryHub();
    const peers = memoryPeers();
    const secret = newSecret();
    const { topic } = await deriveKeys(secret);
    const stranger = hub.client();
    const hosting = hostMatch({ secret, broker: hub.client(), peer: peers(), republishMs: 20, timeoutMs: 3000 });
    stranger.publish(topic, 'garbage');
    stranger.publish(topic, JSON.stringify({ kind: 'answer', from: 'x', to: 'y', sdp: 'memory-answer-0' }));
    const forged = await seal((await deriveKeys(newSecret())).key, { kind: 'answer', from: 'x', to: 'y', sdp: 'z' });
    stranger.publish(topic, forged);
    await settle();
    await joinMatch({ secret, broker: hub.client(), peer: peers(), timeoutMs: 2000 });
    await expect(hosting).resolves.toBeDefined();
  });

  it('lets a guest join late, from the repeated offer', async () => {
    const hub = memoryHub();
    const peers = memoryPeers();
    const secret = newSecret();
    const hosting = hostMatch({ secret, broker: hub.client(), peer: peers(), republishMs: 20, timeoutMs: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await joinMatch({ secret, broker: hub.client(), peer: peers(), timeoutMs: 2000 });
    await expect(hosting).resolves.toBeDefined();
  });

  it('ignores an offer older than two minutes', async () => {
    const hub = memoryHub();
    const peers = memoryPeers();
    const secret = newSecret();
    const hosting = hostMatch({ secret, broker: hub.client(), peer: peers(), republishMs: 20, timeoutMs: 400, now: () => 0 });
    await expect(joinMatch({ secret, broker: hub.client(), peer: peers(), timeoutMs: 200, now: () => 3 * 60 * 1000 })).rejects.toThrow('timeout');
    await expect(hosting).rejects.toThrow('timeout');
  });

  it('starts when one of two brokers is dead on one side', async () => {
    const live = memoryHub();
    const peers = memoryPeers();
    const secret = newSecret();
    const [host] = await Promise.all([
      hostMatch({ secret, broker: fanOut([deadBroker(), live.client()]), peer: peers(), republishMs: 20, timeoutMs: 2000 }),
      joinMatch({ secret, broker: fanOut([live.client(), deadBroker()]), peer: peers(), timeoutMs: 2000 }),
    ]);
    expect(host).toBeDefined();
  });

  it('delivers a payload heard on two brokers once', async () => {
    const first = memoryHub();
    const second = memoryHub();
    const both = fanOut([first.client(), second.client()]);
    const heard: string[] = [];
    both.subscribe('t', (payload) => heard.push(payload));
    fanOut([first.client(), second.client()]).publish('t', 'once');
    await settle();
    expect(heard).toEqual(['once']);
  });
});

describe('host and guest sessions', () => {
  /** Varek drives seat 1; the guest holds seat 2 and mostly watches. */
  async function play(options: { tamperAt?: number; flood?: boolean; until?: number } = {}) {
    const { host: hostChannels, guest: guestChannels } = await connect();
    const sim = Simulation.create(0x5eed, ['varek', 'human']);
    const host = new HostSession(sim, ENEMY_ID, hostChannels, () => sim.world.tick * 50);
    const guest = new GuestSession(guestChannels, 'test');
    const acks: (string | null)[] = [];
    guest.onAck = (ack) => acks.push(ack.reason);
    await settle();
    const own = () => sim.world.units.filter((unit) => unit.owner === ENEMY_ID).slice(0, 2).map((unit) => unit.id);
    const foreign = () => sim.world.units.filter((unit) => unit.owner === PLAYER_ID).slice(0, 2).map((unit) => unit.id);
    while (sim.world.winner === 0 && sim.world.tick < (options.until ?? 6000)) {
      if (sim.world.tick === 20) guest.command({ type: 'move', unitIds: own(), to: { x: 100, y: 34 } });
      if (sim.world.tick === 40) guest.command({ type: 'move', unitIds: foreign(), to: { x: 100, y: 34 } });
      if (options.flood && sim.world.tick === 60) for (let index = 0; index < 100; index++) guest.command({ type: 'stop', unitIds: own() });
      if (sim.world.tick === options.tamperAt) {
        const center = sim.world.buildings.find((building) => building.owner === ENEMY_ID && building.kind === 'command_center')!;
        center.hp = 1;
      }
      /** Let messages through every tenth tick and around each order; views queue up in between, as on a busy tab. */
      if (sim.world.tick % 10 === 0) await settle(2);
      sim.step();
      host.afterStep();
    }
    /** Views are compressed and inflated asynchronously; wait for the last ones and the end, as a real guest would. */
    for (let round = 0; round < 100; round++) {
      const caughtUp = guest.view !== null && guest.view.tick >= sim.world.tick - 2;
      if (caughtUp && (sim.world.winner === 0 || guest.end !== null)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { sim, host, guest, acks };
  }

  it('seats the guest, streams views, acknowledges orders and passes the audit', async () => {
    const { sim, host, guest, acks } = await play();
    expect(guest.seat).toBe(ENEMY_ID);
    expect(guest.view?.seat).toBe(ENEMY_ID);
    expect(guest.view!.tick).toBeGreaterThanOrEqual(sim.world.tick - 2);
    expect(guest.explored!.some((cell) => cell === 1)).toBe(true);
    /** The second order names player 1's units, which the guest cannot see: refused like a missing unit. */
    expect(acks).toEqual([null, 'unknown_unit']);
    expect(sim.world.winner).toBe(PLAYER_ID);
    expect(guest.end?.winner).toBe(PLAYER_ID);
    expect(guest.audit).toEqual({ ok: true });
    expect([host.refused, host.dropped, guest.refused]).toEqual([0, 0, 0]);
  }, 30_000);

  it('drops a command flood past the budget', async () => {
    const { host, acks } = await play({ flood: true, until: 200 });
    expect(acks.length).toBeLessThanOrEqual(2 + 20);
    expect(host.dropped).toBeGreaterThanOrEqual(80);
  });

  it('fails the audit when the host changed the world', async () => {
    const { guest } = await play({ tamperAt: 500 });
    expect(guest.audit).toEqual({ ok: false, reason: 'checksum' });
  }, 30_000);

  /** React mounts a field twice in development: the first host session is torn down after the guest's first hello. */
  it('seats a guest whose first hello reached a host session that closed', async () => {
    const { host: hostChannels, guest: guestChannels } = await connect();
    const sim = Simulation.create(0x5eed, ['human', 'human']);
    const stale = new HostSession(sim, ENEMY_ID, hostChannels);
    const guest = new GuestSession(guestChannels, 'test');
    await settle();
    stale.close();
    const live = new HostSession(sim, ENEMY_ID, hostChannels);
    for (let round = 0; round < 40 && !guest.explored; round++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      sim.step();
      live.afterStep();
      await settle();
    }
    expect(guest.seat).toBe(ENEMY_ID);
    expect(guest.explored).not.toBeNull();
    guest.command({ type: 'stop', unitIds: [1] });
    await settle();
    sim.step();
    stale.afterStep();
    live.afterStep();
    expect(sim.log).toHaveLength(1);
    guestChannels.reliable.close();
  });

  it('counts junk from the guest without acting on it', async () => {
    const { host: hostChannels, guest: guestChannels } = await connect();
    const sim = Simulation.create(0x5eed, ['human', 'human']);
    const host = new HostSession(sim, ENEMY_ID, hostChannels);
    guestChannels.reliable.send('junk');
    guestChannels.reliable.send(JSON.stringify({ t: 'view', v: 1 }));
    guestChannels.reliable.send(new Uint8Array([1, 2, 3]));
    await settle();
    expect(host.refused).toBe(3);
    expect(sim.log).toEqual([]);
  });
});
