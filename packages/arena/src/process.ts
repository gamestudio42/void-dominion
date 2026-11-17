import { spawn, type ChildProcess } from 'node:child_process';
import { SCHEMA_VERSION, createJsonlReader, createJsonlWriter, validateActResponse, type ActResponse } from '@void-dominion/agent-sdk';

export interface AgentProcess {
  send(request: unknown): Promise<void>;
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
      if (!alive) return null;

      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const message = reader.read();
      const result = await Promise.race([message, timeout]);

      if (result === null) return null;

      const validated = validateActResponse(result);
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
    return {
      async send(_request: unknown): Promise<void> {
        // Deterministic agent ignores requests
      },
      async receive(_timeoutMs: number): Promise<ActResponse | null> {
        return {
          schemaVersion: SCHEMA_VERSION,
          requestId: 'fallback',
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
