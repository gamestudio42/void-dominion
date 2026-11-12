import { ENEMY_ID, MATCH, PLAYER_ID, BUILDINGS } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { runArena, Simulation, type LoggedCommand } from '../src/index.ts';

const KEEP_AWAY = 60;
const SEEDS = [MATCH.seed, 0x51eed, 0xa11ce] as const;
const OPENING_TICKS = 120;
const CEILING_MS = 20_000;

function playerCenter(): { x: number; y: number } {
  const base = MATCH.bases[0]!;
  return { x: base.cc.x + BUILDINGS.command_center.width / 2, y: base.cc.y + BUILDINGS.command_center.height / 2 };
}

describe('seed arena', () => {
  it('keeps the player base standing until the march is allowed', () => {
    const sim = Simulation.create();
    while (sim.world.tick < MATCH.ai.marchTick) sim.step();
    const center = playerCenter();
    const command = sim.world.buildings.find(
      (building) => building.owner === PLAYER_ID && building.kind === 'command_center',
    );
    expect(command?.hp).toBe(BUILDINGS.command_center.hp);
    for (const unit of sim.world.units) {
      if (unit.owner !== ENEMY_ID || unit.kind !== 'rifleman') continue;
      const dx = unit.x - center.x;
      const dy = unit.y - center.y;
      expect(dx * dx + dy * dy).toBeGreaterThan(KEEP_AWAY * KEEP_AWAY);
    }
  });

  /** The runner's timeout is the same ceiling, so a busy machine fails on it and not on Vitest's 5 s default. */
  it('compares unattended seeds and finishes them within twenty seconds', () => {
    const started = Date.now();
    const reports = SEEDS.map((seed) => runArena(seed));
    expect(Date.now() - started).toBeLessThan(CEILING_MS);
    expect(reports[0]).toMatchObject({
      seed: MATCH.seed >>> 0,
      winner: ENEMY_ID,
      tick: 3338,
      hash: 3280354694,
      steps: 3338,
    });
    for (const report of reports) {
      expect(report.winner).toBe(reports[0]!.winner);
      expect(report.tick).toBe(reports[0]!.tick);
      expect(report.steps).toBe(reports[0]!.steps);
      expect(report.ore).toEqual(reports[0]!.ore);
      expect(report.units).toEqual(reports[0]!.units);
    }
    expect(reports.map((report) => report.hash)).toEqual([3280354694, 2653787263, 3889541598]);
  }, CEILING_MS);

  it('tells a commanded opening apart from the unattended one', () => {
    const unitIds = Simulation.create().world.units.filter((unit) => unit.owner === PLAYER_ID).map((unit) => unit.id);
    const log: LoggedCommand[] = [{ tick: 0, cmd: { type: 'move', playerId: PLAYER_ID, unitIds, to: { x: 30, y: 90 } } }];
    const moved = runArena(MATCH.seed, log, OPENING_TICKS);
    const stayed = runArena(MATCH.seed, [], OPENING_TICKS);
    expect(moved.winner).toBe(0);
    expect(moved.tick).toBe(OPENING_TICKS);
    expect(moved).toEqual(runArena(MATCH.seed, log, OPENING_TICKS));
    expect(moved.hash).not.toBe(stayed.hash);
  });
});
