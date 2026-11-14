import { MATCH } from '@void-dominion/content';
import { Simulation, deserializeReplay } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { playLocalMatch } from '../src/local-match.ts';

describe('local arena match', () => {
  it('exports a replay whose checksum is the match that was played', async () => {
    const result = await playLocalMatch({
      seed: MATCH.seed,
      seats: ['human', 'varek'],
      maxTicks: 240,
      agents: [
        {
          seat: 1,
          async act(observe) {
            const engineers = observe.units.filter((unit) => unit.owner === observe.seat && unit.kind === 'engineer');
            const ore = observe.nodes.find((node) => node.kind === 'ore');
            if (engineers.length === 0 || !ore) return [{ type: 'noop' }];
            return [{
              type: 'command',
              command: { type: 'gather', unitIds: engineers.map((unit) => unit.id), nodeId: ore.id },
            }];
          },
        },
      ],
    });
    const file = deserializeReplay(result.replay);
    expect(file).not.toBeNull();
    const again = Simulation.replay(file!.commands, file!.ticks, { seed: file!.seed, seats: file!.seats });
    expect(again.hashState()).toBe(result.checksum);
    expect(again.world.tick).toBe(result.ticks);
    expect(again.world.winner).toBe(result.winner);
    const saved = JSON.parse(result.replay) as { version: number; checksum: number };
    expect(saved.version).toBe(2);
    expect(saved.checksum).toBe(result.checksum);
  });

  it('keeps both human seats in the file and drops an invalid action', async () => {
    const result = await playLocalMatch({
      seed: MATCH.seed,
      seats: ['human', 'human'],
      maxTicks: 100,
      agents: [
        { seat: 1, async act() { return [{ type: 'noop' }]; } },
        { seat: 2, async act() { return [{ type: 'command', command: { type: 'gather' } }]; } },
      ],
    });
    expect(result.errors.some((line) => line.startsWith('Seat 2:'))).toBe(true);
    const file = deserializeReplay(result.replay);
    const again = Simulation.replay(file!.commands, file!.ticks, { seed: file!.seed, seats: file!.seats });
    expect(again.hashState()).toBe(result.checksum);
  });
});
