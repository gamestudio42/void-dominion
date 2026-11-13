#!/usr/bin/env node
/**
 * Deterministic agent example for Agent Arena.
 * This agent always responds with noop actions, providing a baseline for testing.
 * Run: node --experimental-transform-types examples/deterministic.ts
 */

import { createJsonlReader, createJsonlWriter, SCHEMA_VERSION, validateObserveRequest } from '../packages/agent-sdk/src/index.ts';

const reader = createJsonlReader(process.stdin);
const writer = createJsonlWriter(process.stdout);

async function main() {
  while (true) {
    const message = await reader.read();
    if (message === null) break;

    const request = validateObserveRequest(message);
    if (!request) {
      console.error('Invalid request received');
      continue;
    }

    await writer.write({
      schemaVersion: SCHEMA_VERSION,
      requestId: request.requestId,
      type: 'agent.act',
      actions: [{ type: 'noop' }],
    });
  }
}

main().catch((err) => {
  console.error('Deterministic agent error:', err);
  process.exit(1);
});
