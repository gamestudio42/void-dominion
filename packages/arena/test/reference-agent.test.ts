import { MATCH } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG, ScriptAgentFactory, runMatch, type ArenaConfig } from '../src/index.ts';
import { createMemory, decide } from '../../../examples/reference.ts';
import type { ObserveRequest } from '@void-dominion/agent-sdk';

function observe(patch: Partial<ObserveRequest>): ObserveRequest {
  return {
    schemaVersion: '1.0.0',
    requestId: 'tick-0',
    type: 'agent.observe',
    seat: 1,
    tick: 0,
    ore: 50,
    aether: 0,
    units: [],
    buildings: [
      { id: 1, owner: 1, kind: 'command_center', x: 8, y: 96, hp: 1500, wreck: false },
    ],
    nodes: [{ id: 2, kind: 'ore', x: 16, y: 100 }],
    ...patch,
  };
}

const engineers = [10, 11, 12, 13].map((id, index) => ({
  id,
  owner: 1,
  kind: 'engineer',
  x: 15 + (index % 2),
  y: 99,
  hp: 40,
}));

describe('reference agent', () => {
  it('builds an extractor from the observation once ore allows it', () => {
    const early = decide(observe({ ore: 50, units: engineers }), createMemory());
    expect(early.map((action) => action.type)).toEqual(['noop']);

    const opening = decide(observe({ ore: 200, tick: 100, units: engineers }), createMemory());
    const build = opening.find((action) => action.type === 'command' && action.command.type === 'build');
    expect(build && build.type === 'command' && build.command.type === 'build' ? build.command.kind : null).toBe('ore_extractor');
  });

  it('holds a small squad and attacks a command center that is in sight', () => {
    const rifles = Array.from({ length: 8 }, (_, index) => ({
      id: 20 + index,
      owner: 1,
      kind: 'rifleman',
      x: 112,
      y: 30,
      hp: 45,
    }));
    const obs = observe({
      tick: 3000,
      ore: 400,
      units: [
        ...engineers,
        ...rifles,
        { id: 90, owner: 2, kind: 'rifleman', x: 10, y: 98, hp: 45 },
      ],
      buildings: [
        { id: 1, owner: 1, kind: 'command_center', x: 8, y: 96, hp: 1500, wreck: false },
        { id: 4, owner: 1, kind: 'barracks', x: 8, y: 92, hp: 900, wreck: false },
        { id: 5, owner: 1, kind: 'defense_turret', x: 14, y: 96, hp: 350, wreck: false },
        { id: 8, owner: 2, kind: 'command_center', x: 112, y: 24, hp: 1500, wreck: false },
      ],
    });
    const home = decide(obs, createMemory());
    const defense = home.find((action) => action.type === 'command' && action.command.type === 'attack');
    expect(defense && defense.type === 'command' && defense.command.type === 'attack' ? defense.command.targetId : 0).toBe(90);

    const away = decide(
      observe({
        ...obs,
        units: obs.units.filter((unit) => unit.id !== 90),
      }),
      createMemory(),
    );
    const pushed = away.find((action) => action.type === 'command' && action.command.type === 'attack');
    expect(pushed && pushed.type === 'command' && pushed.command.type === 'attack' ? pushed.command.targetId : 0).toBe(8);
  });

  it('repeats itself for the same observation stream', () => {
    const frames = [
      observe({ ore: 200, tick: 0, units: engineers }),
      observe({ ore: 180, tick: 100, units: engineers, buildings: [
        { id: 1, owner: 1, kind: 'command_center', x: 8, y: 96, hp: 1500, wreck: false },
        { id: 3, owner: 1, kind: 'ore_extractor', x: 14, y: 98, hp: 500, wreck: false },
      ] }),
    ];
    const left = createMemory();
    const right = createMemory();
    const a = frames.map((frame) => decide(frame, left));
    const b = frames.map((frame) => decide(frame, right));
    expect(a).toEqual(b);
  });

  it('matches its own checksum against Varek on one seeded match', async () => {
    const agentPath = resolve(process.cwd(), 'examples/reference.ts');
    const factory = new ScriptAgentFactory('node', ['--experimental-transform-types', '--no-warnings', agentPath]);
    const config: ArenaConfig = {
      ...DEFAULT_ARENA_CONFIG,
      maxTicks: 600,
      strategicPeriodTicks: 100,
      variation: 'seeded',
      seats: [
        { ...DEFAULT_SEAT_CONFIG, agentId: 'reference', decisionTimeoutMs: 5000 },
        { ...DEFAULT_SEAT_CONFIG, agentId: 'varek', decisionTimeoutMs: 5000 },
      ],
    };
    const play = () =>
      runMatch({
        seed: MATCH.seed,
        engineSeats: ['human', 'varek'],
        agentFactories: [factory, factory],
        config,
      });
    const first = await play();
    const second = await play();
    expect(first.status).toBe('completed');
    expect(first.endReason).toBe('tick_cap');
    expect(first.finalChecksum).toBe(second.finalChecksum);
    expect(first.seats[0]!.ownDecisions).toBeGreaterThan(0);
    expect(first.seats[0]!.fallbackDecisions).toBe(0);
    expect(first.seats[1]!.decisions).toBe(0);
  }, 60_000);
});
