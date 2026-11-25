import { UNITS } from '@void-dominion/content';
import { FIXED_DT } from '@void-dominion/kernel';
import { clientView, makeBuilding, rebake, Simulation } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { createMirror } from '../../../apps/game/src/mirror.ts';
import { productionCard, SessionClock } from '../../../apps/game/src/session-ui.ts';

describe('local session clock', () => {
  it('preserves state while paused and resumes without accumulating paused wall time', () => {
    const clock = new SessionClock(true);
    const actual = Simulation.create();
    const reference = Simulation.create();
    const advance = (seconds: number) => {
      const frame = clock.advance(seconds, true);
      for (let n = 0; n < frame.steps; n++) actual.step();
      return frame.steps;
    };
    advance(FIXED_DT / 2);
    const before = actual.hashState();
    clock.toggle();
    expect(advance(3600)).toBe(0);
    expect(actual.hashState()).toBe(before);
    clock.toggle();
    expect(advance(FIXED_DT / 2)).toBe(1);
    reference.step();
    expect(actual.hashState()).toBe(reference.hashState());
  });

  it('does not introduce a local pause in host, guest or replay clocks', () => {
    const clock = new SessionClock(false);
    clock.toggle();
    expect(clock.paused).toBe(false);
    expect(clock.advance(FIXED_DT, true).steps).toBe(1);
    expect(clock.advance(30, false).steps).toBe(0);
  });

  it('resets a paused session without carrying time into a new match', () => {
    const clock = new SessionClock(true);
    clock.advance(FIXED_DT / 2, true);
    clock.toggle();
    clock.reset();
    expect(clock.paused).toBe(false);
    expect(clock.advance(FIXED_DT / 2, true).steps).toBe(0);
  });
});

function producing() {
  const sim = Simulation.create(undefined, ['human', 'human']);
  sim.world.players[0]!.ore = 500;
  const hall = sim.world.buildings.find((building) => building.owner === 1)!;
  for (let n = 0; n < 3; n++) sim.enqueue({ type: 'produce', playerId: 1, buildingId: hall.id, kind: 'engineer' });
  sim.step();
  return { sim, hall };
}

describe('production presentation', () => {
  it('reads the current job and waiting jobs without changing the world', () => {
    const { sim, hall } = producing();
    const before = sim.hashState();
    expect(productionCard(sim.world, hall, 1)).toMatchObject({
      construction: 100, available: true, powerShort: false,
      current: { kind: 'engineer', seconds: 4, percent: 1 }, queue: ['engineer', 'engineer'],
    });
    expect(sim.hashState()).toBe(before);
    for (let n = 0; n < UNITS.engineer.trainTicks; n++) sim.step();
    expect(productionCard(sim.world, hall, 1)?.queue).toEqual(['engineer']);
  });

  it('shows the same own production through a multiplayer mirror and omits foreign jobs', () => {
    const { sim, hall } = producing();
    const mirror = createMirror(sim.world.seed, 1);
    mirror.apply(clientView(sim.world, 1, true), sim.world.explored[0]!);
    const mirroredHall = mirror.world.buildings.find((building) => building.id === hall.id)!;
    expect(productionCard(mirror.world, mirroredHall, 1)).toEqual(productionCard(sim.world, hall, 1));
    expect(productionCard(sim.world, hall, 2)).toBeNull();
  });

  it('shows power starvation while the engine holds the production timer', () => {
    const { sim, hall } = producing();
    for (let n = 0; n < 7; n++) sim.world.buildings.push(makeBuilding(sim.world, 1, 'defense_turret', 30 + n * 3, 80, true));
    rebake(sim.world);
    const left = hall.prodLeft;
    sim.step();
    expect(hall.prodLeft).toBe(left);
    expect(productionCard(sim.world, hall, 1)?.powerShort).toBe(true);
  });

  it('distinguishes construction from a completed idle production building', () => {
    const sim = Simulation.create();
    const building = makeBuilding(sim.world, 1, 'barracks', 20, 90, false);
    const card = productionCard(sim.world, building, 1)!;
    expect(card.available).toBe(false);
    expect(card.construction).toBeLessThan(100);
    const complete = sim.world.buildings.find((entry) => entry.owner === 1)!;
    expect(productionCard(sim.world, complete, 1)).toMatchObject({ available: true, current: null, queue: [] });
  });
});
