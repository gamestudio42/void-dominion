/**
 * Size and cost of the client view a host sends its guest (docs/MULTIPLAYER.md).
 * Two scenarios: the unattended skirmish, and a stress fight with a large army on
 * each side in the middle of the map, in sight of both. Prints a Markdown table.
 *
 *   pnpm bench:view [--army N]
 */
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { ENEMY_ID, MATCH, PLAYER_ID } from '@void-dominion/content';
import { clientView, makeUnit, Simulation } from '@void-dominion/simulation';

interface Sample {
  bytes: number;
  gzip: number;
  micros: number;
  zipMicros: number;
  entities: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** One view per seat every second tick, as the host would send them. */
function sample(sim: Simulation, ticks: number): Sample[] {
  const samples: Sample[] = [];
  for (let tick = 0; tick < ticks && sim.world.winner === 0; tick++) {
    sim.step();
    if (sim.world.tick % 2 !== 0) continue;
    for (const seat of [PLAYER_ID, ENEMY_ID]) {
      const started = performance.now();
      const json = JSON.stringify(clientView(sim.world, seat));
      const micros = (performance.now() - started) * 1000;
      const zipped = performance.now();
      const gzip = gzipSync(json).length;
      const zipMicros = (performance.now() - zipped) * 1000;
      const view = JSON.parse(json) as { units: unknown[]; buildings: unknown[] };
      samples.push({ bytes: json.length, gzip, micros, zipMicros, entities: view.units.length + view.buildings.length });
    }
  }
  return samples;
}

/** `army` riflemen per side in two blocks facing each other across the middle of the map. */
function stress(army: number): Simulation {
  const sim = Simulation.create(MATCH.seed, ['human', 'human']);
  const columns = 10;
  for (let index = 0; index < army; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    sim.world.units.push(makeUnit(sim.world, PLAYER_ID, 'rifleman', 50 + column, 58 + row));
    sim.world.units.push(makeUnit(sim.world, ENEMY_ID, 'rifleman', 50 + column, 58 + row + Math.ceil(army / columns) + 4));
  }
  return sim;
}

function summary(name: string, samples: Sample[]): string {
  const pick = (key: keyof Sample) => {
    const sorted = samples.map((entry) => entry[key]).sort((a, b) => a - b);
    const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
    return [mean, sorted[Math.floor(sorted.length * 0.95)]!, sorted[sorted.length - 1]!];
  };
  const [bytes, bytes95, bytesMax] = pick('bytes');
  const [gzip, , gzipMax] = pick('gzip');
  const [micros, micros95] = pick('micros');
  const [zipMicros] = pick('zipMicros');
  const [, , entities] = pick('entities');
  const rate = (bytes! * 10) / 1024;
  const zipRate = (gzip! * 10) / 1024;
  const cells = [name, entities, bytes, bytes95, bytesMax, gzip, gzipMax, micros, micros95, zipMicros].map((value) =>
    typeof value === 'number' ? Math.round(value).toString() : value,
  );
  return `| ${cells.join(' | ')} | ${rate.toFixed(1)} | ${zipRate.toFixed(1)} |`;
}

const army = Number(arg('--army') ?? 100);
console.log('| Scenario | Max entities | JSON mean (B) | JSON p95 (B) | JSON max (B) | gzip mean (B) | gzip max (B) | Build mean (µs) | Build p95 (µs) | gzip mean (µs) | Raw at 10 Hz (KB/s) | gzip at 10 Hz (KB/s) |');
console.log('| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |');
console.log(summary(`Unattended ${`0x${MATCH.seed.toString(16)}`}`, sample(Simulation.create(), 8000)));
console.log(summary(`Stress, ${army} riflemen a side`, sample(stress(army), 400)));
