import { MATCH, PLAYER_ID } from '@void-dominion/content';
import { stepAi } from './ai.ts';
import { stepCombat, resolveCasualties } from './combat.ts';
import { applyCommand, cloneCommand, parseLogged, type Command, type RejectReason } from './commands.ts';
import { steerAll } from './commands.ts';
import { stepEconomy } from './economy.ts';
import { createWorld, hashWorld, stepMovement, type World } from './world.ts';
import { refreshMemory, updateVision } from './vision.ts';

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

interface Envelope {
  seq: number;
  tick: number;
  cmd: Command;
}

/** Authoritative match. The same human commands on two instances stay in lockstep. */
export class Simulation {
  readonly world: World;
  /** Human orders only. The opponent is simulated again on replay, not stored. */
  readonly log: LoggedCommand[] = [];
  private readonly queue: Envelope[] = [];
  private seq = 0;
  /** Reason from the latest human command, or null when that command was accepted. */
  lastRejection: RejectReason | null = null;

  private constructor(world: World) {
    this.world = world;
  }

  static create(seed: number = MATCH.seed): Simulation {
    const sim = new Simulation(createWorld(seed));
    updateVision(sim.world);
    refreshMemory(sim.world);
    return sim;
  }

  enqueue(cmd: Command): void {
    const copy = cloneCommand(cmd);
    if (copy.playerId === PLAYER_ID) this.log.push({ tick: this.world.tick, cmd: copy });
    this.queue.push({ seq: this.seq, tick: this.world.tick, cmd: copy });
    this.seq += 1;
  }

  step(): void {
    if (this.world.winner !== 0) {
      this.queue.length = 0;
      return;
    }
    this.queue.sort((a, b) => a.seq - b.seq);
    for (const envelope of this.queue) {
      const reason = applyCommand(this.world, envelope.cmd);
      this.lastRejection = reason;
    }
    this.queue.length = 0;
    if (this.world.tick % MATCH.ai.period === 0) stepAi(this.world);
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

  /** Play a human log forward. Opponent orders are decided again inside each step; any in the log are ignored. */
  static replay(log: readonly LoggedCommand[], ticks: number): Simulation {
    const sim = Simulation.create();
    let index = 0;
    for (let tick = 0; tick < ticks; tick++) {
      while (index < log.length && log[index]!.tick === tick) {
        const { cmd } = log[index]!;
        if (cmd.playerId === PLAYER_ID) sim.enqueue(cmd);
        index += 1;
      }
      sim.step();
    }
    return sim;
  }
}

export function serializeReplay(log: readonly LoggedCommand[], ticks: number): string {
  return JSON.stringify({ ticks, commands: log });
}

export function deserializeReplay(raw: string): { ticks: number; commands: LoggedCommand[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const file = parsed as { ticks?: unknown; commands?: unknown };
  if (typeof file.ticks !== 'number' || !Number.isInteger(file.ticks) || file.ticks < 0) return null;
  if (!Array.isArray(file.commands)) return null;
  const commands: LoggedCommand[] = [];
  for (const entry of file.commands) {
    const logged = parseLogged(entry);
    /** A human replay carries player 1 only. A Varek order in the file would let it steer him. */
    if (!logged || logged.cmd.playerId !== PLAYER_ID) return null;
    commands.push(logged);
  }
  return { ticks: file.ticks, commands };
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
