/**
 * JSONL (JSON Lines) transport utilities for agent communication.
 * Each message is a single line of JSON terminated by \n.
 */

import type { Readable, Writable } from 'node:stream';

export interface JsonlReader {
  read(): Promise<unknown | null>;
  close(): void;
}

/**
 * What `read()` returns for a line that is not JSON. A stray print in an agent
 * must not throw inside the stream handler, so the line becomes a value every
 * validator rejects.
 */
export interface MalformedLine {
  type: 'jsonl.malformed';
  /** The first 200 characters of the line, for logs. */
  line: string;
}

export function isMalformedLine(value: unknown): value is MalformedLine {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'jsonl.malformed';
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return { type: 'jsonl.malformed', line: line.slice(0, 200) } satisfies MalformedLine;
  }
}

export interface JsonlWriter {
  write(value: unknown): Promise<void>;
  close(): Promise<void>;
}

export function createJsonlReader(stream: Readable): JsonlReader {
  let buffer = '';
  let closed = false;
  const lines: string[] = [];
  let resolve: ((value: unknown | null) => void) | null = null;

  stream.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffer += chunk.toString('utf8');
    const parts = buffer.split('\n');
    buffer = parts[parts.length - 1]!;
    for (let i = 0; i < parts.length - 1; i++) {
      const line = parts[i]!.trim();
      if (line.length > 0) {
        lines.push(line);
        if (resolve) {
          const pending = resolve;
          resolve = null;
          pending(parseLine(lines.shift()!));
        }
      }
    }
  });

  stream.on('end', () => {
    closed = true;
    if (resolve) {
      const pending = resolve;
      resolve = null;
      pending(null);
    }
  });

  stream.on('error', () => {
    closed = true;
    if (resolve) {
      const pending = resolve;
      resolve = null;
      pending(null);
    }
  });

  return {
    async read(): Promise<unknown | null> {
      if (closed) return null;
      if (lines.length > 0) {
        return parseLine(lines.shift()!);
      }
      return new Promise((res) => {
        resolve = res;
      });
    },
    close() {
      closed = true;
      stream.destroy();
    },
  };
}

export function createJsonlWriter(stream: Writable): JsonlWriter {
  return {
    async write(value: unknown): Promise<void> {
      return new Promise((resolve, reject) => {
        const line = JSON.stringify(value) + '\n';
        stream.write(line, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    async close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
