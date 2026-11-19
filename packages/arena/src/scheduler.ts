import type { ActResponse, ObserveRequest } from '@void-dominion/agent-sdk';
import type { Simulation } from '@void-dominion/simulation';
import { CommanderAdapter, buildObservation } from '@void-dominion/agent';
import { MalformedReplyError, type AgentProcess } from './process.ts';
import type { SeatConfig } from './config.ts';
import type { DecisionResult } from './types.ts';
import { FallbackAgent } from './fallback.ts';
import { createHash } from 'node:crypto';

interface Pending {
  requestId: string;
  /** Wall time the observation was written, so each seat's clock starts at its own send. */
  sentAt: number;
  /** The observation could not be written: the agent is gone, and the decision counts as a crash. */
  sendFailed: boolean;
}

interface Reply {
  response: ActResponse | null;
  decisionMs: number;
  timedOut: boolean;
  crashed: boolean;
  malformed: boolean;
}

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
  private pendingRequests: Map<number, Pending> = new Map();

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
      const sentAt = Date.now();
      try {
        await state.process.send(observation);
        this.pendingRequests.set(seat, { requestId, sentAt, sendFailed: false });
      } catch {
        this.pendingRequests.set(seat, { requestId, sentAt, sendFailed: true });
      }
    }
  }

  /**
   * Wait for both seats at once, so seat 2 gets the same time as seat 1 and its
   * latency is measured from its own send. Actions are applied afterwards in seat
   * order, never in arrival order.
   */
  async collectDecisions(): Promise<DecisionResult[]> {
    const tick = this.sim.world.tick;
    const replies = await Promise.all([0, 1].map((seatIndex) => this.awaitReply(seatIndex)));
    const results: DecisionResult[] = [];

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

      const pending = this.pendingRequests.get(seat);
      const reply = replies[seatIndex];
      if (!pending || !reply) continue;
      this.pendingRequests.delete(seat);

      let { response } = reply;
      const { timedOut, crashed, malformed, decisionMs } = reply;
      let fallbackUsed = false;

      if (timedOut || crashed || malformed) {
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= seatConfig.maxConsecutiveFailures && seatConfig.failurePolicy === 'forfeit') {
          state.forfeited = true;
        }
        if (seatConfig.failurePolicy === 'fallback') {
          response = state.fallbackAgent.decide(this.sim, pending.requestId);
          fallbackUsed = true;
        }
      } else {
        state.consecutiveFailures = 0;
      }

      if (response) {
        for (const action of response.actions) {
          state.adapter.applyAction(action);
        }
      }

      results.push({ seat, tick, response, decisionMs, timedOut, crashed, malformed, fallbackUsed });
    }

    return results;
  }

  private async awaitReply(seatIndex: number): Promise<Reply | null> {
    const seat = seatIndex + 1;
    const state = this.seats[seatIndex]!;
    const pending = this.pendingRequests.get(seat);
    if (!state.process || state.forfeited || !pending) return null;

    const reply: Reply = { response: null, decisionMs: 0, timedOut: false, crashed: false, malformed: false };
    if (pending.sendFailed) {
      reply.crashed = true;
      return reply;
    }
    const deadline = pending.sentAt + this.config.seats[seatIndex]!.decisionTimeoutMs;
    try {
      /** A reply to an earlier request arrived late: drop it and keep waiting for this one. */
      for (;;) {
        const response = await state.process.receive(Math.max(0, deadline - Date.now()));
        if (response === null) {
          reply.timedOut = true;
          break;
        }
        if (response.requestId === pending.requestId) {
          reply.response = response;
          break;
        }
      }
    } catch (error) {
      if (error instanceof MalformedReplyError) reply.malformed = true;
      else reply.crashed = true;
    }
    reply.decisionMs = Date.now() - pending.sentAt;
    return reply;
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
