#!/usr/bin/env node
/**
 * Fixed leaderboard: every roster agent against Varek and against each other.
 * Usage: pnpm arena:leaderboard
 * ARENA_LEADERBOARD_OLLAMA=1 adds examples/ollama.ts and does not rewrite docs/.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MATCH } from '../../packages/content/src/index.ts';
import {
  DeterministicAgentFactory,
  LEADERBOARD_DECISION_TIMEOUT_MS,
  LEADERBOARD_MAX_TICKS,
  LEADERBOARD_PERIOD_TICKS,
  ScriptAgentFactory,
  leaderboardSeeds,
  renderLeaderboardMarkdown,
  runLeaderboard,
  type LeaderboardContestant,
} from '../../packages/arena/src/index.ts';
import { rosterForRun, type RosterEntry } from './roster.ts';

function factoryFor(entry: RosterEntry) {
  if (!entry.script) return new DeterministicAgentFactory();
  return new ScriptAgentFactory('node', [
    '--experimental-transform-types',
    '--no-warnings',
    resolve(entry.script),
  ]);
}

const includeOllama = process.env.ARENA_LEADERBOARD_OLLAMA === '1';
const roster = rosterForRun(includeOllama);
const agents: LeaderboardContestant[] = roster.map((entry) => ({
  id: entry.id,
  factory: factoryFor(entry),
}));
const timeoutMs = includeOllama
  ? Number(process.env.OLLAMA_TIMEOUT_MS ?? 20_000) + 5_000
  : LEADERBOARD_DECISION_TIMEOUT_MS;

const report = await runLeaderboard({
  seeds: leaderboardSeeds(MATCH.seed),
  maxTicks: LEADERBOARD_MAX_TICKS,
  strategicPeriodTicks: LEADERBOARD_PERIOD_TICKS,
  decisionTimeoutMs: timeoutMs,
  agents,
  onMatch(row) {
    console.error(`${row.home}\tvs ${row.away}\tseed ${row.seed}\tseat ${row.homeSeat}\twinner ${row.winner}\t${row.endReason}\t${row.ticks}`);
  },
});

const markdown = renderLeaderboardMarkdown(report);
if (includeOllama) {
  console.log(markdown);
  console.error('Ollama was included. The versioned board in docs/ was left unchanged.');
} else {
  const jsonPath = resolve('docs/leaderboard.json');
  const markdownPath = resolve('docs/LEADERBOARD.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);
  console.log(markdown);
  console.error(`Wrote ${jsonPath} and ${markdownPath}`);
}
