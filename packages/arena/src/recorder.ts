import { createWriteStream, type WriteStream } from 'node:fs';
import { SCHEMA_VERSION } from '@void-dominion/agent-sdk';
import { buildObservation } from '@void-dominion/agent';
import { createHash } from 'node:crypto';
import type { Simulation } from '@void-dominion/simulation';
import type { DecisionResult, TraceEvent } from './types.ts';

/**
 * Records decision traces to a JSONL file.
 * Each event includes schemaVersion for forward compatibility.
 */
export class DecisionRecorder {
  private readonly stream: WriteStream;

  constructor(
    private readonly path: string,
    private readonly matchId: string,
  ) {
    this.stream = createWriteStream(path, { flags: 'w' });
  }

  async recordDecision(decision: DecisionResult, sim: Simulation, agentId: string): Promise<void> {
    const observation = buildObservation(sim, decision.seat, `tick-${decision.tick}`);
    const canonical = JSON.stringify(observation, Object.keys(observation).sort());
    const observationHash = createHash('sha256').update(canonical).digest('hex');

    const event: TraceEvent = {
      schemaVersion: SCHEMA_VERSION,
      type: 'decision',
      matchId: this.matchId,
      seat: decision.seat,
      tick: decision.tick,
      observationHash,
      agentId: decision.fallbackUsed ? 'fallback' : agentId,
      decisionMs: decision.decisionMs,
      fallbackUsed: decision.fallbackUsed,
      usage: decision.response?.usage,
    };

    await this.write(event);

    if (decision.timedOut) {
      await this.write({
        schemaVersion: SCHEMA_VERSION,
        type: 'timeout',
        matchId: this.matchId,
        seat: decision.seat,
        tick: decision.tick,
      });
    }

    if (decision.fallbackUsed) {
      await this.write({
        schemaVersion: SCHEMA_VERSION,
        type: 'fallback',
        matchId: this.matchId,
        seat: decision.seat,
        tick: decision.tick,
        reason: decision.timedOut ? 'timeout' : decision.crashed ? 'crashed' : 'malformed',
      });
    }
  }

  async recordMatchEnd(winner: number, ticks: number, endReason: string): Promise<void> {
    const event: TraceEvent = {
      schemaVersion: SCHEMA_VERSION,
      type: 'match_end',
      matchId: this.matchId,
      winner,
      ticks,
      endReason: endReason as 'victory' | 'draw' | 'tick_cap' | 'forfeit',
    };
    await this.write(event);
  }

  private async write(event: TraceEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.write(JSON.stringify(event) + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
