#!/usr/bin/env node
/**
 * Run Agent Arena benchmark suite.
 * Usage: pnpm arena:bench
 */

import { MATCH } from '../../packages/content/src/index.ts';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, DeterministicAgentFactory, runBenchmark, type ArenaConfig } from '../../packages/arena/src/index.ts';

async function main() {
  const matchCount = 10;
  const factory = new DeterministicAgentFactory();

  console.log(`Running ${matchCount} matches...`);

  const benchmark = await runBenchmark(matchCount, async (index) => {
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 1000,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic-1' },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic-2' },
      ],
    };

    return {
      seed: MATCH.seed + index,
      agentFactories: [factory, factory],
      config,
    };
  });

  console.log('\nBenchmark Results:');
  console.log(`  Total Matches: ${benchmark.totalMatches}`);
  console.log(`  Valid Matches: ${benchmark.validMatches}`);
  console.log(`  Invalid Matches: ${benchmark.invalidMatches}`);
  console.log(`  Seat 1 Wins: ${benchmark.seat1Wins}`);
  console.log(`  Seat 2 Wins: ${benchmark.seat2Wins}`);
  console.log(`  Draws: ${benchmark.draws}`);
  console.log(`  Seat 1 Win Rate: ${(benchmark.seat1WinRate * 100).toFixed(1)}%`);
  console.log(`  Seat 2 Win Rate: ${(benchmark.seat2WinRate * 100).toFixed(1)}%`);
  console.log(`  Average Ticks: ${benchmark.averageTicks.toFixed(0)}`);
  console.log(`  Average Latency: ${benchmark.averageLatencyMs.toFixed(1)}ms`);
}

main().catch((err) => {
  console.error('Error running benchmark:', err);
  process.exit(1);
});
