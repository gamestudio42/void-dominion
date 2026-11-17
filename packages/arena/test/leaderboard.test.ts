import { MATCH } from '@void-dominion/content';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DeterministicAgentFactory,
  ScriptAgentFactory,
  leaderboardSeeds,
  renderLeaderboardMarkdown,
  runLeaderboard,
  summarizeLeaderboard,
  type LeaderboardMatchRow,
} from '../src/index.ts';
import { rosterForRun } from '../../../tools/arena/roster.ts';

function row(patch: Partial<LeaderboardMatchRow> & Pick<LeaderboardMatchRow, 'home' | 'away' | 'winner' | 'ticks'>): LeaderboardMatchRow {
  return {
    seed: 1,
    homeSeat: 1,
    endReason: patch.winner === 0 ? 'tick_cap' : 'victory',
    checksum: 1,
    ...patch,
  };
}

describe('leaderboard', () => {
  it('keeps Ollama out of the default roster', () => {
    expect(rosterForRun(false).map((entry) => entry.id)).toEqual(['reference', 'example', 'noop']);
    expect(rosterForRun(true).some((entry) => entry.id === 'ollama')).toBe(true);
  });

  it('scores wins, draws, and average ticks from fixed rows', () => {
    const report = summarizeLeaderboard(
      [
        row({ home: 'reference', away: 'varek', winner: 1, ticks: 100, seed: 1, homeSeat: 1 }),
        row({ home: 'reference', away: 'varek', winner: 2, ticks: 300, seed: 2, homeSeat: 2 }),
        row({ home: 'reference', away: 'example', winner: 0, ticks: 200, seed: 1, homeSeat: 1 }),
        row({ home: 'example', away: 'varek', winner: 2, ticks: 50, seed: 1, homeSeat: 1 }),
      ],
      ['reference', 'example'],
      [1, 2],
      12_000,
      100,
    );

    expect(report.standings).toEqual([
      { agent: 'reference', matches: 3, wins: 2, losses: 0, draws: 1, winRate: 0.6667, averageTicks: 200 },
      { agent: 'example', matches: 2, wins: 0, losses: 1, draws: 1, winRate: 0, averageTicks: 125 },
    ]);
    expect(report.matchups.find((matchup) => matchup.home === 'reference' && matchup.away === 'varek')).toMatchObject({
      wins: 2,
      losses: 0,
      draws: 0,
      averageTicks: 200,
    });
    const markdown = renderLeaderboardMarkdown(report);
    expect(markdown).toContain('| reference | 3 | 2 | 0 | 1 | 0.6667 | 200.0 |');
    expect(markdown).toBe(renderLeaderboardMarkdown(JSON.parse(JSON.stringify(report))));
  });

  it('repeats the same seeds', async () => {
    const reference = new ScriptAgentFactory('node', [
      '--experimental-transform-types',
      '--no-warnings',
      resolve('examples/reference.ts'),
    ]);
    const play = () => runLeaderboard({
      seeds: leaderboardSeeds(MATCH.seed, 2),
      maxTicks: 400,
      strategicPeriodTicks: 100,
      decisionTimeoutMs: 5_000,
      agents: [
        { id: 'reference', factory: reference },
        { id: 'noop', factory: new DeterministicAgentFactory() },
      ],
    });
    const first = await play();
    const second = await play();
    expect(first.matches).toEqual(second.matches);
    expect(first.standings).toEqual(second.standings);
    expect(first.matches.length).toBe(6);
    expect(first.matches.every((match) => match.checksum === second.matches.find((other) =>
      other.home === match.home && other.away === match.away && other.seed === match.seed,
    )?.checksum)).toBe(true);
  }, 60_000);

  it('matches the published markdown to the published json', () => {
    const report = JSON.parse(readFileSync(resolve('docs/leaderboard.json'), 'utf8'));
    const markdown = readFileSync(resolve('docs/LEADERBOARD.md'), 'utf8');
    expect(markdown).toBe(renderLeaderboardMarkdown(report));
    const versusVarek = report.matchups.find((matchup: { home: string; away: string }) =>
      matchup.home === 'reference' && matchup.away === 'varek');
    expect(versusVarek).toMatchObject({ matches: 20, wins: 19, losses: 0, draws: 1 });
  });
});