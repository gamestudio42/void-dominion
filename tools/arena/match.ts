#!/usr/bin/env node
/**
 * Run a single Agent Arena match.
 * Usage: pnpm arena
 */

import { MATCH } from '../../packages/content/src/index.ts';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, DeterministicAgentFactory, runMatch, type ArenaConfig } from '../../packages/arena/src/index.ts';

async function main() {
  const factory = new DeterministicAgentFactory();
  const config: ArenaConfig = {
    ...DEFAULT_ARENA_CONFIG,
    maxTicks: 2000,
    seats: [
      { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic-1' },
      { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic-2' },
    ],
  };

  console.log('Starting Agent Arena match...');
  const result = await runMatch({
    seed: MATCH.seed,
    agentFactories: [factory, factory],
    config,
  });

  console.log('\nMatch Result:');
  console.log(`  Match ID: ${result.matchId}`);
  console.log(`  Seed: ${result.seed}`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Winner: ${result.winner === 0 ? 'Draw' : `Seat ${result.winner}`}`);
  console.log(`  Ticks: ${result.ticks}`);
  console.log(`  Final Checksum: ${result.finalChecksum}`);
  console.log(`  End Reason: ${result.endReason}`);
  console.log(`  Valid for Benchmark: ${result.validForBenchmark}`);
  if (result.invalidReason) {
    console.log(`  Invalid Reason: ${result.invalidReason}`);
  }

  console.log('\nSeat Metrics:');
  for (const seat of result.seats) {
    console.log(`  Seat ${seat.seat} (${seat.agentId}):`);
    console.log(`    Decisions: ${seat.decisions} (own: ${seat.ownDecisions}, fallback: ${seat.fallbackDecisions})`);
    console.log(`    Timeouts: ${seat.timeouts}, Fallbacks: ${seat.fallbacks}`);
    console.log(`    Latency: mean ${seat.latencyMean.toFixed(1)}ms, p95 ${seat.latencyP95.toFixed(1)}ms`);
  }
}

main().catch((err) => {
  console.error('Error running match:', err);
  process.exit(1);
});
