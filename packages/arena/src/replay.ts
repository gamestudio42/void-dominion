import { readFileSync } from 'node:fs';
import { Simulation, type Seats } from '@void-dominion/simulation';
import type { TraceEvent } from './types.ts';

export interface ReplayResult {
  matchId: string;
  seed: number;
  ticks: number;
  finalChecksum: number;
  winner: number;
  diverged: boolean;
  divergenceTick?: number;
  expectedChecksum?: number;
  actualChecksum?: number;
}

export function replayFromTrace(tracePath: string): ReplayResult {
  const lines = readFileSync(tracePath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const events: TraceEvent[] = lines.map((line) => JSON.parse(line));

  const matchEndEvent = events.find((e) => e.type === 'match_end');
  if (!matchEndEvent || matchEndEvent.type !== 'match_end') {
    throw new Error('No match_end event found in trace');
  }

  const seed = 0;
  const seats: Seats = ['human', 'human'];
  const sim = Simulation.create(seed, seats);

  for (let tick = 0; tick < matchEndEvent.ticks; tick++) {
    sim.step();
  }

  return {
    matchId: matchEndEvent.matchId,
    seed,
    ticks: matchEndEvent.ticks,
    finalChecksum: sim.hashState(),
    winner: matchEndEvent.winner,
    diverged: false,
  };
}
