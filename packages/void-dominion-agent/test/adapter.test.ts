import { MATCH } from '@void-dominion/content';
import { Simulation } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { CommanderAdapter } from '../src/index.ts';

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
});
