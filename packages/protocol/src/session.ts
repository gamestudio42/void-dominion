import { deserializeReplay, Simulation, type Command } from '@void-dominion/simulation';
import type { EndMessage } from './messages.ts';

/** Commands a guest may send in a burst, and per second after it. */
export const COMMAND_BURST = 20;
export const COMMANDS_PER_SECOND = 20;

/**
 * Token bucket over the host's clock. A guest past the budget has its command dropped,
 * not queued, so a flood cannot stall the tick or grow memory.
 */
export class CommandBudget {
  private tokens = COMMAND_BURST;
  private last: number | null = null;

  /** True when a command at `nowMs` fits the budget, and spends it. */
  take(nowMs: number): boolean {
    if (this.last !== null && nowMs > this.last) {
      this.tokens = Math.min(COMMAND_BURST, this.tokens + ((nowMs - this.last) / 1000) * COMMANDS_PER_SECOND);
    }
    this.last = this.last === null ? nowMs : Math.max(this.last, nowMs);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** A command the host acknowledged, as the guest's client recorded it. */
export interface AckedOrder {
  tick: number;
  cmd: Command;
}

export type Audit =
  | { ok: true }
  | { ok: false; reason: 'replay_unreadable' | 'seat' | 'checksum' | 'winner' | 'missing_order' | 'extra_order' };

/**
 * The guest's check on the host after a match. The host's replay must:
 * - read;
 * - list the guest as a human;
 * - replay to the checksum and winner the host announced;
 * - hold exactly the guest's acknowledged orders, at the ticks they were acknowledged.
 * It catches a host that changed the rules or the guest's orders. It cannot catch a
 * host that only read the map.
 */
export function auditMatch(end: EndMessage, seat: number, acked: readonly AckedOrder[]): Audit {
  const file = deserializeReplay(end.replay);
  if (!file) return { ok: false, reason: 'replay_unreadable' };
  if (file.seats[seat - 1] !== 'human') return { ok: false, reason: 'seat' };
  const replayed = Simulation.replay(file.commands, file.ticks, file);
  if (replayed.hashState() !== end.hash) return { ok: false, reason: 'checksum' };
  if (replayed.world.winner !== end.winner) return { ok: false, reason: 'winner' };
  const recorded = file.commands.filter((entry) => entry.cmd.playerId === seat).map((entry) => JSON.stringify(entry));
  const expected = acked.map((order) => JSON.stringify({ tick: order.tick, cmd: order.cmd }));
  const remaining = new Map<string, number>();
  for (const entry of recorded) remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
  for (const entry of expected) {
    const count = remaining.get(entry) ?? 0;
    if (count === 0) return { ok: false, reason: 'missing_order' };
    remaining.set(entry, count - 1);
  }
  if (recorded.length !== expected.length) return { ok: false, reason: 'extra_order' };
  return { ok: true };
}
