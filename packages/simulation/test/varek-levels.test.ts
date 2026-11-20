import { ENEMY_ID, MATCH, VAREK_LEVELS } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { deserializeReplay, serializeReplay, Simulation, varekLevel, type Seats } from '../src/index.ts';

const TICKS = 3000;

function play(seats: Seats, ticks = TICKS): Simulation {
  const sim = Simulation.create(MATCH.seed, seats);
  for (let tick = 0; tick < ticks && sim.world.winner === 0; tick++) sim.step();
  return sim;
}

function count(sim: Simulation, kind: string): number {
  return [...sim.world.units, ...sim.world.buildings].filter((entry) => entry.owner === ENEMY_ID && entry.kind === kind).length;
}

describe('Varek levels', () => {
  it('maps each seat control to its level, and a human to none', () => {
    expect(varekLevel('varek_easy')).toBe('easy');
    expect(varekLevel('varek')).toBe('normal');
    expect(varekLevel('varek_hard')).toBe('hard');
    expect(varekLevel('human')).toBeNull();
  });

  it('keeps the normal plan equal to the skirmish numbers', () => {
    expect(VAREK_LEVELS.normal).toMatchObject({ armyCap: MATCH.ai.army, wave: MATCH.ai.army, marchTick: MATCH.ai.marchTick });
  });

  it('builds a larger base and army at hard than at easy', () => {
    const easy = play(['human', 'varek_easy']);
    const hard = play(['human', 'varek_hard']);
    const start = Simulation.create(MATCH.seed, ['human', 'varek_easy']);
    /** Easy never trains past the engineers the scenario gives him. */
    expect(count(easy, 'engineer')).toBeLessThanOrEqual(count(start, 'engineer'));
    expect(count(hard, 'engineer')).toBeGreaterThan(count(easy, 'engineer'));
    expect(count(hard, 'barracks')).toBe(VAREK_LEVELS.hard.barracks);
    expect(count(hard, 'power_generator')).toBe(1);
    expect(count(hard, 'rifleman')).toBeGreaterThan(count(easy, 'rifleman'));
    expect(hard.hashState()).not.toBe(play(['human', 'varek']).hashState());
  });

  it('replays a match against any level to the same checksum', () => {
    for (const seats of [['varek_hard', 'human'], ['human', 'varek_easy']] as Seats[]) {
      const sim = play(seats, 600);
      const file = deserializeReplay(serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats }));
      expect(file?.seats).toEqual(seats);
      expect(Simulation.replay(file!.commands, file!.ticks, file!).hashState()).toBe(sim.hashState());
    }
  });

  it('refuses a replay whose seat is not a known control', () => {
    for (const seat of ['varek_impossible', 'toString', 'constructor']) {
      const raw = JSON.stringify({ version: 2, seed: 1, seats: ['human', seat], ticks: 0, commands: [] });
      expect(deserializeReplay(raw)).toBeNull();
    }
  });
});
