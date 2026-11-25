import { BUILDINGS, VAREK_LEVELS } from '@void-dominion/content';
import { deserializeReplay, makeBuilding, makeUnit, serializeReplay, Simulation, varekLevel } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { en, ptBR, reasonHelp } from '../../../apps/game/src/locales.ts';
import { OpeningGuide, SKIRMISH_LEVELS, skirmishSeats } from '../../../apps/game/src/opening.ts';

describe('human skirmish setup', () => {
  it('keeps normal identical to the published default', () => {
    expect(SKIRMISH_LEVELS).toEqual(Object.keys(VAREK_LEVELS));
    const actual = Simulation.create(undefined, skirmishSeats());
    const reference = Simulation.create();
    for (let n = 0; n < 600; n++) { actual.step(); reference.step(); }
    expect(actual.seats).toEqual(reference.seats);
    expect(actual.hashState()).toBe(reference.hashState());
  });

  for (const level of SKIRMISH_LEVELS) {
    it(`starts and independently replays a human match against ${level}`, () => {
      const sim = Simulation.create(undefined, skirmishSeats(level));
      expect(sim.seats[0]).toBe('human');
      expect(varekLevel(sim.seats[1])).toBe(level);
      const hall = sim.world.buildings.find(building => building.owner === 1)!;
      sim.enqueue({ type: 'produce', playerId: 1, buildingId: hall.id, kind: 'engineer' });
      for (let n = 0; n < 600; n++) sim.step();
      const file = deserializeReplay(serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats }))!;
      expect(file.seats).toEqual(sim.seats);
      expect(Simulation.replay(file.commands, file.ticks, file).hashState()).toBe(sim.hashState());
    });
  }
});

describe('opening guidance', () => {
  it('follows observed selection, construction, accepted training and the first rifleman', () => {
    const sim = Simulation.create();
    const guide = new OpeningGuide();
    const selected = new Set<number>();
    const read = (building: number | null = null) => guide.read(sim.world, 1, selected, building);
    expect(read()).toBe('select_engineer');
    selected.add(sim.world.units.find(unit => unit.owner === 1)!.id);
    expect(read()).toBe('build_barracks');
    const hall = makeBuilding(sim.world, 1, 'barracks', 12, 90, false);
    sim.world.buildings.push(hall);
    expect(read()).toBe('constructing');
    hall.progress = BUILDINGS.barracks.buildTicks;
    expect(read()).toBe('select_barracks');
    expect(read(hall.id)).toBe('train_rifleman');
    sim.world.players[0]!.ore = 500;
    sim.enqueue({ type: 'produce', playerId: 1, buildingId: hall.id, kind: 'rifleman' });
    // An intention alone does not complete a goal.
    expect(read(hall.id)).toBe('train_rifleman');
    sim.step();
    expect(read()).toBe('training');
    for (let n = 0; n < 150; n++) sim.step();
    expect(read()).toBe('complete');
    sim.world.units = sim.world.units.filter(unit => unit.kind !== 'rifleman');
    expect(read()).toBe('complete');
    guide.reset();
    expect(read()).toBe('select_barracks');
  });

  it('ignores foreign progress, including hidden barracks and units', () => {
    const sim = Simulation.create();
    const foreign = makeBuilding(sim.world, 2, 'barracks', 100, 20, true);
    sim.world.buildings.push(foreign);
    sim.world.units.push(makeUnit(sim.world, 2, 'rifleman', 100, 20));
    const guide = new OpeningGuide();
    expect(guide.read(sim.world, 1, new Set(sim.world.units.filter(unit => unit.owner === 2).map(unit => unit.id)), foreign.id)).toBe('select_engineer');
  });

  it('keeps skipped guidance hidden on retry and emits nothing after the match ends', () => {
    const sim = Simulation.create();
    for (const guide of [new OpeningGuide(false), new OpeningGuide()]) {
      guide.dismiss();
      guide.reset();
      expect(guide.read(sim.world, 1, new Set(), null)).toBeNull();
    }
    sim.world.winner = 2;
    expect(new OpeningGuide().read(sim.world, 1, new Set(), null)).toBeNull();
  });

  it('never changes commands, economy, AI timing or checksums, enabled or dismissed', () => {
    const guided = Simulation.create();
    const reference = Simulation.create();
    const guide = new OpeningGuide();
    const selection = new Set([guided.world.units[0]!.id]);
    for (let tick = 0; tick < 300; tick++) {
      if (tick === 150) guide.dismiss();
      guide.read(guided.world, 1, selection, null);
      guided.step(); reference.step();
      expect(guided.hashState()).toBe(reference.hashState());
    }
    expect(guided.log).toEqual(reference.log);
  });

  it('explains only resource refusal keys supplied by the engine, in both locales', () => {
    for (const messages of [en, ptBR]) {
      expect(reasonHelp(messages, 'no_supply')).toBe(messages.help_supply);
      expect(reasonHelp(messages, 'no_aether')).toBe(messages.help_aether);
      expect(reasonHelp(messages, 'no_refinery')).toBe(messages.help_aether);
      expect(reasonHelp(messages, 'no_ore')).toBe(messages.help_ore);
      expect(reasonHelp(messages, 'not_visible')).toBeNull();
      expect(reasonHelp(messages, null)).toBeNull();
    }
  });
});
