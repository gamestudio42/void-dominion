import { MATCH } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, ScriptAgentFactory, runBenchmark, runMatch, type ArenaConfig } from '../src/index.ts';
import { resolve } from 'node:path';

describe('Example Agent', () => {
  it('issues non-noop commands that are accepted', async () => {
    const agentPath = resolve(process.cwd(), 'examples/deterministic.ts');
    const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 1500,
      strategicPeriodTicks: 50,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 5000 },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 5000 },
      ],
    };

    const result = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory, factory],
      config,
    });

    expect(result.status).toBe('completed');
    const seat1 = result.seats[0]!;
    expect(seat1.decisions).toBeGreaterThan(0);
    expect(seat1.ownDecisions).toBeGreaterThan(0);
    expect(seat1.ownDecisions).toBe(seat1.decisions);
  }, 60_000);

  it('plays against Varek and records W/L/D', async () => {
    const agentPath = resolve(process.cwd(), 'examples/deterministic.ts');
    const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);

    const benchmark = await runBenchmark(5, async (index) => {
      const config: ArenaConfig = {
        ...DEFAULT_ARENA_CONFIG,
        maxTicks: 2000,
        strategicPeriodTicks: 100,
        fallbackInvalidThreshold: 0.5,
        seats: [
          { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 5000 },
          { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 5000 },
        ],
      };

      return {
        seed: MATCH.seed + index,
        agentFactories: [factory, factory],
        config,
      };
    });

    expect(benchmark.totalMatches).toBe(5);
    expect(benchmark.seat1Wins + benchmark.seat2Wins + benchmark.draws).toBeGreaterThan(0);
    
    console.log('\nExample Agent vs Deterministic (5 matches):');
    console.log(`  Seat 1 wins: ${benchmark.seat1Wins}`);
    console.log(`  Seat 2 wins: ${benchmark.seat2Wins}`);
    console.log(`  Draws: ${benchmark.draws}`);
    console.log(`  Valid matches: ${benchmark.validMatches}/${benchmark.totalMatches}`);
  }, 180_000);
});
