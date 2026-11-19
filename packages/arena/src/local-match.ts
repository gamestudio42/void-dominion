/**
 * One match played in the page. The published layout is required so the file
 * the viewer loads can resimulate it. Seeded variation is not stored in replay v2.
 */

import { SCHEMA_VERSION, validateActResponse, type Action, type ObserveRequest } from '@void-dominion/agent-sdk';
import { CommanderAdapter, buildObservation } from '@void-dominion/agent';
import { Simulation, serializeReplay, type Seats } from '@void-dominion/simulation';

export const LOCAL_MATCH_MAX_TICKS = 12_000;
export const LOCAL_MATCH_PERIOD_TICKS = 100;

const ERROR_CAP = 24;

export interface LocalSeatAgent {
  seat: 1 | 2;
  act(observe: ObserveRequest): Promise<unknown[]>;
}

export interface LocalMatchResult {
  winner: number;
  ticks: number;
  checksum: number;
  replay: string;
  errors: string[];
}

function accepted(observe: ObserveRequest, actions: unknown[]): Action[] | null {
  const response = validateActResponse({
    schemaVersion: SCHEMA_VERSION,
    requestId: observe.requestId,
    type: 'agent.act',
    actions,
  });
  return response ? response.actions : null;
}

/**
 * Step a published-layout match. Human seats are the agents passed in.
 * A missing agent is Varek, and `step` runs his policy. Observations for a
 * decision tick are taken before either seat's actions are enqueued.
 */
export async function playLocalMatch(options: {
  seed: number;
  seats: Seats;
  agents: readonly LocalSeatAgent[];
  maxTicks?: number;
  strategicPeriodTicks?: number;
  onTick?: (tick: number) => void | Promise<void>;
  shouldStop?: () => boolean;
}): Promise<LocalMatchResult> {
  const maxTicks = options.maxTicks ?? LOCAL_MATCH_MAX_TICKS;
  const period = options.strategicPeriodTicks ?? LOCAL_MATCH_PERIOD_TICKS;
  const sim = Simulation.create(options.seed >>> 0, options.seats, 'none');
  const errors: string[] = [];
  const adapters = {
    1: new CommanderAdapter(sim, 1),
    2: new CommanderAdapter(sim, 2),
  };
  const bySeat = new Map(options.agents.map((agent) => [agent.seat, agent]));

  const note = (line: string) => {
    if (errors.length < ERROR_CAP) errors.push(line);
  };

  while (sim.world.winner === 0 && sim.world.tick < maxTicks) {
    if (options.shouldStop?.()) throw new Error('aborted');
    if (sim.world.tick % period === 0) {
      const pending: { seat: 1 | 2; observe: ObserveRequest; agent: LocalSeatAgent }[] = [];
      for (const seat of [1, 2] as const) {
        const agent = bySeat.get(seat);
        if (!agent) continue;
        pending.push({ seat, observe: buildObservation(sim, seat, `tick-${sim.world.tick}`, adapters[seat].lastDecision()), agent });
      }
      const replies = await Promise.all(
        pending.map(async (item) => {
          try {
            const actions = await item.agent.act(item.observe);
            const valid = accepted(item.observe, actions);
            if (!valid) {
              note(`Seat ${item.seat}: invalid action`);
              return { seat: item.seat, actions: [] as Action[] };
            }
            return { seat: item.seat, actions: valid };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== 'aborted') note(`Seat ${item.seat}: ${message}`);
            return { seat: item.seat, actions: [] as Action[] };
          }
        }),
      );
      for (const reply of replies) {
        const adapter = adapters[reply.seat];
        adapter.beginDecision(`tick-${sim.world.tick}`, false);
        for (const action of reply.actions) adapter.applyAction(action);
      }
    }
    let stepped = 0;
    while (sim.world.winner === 0 && sim.world.tick < maxTicks && stepped < period) {
      sim.step();
      /** The first step after a decision applies its commands; read their results once. */
      if (stepped === 0) {
        adapters[1].settle();
        adapters[2].settle();
      }
      stepped += 1;
    }
    if (options.onTick) await options.onTick(sim.world.tick);
  }

  const checksum = sim.hashState();
  const body = JSON.parse(serializeReplay(sim.log, sim.world.tick, { seed: sim.world.seed, seats: sim.seats })) as Record<string, unknown>;
  body.checksum = checksum;
  return { winner: sim.world.winner, ticks: sim.world.tick, checksum, replay: JSON.stringify(body), errors };
}
