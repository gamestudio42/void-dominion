export { runMatch, type MatchSetup } from './match.ts';
export { runBenchmark, benchmarkResults, type BenchmarkResult } from './benchmark.ts';
export {
  LEADERBOARD_DECISION_TIMEOUT_MS,
  LEADERBOARD_MAX_TICKS,
  LEADERBOARD_PERIOD_TICKS,
  LEADERBOARD_SEED_COUNT,
  leaderboardSeeds,
  renderLeaderboardMarkdown,
  roundedRatio,
  runLeaderboard,
  summarizeLeaderboard,
  type LeaderboardContestant,
  type LeaderboardMatchRow,
  type LeaderboardMatchup,
  type LeaderboardReport,
  type LeaderboardRunOptions,
  type LeaderboardStanding,
} from './leaderboard.ts';
export { replayFromTrace, type ReplayResult } from './replay.ts';
export { ArenaScheduler } from './scheduler.ts';
export { DecisionRecorder } from './recorder.ts';
export { FallbackAgent } from './fallback.ts';
export { spawnAgentProcess, ScriptAgentFactory, DeterministicAgentFactory, type AgentFactory, type AgentProcess } from './process.ts';
export { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, type ArenaConfig, type FailurePolicy, type SeatConfig } from './config.ts';
export type {
  CommandResultEvent,
  DecisionEvent,
  DecisionResult,
  EndReason,
  FallbackEvent,
  MatchEndEvent,
  MatchMetrics,
  MatchResult,
  SeatMetrics,
  TimeoutEvent,
  TraceEvent,
} from './types.ts';
