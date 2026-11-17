import type { ActResponse } from '@void-dominion/agent-sdk';

export type EndReason = 'victory' | 'draw' | 'tick_cap' | 'forfeit';

export interface DecisionResult {
  seat: number;
  tick: number;
  response: ActResponse | null;
  decisionMs: number;
  timedOut: boolean;
  crashed: boolean;
  malformed: boolean;
  fallbackUsed: boolean;
}

export interface MatchMetrics {
  decisions: number;
  invalidActions: number;
  timeouts: number;
  fallbacks: number;
  latencyMean: number;
  latencyP95: number;
}

export interface SeatMetrics extends MatchMetrics {
  seat: number;
  agentId: string;
  ownDecisions: number;
  fallbackDecisions: number;
}

export interface MatchResult {
  matchId: string;
  seed: number;
  status: 'completed' | 'error';
  winner: number;
  ticks: number;
  finalChecksum: number;
  endReason: EndReason;
  engineVersion: string;
  commitSha: string;
  config: unknown;
  seats: SeatMetrics[];
  validForBenchmark: boolean;
  invalidReason?: string;
}

export interface DecisionEvent {
  schemaVersion: string;
  type: 'decision';
  matchId: string;
  seat: number;
  tick: number;
  observationHash: string;
  agentId: string;
  decisionMs: number;
  fallbackUsed: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface CommandResultEvent {
  schemaVersion: string;
  type: 'command_result';
  matchId: string;
  seat: number;
  tick: number;
  actionIndex: number;
  success: boolean;
  reason?: string;
}

export interface FallbackEvent {
  schemaVersion: string;
  type: 'fallback';
  matchId: string;
  seat: number;
  tick: number;
  reason: 'timeout' | 'crashed' | 'malformed';
}

export interface TimeoutEvent {
  schemaVersion: string;
  type: 'timeout';
  matchId: string;
  seat: number;
  tick: number;
}

export interface MatchEndEvent {
  schemaVersion: string;
  type: 'match_end';
  matchId: string;
  winner: number;
  ticks: number;
  endReason: EndReason;
}

export type TraceEvent = DecisionEvent | CommandResultEvent | FallbackEvent | TimeoutEvent | MatchEndEvent;
