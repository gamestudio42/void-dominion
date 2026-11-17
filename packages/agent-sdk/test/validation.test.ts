import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, validateActResponse, validateObserveRequest } from '../src/index.ts';

describe('validation', () => {
  it('accepts a valid observe request', () => {
    const request = {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'test-123',
      type: 'agent.observe',
      seat: 1,
      tick: 0,
      ore: 100,
      aether: 50,
      units: [],
      buildings: [],
      nodes: [],
    };
    expect(validateObserveRequest(request)).toEqual(request);
  });

  it('refuses an observe request with wrong schema version', () => {
    const request = {
      schemaVersion: '0.0.0',
      requestId: 'test-123',
      type: 'agent.observe',
      seat: 1,
      tick: 0,
      ore: 100,
      aether: 50,
      units: [],
      buildings: [],
      nodes: [],
    };
    expect(validateObserveRequest(request)).toBeNull();
  });

  it('accepts a valid act response with noop', () => {
    const response = {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'test-123',
      type: 'agent.act',
      actions: [{ type: 'noop' }],
    };
    expect(validateActResponse(response)).toEqual(response);
  });

  it('accepts a valid act response with strategic plan', () => {
    const response = {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'test-123',
      type: 'agent.act',
      actions: [
        {
          type: 'strategic_plan',
          plan: {
            type: 'group',
            unitIds: [1, 2, 3],
            to: { x: 10, y: 20 },
          },
        },
      ],
    };
    expect(validateActResponse(response)).toEqual(response);
  });

  it('accepts a valid act response with command', () => {
    const response = {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'test-123',
      type: 'agent.act',
      actions: [
        {
          type: 'command',
          command: {
            type: 'move',
            unitIds: [1, 2],
            to: { x: 5, y: 10 },
          },
        },
      ],
    };
    expect(validateActResponse(response)).toEqual(response);
  });

  it('refuses an act response with malformed action', () => {
    const response = {
      schemaVersion: SCHEMA_VERSION,
      requestId: 'test-123',
      type: 'agent.act',
      actions: [{ type: 'invalid' }],
    };
    expect(validateActResponse(response)).toBeNull();
  });
});
