#!/usr/bin/env node
/**
 * Replay an Agent Arena match from trace.
 * Usage: pnpm arena:replay <trace-path>
 */

import { replayFromTrace } from '../../packages/arena/src/index.ts';

async function main() {
  const tracePath = process.argv[2];
  if (!tracePath) {
    console.error('Usage: pnpm arena:replay <trace-path>');
    process.exit(1);
  }

  console.log(`Replaying from ${tracePath}...`);
  const result = replayFromTrace(tracePath);

  console.log('\nReplay Result:');
  console.log(`  Match ID: ${result.matchId}`);
  console.log(`  Seed: ${result.seed}`);
  console.log(`  Ticks: ${result.ticks}`);
  console.log(`  Final Checksum: ${result.finalChecksum}`);
  console.log(`  Winner: ${result.winner === 0 ? 'Draw' : `Seat ${result.winner}`}`);
  console.log(`  Diverged: ${result.diverged}`);

  if (result.diverged) {
    console.log(`  Divergence Tick: ${result.divergenceTick}`);
    console.log(`  Expected Checksum: ${result.expectedChecksum}`);
    console.log(`  Actual Checksum: ${result.actualChecksum}`);
  }
}

main().catch((err) => {
  console.error('Error replaying match:', err);
  process.exit(1);
});
