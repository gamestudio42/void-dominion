#!/usr/bin/env node
/**
 * Reference agent against Varek, with seeded variation.
 * Usage: pnpm arena:bench
 * ARENA_MATCHES (default 20) and ARENA_MAX_TICKS (default 12000) override the run.
 * Even indexes put the reference agent on seat 1, odd indexes on seat 2.
 */

import { resolve } from 'node:path';
import { MATCH } from '../../packages/content/src/index.ts';
import {
  DEFAULT_ARENA_CONFIG,
  DEFAULT_SEAT_CONFIG,
  ScriptAgentFactory,
  runMatch,
  type ArenaConfig,
} from '../../packages/arena/src/index.ts';

const agentPath = resolve('examples/reference.ts');
const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
const count = Number(process.env.ARENA_MATCHES ?? 20);
const maxTicks = Number(process.env.ARENA_MAX_TICKS ?? 12000);

let wins = 0;
let losses = 0;
let draws = 0;

console.log('seed\textSeat\twinner\tend\tticks\town\tfallback\tinvalid');

for (let index = 0; index < count; index++) {
  const seed = (MATCH.seed + index) >>> 0;
  const externalSeat = index % 2 === 0 ? 1 : 2;
  const config: ArenaConfig = {
    ...DEFAULT_ARENA_CONFIG,
    maxTicks,
    strategicPeriodTicks: 100,
    variation: 'seeded',
    seats: [
      { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 1 ? 'reference' : 'varek', decisionTimeoutMs: 5000 },
      { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 2 ? 'reference' : 'varek', decisionTimeoutMs: 5000 },
    ],
  };
  const result = await runMatch({
    seed,
    engineSeats: externalSeat === 1 ? ['human', 'varek'] : ['varek', 'human'],
    agentFactories: [factory, factory],
    config,
  });
  const external = result.seats[externalSeat - 1]!;
  if (result.winner === 0) draws += 1;
  else if (result.winner === externalSeat) wins += 1;
  else losses += 1;
  console.log(
    [seed, externalSeat, result.winner, result.endReason, result.ticks, external.ownDecisions, external.fallbackDecisions, external.invalidActions].join('\t'),
  );
}

console.log(JSON.stringify({ wins, losses, draws, matches: count }));
