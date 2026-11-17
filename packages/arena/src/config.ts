/**
 * Arena configuration types and defaults.
 */

export type FailurePolicy = 'fallback' | 'noop' | 'forfeit';

export interface SeatConfig {
  agentId: string;
  failurePolicy: FailurePolicy;
  maxConsecutiveFailures: number;
  decisionTimeoutMs: number;
}

export interface ArenaConfig {
  strategicPeriodTicks: number;
  maxTicks: number;
  seats: [SeatConfig, SeatConfig];
  fallbackInvalidThreshold: number;
  /**
   * `seeded` nudges both seats' resource nodes from the match seed.
   * Omitted or `none` is the published skirmish layout.
   */
  variation?: 'none' | 'seeded';
}

export const DEFAULT_SEAT_CONFIG: Omit<SeatConfig, 'agentId'> = {
  failurePolicy: 'fallback',
  maxConsecutiveFailures: 3,
  decisionTimeoutMs: 10_000,
};

export const DEFAULT_ARENA_CONFIG: Omit<ArenaConfig, 'seats'> = {
  strategicPeriodTicks: 100,
  maxTicks: 20_000,
  fallbackInvalidThreshold: 0.2,
};
