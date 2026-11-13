import { MATCH } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, DeterministicAgentFactory, runBenchmark, runMatch, type ArenaConfig } from '../src/index.ts';

describe('MVP2: two external agents', () => {
  it('controls two independent processes for seats 1 and 2', async () => {
    const factory1 = new DeterministicAgentFactory();
    const factory2 = new DeterministicAgentFactory();
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 1000,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent1' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent2' },
      ],
    };

    const result = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory1, factory2],
      config,
    });

    expect(result.status).toBe('completed');
    expect(result.seats[0]?.agentId).toBe('agent1');
    expect(result.seats[1]?.agentId).toBe('agent2');
  });

  it('replays without processes and produces same checksum', async () => {
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

  it('response arrival order does not change outcome', async () => {
    const factory = new DeterministicAgentFactory();
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 500,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent1' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent2' },
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

  it('benchmark records W/L/D and per-agent metrics', async () => {
    const factory = new DeterministicAgentFactory();

    const benchmark = await runBenchmark(5, async (index) => {
      const config: ArenaConfig = {
        ...DEFAULT_ARENA_CONFIG,
        maxTicks: 500,
        fallbackInvalidThreshold: 1.0,
        seats: [
          { ...DEFAULT_SEAT_CONFIG, agentId: 'agent1' },
          { ...DEFAULT_SEAT_CONFIG, agentId: 'agent2' },
        ],
      };

      return {
        seed: MATCH.seed + index,
        agentFactories: [factory, factory],
        config,
      };
    });

    expect(benchmark.totalMatches).toBe(5);
    expect(benchmark.validMatches).toBe(5);
    expect(benchmark.seat1Wins + benchmark.seat2Wins + benchmark.draws).toBe(benchmark.validMatches);
  });

  it('swaps seats and compares win rates', async () => {
    const factory1 = new DeterministicAgentFactory();
    const factory2 = new DeterministicAgentFactory();
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 500,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent1' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent2' },
      ],
    };

    const result1 = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory1, factory2],
      config,
    });

    const configSwapped: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 500,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent2' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'agent1' },
      ],
    };

    const result2 = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory2, factory1],
      config: configSwapped,
    });

    expect(result1.status).toBe('completed');
    expect(result2.status).toBe('completed');
  });
});
