import { ENEMY_ID, MATCH, PLAYER_ID } from '@void-dominion/content';
import { describe, expect, it } from 'vitest';
import { applyCommand, considerCommander, makeUnit, observe, Simulation } from '../src/index.ts';

function enemyCenter(sim: Simulation): number {
  const center = sim.world.buildings.find((building) => building.owner === ENEMY_ID && building.kind === 'command_center');
  if (!center) throw new Error('missing enemy command center');
  return center.id;
}

function sameSteps(left: Simulation, right: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    left.step();
    right.step();
  }
}

describe('commander gateway', () => {
  it('omits hidden enemies from the view', () => {
    const sim = Simulation.create();
    const view = observe(sim.world, ENEMY_ID);
    const hidden = MATCH.bases.find((base) => base.id === PLAYER_ID);
    expect(hidden).toBeTruthy();
    expect(view.units.every((unit) => unit.owner === ENEMY_ID)).toBe(true);
    expect(view.buildings.every((building) => building.owner === ENEMY_ID)).toBe(true);
    expect(view.nodes.some((node) => node.x === hidden!.ore.x && node.y === hidden!.ore.y)).toBe(false);
    expect(view.nodes.some((node) => node.x === MATCH.bases[1]!.ore.x && node.y === MATCH.bases[1]!.ore.y)).toBe(true);
  });

  it('falls back when the source is absent, malformed or throws', () => {
    const proposals: unknown[] = [null, { type: 'teleport' }];
    for (const proposal of proposals) {
      const clean = Simulation.create();
      const sim = Simulation.create();
      expect(considerCommander(sim.world, ENEMY_ID, { propose: () => proposal }).status).toBe('fallback');
      sameSteps(clean, sim, 80);
      expect(sim.hashState()).toBe(clean.hashState());
    }
    const clean = Simulation.create();
    const crashed = Simulation.create();
    expect(
      considerCommander(crashed.world, ENEMY_ID, {
        propose() {
          throw new Error('timeout');
        },
      }).status,
    ).toBe('fallback');
    sameSteps(clean, crashed, 80);
    expect(crashed.hashState()).toBe(clean.hashState());
  });

  it('refuses another player and leaves the checksum untouched', () => {
    const clean = Simulation.create();
    const sim = Simulation.create();
    const human = sim.world.units.find((unit) => unit.owner === PLAYER_ID);
    const result = considerCommander(sim.world, ENEMY_ID, {
      propose: () => ({ type: 'group', playerId: PLAYER_ID, unitIds: [human!.id], to: { x: 30, y: 90 } }),
    });
    expect(result).toEqual({ status: 'refused', reason: 'not_owner' });
    expect(sim.hashState()).toBe(clean.hashState());
    sameSteps(clean, sim, 40);
    expect(sim.hashState()).toBe(clean.hashState());
  });

  it('turns produce and group into the same commands a player can issue', () => {
    const viaPlan = Simulation.create();
    const viaCommand = Simulation.create();
    const buildingId = enemyCenter(viaPlan);
    const produced = considerCommander(viaPlan.world, ENEMY_ID, {
      propose: () => ({ type: 'produce', playerId: ENEMY_ID, buildingId, kind: 'engineer' }),
    });
    expect(produced.status).toBe('accepted');
    expect(applyCommand(viaCommand.world, { type: 'produce', playerId: ENEMY_ID, buildingId, kind: 'engineer' })).toBeNull();
    expect(viaPlan.hashState()).toBe(viaCommand.hashState());

    const grouped = Simulation.create();
    const moved = Simulation.create();
    const unitIds = grouped.world.units.filter((unit) => unit.owner === ENEMY_ID).map((unit) => unit.id);
    const to = { x: 100, y: 36 };
    expect(
      considerCommander(grouped.world, ENEMY_ID, {
        propose: () => ({ type: 'group', playerId: ENEMY_ID, unitIds, to }),
      }).status,
    ).toBe('accepted');
    expect(applyCommand(moved.world, { type: 'move', playerId: ENEMY_ID, unitIds, to })).toBeNull();
    expect(grouped.hashState()).toBe(moved.hashState());
  });

  it('defends with the same attack-move a player can issue', () => {
    const viaPlan = Simulation.create();
    const viaCommand = Simulation.create();
    const rifle = makeUnit(viaPlan.world, ENEMY_ID, 'rifleman', 100, 30);
    viaPlan.world.units.push(rifle);
    viaCommand.world.units.push(makeUnit(viaCommand.world, ENEMY_ID, 'rifleman', 100, 30));
    const at = { x: 90, y: 40 };
    expect(considerCommander(viaPlan.world, ENEMY_ID, { propose: () => ({ type: 'defend', playerId: ENEMY_ID, at }) }).status).toBe(
      'accepted',
    );
    expect(applyCommand(viaCommand.world, { type: 'attack_move', playerId: ENEMY_ID, unitIds: [rifle.id], to: at })).toBeNull();
    expect(viaPlan.hashState()).toBe(viaCommand.hashState());
  });

  it('refuses a defend plan when that player has no soldiers', () => {
    const clean = Simulation.create();
    const sim = Simulation.create();
    const result = considerCommander(sim.world, ENEMY_ID, {
      propose: () => ({ type: 'defend', playerId: ENEMY_ID, at: { x: 90, y: 40 } }),
    });
    expect(result).toEqual({ status: 'refused', reason: 'unknown_unit' });
    expect(sim.hashState()).toBe(clean.hashState());
  });

  it('keeps two hosts in lockstep when they feed the same plan', () => {
    const left = Simulation.create();
    const right = Simulation.create();
    const unitIds = left.world.units.filter((unit) => unit.owner === ENEMY_ID).map((unit) => unit.id);
    const plan = { type: 'group', playerId: ENEMY_ID, unitIds, to: { x: 100, y: 36 } };
    expect(considerCommander(left.world, ENEMY_ID, { propose: () => plan }).status).toBe('accepted');
    expect(considerCommander(right.world, ENEMY_ID, { propose: () => plan }).status).toBe('accepted');
    sameSteps(left, right, 40);
    expect(left.hashState()).toBe(right.hashState());
    const plain = Simulation.create();
    for (let tick = 0; tick < 40; tick++) plain.step();
    expect(left.hashState()).not.toBe(plain.hashState());
  });
});
