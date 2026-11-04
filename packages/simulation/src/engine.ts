import { applyCommand, type Command, type RejectReason } from './commands.ts';
import { createWorld, hashWorld, stepMovement, type World } from './world.ts';

interface Envelope {
  seq: number;
  tick: number;
  cmd: Command;
}

/** Authoritative match. The same commands on two instances stay in lockstep. */
export class Simulation {
  readonly world: World;
  private readonly queue: Envelope[] = [];
  private seq = 0;
  /** Reason from the latest command, or null when that command was accepted. */
  lastRejection: RejectReason | null = null;

  private constructor(world: World) {
    this.world = world;
  }

  static create(): Simulation {
    return new Simulation(createWorld());
  }

  enqueue(cmd: Command): void {
    this.queue.push({ seq: this.seq, tick: this.world.tick, cmd });
    this.seq += 1;
  }

  step(): void {
    this.queue.sort((a, b) => a.seq - b.seq);
    for (const envelope of this.queue) {
      this.lastRejection = applyCommand(this.world, envelope.cmd);
    }
    this.queue.length = 0;
    stepMovement(this.world);
    this.world.tick += 1;
  }

  hashState(): number {
    return hashWorld(this.world);
  }
}
