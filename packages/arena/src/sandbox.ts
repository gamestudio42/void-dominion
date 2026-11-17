/**
 * Browser isolation for a player-supplied agent.
 * The worker source blocks the network APIs named by the Arena page.
 * A decision that does not answer in time is a noop, and the page restarts the worker.
 */

/** One second. A longer wait would freeze the match on a stuck script. */
export const LOCAL_DECISION_TIMEOUT_MS = 1000;

/** Characters of the `replay-data` query value. Past this, only the file is offered. */
export const REPLAY_LINK_LIMIT = 16_384;

/**
 * The script the Arena textarea starts with. `act` receives an `agent.observe`
 * message and returns the actions `enqueue` accepts. `playerId` is not set here.
 */
export const EXAMPLE_AGENT_SOURCE = `// Called every 100 ticks. observe is the agent.observe message for your seat.
// Return { actions }. The seat is added when the command is enqueued.
let decisions = 0;

function act(observe) {
  decisions += 1;
  const engineers = observe.units.filter((unit) => unit.owner === observe.seat && unit.kind === 'engineer');
  const ore = observe.nodes.find((node) => node.kind === 'ore');
  if (engineers.length === 0 || !ore) return { actions: [{ type: 'noop' }] };
  return {
    actions: [{
      type: 'command',
      command: {
        type: 'gather',
        unitIds: engineers.slice(0, 3).map((unit) => unit.id),
        nodeId: ore.id,
      },
    }],
  };
}
`;

const LOCKDOWN = `
(function () {
  function blocked(name) {
    return function networkIsBlocked() {
      throw new Error(name + ' is blocked');
    };
  }
  var names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts'];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    try {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: blocked(name) });
    } catch (error) {
      globalThis[name] = blocked(name);
    }
  }
})();
`;

const HANDLER = `
function normalizeAct(value) {
  if (value && Array.isArray(value.actions)) return { actions: value.actions };
  if (Array.isArray(value)) return { actions: value };
  if (value && value.type) return { actions: [value] };
  return { actions: [{ type: 'noop' }] };
}

globalThis.onmessage = function (event) {
  var message = event.data;
  if (!message || typeof message !== 'object') return;
  var id = message.id;
  var settled = false;
  function finish(payload) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    globalThis.postMessage(payload);
  }
  var timer = setTimeout(function () {
    finish({ id: id, ok: false, error: 'decision timed out', timeout: true });
  }, message.timeoutMs);
  Promise.resolve()
    .then(function () {
      if (typeof act !== 'function') throw new Error('define function act(observe)');
      return act(message.observe);
    })
    .then(function (value) {
      finish({ id: id, ok: true, body: normalizeAct(value) });
    })
    .catch(function (error) {
      finish({ id: id, ok: false, error: error && error.message ? String(error.message) : String(error) });
    });
};
`;

/** Classic-script source for a dedicated worker. User code sits between the lockdown and the handler. */
export function agentWorkerSource(userCode: string): string {
  return `${LOCKDOWN}\n${userCode}\n${HANDLER}`;
}

/** Compile the script on the page so a syntax error is shown before a match starts. */
export function agentSourceError(userCode: string): string | null {
  try {
    new Function(userCode);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export interface AgentEndpoint {
  postMessage(message: unknown): void;
  terminate(): void;
  listen(onMessage: (data: unknown) => void, onError: (message: string) => void): () => void;
}

export type AgentReply =
  | { ok: true; actions: unknown[] }
  | { ok: false; error: string; timeout: boolean };

let nextDecisionId = 1;

/**
 * Ask one worker for one decision. A missing answer terminates the endpoint so a
 * tight loop cannot keep the next tick waiting, and the caller treats it as a noop.
 */
export function askAgent(endpoint: AgentEndpoint, observe: unknown, timeoutMs: number): Promise<AgentReply> {
  const id = nextDecisionId;
  nextDecisionId += 1;
  return new Promise((resolve) => {
    let settled = false;
    let stop = () => {};
    const finish = (result: AgentReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      resolve(result);
    };
    stop = endpoint.listen(
      (data) => {
        if (!data || typeof data !== 'object') return;
        const message = data as { id?: unknown; ok?: unknown; body?: { actions?: unknown }; error?: unknown; timeout?: unknown };
        if (message.id !== id) return;
        if (message.ok === true && message.body && Array.isArray(message.body.actions)) {
          finish({ ok: true, actions: message.body.actions });
          return;
        }
        const timeout = message.timeout === true;
        if (timeout) endpoint.terminate();
        finish({
          ok: false,
          error: typeof message.error === 'string' ? message.error : 'agent failed',
          timeout,
        });
      },
      (error) => {
        endpoint.terminate();
        finish({ ok: false, error, timeout: false });
      },
    );
    const timer = setTimeout(() => {
      endpoint.terminate();
      finish({ ok: false, error: 'decision timed out', timeout: true });
    }, timeoutMs);
    try {
      endpoint.postMessage({ id, observe, timeoutMs });
    } catch (error) {
      endpoint.terminate();
      finish({ ok: false, error: error instanceof Error ? error.message : String(error), timeout: false });
    }
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Gzip plus base64url. Null when the query value would pass the limit. */
export async function encodeReplayLink(json: string): Promise<string | null> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = bytesToBase64Url(bytes);
  return encoded.length > REPLAY_LINK_LIMIT ? null : encoded;
}

export async function decodeReplayLink(encoded: string): Promise<string> {
  const bytes = base64UrlToBytes(encoded);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
