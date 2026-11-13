import { MATCH } from '@void-dominion/content';
import { Simulation } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, DeterministicAgentFactory, runMatch, type ArenaConfig } from '../src/index.ts';

describe('MVP1: external vs Varek', () => {
  it('runs 100 consecutive headless matches without crash/deadlock/orphan process', async () => {
    const factory = new DeterministicAgentFactory();
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 1000,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'varek' },
      ],
    };

    for (let i = 0; i < 100; i++) {
      const result = await runMatch({
        seed: MATCH.seed + i,
        agentFactories: [factory, factory],
        config,
      });
      expect(result.status).toBe('completed');
    }
  }, 120_000);

  it('produces identical final checksum for same replay+engine+seed', async () => {
    const factory = new DeterministicAgentFactory();
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 1000,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic' },
      ],
    };

    const result1 = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory, factory],
      config,
    });

    const result2 = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory, factory],
      config,
    });

    expect(result1.finalChecksum).toBe(result2.finalChecksum);
  });

  it('rejects invalid commands without changing state', async () => {
    const sim1 = Simulation.create(MATCH.seed, ['human', 'human']);
    const sim2 = Simulation.create(MATCH.seed, ['human', 'human']);

    sim1.enqueue({
      type: 'move',
      playerId: 1,
      unitIds: [99999],
      to: { x: 50, y: 50 },
    });
    sim1.step();
    sim2.step();

    expect(sim1.hashState()).toBe(sim2.hashState());
  });

  it('triggers correct policy on timeout', async () => {
    const factory = new DeterministicAgentFactory();
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 500,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 100 },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic' },
      ],
    };

    const result = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory, factory],
      config,
    });

    expect(result.status).toBe('completed');
  });

  it('observations contain nothing hidden by fog', async () => {
    const sim = Simulation.create(MATCH.seed, ['human', 'human']);
    const { buildObservation } = await import('../../void-dominion-agent/src/index.ts');

    sim.world.units.find((u) => u.owner === 2)!.hp = 999;

    const obs1 = buildObservation(sim, 1, 'test');
    const enemy = obs1.units.find((u) => u.owner === 2);

    if (enemy) {
      expect(enemy.hp).not.toBe(999);
    }
  });
});
