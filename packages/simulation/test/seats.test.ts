import { ENEMY_ID, MATCH, PLAYER_ID } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import {
  deserializeReplay,
  REPLAY_VERSION,
  runArena,
  serializeReplay,
  Simulation,
  SKIRMISH_SEATS,
  type Command,
  type Seats,
} from '../src/index.ts';

const PVP: Seats = ['human', 'human'];
const SEED = 0x51eed;

function engineers(sim: Simulation, owner: number) {
  return sim.world.units.filter((unit) => unit.owner === owner && unit.kind === 'engineer');
}

function run(sim: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) sim.step();
}

/** Both seats send their engineers to the field on tick 0 and back on tick 120. */
function scripted(sim: Simulation): void {
  const orders = (tick: number): Command[] =>
    [PLAYER_ID, ENEMY_ID].map((playerId) => ({
      type: 'move',
      playerId,
      unitIds: engineers(sim, playerId).slice(0, 2).map((unit) => unit.id),
      to: tick === 0 ? { x: 60, y: playerId === PLAYER_ID ? 70 : 58 } : MATCH.bases[playerId - 1]!.ore,
    }));
  for (let tick = 0; tick < 240; tick++) {
    if (tick === 0 || tick === 120) for (const cmd of orders(tick)) sim.enqueue(cmd);
    sim.step();
  }
}

describe('seat control', () => {
  it('keeps the skirmish as the default, with its pinned checksum', () => {
    expect(Simulation.create().seats).toEqual(SKIRMISH_SEATS);
    expect(runArena(MATCH.seed).hash).toBe(1794058122);
    /** A whole match: the same ceiling as the arena test, so a busy machine does not fail on Vitest's 5 s default. */
  }, 20_000);

  /** Starting engineers mine on their own; only Varek trains more of them. */
  const START = MATCH.bases[0]!.workers.length;

  it('leaves seat 2 to its human when Varek is off', () => {
    const pvp = Simulation.create(MATCH.seed, PVP);
    const skirmish = Simulation.create();
    run(pvp, 400);
    run(skirmish, 400);
    expect(engineers(pvp, ENEMY_ID)).toHaveLength(START);
    expect(engineers(skirmish, ENEMY_ID).length).toBeGreaterThan(START);
    expect(pvp.hashState()).not.toBe(skirmish.hashState());
  });

  it('lets Varek drive seat 1 as well', () => {
    const sim = Simulation.create(MATCH.seed, ['varek', 'human']);
    run(sim, 400);
    expect(engineers(sim, PLAYER_ID).length).toBeGreaterThan(START);
    expect(engineers(sim, ENEMY_ID)).toHaveLength(START);
  });

  it('logs every human seat and nothing Varek decides', () => {
    const pvp = Simulation.create(SEED, PVP);
    scripted(pvp);
    expect(new Set(pvp.log.map((entry) => entry.cmd.playerId))).toEqual(new Set([PLAYER_ID, ENEMY_ID]));
    const skirmish = Simulation.create(SEED);
    scripted(skirmish);
    expect(skirmish.log.every((entry) => entry.cmd.playerId === PLAYER_ID)).toBe(true);
  });

  it('keeps two matches between people in lockstep', () => {
    const left = Simulation.create(SEED, PVP);
    const right = Simulation.create(SEED, PVP);
    scripted(left);
    scripted(right);
    expect(left.hashState()).toBe(right.hashState());
  });
});

describe('replay version 2', () => {
  it('replays a match between people from its file', () => {
    const live = Simulation.create(SEED, PVP);
    scripted(live);
    const raw = serializeReplay(live.log, live.world.tick, { seed: live.world.seed, seats: live.seats });
    expect(JSON.parse(raw)).toMatchObject({ version: REPLAY_VERSION, seed: SEED, seats: PVP });
    const file = deserializeReplay(raw)!;
    expect(file).toMatchObject({ seed: SEED, seats: PVP, ticks: 240 });
    expect(Simulation.replay(file.commands, file.ticks, file).hashState()).toBe(live.hashState());
  });

  it('still reads a version 1 file as the skirmish', () => {
    const live = Simulation.create();
    live.enqueue({ type: 'move', playerId: PLAYER_ID, unitIds: engineers(live, PLAYER_ID).map((unit) => unit.id), to: { x: 30, y: 90 } });
    run(live, 100);
    const v1 = JSON.stringify({ ticks: live.world.tick, commands: live.log });
    const file = deserializeReplay(v1)!;
    expect(file).toMatchObject({ seed: MATCH.seed, seats: SKIRMISH_SEATS });
    expect(Simulation.replay(file.commands, file.ticks, file).hashState()).toBe(live.hashState());
  });

  it('refuses an order for a seat Varek drives, in either version', () => {
    const stop = { tick: 0, cmd: { type: 'stop', playerId: ENEMY_ID, unitIds: [1] } };
    expect(deserializeReplay(JSON.stringify({ ticks: 5, commands: [stop] }))).toBeNull();
    expect(deserializeReplay(serializeReplay([stop as never], 5))).toBeNull();
    expect(deserializeReplay(serializeReplay([stop as never], 5, { seed: SEED, seats: PVP }))).not.toBeNull();
  });

  it('refuses an unknown version, bad seats or a seed outside 32 bits', () => {
    const base = { version: REPLAY_VERSION, seed: SEED, seats: PVP, ticks: 1, commands: [] };
    expect(deserializeReplay(JSON.stringify(base))).not.toBeNull();
    expect(deserializeReplay(JSON.stringify({ ...base, version: 3 }))).toBeNull();
    expect(deserializeReplay(JSON.stringify({ ...base, seats: ['human'] }))).toBeNull();
    expect(deserializeReplay(JSON.stringify({ ...base, seats: ['human', 'model'] }))).toBeNull();
    expect(deserializeReplay(JSON.stringify({ ...base, seed: -1 }))).toBeNull();
    expect(deserializeReplay(JSON.stringify({ ...base, seed: 2 ** 32 }))).toBeNull();
    expect(deserializeReplay(JSON.stringify({ ...base, seed: 1.5 }))).toBeNull();
  });
});
