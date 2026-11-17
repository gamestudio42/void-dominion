import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_AGENT_SOURCE,
  REPLAY_LINK_LIMIT,
  agentWorkerSource,
  askAgent,
  decodeReplayLink,
  encodeReplayLink,
} from '../src/sandbox.ts';

function runWorker(userCode: string, observe: unknown, timeoutMs: number): Promise<{ id: number; ok: boolean; error?: string; timeout?: boolean; body?: { actions: unknown[] } }> {
  const source = `
    const { parentPort } = require('node:worker_threads');
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    parentPort.on('message', (data) => {
      const handler = globalThis.onmessage;
      if (typeof handler === 'function') handler({ data });
    });
    ${agentWorkerSource(userCode)}
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('worker test timed out'));
    }, 2000);
    worker.once('message', (data) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(data);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
    worker.postMessage({ id: 7, observe, timeoutMs });
  });
}

const observe = {
  schemaVersion: '1.0.0',
  requestId: 'tick-0',
  type: 'agent.observe',
  seat: 1,
  tick: 0,
  ore: 0,
  aether: 0,
  units: [{ id: 3, owner: 1, kind: 'engineer', x: 1, y: 1, hp: 40 }],
  buildings: [],
  nodes: [{ id: 9, kind: 'ore', x: 2, y: 2 }],
};

describe('agent worker', () => {
  it('blocks fetch, XMLHttpRequest, WebSocket and importScripts', async () => {
    const reply = await runWorker(
      `
        function act() {
          const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts'];
          for (const name of names) {
            const value = globalThis[name];
            if (name === 'XMLHttpRequest' || name === 'WebSocket') new value();
            else value('https://example.invalid/arena');
          }
          return { actions: [{ type: 'noop' }] };
        }
      `,
      observe,
      1000,
    );
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('is blocked');
  });

  it('turns a decision that never returns into a timeout', async () => {
    const reply = await runWorker(
      `function act() { return new Promise(function () {}); }`,
      observe,
      40,
    );
    expect(reply.ok).toBe(false);
    expect(reply.timeout).toBe(true);
    expect(reply.error).toBe('decision timed out');
  });

  it('stops a silent endpoint when the deadline passes', async () => {
    let terminated = false;
    const reply = await askAgent(
      {
        postMessage() {},
        terminate() {
          terminated = true;
        },
        listen() {
          return () => {};
        },
      },
      observe,
      20,
    );
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.timeout).toBe(true);
    expect(terminated).toBe(true);
  });

  it('runs the example that fills the editor', async () => {
    const reply = await runWorker(EXAMPLE_AGENT_SOURCE, observe, 1000);
    expect(reply.ok).toBe(true);
    const action = reply.body?.actions[0] as { type: string; command?: { type: string; nodeId: number } };
    expect(action?.type).toBe('command');
    expect(action?.command?.type).toBe('gather');
    expect(action?.command?.nodeId).toBe(9);
  });
});

describe('replay link', () => {
  it('round-trips gzip and base64url', async () => {
    const json = JSON.stringify({ version: 2, seed: 24301, ticks: 4, commands: [{ tick: 0, cmd: { type: 'stop', playerId: 1, unitIds: [1] } }] });
    const encoded = await encodeReplayLink(json);
    expect(encoded).toBeTruthy();
    expect(encoded!.includes('+')).toBe(false);
    expect(encoded!.includes('/')).toBe(false);
    expect(encoded!.includes('=')).toBe(false);
    expect(await decodeReplayLink(encoded!)).toBe(json);
  });

  it('refuses a payload that would exceed the query limit', async () => {
    const commands = Array.from({ length: 8000 }, (_, index) => ({
      tick: index,
      cmd: { type: 'stop', playerId: 1 + (index % 2), unitIds: [index, index + 3, index + 11], note: `order-${index}-${(index * 997).toString(16)}` },
    }));
    const encoded = await encodeReplayLink(JSON.stringify({ version: 2, commands }));
    expect(encoded).toBeNull();
    expect(REPLAY_LINK_LIMIT).toBe(16384);
  });
});
