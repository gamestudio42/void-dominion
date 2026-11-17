import type { MatchResult } from './types.ts';

export interface BenchmarkResult {
  totalMatches: number;
  validMatches: number;
  invalidMatches: number;
  seat1Wins: number;
  seat2Wins: number;
  draws: number;
  seat1WinRate: number;
  seat2WinRate: number;
  averageTicks: number;
  averageLatencyMs: number;
  matches: MatchResult[];
}

export function benchmarkResults(matches: MatchResult[]): BenchmarkResult {
  const validMatches = matches.filter((m) => m.validForBenchmark);
  const seat1Wins = validMatches.filter((m) => m.winner === 1).length;
  const seat2Wins = validMatches.filter((m) => m.winner === 2).length;
  const draws = validMatches.filter((m) => m.winner === 0).length;

  const totalTicks = validMatches.reduce((sum, m) => sum + m.ticks, 0);
  const totalLatency = validMatches.reduce((sum, m) => {
    const seat1Latency = m.seats[0]?.latencyMean ?? 0;
    const seat2Latency = m.seats[1]?.latencyMean ?? 0;
    return sum + seat1Latency + seat2Latency;
  }, 0);

  return {
    totalMatches: matches.length,
    validMatches: validMatches.length,
    invalidMatches: matches.length - validMatches.length,
    seat1Wins,
    seat2Wins,
    draws,
    seat1WinRate: validMatches.length > 0 ? seat1Wins / validMatches.length : 0,
    seat2WinRate: validMatches.length > 0 ? seat2Wins / validMatches.length : 0,
    averageTicks: validMatches.length > 0 ? totalTicks / validMatches.length : 0,
    averageLatencyMs: validMatches.length > 0 ? totalLatency / (validMatches.length * 2) : 0,
    matches,
  };
}

export async function runBenchmark(
  matchCount: number,
  matchSetupFactory: (index: number) => Promise<import('./match.ts').MatchSetup>,
): Promise<BenchmarkResult> {
  const matches: MatchResult[] = [];
  const { runMatch } = await import('./match.ts');

  for (let i = 0; i < matchCount; i++) {
    const setup = await matchSetupFactory(i);
    const result = await runMatch(setup);
    matches.push(result);
  }

  return benchmarkResults(matches);
}
