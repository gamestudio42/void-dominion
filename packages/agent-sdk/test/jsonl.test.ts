import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createJsonlReader, isMalformedLine, validateActResponse } from '../src/index.ts';

describe('jsonl reader', () => {
  it('returns a malformed marker for a line that is not JSON and keeps reading', async () => {
    const stream = new PassThrough();
    const reader = createJsonlReader(stream);
    stream.write('print debugging\n{"ok":1}\n');
    const first = await reader.read();
    expect(isMalformedLine(first)).toBe(true);
    expect(validateActResponse(first)).toBeNull();
    expect(await reader.read()).toEqual({ ok: 1 });
  });

  it('does not throw when a bad line arrives while a read is waiting', async () => {
    const stream = new PassThrough();
    const reader = createJsonlReader(stream);
    const waiting = reader.read();
    stream.write('not json\n');
    expect(isMalformedLine(await waiting)).toBe(true);
    stream.end();
    expect(await reader.read()).toBeNull();
  });
});
