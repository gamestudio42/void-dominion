import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildingDef, ENEMY_ID, PLAYER_ID } from '@void-dominion/content';
import { makeBuilding, makeUnit, Simulation } from '@void-dominion/simulation';
import { describe, expect, it } from 'vitest';
import { combatWatcher, EFFECT_SHEETS, type CombatEffect } from '../../../apps/game/src/effects.ts';

const CELL = 128;

/** Width and height from a PNG header. */
function pngSize(bytes: Buffer): [number, number] {
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** Put an enemy rifleman beside the first player engineer, inside the player's sight. */
function skirmish(): Simulation {
  const sim = Simulation.create();
  const worker = sim.world.units.find((unit) => unit.owner === PLAYER_ID)!;
  sim.world.units.push(makeUnit(sim.world, ENEMY_ID, 'rifleman', worker.x + 1, worker.y));
  return sim;
}

function watch(sim: Simulation, ticks: number, blind = false): CombatEffect[] {
  const watcher = combatWatcher(PLAYER_ID);
  watcher(sim.world);
  const seen: CombatEffect[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    sim.step();
    if (blind) sim.world.visible[PLAYER_ID - 1]!.fill(0);
    seen.push(...watcher(sim.world));
  }
  return seen;
}

describe('effect sheets', () => {
  for (const [kind, sheet] of Object.entries(EFFECT_SHEETS)) {
    it(`ships ${kind} as a verified sheet with the layout the client reads`, () => {
      const path = fileURLToPath(sheet.url);
      const bytes = readFileSync(path);
      const manifest = JSON.parse(readFileSync(path.replace(/sheet\.png$/, 'manifest.json'), 'utf8'));
      expect(manifest.verdict).toBe('pass');
      expect(manifest.sheet.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(manifest.sheet).toMatchObject({ cell: CELL, columns: sheet.columns, rows: sheet.rows, frames: sheet.frames, fps: sheet.fps });
      expect(pngSize(bytes)).toEqual([sheet.columns * CELL, sheet.rows * CELL]);
      expect(sheet.frames).toBeLessThanOrEqual(sheet.columns * sheet.rows);
      expect(sheet.frames).toBeGreaterThan((sheet.columns - 1) * sheet.rows);
    });
  }
});

describe('combat watcher', () => {
  it('turns a visible fight into flashes, hits and a death', () => {
    const combat = new Set(['muzzle_flash', 'impact_hit', 'explosion']);
    /** Miners leave the rifleman's cell instead of stacking on it, so the kill lands after the old 200-tick window. */
    const effects = watch(skirmish(), 400).filter((effect) => combat.has(effect.kind));
    const kinds = new Set(effects.map((effect) => effect.kind));
    expect(kinds).toEqual(new Set(['muzzle_flash', 'impact_hit', 'explosion']));
    /** Every shot lands: a hit, or a death when the target leaves the world on that tick. */
    const count = (kind: CombatEffect['kind']) => effects.filter((effect) => effect.kind === kind).length;
    expect(count('impact_hit') + count('explosion')).toBe(count('muzzle_flash'));
  });

  it('shows nothing the viewer cannot see', () => {
    expect(watch(skirmish(), 200, true)).toEqual([]);
  });

  it('marks a finished building and a new unit of the viewer with build_complete', () => {
    const sim = Simulation.create();
    const worker = sim.world.units.find((unit) => unit.owner === PLAYER_ID)!;
    const site = makeBuilding(sim.world, PLAYER_ID, 'ore_extractor', Math.floor(worker.x) + 2, Math.floor(worker.y), false);
    sim.world.buildings.push(site);
    const watcher = combatWatcher(PLAYER_ID);
    expect(watcher(sim.world)).toEqual([]);
    site.progress = buildingDef('ore_extractor').buildTicks;
    const finished = watcher(sim.world);
    expect(finished.map((effect) => effect.kind)).toEqual(['build_complete']);
    expect(finished[0]).toMatchObject({ x: site.x + 1, y: site.y + 1 });
    expect(watcher(sim.world)).toEqual([]);
    sim.world.units.push(makeUnit(sim.world, PLAYER_ID, 'rifleman', worker.x + 1, worker.y));
    expect(watcher(sim.world).map((effect) => effect.kind)).toEqual(['build_complete']);
  });

  it('pulses where the viewer delivers ore, once per block every few ticks', () => {
    const sim = Simulation.create();
    const watcher = combatWatcher(PLAYER_ID);
    watcher(sim.world);
    const pulses: { tick: number; x: number; y: number }[] = [];
    let deliveries = 0;
    for (let tick = 0; tick < 400; tick++) {
      const carrying = new Set(sim.world.units.filter((unit) => unit.owner === PLAYER_ID && unit.carryOre > 0).map((unit) => unit.id));
      sim.step();
      deliveries += sim.world.units.filter((unit) => carrying.has(unit.id) && unit.carryOre === 0).length;
      for (const effect of watcher(sim.world)) {
        if (effect.kind === 'ore_delivered') pulses.push({ tick: sim.world.tick, x: effect.x, y: effect.y });
      }
    }
    expect(deliveries).toBeGreaterThan(0);
    expect(pulses.length).toBeGreaterThan(0);
    expect(pulses.length).toBeLessThanOrEqual(deliveries);
    const block = (pulse: { x: number; y: number }) => `${Math.floor(pulse.x / 3)},${Math.floor(pulse.y / 3)}`;
    for (const [index, pulse] of pulses.entries()) {
      const earlier = pulses.slice(0, index).filter((other) => block(other) === block(pulse));
      for (const other of earlier) expect(pulse.tick - other.tick).toBeGreaterThanOrEqual(10);
    }
  });

  it('does not pulse for ore another player delivers in sight', () => {
    const sim = Simulation.create();
    const worker = sim.world.units.find((unit) => unit.owner === PLAYER_ID)!;
    const rival = makeUnit(sim.world, ENEMY_ID, 'engineer', worker.x + 1, worker.y);
    rival.carryOre = 5;
    sim.world.units.push(rival);
    const watcher = combatWatcher(PLAYER_ID);
    watcher(sim.world);
    rival.carryOre = 0;
    expect(watcher(sim.world).filter((effect) => effect.kind === 'ore_delivered')).toEqual([]);
    worker.carryOre = 5;
    watcher(sim.world);
    worker.carryOre = 0;
    expect(watcher(sim.world).map((effect) => effect.kind)).toEqual(['ore_delivered']);
  });

  it('does not mark an enemy unit that comes into sight', () => {
    const sim = Simulation.create();
    const watcher = combatWatcher(PLAYER_ID);
    watcher(sim.world);
    const worker = sim.world.units.find((unit) => unit.owner === PLAYER_ID)!;
    sim.world.units.push(makeUnit(sim.world, ENEMY_ID, 'rifleman', worker.x + 1, worker.y));
    expect(watcher(sim.world)).toEqual([]);
  });

  it('reads the world without changing it', () => {
    const watched = skirmish();
    const plain = skirmish();
    watch(watched, 120);
    for (let tick = 0; tick < 120; tick++) plain.step();
    expect(watched.hashState()).toBe(plain.hashState());
  });
});
