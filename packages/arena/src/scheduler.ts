import type { ActResponse, ObserveRequest } from '@void-dominion/agent-sdk';
import type { Simulation } from '@void-dominion/simulation';
import { CommanderAdapter, buildObservation } from '@void-dominion/agent';
import type { AgentProcess } from './process.ts';
import type { SeatConfig } from './config.ts';
import type { DecisionResult } from './types.ts';
import { FallbackAgent } from './fallback.ts';
import { createHash } from 'node:crypto';

interface SeatState {
  /** Null when the engine's Varek policy drives this seat. No process, no observation. */
  process: AgentProcess | null;
  fallbackAgent: FallbackAgent;
  adapter: CommanderAdapter;
  consecutiveFailures: number;
  forfeited: boolean;
}

/**
 * Arena scheduler manages decision timing and failure policies.
 * It owns the clock, sends observations, waits for decisions, validates responses,
 * applies failure policies, and enqueues commands in deterministic order.
 */
export class ArenaScheduler {
  private readonly seats: [SeatState, SeatState];
  private pendingRequests: Map<number, string> = new Map();

  constructor(
    private readonly sim: Simulation,
    private readonly config: { seats: [SeatConfig, SeatConfig]; strategicPeriodTicks: number },
    seat1Process: AgentProcess | null,
    seat2Process: AgentProcess | null,
  ) {
    this.seats = [
      {
        process: seat1Process,
        fallbackAgent: new FallbackAgent(1),
        adapter: new CommanderAdapter(sim, 1),
        consecutiveFailures: 0,
        forfeited: false,
      },
      {
        process: seat2Process,
        fallbackAgent: new FallbackAgent(2),
        adapter: new CommanderAdapter(sim, 2),
        consecutiveFailures: 0,
        forfeited: false,
      },
    ];
  }

  shouldDecide(tick: number): boolean {
    return tick % this.config.strategicPeriodTicks === 0;
  }

  async requestDecisions(tick: number): Promise<void> {
    const requestId = `tick-${tick}`;
    for (let seatIndex = 0; seatIndex < 2; seatIndex++) {
      const seat = seatIndex + 1;
      const state = this.seats[seatIndex]!;
      if (!state.process || state.forfeited) continue;
      if (this.pendingRequests.has(seat)) {
        throw new Error(`Seat ${seat} already has a pending decision`);
      }
      const observation = buildObservation(this.sim, seat, requestId);
      try {
        await state.process.send(observation);
        this.pendingRequests.set(seat, requestId);
      } catch {
        state.consecutiveFailures += 1;
      }
    }
  }

  async collectDecisions(): Promise<DecisionResult[]> {
    const results: DecisionResult[] = [];
    const tick = this.sim.world.tick;

    for (let seatIndex = 0; seatIndex < 2; seatIndex++) {
      const seat = seatIndex + 1;
      const state = this.seats[seatIndex]!;
      const seatConfig = this.config.seats[seatIndex]!;

      if (!state.process) continue;

      if (state.forfeited) {
        results.push({
          seat,
          tick,
          response: null,
          decisionMs: 0,
          timedOut: false,
          crashed: false,
          malformed: false,
          fallbackUsed: false,
        });
        continue;
      }

      const requestId = this.pendingRequests.get(seat);
      if (!requestId) continue;

      const startMs = Date.now();
      let response: ActResponse | null = null;
      let timedOut = false;
      let crashed = false;
      let malformed = false;
      let fallbackUsed = false;

      try {
        response = await state.process.receive(seatConfig.decisionTimeoutMs);
        if (response === null) {
          timedOut = true;
        } else if (response.requestId !== requestId) {
          malformed = true;
          response = null;
        }
      } catch {
        crashed = true;
      }

      const decisionMs = Date.now() - startMs;

      if (timedOut || crashed || malformed) {
        state.consecutiveFailures += 1;

        if (state.consecutiveFailures >= seatConfig.maxConsecutiveFailures && seatConfig.failurePolicy === 'forfeit') {
          state.forfeited = true;
        }

        if (seatConfig.failurePolicy === 'fallback') {
          response = state.fallbackAgent.decide(this.sim, requestId);
          fallbackUsed = true;
        }
      } else {
        state.consecutiveFailures = 0;
      }

      if (response && !fallbackUsed) {
        for (const action of response.actions) {
          state.adapter.applyAction(action);
        }
      } else if (response && fallbackUsed) {
        for (const action of response.actions) {
          state.adapter.applyAction(action);
        }
      }

      results.push({
        seat,
        tick,
        response,
        decisionMs,
        timedOut,
        crashed,
        malformed,
        fallbackUsed,
      });

      this.pendingRequests.delete(seat);
    }

    return results;
  }

  isSeatForfeited(seat: number): boolean {
    return this.seats[seat - 1]!.forfeited;
  }

  cleanup(): void {
    for (const state of this.seats) {
      state.process?.kill();
    }
  }

  hashObservation(observation: ObserveRequest): string {
    const canonical = JSON.stringify(observation, Object.keys(observation).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }
}
