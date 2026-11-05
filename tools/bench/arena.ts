/**
 * Speed table for the headless arena: each comparable seed played to its end,
 * several times, with every step timed. Prints a Markdown table, or JSON with --json.
 *
 *   pnpm bench [--runs N] [--json]
 *
 * Wall time lives here, never in the simulation. The numbers depend on the machine
 * and its load, so the table records both.
 */
import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { MATCH } from '@void-dominion/content';
import { SIMULATION_HZ } from '@void-dominion/kernel';
import { Simulation } from '@void-dominion/simulation';

const SEEDS = [MATCH.seed, 0x51eed, 0xa11ce] as const;
const CAP = 8000;

interface Row {
  seed: string;
  ticks: number;
  hash: number;
  matchMs: number;
  stepMeanUs: number;
  stepP50Us: number;
  stepP95Us: number;
  stepMaxUs: number;
  speedup: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function quantile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** Play one seed to the end and return the time of every step, in milliseconds. */
function play(seed: number): { steps: Float64Array; ticks: number; hash: number } {
  const sim = Simulation.create(seed);
  const steps = new Float64Array(CAP);
  let count = 0;
  while (sim.world.winner === 0 && count < CAP) {
    const started = performance.now();
    sim.step();
    steps[count++] = performance.now() - started;
  }
  return { steps: steps.slice(0, count), ticks: sim.world.tick, hash: sim.hashState() };
}

function measure(seed: number, runs: number): Row {
  play(seed);
  const all: number[] = [];
  let total = 0;
  let ticks = 0;
  let hash = 0;
  for (let run = 0; run < runs; run++) {
    const result = play(seed);
    for (const step of result.steps) {
      all.push(step);
      total += step;
    }
    ticks = result.ticks;
    hash = result.hash;
  }
  const sorted = Float64Array.from(all).sort();
  const mean = total / all.length;
  return {
    seed: `0x${(seed >>> 0).toString(16)}`,
    ticks,
    hash,
    matchMs: total / runs,
    stepMeanUs: mean * 1000,
    stepP50Us: quantile(sorted, 0.5) * 1000,
    stepP95Us: quantile(sorted, 0.95) * 1000,
    stepMaxUs: sorted[sorted.length - 1]! * 1000,
    /** How many times faster than the 20 Hz clock a match plays. */
    speedup: 1000 / SIMULATION_HZ / mean,
  };
}

const runs = Number(arg('--runs') ?? 5);
const rows = SEEDS.map((seed) => measure(seed, runs));
const machine = {
  cpu: cpus()[0]?.model.trim() ?? 'unknown',
  cores: cpus().length,
  node: process.version,
  load: loadavg().map((value) => value.toFixed(2)).join(' '),
  runs,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ machine, rows }, null, 2));
} else {
  const fixed = (value: number, digits = 0) => value.toFixed(digits);
  console.log(`${machine.cpu}, ${machine.cores} threads, Node ${machine.node}, load ${machine.load}, ${runs} runs per seed\n`);
  console.log('| Seed | Ticks | Checksum | Match (ms) | Step mean (µs) | p50 (µs) | p95 (µs) | max (µs) | × real time |');
  console.log('| --- | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const row of rows) {
    console.log(
      `| ${row.seed} | ${row.ticks} | ${row.hash} | ${fixed(row.matchMs)} | ${fixed(row.stepMeanUs)} | ${fixed(row.stepP50Us)} | ${fixed(row.stepP95Us)} | ${fixed(row.stepMaxUs)} | ${fixed(row.speedup)} |`,
    );
  }
}
