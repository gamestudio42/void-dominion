/** Browser smoke fixtures and an independent check of downloaded replay files. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeReplay, serializeReplay, Simulation } from '@void-dominion/simulation';

if (process.argv[2] === 'create') {
  const sim = Simulation.create();
  while (sim.world.winner === 0 && sim.world.tick < 8000) sim.step();
  if (sim.world.winner !== 2) throw new Error('The unattended defeat fixture changed');
  writeFileSync(join(process.argv[3]!, 'defeat.json'), serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats }));
} else {
  const file = deserializeReplay(readFileSync(process.argv[3]!, 'utf8'));
  if (!file) throw new Error('Unreadable exported replay');
  const sim = Simulation.replay(file.commands, file.ticks, file);
  console.log(JSON.stringify({ checksum: sim.hashState(), tick: sim.world.tick, winner: sim.world.winner }));
}
