import { describe, expect, it } from 'vitest';
import { formatFieldReport } from '../src/report.ts';

describe('field report', () => {
  it('formats a note both players can paste', () => {
    expect(formatFieldReport({
      role: 'guest',
      tick: 4102,
      pingMs: 86,
      iceLocal: 'srflx',
      iceRemote: 'host',
      drops: 1,
      audit: 'fail',
      auditReason: 'checksum',
      result: 'defeat',
    })).toBe([
      'void-dominion field test',
      'role: guest',
      'tick: 4102',
      'ping_ms: 86',
      'ice_local: srflx',
      'ice_remote: host',
      'drops: 1',
      'audit: fail checksum',
      'result: defeat',
    ].join('\n'));
  });

  it('names a match that has not ended', () => {
    const text = formatFieldReport({
      role: 'host',
      tick: 40,
      pingMs: null,
      iceLocal: null,
      iceRemote: null,
      drops: 0,
      audit: 'pending',
      auditReason: null,
      result: 'playing',
    });
    expect(text).toContain('ping_ms: none');
    expect(text).toContain('ice_local: unknown');
    expect(text).toContain('audit: pending');
    expect(text).toContain('result: playing');
  });
});
