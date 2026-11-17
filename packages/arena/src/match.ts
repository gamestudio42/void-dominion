import { MATCH } from '@void-dominion/content';
import { Simulation, type Seats } from '@void-dominion/simulation';
import { randomUUID } from 'node:crypto';
import type { ArenaConfig } from './config.ts';
import type { AgentFactory } from './process.ts';
import { ArenaScheduler } from './scheduler.ts';
import type { DecisionResult, EndReason, MatchResult, SeatMetrics } from './types.ts';
import { DecisionRecorder } from './recorder.ts';

export interface MatchSetup {
  matchId?: string;
  seed?: number;
  agentFactories: [AgentFactory, AgentFactory];
  config: ArenaConfig;
  recordPath?: string;
  /**
   * Engine seat control. A `varek` seat is driven by `stepAi` inside the simulation
   * and is not given a process or an observation. Default is two external seats.
   */
  engineSeats?: Seats;
  /** Called with the finished simulation, so a caller can copy the replay log. */
  onFinished?: (sim: Simulation) => void;
}

function determineEndReason(sim: Simulation, ticks: number, maxTicks: number, seat1Forfeited: boolean, seat2Forfeited: boolean): EndReason {
  if (seat1Forfeited || seat2Forfeited) return 'forfeit';
  if (sim.world.winner !== 0) return 'victory';
  if (ticks >= maxTicks) return 'tick_cap';
  return 'draw';
}

function calculateMetrics(decisions: DecisionResult[], agentId: string, seat: number): SeatMetrics {
  const seatDecisions = decisions.filter((d) => d.seat === seat);
  const latencies = seatDecisions.filter((d) => !d.fallbackUsed).map((d) => d.decisionMs);
  const ownDecisions = seatDecisions.filter((d) => !d.fallbackUsed).length;
  const fallbackDecisions = seatDecisions.filter((d) => d.fallbackUsed).length;

  latencies.sort((a, b) => a - b);
  const latencyMean = latencies.length > 0 ? latencies.reduce((sum, val) => sum + val, 0) / latencies.length : 0;
  const p95Index = Math.floor(latencies.length * 0.95);
  const latencyP95 = latencies.length > 0 ? latencies[p95Index] ?? latencies[latencies.length - 1]! : 0;

  return {
    seat,
    agentId,
    decisions: seatDecisions.length,
    ownDecisions,
    fallbackDecisions,
    invalidActions: seatDecisions.filter((d) => d.malformed).length,
    timeouts: seatDecisions.filter((d) => d.timedOut).length,
    fallbacks: fallbackDecisions,
    latencyMean,
    latencyP95,
  };
}

export async function runMatch(setup: MatchSetup): Promise<MatchResult> {
  const matchId = setup.matchId ?? randomUUID();
  const seed = setup.seed ?? MATCH.seed;
  const seats: Seats = setup.engineSeats ?? ['human', 'human'];
  const sim = Simulation.create(seed, seats, setup.config.variation === 'seeded' ? 'seeded' : 'none');

  const seat1Process = seats[0] === 'varek' ? null : setup.agentFactories[0].create(1, seed);
  const seat2Process = seats[1] === 'varek' ? null : setup.agentFactories[1].create(2, seed);

  const scheduler = new ArenaScheduler(sim, setup.config, seat1Process, seat2Process);
  const recorder = setup.recordPath ? new DecisionRecorder(setup.recordPath, matchId) : null;

  const allDecisions: DecisionResult[] = [];
  let ticks = 0;

  try {
    while (ticks < setup.config.maxTicks && sim.world.winner === 0) {
      if (scheduler.shouldDecide(ticks)) {
        await scheduler.requestDecisions(ticks);
        const decisions = await scheduler.collectDecisions();
        allDecisions.push(...decisions);

        if (recorder) {
          for (const decision of decisions) {
            await recorder.recordDecision(decision, sim, setup.config.seats[decision.seat - 1]!.agentId);
          }
        }
      }

      sim.step();
      ticks = sim.world.tick;

      if (scheduler.isSeatForfeited(1) || scheduler.isSeatForfeited(2)) {
        break;
      }
    }
  } finally {
    scheduler.cleanup();
    if (recorder) {
      await recorder.close();
    }
  }

  const seat1Metrics = calculateMetrics(allDecisions, setup.config.seats[0].agentId, 1);
  const seat2Metrics = calculateMetrics(allDecisions, setup.config.seats[1].agentId, 2);

  const fallbackShare1 = seat1Metrics.decisions > 0 ? seat1Metrics.fallbackDecisions / seat1Metrics.decisions : 0;
  const fallbackShare2 = seat2Metrics.decisions > 0 ? seat2Metrics.fallbackDecisions / seat2Metrics.decisions : 0;
  const validForBenchmark = fallbackShare1 <= setup.config.fallbackInvalidThreshold && fallbackShare2 <= setup.config.fallbackInvalidThreshold;

  setup.onFinished?.(sim);

  const endReason = determineEndReason(
    sim,
    ticks,
    setup.config.maxTicks,
    scheduler.isSeatForfeited(1),
    scheduler.isSeatForfeited(2),
  );

  return {
    matchId,
    seed,
    status: 'completed',
    winner: sim.world.winner,
    ticks,
    finalChecksum: sim.hashState(),
    endReason,
    engineVersion: '0.0.0',
    commitSha: 'unknown',
    config: setup.config,
    seats: [seat1Metrics, seat2Metrics],
    validForBenchmark,
    invalidReason: validForBenchmark ? undefined : `Fallback share exceeded threshold: seat1=${fallbackShare1.toFixed(2)}, seat2=${fallbackShare2.toFixed(2)}`,
  };
}
