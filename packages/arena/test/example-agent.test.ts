import { MATCH } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, ScriptAgentFactory, runMatch, type ArenaConfig } from '../src/index.ts';
import { resolve } from 'node:path';

describe('Example Agent', () => {
  it('issues non-noop commands that are accepted', async () => {
    const agentPath = resolve(process.cwd(), 'examples/deterministic.ts');
    const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 1500,
      strategicPeriodTicks: 50,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 5000 },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'deterministic', decisionTimeoutMs: 5000 },
      ],
    };

    const result = await runMatch({
      seed: MATCH.seed,
      agentFactories: [factory, factory],
      config,
    });

    expect(result.status).toBe('completed');
    const seat1 = result.seats[0]!;
    expect(seat1.decisions).toBeGreaterThan(0);
    expect(seat1.ownDecisions).toBeGreaterThan(0);
    expect(seat1.ownDecisions).toBe(seat1.decisions);
  }, 60_000);

  it('plays against Varek, alternating the external seat', async () => {
    const agentPath = resolve(process.cwd(), 'examples/deterministic.ts');
    const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
    const seeds = [MATCH.seed, MATCH.seed + 1, MATCH.seed + 2];

    for (let index = 0; index < seeds.length; index++) {
      const externalSeat = index % 2 === 0 ? 1 : 2;
      const config: ArenaConfig = {
        ...DEFAULT_ARENA_CONFIG,
        maxTicks: 400,
        strategicPeriodTicks: 100,
        seats: [
          { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 1 ? 'deterministic' : 'varek', decisionTimeoutMs: 5000 },
          { ...DEFAULT_SEAT_CONFIG, agentId: externalSeat === 2 ? 'deterministic' : 'varek', decisionTimeoutMs: 5000 },
        ],
      };

      const result = await runMatch({
        seed: seeds[index],
        engineSeats: externalSeat === 1 ? ['human', 'varek'] : ['varek', 'human'],
        agentFactories: [factory, factory],
        config,
      });

      expect(result.status).toBe('completed');
      expect(result.endReason).toBe('tick_cap');
      const external = result.seats[externalSeat - 1]!;
      const varek = result.seats[externalSeat === 1 ? 1 : 0]!;
      expect(external.agentId).toBe('deterministic');
      expect(external.ownDecisions).toBeGreaterThan(0);
      expect(external.fallbackDecisions).toBe(0);
      expect(varek.agentId).toBe('varek');
      expect(varek.decisions).toBe(0);
    }
  }, 60_000);
});
