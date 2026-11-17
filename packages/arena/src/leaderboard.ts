import type { Seats } from '@void-dominion/simulation';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, type ArenaConfig } from './config.ts';
import { runMatch } from './match.ts';
import { DeterministicAgentFactory, type AgentFactory } from './process.ts';
import type { EndReason } from './types.ts';

/** Seeds in the published board. Even indexes seat the home agent on seat 1. */
export const LEADERBOARD_SEED_COUNT = 20;
export const LEADERBOARD_MAX_TICKS = 12_000;
export const LEADERBOARD_PERIOD_TICKS = 100;
export const LEADERBOARD_DECISION_TIMEOUT_MS = 5_000;

export function leaderboardSeeds(origin: number, count = LEADERBOARD_SEED_COUNT): number[] {
  const seeds: number[] = [];
  for (let index = 0; index < count; index++) seeds.push((origin + index) >>> 0);
  return seeds;
}

export interface LeaderboardContestant {
  id: string;
  factory: AgentFactory;
}

export interface LeaderboardRunOptions {
  seeds: readonly number[];
  maxTicks: number;
  strategicPeriodTicks: number;
  decisionTimeoutMs: number;
  /** Roster order. The earlier id is home when two agents play each other. */
  agents: readonly LeaderboardContestant[];
  versusVarek?: boolean;
  pairwise?: boolean;
  onMatch?: (row: LeaderboardMatchRow) => void;
}

export interface LeaderboardMatchRow {
  seed: number;
  home: string;
  away: string;
  homeSeat: 1 | 2;
  winner: 0 | 1 | 2;
  endReason: EndReason;
  ticks: number;
  checksum: number;
}

export interface LeaderboardStanding {
  agent: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Wins / matches, rounded to four decimals. Draws stay in the denominator. */
  winRate: number;
  /** Mean match length in ticks, rounded to one decimal. */
  averageTicks: number;
}

export interface LeaderboardMatchup extends LeaderboardStanding {
  home: string;
  away: string;
}

export interface LeaderboardReport {
  variation: 'seeded';
  strategicPeriodTicks: number;
  maxTicks: number;
  seeds: number[];
  agents: string[];
  standings: LeaderboardStanding[];
  matchups: LeaderboardMatchup[];
  matches: LeaderboardMatchRow[];
}

interface Pairing {
  home: LeaderboardContestant;
  awayId: string;
  awayFactory: AgentFactory;
  awayEngine: 'human' | 'varek';
}

export function roundedRatio(numerator: number, denominator: number, places: number): number {
  if (denominator <= 0) return 0;
  const scale = 10 ** places;
  return Math.round((numerator * scale) / denominator) / scale;
}

function homeResult(row: LeaderboardMatchRow): 'win' | 'loss' | 'draw' {
  if (row.winner === 0) return 'draw';
  const homeWon = row.winner === row.homeSeat;
  return homeWon ? 'win' : 'loss';
}

function emptyStanding(agent: string): LeaderboardStanding {
  return { agent, matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0, averageTicks: 0 };
}

function finish(standing: LeaderboardStanding, ticks: number): void {
  standing.winRate = roundedRatio(standing.wins, standing.matches, 4);
  standing.averageTicks = roundedRatio(ticks, standing.matches, 1);
}

function addResult(standing: LeaderboardStanding, result: 'win' | 'loss' | 'draw'): void {
  standing.matches += 1;
  if (result === 'win') standing.wins += 1;
  else if (result === 'loss') standing.losses += 1;
  else standing.draws += 1;
}

export function summarizeLeaderboard(
  matches: readonly LeaderboardMatchRow[],
  agents: readonly string[],
  seeds: readonly number[],
  maxTicks: number,
  strategicPeriodTicks: number,
): LeaderboardReport {
  const byAgent = new Map<string, LeaderboardStanding>();
  const ticksByAgent = new Map<string, number>();
  for (const agent of agents) {
    byAgent.set(agent, emptyStanding(agent));
    ticksByAgent.set(agent, 0);
  }

  const matchupKey = (home: string, away: string) => `${home}\0${away}`;
  const matchups = new Map<string, LeaderboardStanding & { home: string; away: string }>();
  const matchupTicks = new Map<string, number>();

  for (const row of matches) {
    const outcome = homeResult(row);
    const home = byAgent.get(row.home);
    if (home) {
      addResult(home, outcome);
      ticksByAgent.set(row.home, (ticksByAgent.get(row.home) ?? 0) + row.ticks);
    }
    if (row.away !== 'varek') {
      const away = byAgent.get(row.away);
      if (away) {
        const flipped = outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : 'draw';
        addResult(away, flipped);
        ticksByAgent.set(row.away, (ticksByAgent.get(row.away) ?? 0) + row.ticks);
      }
    }

    const key = matchupKey(row.home, row.away);
    let matchup = matchups.get(key);
    if (!matchup) {
      matchup = { ...emptyStanding(row.home), home: row.home, away: row.away };
      matchups.set(key, matchup);
      matchupTicks.set(key, 0);
    }
    addResult(matchup, outcome);
    matchupTicks.set(key, (matchupTicks.get(key) ?? 0) + row.ticks);
  }

  const standings = [...byAgent.values()];
  for (const standing of standings) finish(standing, ticksByAgent.get(standing.agent) ?? 0);
  standings.sort((a, b) => {
    const rate = b.wins * a.matches - a.wins * b.matches;
    if (rate !== 0) return rate;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.agent.localeCompare(b.agent);
  });

  const matchupRows: LeaderboardMatchup[] = [];
  for (const matchup of matchups.values()) {
    finish(matchup, matchupTicks.get(matchupKey(matchup.home, matchup.away)) ?? 0);
    matchupRows.push({
      home: matchup.home,
      away: matchup.away,
      agent: matchup.home,
      matches: matchup.matches,
      wins: matchup.wins,
      losses: matchup.losses,
      draws: matchup.draws,
      winRate: matchup.winRate,
      averageTicks: matchup.averageTicks,
    });
  }

  return {
    variation: 'seeded',
    strategicPeriodTicks,
    maxTicks,
    seeds: [...seeds],
    agents: [...agents],
    standings,
    matchups: matchupRows,
    matches: [...matches],
  };
}

function pairings(options: LeaderboardRunOptions): Pairing[] {
  const pairs: Pairing[] = [];
  if (options.versusVarek !== false) {
    const varekFactory = new DeterministicAgentFactory();
    for (const agent of options.agents) {
      pairs.push({ home: agent, awayId: 'varek', awayFactory: varekFactory, awayEngine: 'varek' });
    }
  }
  if (options.pairwise !== false) {
    for (let i = 0; i < options.agents.length; i++) {
      for (let j = i + 1; j < options.agents.length; j++) {
        const home = options.agents[i]!;
        const away = options.agents[j]!;
        pairs.push({ home, awayId: away.id, awayFactory: away.factory, awayEngine: 'human' });
      }
    }
  }
  return pairs;
}

export async function runLeaderboard(options: LeaderboardRunOptions): Promise<LeaderboardReport> {
  const rows: LeaderboardMatchRow[] = [];

  for (const pair of pairings(options)) {
    for (let index = 0; index < options.seeds.length; index++) {
      const seed = options.seeds[index]!;
      const homeSeat: 1 | 2 = index % 2 === 0 ? 1 : 2;
      const engineSeats: Seats = homeSeat === 1
        ? ['human', pair.awayEngine]
        : [pair.awayEngine, 'human'];
      const seatConfig = (agentId: string) => ({
        ...DEFAULT_SEAT_CONFIG,
        agentId,
        decisionTimeoutMs: options.decisionTimeoutMs,
      });
      const config: ArenaConfig = {
        ...DEFAULT_ARENA_CONFIG,
        maxTicks: options.maxTicks,
        strategicPeriodTicks: options.strategicPeriodTicks,
        variation: 'seeded',
        seats: homeSeat === 1
          ? [seatConfig(pair.home.id), seatConfig(pair.awayId)]
          : [seatConfig(pair.awayId), seatConfig(pair.home.id)],
      };
      const result = await runMatch({
        seed,
        engineSeats,
        agentFactories: homeSeat === 1
          ? [pair.home.factory, pair.awayFactory]
          : [pair.awayFactory, pair.home.factory],
        config,
      });
      const row: LeaderboardMatchRow = {
        seed,
        home: pair.home.id,
        away: pair.awayId,
        homeSeat,
        winner: result.winner === 1 || result.winner === 2 ? result.winner : 0,
        endReason: result.endReason,
        ticks: result.ticks,
        checksum: result.finalChecksum,
      };
      rows.push(row);
      options.onMatch?.(row);
    }
  }

  return summarizeLeaderboard(
    rows,
    options.agents.map((agent) => agent.id),
    options.seeds,
    options.maxTicks,
    options.strategicPeriodTicks,
  );
}

function cell(value: string | number): string {
  return String(value);
}

function standingCells(row: LeaderboardStanding): string {
  return [
    row.matches,
    row.wins,
    row.losses,
    row.draws,
    row.winRate.toFixed(4),
    row.averageTicks.toFixed(1),
  ].map(cell).join(' | ');
}

export function renderLeaderboardMarkdown(report: LeaderboardReport): string {
  const first = report.seeds[0];
  const last = report.seeds[report.seeds.length - 1];
  const seedLabel = first === undefined ? 'none' : first === last ? String(first) : `${first}–${last}`;
  const lines = [
    '# Arena leaderboard',
    '',
    'Generated by `pnpm arena:leaderboard`. Do not edit by hand.',
    '',
    `Seeds ${seedLabel}. \`variation: 'seeded'\`. Cap ${report.maxTicks} ticks. Strategic period ${report.strategicPeriodTicks}. Even seed indexes seat the home agent on seat 1; odd indexes seat it on seat 2.`,
    '',
    'Win rate is wins divided by matches, rounded to four decimals. Draws stay in the denominator. Average ticks are the mean length of that agent\'s matches, rounded to one decimal.',
    '',
    '## Standings',
    '',
    '| agent | matches | wins | losses | draws | win rate | average ticks |',
    '|---|---|---|---|---|---|---|',
    ...report.standings.map((row) => `| ${row.agent} | ${standingCells(row)} |`),
    '',
    '## Matchups',
    '',
    'Wins, losses, and the win rate are from the home agent\'s side.',
    '',
    '| home | away | matches | wins | losses | draws | win rate | average ticks |',
    '|---|---|---|---|---|---|---|---|',
    ...report.matchups.map((row) => `| ${row.home} | ${row.away} | ${standingCells(row)} |`),
    '',
  ];
  return lines.join('\n');
}
