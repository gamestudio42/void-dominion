import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARENA_CONFIG,
  DEFAULT_SEAT_CONFIG,
  ScriptAgentFactory,
  runMatch,
  type ArenaConfig,
  type SeatConfig,
} from '../src/index.ts';

/** A child agent written inline: `reply(req)` returns the line to print, or null for none. */
function agent(body: string): ScriptAgentFactory {
  const code = `
    const { createInterface } = require('node:readline');
    const delay = Number(process.argv[1] ?? 0);
    const ok = (req) => JSON.stringify({ schemaVersion: '1.0.0', requestId: req.requestId, type: 'agent.act', actions: [{ type: 'noop' }] });
    createInterface({ input: process.stdin }).on('line', (line) => {
      const req = JSON.parse(line);
      ${body}
    });
  `;
  return new ScriptAgentFactory('node', ['-e', code]);
}

function delayed(ms: number): ScriptAgentFactory {
  return agent(`setTimeout(() => process.stdout.write(ok(req) + '\\n'), ${ms});`);
}

const prompt = agent(`process.stdout.write(ok(req) + '\\n');`);
const garbage = agent(`process.stdout.write('not json\\n');`);
const wrongShape = agent(`process.stdout.write(JSON.stringify({ hello: req.requestId }) + '\\n');`);
const quitter = agent(`process.exit(0);`);

function config(maxTicks: number, seats: [Partial<SeatConfig>, Partial<SeatConfig>]): ArenaConfig {
  return {
    ...DEFAULT_ARENA_CONFIG,
    maxTicks,
    strategicPeriodTicks: 100,
    seats: [
      { ...DEFAULT_SEAT_CONFIG, agentId: 'one', decisionTimeoutMs: 1000, ...seats[0] },
      { ...DEFAULT_SEAT_CONFIG, agentId: 'two', decisionTimeoutMs: 1000, ...seats[1] },
    ],
  };
}

describe('arena agent failures', () => {
  it('survives a line that is not JSON and counts it as malformed, not as a timeout', async () => {
    const result = await runMatch({ agentFactories: [garbage, prompt], config: config(300, [{}, {}]) });
    const [bad, good] = result.seats;
    expect(result.status).toBe('completed');
    expect(bad.decisions).toBe(3);
    expect(bad.invalidActions).toBe(3);
    expect(bad.timeouts).toBe(0);
    expect(bad.fallbackDecisions).toBe(3);
    expect(good.ownDecisions).toBe(3);
    expect(good.invalidActions).toBe(0);
  }, 30_000);

  it('counts JSON that is not an agent.act as malformed', async () => {
    const result = await runMatch({ agentFactories: [wrongShape, prompt], config: config(200, [{}, {}]) });
    expect(result.seats[0].invalidActions).toBe(2);
    expect(result.seats[0].timeouts).toBe(0);
  }, 30_000);

  it('treats an agent that exits as crashed, not as a timeout', async () => {
    const result = await runMatch({ agentFactories: [quitter, prompt], config: config(300, [{}, {}]) });
    expect(result.seats[0].timeouts).toBe(0);
    expect(result.seats[0].invalidActions).toBe(0);
    expect(result.seats[0].fallbackDecisions).toBe(3);
  }, 30_000);

  it('gives seat 2 the same time as seat 1 and measures it from its own send', async () => {
    const result = await runMatch({ agentFactories: [delayed(700), delayed(1500)], config: config(200, [{}, {}]) });
    const [first, second] = result.seats;
    expect(first.ownDecisions).toBe(2);
    expect(first.latencyMean).toBeGreaterThanOrEqual(600);
    /** Waited after seat 1, seat 2 used to get 1700 ms and answer in time. */
    expect(second.timeouts).toBe(2);
    /** The late reply to the first request reaches the second wait and is dropped, not read as malformed. */
    expect(second.invalidActions).toBe(0);
  }, 30_000);

  it('reports a fair latency for seat 2 when both answer in time', async () => {
    const result = await runMatch({ agentFactories: [delayed(600), delayed(600)], config: config(200, [{}, {}]) });
    const [first, second] = result.seats;
    expect(second.ownDecisions).toBe(2);
    /** Measured after seat 1 had been waited for, this read close to 0. */
    expect(second.latencyMean).toBeGreaterThanOrEqual(500);
    expect(Math.abs(second.latencyMean - first.latencyMean)).toBeLessThan(300);
  }, 30_000);

  it('gives a forfeit to the other seat', async () => {
    const result = await runMatch({
      agentFactories: [garbage, prompt],
      config: config(2000, [{ failurePolicy: 'forfeit', maxConsecutiveFailures: 2 }, {}]),
    });
    expect(result.endReason).toBe('forfeit');
    expect(result.winner).toBe(2);
  }, 30_000);
});
