import { spawn, type ChildProcess } from 'node:child_process';
import { SCHEMA_VERSION, createJsonlReader, createJsonlWriter, validateActResponse, type ActResponse } from '@void-dominion/agent-sdk';

/** The agent answered, but the line is not JSON or is not a valid `agent.act`. */
export class MalformedReplyError extends Error {
  constructor(message = 'agent reply is not a valid agent.act') {
    super(message);
    this.name = 'MalformedReplyError';
  }
}

export interface AgentProcess {
  send(request: unknown): Promise<void>;
  /**
   * The next reply, or null when none arrives within `timeoutMs`.
   * Throws `MalformedReplyError` for a reply that fails validation, and any other
   * error when the agent closed its output or died.
   */
  receive(timeoutMs: number): Promise<ActResponse | null>;
  kill(): void;
  isAlive(): boolean;
}

export function spawnAgentProcess(command: string, args: string[]): AgentProcess {
  const child: ChildProcess = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('Failed to spawn agent process with stdio pipes');
  }

  const writer = createJsonlWriter(child.stdin);
  const reader = createJsonlReader(child.stdout);
  let alive = true;

  child.on('exit', () => {
    alive = false;
  });

  child.on('error', () => {
    alive = false;
  });

  /** Writing to an agent that already exited raises EPIPE on stdin; unhandled, it would end the Arena. */
  child.stdin.on('error', () => {
    alive = false;
  });

  child.stderr.on('data', (chunk: Buffer) => {
    // Log stderr for debugging but do not fail on it
    const message = chunk.toString('utf8').trim();
    if (message.length > 0) {
      console.error(`[agent stderr] ${message}`);
    }
  });

  return {
    async send(request: unknown): Promise<void> {
      if (!alive) throw new Error('Agent process is not alive');
      await writer.write(request);
    },

    async receive(timeoutMs: number): Promise<ActResponse | null> {
      if (!alive) throw new Error('Agent process is not alive');

      const timedOut = Symbol('timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), timeoutMs);
      });
      const result = await Promise.race([reader.read(), timeout]);
      clearTimeout(timer);

      if (result === timedOut) return null;
      if (result === null) throw new Error('Agent process closed its output');

      const validated = validateActResponse(result);
      if (!validated) throw new MalformedReplyError();
      return validated;
    },

    kill() {
      alive = false;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 1000);
    },

    isAlive() {
      return alive;
    },
  };
}

export interface AgentFactory {
  create(seat: number, seed: number): AgentProcess;
}

export class ScriptAgentFactory implements AgentFactory {
  constructor(
    private readonly command: string,
    private readonly args: string[],
  ) {}

  create(_seat: number, _seed: number): AgentProcess {
    return spawnAgentProcess(this.command, this.args);
  }
}

export class DeterministicAgentFactory implements AgentFactory {
  create(_seat: number, _seed: number): AgentProcess {
    /** Echo the last request id, or the scheduler reads every answer as malformed. */
    let requestId = '';
    return {
      async send(request: unknown): Promise<void> {
        const id = (request as { requestId?: unknown } | null)?.requestId;
        requestId = typeof id === 'string' ? id : '';
      },
      async receive(_timeoutMs: number): Promise<ActResponse | null> {
        return {
          schemaVersion: SCHEMA_VERSION,
          requestId,
          type: 'agent.act',
          actions: [{ type: 'noop' }],
        };
      },
      kill() {
        // No-op
      },
      isAlive() {
        return true;
      },
    };
  }
}
