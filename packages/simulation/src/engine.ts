import { ENEMY_ID, MATCH, PLAYER_ID } from '@void-dominion/content';
import { stepAi } from './ai.ts';
import { stepCombat, resolveCasualties } from './combat.ts';
import { applyCommand, cloneCommand, parseLogged, type Command, type RejectReason } from './commands.ts';
import { steerAll } from './commands.ts';
import { stepEconomy } from './economy.ts';
import { createWorld, hashWorld, stepMovement, type ScenarioVariation, type World } from './world.ts';
import { refreshMemory, updateVision } from './vision.ts';

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

/** Who drives each seat, player 1 first. Varek is the conventional opponent in `ai.ts`. */
export type SeatControl = 'human' | 'varek';
export type Seats = readonly [SeatControl, SeatControl];

/** The skirmish: a human on seat 1 against General Varek on seat 2. */
export const SKIRMISH_SEATS: Seats = ['human', 'varek'];

export interface MatchSetup {
  seed: number;
  seats: Seats;
}

const SEAT_IDS = [PLAYER_ID, ENEMY_ID] as const;

function seatOf(playerId: number): number {
  return SEAT_IDS.indexOf(playerId as (typeof SEAT_IDS)[number]);
}

/** True when a human drives that player's seat, so its orders belong in the log. */
export function humanSeat(seats: Seats, playerId: number): boolean {
  const seat = seatOf(playerId);
  return seat >= 0 && seats[seat] === 'human';
}

interface Envelope {
  seq: number;
  tick: number;
  cmd: Command;
}

/** Authoritative match. The same human commands on two instances stay in lockstep. */
export class Simulation {
  readonly world: World;
  /** Seat control lives here, not in the world: it decides who issues orders, not what the state is. */
  readonly seats: Seats;
  /** Human orders only. Varek is simulated again on replay, not stored. */
  readonly log: LoggedCommand[] = [];
  private readonly queue: Envelope[] = [];
  private seq = 0;
  /** Reason from the latest human command, or null when that command was accepted. */
  lastRejection: RejectReason | null = null;
  /** Each command applied by the latest step, by the number `enqueue` returned: its reason, or null. */
  readonly results = new Map<number, RejectReason | null>();

  private constructor(world: World, seats: Seats) {
    this.world = world;
    this.seats = seats;
  }

  static create(seed: number = MATCH.seed, seats: Seats = SKIRMISH_SEATS, variation: ScenarioVariation = 'none'): Simulation {
    const sim = new Simulation(createWorld(seed, variation), [seats[0], seats[1]]);
    updateVision(sim.world);
    refreshMemory(sim.world);
    return sim;
  }

  /** Queue a command for the next step. Returns its number in `results` once that step runs. */
  enqueue(cmd: Command): number {
    const copy = cloneCommand(cmd);
    if (humanSeat(this.seats, copy.playerId)) this.log.push({ tick: this.world.tick, cmd: copy });
    this.queue.push({ seq: this.seq, tick: this.world.tick, cmd: copy });
    this.seq += 1;
    return this.seq - 1;
  }

  step(): void {
    if (this.world.winner !== 0) {
      this.queue.length = 0;
      return;
    }
    this.queue.sort((a, b) => a.seq - b.seq);
    this.results.clear();
    for (const envelope of this.queue) {
      const reason = applyCommand(this.world, envelope.cmd);
      this.lastRejection = reason;
      this.results.set(envelope.seq, reason);
    }
    this.queue.length = 0;
    if (this.world.tick % MATCH.ai.period === 0) {
      for (let seat = 0; seat < SEAT_IDS.length; seat++) {
        if (this.seats[seat] === 'varek') stepAi(this.world, SEAT_IDS[seat]!);
      }
    }
    steerAll(this.world);
    stepMovement(this.world);
    stepEconomy(this.world);
    updateVision(this.world);
    stepCombat(this.world);
    resolveCasualties(this.world);
    refreshMemory(this.world);
    this.world.tick += 1;
  }

  hashState(): number {
    return hashWorld(this.world);
  }

  /** Play a human log forward. Varek's orders are decided again inside each step; any in the log are ignored. */
  static replay(log: readonly LoggedCommand[], ticks: number, setup: MatchSetup = { seed: MATCH.seed, seats: SKIRMISH_SEATS }): Simulation {
    const sim = Simulation.create(setup.seed, setup.seats);
    let index = 0;
    for (let tick = 0; tick < ticks; tick++) {
      while (index < log.length && log[index]!.tick === tick) {
        const { cmd } = log[index]!;
        if (humanSeat(sim.seats, cmd.playerId)) sim.enqueue(cmd);
        index += 1;
      }
      sim.step();
    }
    return sim;
  }
}

export const REPLAY_VERSION = 2;

export interface ReplayFile extends MatchSetup {
  ticks: number;
  commands: LoggedCommand[];
}

/** Version 2 records the seed and who drove each seat, so a match between two people replays too. */
export function serializeReplay(
  log: readonly LoggedCommand[],
  ticks: number,
  setup: MatchSetup = { seed: MATCH.seed, seats: SKIRMISH_SEATS },
): string {
  return JSON.stringify({ version: REPLAY_VERSION, seed: setup.seed >>> 0, seats: setup.seats, ticks, commands: log });
}

function parseSeats(value: unknown): Seats | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [first, second] = value as unknown[];
  const control = (entry: unknown): entry is SeatControl => entry === 'human' || entry === 'varek';
  return control(first) && control(second) ? [first, second] : null;
}

/**
 * Reads version 2, and version 1 files, which have no version field: the skirmish seed,
 * a human on seat 1 and Varek on seat 2. A file carrying an order for a seat Varek drives
 * is unreadable, so a replay cannot steer him.
 */
export function deserializeReplay(raw: string): ReplayFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const file = parsed as { version?: unknown; seed?: unknown; seats?: unknown; ticks?: unknown; commands?: unknown };
  let setup: MatchSetup;
  if (file.version === undefined) setup = { seed: MATCH.seed, seats: SKIRMISH_SEATS };
  else if (file.version === REPLAY_VERSION) {
    const seats = parseSeats(file.seats);
    const seed = file.seed;
    if (!seats || typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
    setup = { seed, seats };
  } else return null;
  if (typeof file.ticks !== 'number' || !Number.isInteger(file.ticks) || file.ticks < 0) return null;
  if (!Array.isArray(file.commands)) return null;
  const commands: LoggedCommand[] = [];
  for (const entry of file.commands) {
    const logged = parseLogged(entry);
    if (!logged || !humanSeat(setup.seats, logged.cmd.playerId)) return null;
    commands.push(logged);
  }
  return { ...setup, ticks: file.ticks, commands };
}

export interface ArenaReport {
  seed: number;
  winner: number;
  tick: number;
  hash: number;
  steps: number;
  ore: [number, number];
  units: [number, number];
}

/** Run until the match ends or the step cap. The same seed and commands return the same report. */
export function runArena(seed: number = MATCH.seed, log: readonly LoggedCommand[] = [], cap = 8000): ArenaReport {
  const sim = Simulation.create(seed);
  let index = 0;
  let steps = 0;
  while (sim.world.winner === 0 && steps < cap) {
    while (index < log.length && log[index]!.tick === sim.world.tick) {
      sim.enqueue(log[index]!.cmd);
      index += 1;
    }
    sim.step();
    steps += 1;
  }
  const ore: [number, number] = [0, 0];
  const units: [number, number] = [0, 0];
  for (const player of sim.world.players) {
    const seat = player.id - 1;
    if (seat === 0 || seat === 1) ore[seat] = player.ore;
  }
  for (const unit of sim.world.units) {
    const seat = unit.owner - 1;
    if (seat === 0 || seat === 1) units[seat] += 1;
  }
  return {
    seed: sim.world.seed,
    winner: sim.world.winner,
    tick: sim.world.tick,
    hash: sim.hashState(),
    steps,
    ore,
    units,
  };
}
