import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MATCH } from '@void-dominion/content';
import { Simulation, deserializeReplay, serializeReplay } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARENA_CONFIG,
  DEFAULT_SEAT_CONFIG,
  ScriptAgentFactory,
  runMatch,
  type ArenaConfig,
} from '../src/index.ts';

describe('arena replay file', () => {
  it('reproduces the checksum of the match that wrote it', async () => {
    const agentPath = resolve('examples/reference.ts');
    const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 400,
      strategicPeriodTicks: 100,
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'reference', decisionTimeoutMs: 5000 },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'varek', decisionTimeoutMs: 5000 },
      ],
    };
    let captured: Simulation | null = null;
    const result = await runMatch({
      seed: MATCH.seed,
      engineSeats: ['human', 'varek'],
      agentFactories: [factory, factory],
      config,
      onFinished(sim) {
        captured = sim;
      },
    });
    expect(captured).not.toBeNull();
    const sim = captured as Simulation;
    const file = deserializeReplay(serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats }));
    expect(file).not.toBeNull();
    const again = Simulation.replay(file!.commands, file!.ticks, file!);
    expect(again.hashState()).toBe(result.finalChecksum);
    expect(again.world.winner).toBe(result.winner);
  }, 60_000);

  it('replays the published example to the checksum recorded with it', () => {
    const raw = readFileSync(resolve('apps/game/public/replays/reference-varek.json'), 'utf8');
    const recorded = JSON.parse(raw) as { checksum?: unknown };
    const file = deserializeReplay(raw);
    expect(file).not.toBeNull();
    expect(typeof recorded.checksum).toBe('number');
    const sim = Simulation.replay(file!.commands, file!.ticks, file!);
    expect(sim.hashState()).toBe(recorded.checksum);
    expect(sim.world.tick).toBe(file!.ticks);
  });
});