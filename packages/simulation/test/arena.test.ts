import { BUILDINGS, ENEMY_ID, MATCH, PLAYER_ID } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/index.ts';

const KEEP_AWAY = 60;

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

  it('finishes the unattended seed on a known tick and checksum', () => {
    const sim = Simulation.create();
    let guard = 0;
    while (sim.world.winner === 0 && guard < 8000) {
      sim.step();
      guard += 1;
    }
    expect(sim.world.winner).toBe(ENEMY_ID);
    expect({ tick: sim.world.tick, hash: sim.hashState() }).toEqual({ tick: 3333, hash: 1794058122 });
  });
});
