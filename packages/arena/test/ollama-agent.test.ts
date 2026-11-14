import { describe, expect, it } from 'vitest';
import { validateActResponse } from '@void-dominion/agent-sdk';
import { actionsFromModelText, buildPrompt, decide, type ModelClient } from '../../../examples/ollama.ts';
import type { ObserveRequest } from '@void-dominion/agent-sdk';

function observe(): ObserveRequest {
  return {
    schemaVersion: '1.0.0',
    requestId: 'tick-100',
    type: 'agent.observe',
    seat: 1,
    tick: 100,
    ore: 180,
    aether: 0,
    units: [
      { id: 4, owner: 1, kind: 'engineer', x: 15.5, y: 99.5, hp: 40 },
      { id: 8, owner: 1, kind: 'rifleman', x: 20, y: 90, hp: 45 },
      { id: 30, owner: 2, kind: 'rifleman', x: 40, y: 40, hp: 45 },
    ],
    buildings: [
      { id: 1, owner: 1, kind: 'command_center', x: 8, y: 96, hp: 1500, wreck: false },
      { id: 9, owner: 2, kind: 'command_center', x: 112, y: 24, hp: 1500, wreck: false },
    ],
    nodes: [{ id: 2, kind: 'ore', x: 16, y: 100 }],
  };
}

const client =
  (text: string): ModelClient => ({
    complete: async () => text,
  });

describe('ollama agent', () => {
  it('asks only about what the observation contains', () => {
    const prompt = buildPrompt(observe());
    expect(prompt).toContain('Engineers: 4@15,99');
    expect(prompt).toContain('Nearest ore node #2');
    expect(prompt).toContain('enemy command_center#9');
    expect(prompt).toContain('Prefer build_extractor');
    expect(prompt).not.toContain('amount');
  });

  it('reads JSON, fenced JSON, and shorthand commands, and drops unknown ids', () => {
    const obs = observe();
    const fenced = actionsFromModelText(
      'Sure.\n```json\n{"actions":[{"type":"gather","unitIds":[4],"nodeId":2},{"type":"gather","unitIds":[99],"nodeId":2}]}\n```',
      obs,
    );
    expect(fenced).toEqual([{ type: 'command', command: { type: 'gather', unitIds: [4], nodeId: 2 } }]);

    const wrapped = actionsFromModelText(
      '{"type":"command","command":{"type":"produce","buildingId":1,"kind":"engineer"}}',
      obs,
    );
    expect(wrapped[0]).toEqual({ type: 'command', command: { type: 'produce', buildingId: 1, kind: 'engineer' } });

    expect(actionsFromModelText('I choose to wait.', obs)).toEqual([]);
    expect(actionsFromModelText('{"type":"teleport","unitIds":[4]}', obs)).toEqual([]);
  });

  it('uses a fake client and still emits a valid act', async () => {
    const obs = observe();
    const actions = await decide(
      obs,
      client('{"actions":[{"type":"attack_move","unitIds":[8],"to":{"x":112,"y":30}}]}'),
    );
    expect(actions).toEqual([{ type: 'command', command: { type: 'attack_move', unitIds: [8], to: { x: 112, y: 30 } } }]);
    expect(
      validateActResponse({
        schemaVersion: '1.0.0',
        requestId: obs.requestId,
        type: 'agent.act',
        actions,
      }),
    ).not.toBeNull();

    const failed = await decide(obs, {
      complete: async () => {
        throw new Error('timeout');
      },
    });
    expect(failed).toEqual([{ type: 'noop' }]);
  });
});
