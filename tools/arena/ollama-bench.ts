#!/usr/bin/env node
/**
 * Ollama example against Varek. Not used by CI.
 * Usage: node --experimental-transform-types --no-warnings tools/arena/ollama-bench.ts
 * ARENA_MATCHES default 6, ARENA_MAX_TICKS default 8000, ARENA_PERIOD default 200.
 * Even indexes seat the model on seat 1, odd indexes on seat 2.
 * Requires a running Ollama and OLLAMA_MODEL (default qwen2.5:1.5b).
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

const agentPath = resolve('examples/ollama.ts');
const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
const count = Number(process.env.ARENA_MATCHES ?? 6);
const maxTicks = Number(process.env.ARENA_MAX_TICKS ?? 8000);
const period = Number(process.env.ARENA_PERIOD ?? 200);
const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 20_000);

let wins = 0;
let losses = 0;
let draws = 0;
let own = 0;
let fallback = 0;
let invalid = 0;
let latencySum = 0;
let latencyN = 0;

console.log('seed\textSeat\twinner\tend\tticks\town\tfallback\tinvalid\tlatencyMean\tlatencyP95');

for (let index = 0; index < count; index++) {
  const seed = (MATCH.seed + index) >>> 0;
  const externalSeat = index % 2 === 0 ? 1 : 2;
  const config: ArenaConfig = {
    ...DEFAULT_ARENA_CONFIG,
    maxTicks,
    strategicPeriodTicks: period,
    variation: 'seeded',
    seats: [
      { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 1 ? 'ollama' : 'varek', decisionTimeoutMs: timeoutMs + 5_000 },
      { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 2 ? 'ollama' : 'varek', decisionTimeoutMs: timeoutMs + 5_000 },
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
  own += external.ownDecisions;
  fallback += external.fallbackDecisions;
  invalid += external.invalidActions;
  latencySum += external.latencyMean;
  latencyN += 1;
  console.log(
    [
      seed,
      externalSeat,
      result.winner,
      result.endReason,
      result.ticks,
      external.ownDecisions,
      external.fallbackDecisions,
      external.invalidActions,
      external.latencyMean.toFixed(0),
      external.latencyP95.toFixed(0),
    ].join('\t'),
  );
}

const decisions = own + fallback;
console.log(
  JSON.stringify({
    wins,
    losses,
    draws,
    matches: count,
    ownDecisions: own,
    fallbackDecisions: fallback,
    invalidActions: invalid,
    fallbackRate: decisions > 0 ? fallback / decisions : 0,
    invalidRate: decisions > 0 ? invalid / decisions : 0,
    latencyMeanMs: latencyN > 0 ? latencySum / latencyN : 0,
  }),
);
