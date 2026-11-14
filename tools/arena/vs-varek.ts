#!/usr/bin/env node
/**
 * Run the deterministic example agent against Varek.
 * Usage: node --experimental-transform-types --no-warnings tools/arena/vs-varek.ts
 * External seat alternates: seed index even -> seat 1, odd -> seat 2.
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

const agentPath = resolve('examples/deterministic.ts');
const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
const count = Number(process.env.ARENA_MATCHES ?? 10);
const maxTicks = Number(process.env.ARENA_MAX_TICKS ?? 8000);

let wins = 0;
let losses = 0;
let draws = 0;

for (let index = 0; index < count; index++) {
  const seed = (MATCH.seed + index) >>> 0;
  const externalSeat = index % 2 === 0 ? 1 : 2;
  const started = Date.now();
  const config: ArenaConfig = {
    ...DEFAULT_ARENA_CONFIG,
    maxTicks,
    strategicPeriodTicks: 100,
    variation: 'seeded',
    seats: [
      { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 1 ? 'deterministic' : 'varek', decisionTimeoutMs: 5000 },
      { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 2 ? 'deterministic' : 'varek', decisionTimeoutMs: 5000 },
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
    JSON.stringify({
      seed,
      externalSeat,
      winner: result.winner,
      endReason: result.endReason,
      ticks: result.ticks,
      ownDecisions: external.ownDecisions,
      fallbackDecisions: external.fallbackDecisions,
      invalidActions: external.invalidActions,
      ms: Date.now() - started,
    }),
  );
}

console.log(JSON.stringify({ wins, losses, draws }));
