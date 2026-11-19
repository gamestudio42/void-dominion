import { MAP_SIZE, MATCH, buildingDef } from '@void-dominion/content';
import { Simulation, makeBuilding } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { CommanderAdapter, buildObservation } from '../src/index.ts';

describe('CommanderAdapter', () => {
  it('applies a noop without changing state before step', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const adapter = new CommanderAdapter(sim, 1);
    const before = sim.hashState();
    const result = adapter.applyAction({ type: 'noop' });
    expect(result).toBeNull();
    expect(sim.hashState()).toBe(before);
  });

  it('applies a strategic plan to move units', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const adapter = new CommanderAdapter(sim, 1);
    const units = sim.world.units.filter((u) => u.owner === 1).slice(0, 2);
    const result = adapter.applyAction({
      type: 'strategic_plan',
      plan: {
        type: 'group',
        unitIds: units.map((u) => u.id),
        to: { x: 50, y: 50 },
      },
    });
    expect(result).toBeNull();
    sim.step();
    expect(sim.world.units.find((u) => u.id === units[0]!.id)?.waypoints.length).toBeGreaterThan(0);
  });

  it('injects the correct seat playerId for commands', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const adapter = new CommanderAdapter(sim, 2);
    const units = sim.world.units.filter((u) => u.owner === 2).slice(0, 2);
    adapter.applyAction({
      type: 'command',
      command: {
        type: 'move',
        unitIds: units.map((u) => u.id),
        to: { x: 50, y: 50 },
      },
    });
    sim.step();
    expect(sim.log[0]?.cmd.playerId).toBe(2);
  });

  it('refuses to produce an invalid unit kind', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const adapter = new CommanderAdapter(sim, 1);
    const building = sim.world.buildings.find((b) => b.owner === 1);
    const result = adapter.applyAction({
      type: 'strategic_plan',
      plan: {
        type: 'produce',
        buildingId: building!.id,
        kind: 'invalid_kind',
      },
    });
    expect(result).toBe('cannot_produce');
  });

  it('reports accepted and refused actions after the step that applied them', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const adapter = new CommanderAdapter(sim, 1);
    const own = sim.world.units.filter((u) => u.owner === 1).slice(0, 1);
    const enemy = sim.world.units.find((u) => u.owner === 2)!;
    const cc = sim.world.buildings.find((b) => b.owner === 1 && b.kind === 'command_center')!;
    expect(adapter.lastDecision()).toBeNull();
    adapter.beginDecision('tick-0', false);
    adapter.applyAction({ type: 'noop' });
    adapter.applyAction({ type: 'command', command: { type: 'move', unitIds: own.map((u) => u.id), to: { x: 50, y: 50 } } });
    adapter.applyAction({ type: 'command', command: { type: 'move', unitIds: [enemy.id], to: { x: 50, y: 50 } } });
    adapter.applyAction({ type: 'strategic_plan', plan: { type: 'produce', buildingId: cc.id, kind: 'invalid_kind' } });
    sim.step();
    adapter.settle();
    expect(adapter.lastDecision()).toEqual({
      requestId: 'tick-0',
      fallback: false,
      results: [
        { index: 0, accepted: true },
        { index: 1, accepted: true },
        { index: 2, accepted: false, reason: 'unknown_unit' },
        { index: 3, accepted: false, reason: 'cannot_produce' },
      ],
    });
    const observation = buildObservation(sim, 1, 'tick-1', adapter.lastDecision());
    expect(observation.lastDecision?.results[2]?.reason).toBe('unknown_unit');
    /** Settling again without a new decision keeps the same feedback. */
    sim.step();
    adapter.settle();
    expect(adapter.lastDecision()?.results).toHaveLength(4);
  });

  it('does not change the checksum by recording feedback', () => {
    const plain = Simulation.create(MATCH.seed, ['human', 'human']);
    const watched = Simulation.create(MATCH.seed, ['human', 'human']);
    const adapter = new CommanderAdapter(watched, 1);
    adapter.beginDecision('tick-0', true);
    adapter.applyAction({ type: 'noop' });
    plain.step();
    watched.step();
    adapter.settle();
    expect(watched.hashState()).toBe(plain.hashState());
    expect(adapter.lastDecision()?.fallback).toBe(true);
  });
});

describe('buildObservation', () => {
  it('tells the seat its supply, power, orders, cargo and own production', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    for (let tick = 0; tick < 60; tick++) sim.step();
    const observation = buildObservation(sim, 1, 'tick-60');
    expect(observation.supplyCap).toBeGreaterThan(0);
    expect(observation.supplyUsed).toBeGreaterThan(0);
    expect(typeof observation.powerGive).toBe('number');
    const engineer = observation.units.find((u) => u.owner === 1 && u.kind === 'engineer')!;
    expect(engineer.order).toBeDefined();
    expect(typeof engineer.carryOre).toBe('number');
    const cc = observation.buildings.find((b) => b.owner === 1 && b.kind === 'command_center')!;
    expect(cc).toMatchObject({ complete: true, progress: 1, producing: null, queue: [] });
  });

  it('marks a site in progress as unfinished', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const site = makeBuilding(sim.world, 1, 'barracks', 30, 90, false);
    site.progress = Math.floor(buildingDef('barracks').buildTicks / 2);
    sim.world.buildings.push(site);
    const drawn = buildObservation(sim, 1, 'tick-0').buildings.find((b) => b.id === site.id)!;
    expect(drawn.complete).toBe(false);
    expect(drawn.progress).toBeCloseTo(0.5, 1);
  });

  it('never gives another seat its orders, cargo, queues, or a stock out of sight', () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    for (let tick = 0; tick < 200; tick++) sim.step();
    const observation = buildObservation(sim, 1, 'tick-200');
    for (const unit of observation.units.filter((u) => u.owner !== 1)) {
      expect(unit.order).toBeUndefined();
      expect(unit.carryOre).toBeUndefined();
    }
    for (const building of observation.buildings.filter((b) => b.owner !== 1)) {
      expect(building.queue).toBeUndefined();
      expect(building.producing).toBeUndefined();
    }
    for (const node of observation.nodes) {
      const seen = sim.world.visible[0]![node.y * MAP_SIZE + node.x] === 1;
      expect(node.amount !== undefined).toBe(seen);
    }
  });
});
