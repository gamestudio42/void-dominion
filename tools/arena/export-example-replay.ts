#!/usr/bin/env node
/**
 * Write the small reference-vs-Varek replay the browser viewer ships.
 * Usage: node --experimental-transform-types --no-warnings tools/arena/export-example-replay.ts
 * The layout is the published skirmish, so replay v2 can resimulate it.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MATCH } from '../../packages/content/src/index.ts';
import {
  DEFAULT_ARENA_CONFIG,
  DEFAULT_SEAT_CONFIG,
  ScriptAgentFactory,
  runMatch,
  type ArenaConfig,
} from '../../packages/arena/src/index.ts';
import { serializeReplay, type Simulation } from '../../packages/simulation/src/index.ts';

const agentPath = resolve('examples/reference.ts');
const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
const maxTicks = Number(process.env.ARENA_MAX_TICKS ?? 6000);
const seed = MATCH.seed;
const config: ArenaConfig = {
  ...DEFAULT_ARENA_CONFIG,
  maxTicks,
  strategicPeriodTicks: 100,
  seats: [
    { ...DEFAULT_SEAT_CONFIG, agentId: 'reference', decisionTimeoutMs: 5000 },
    { ...DEFAULT_SEAT_CONFIG, agentId: 'varek', decisionTimeoutMs: 5000 },
  ],
};

let finished: Simulation | null = null;
const result = await runMatch({
  seed,
  engineSeats: ['human', 'varek'],
  agentFactories: [factory, factory],
  config,
  onFinished(sim) {
    finished = sim;
  },
});

if (!finished) throw new Error('The match did not finish');
const sim: Simulation = finished;
const body = JSON.parse(serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats })) as {
  checksum?: number;
};
body.checksum = result.finalChecksum;
const path = resolve('apps/game/public/replays/reference-varek.json');
writeFileSync(path, `${JSON.stringify(body)}\n`);
console.log(JSON.stringify({
  path,
  ticks: sim.world.tick,
  winner: result.winner,
  endReason: result.endReason,
  checksum: result.finalChecksum,
  commands: sim.log.length,
}));
