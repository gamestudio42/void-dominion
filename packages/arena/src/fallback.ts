import { SCHEMA_VERSION, type ActResponse } from '@void-dominion/agent-sdk';
import type { Simulation } from '@void-dominion/simulation';

/**
 * Fallback agent provides deterministic noop responses.
 * It receives only the authorized observation and submits via the Arena.
 * This is distinguishable from the agent under test.
 */
export class FallbackAgent {
  constructor(
    private readonly _seat: number,
  ) {}

  decide(_sim: Simulation, _requestId: string): ActResponse {
    return {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'fallback',
      type: 'agent.act',
      actions: [{ type: 'noop' }],
    };
  }
}
