import { BUILDINGS, VAREK_LEVELS, type VarekLevel } from '@void-dominion/content';
import type { Seats, World } from '@void-dominion/simulation';

export const SKIRMISH_LEVELS = Object.keys(VAREK_LEVELS) as VarekLevel[];

export function skirmishSeats(level: VarekLevel = 'normal'): Seats {
  return ['human', level === 'easy' ? 'varek_easy' : level === 'hard' ? 'varek_hard' : 'varek'];
}

export type OpeningStep = 'select_engineer' | 'build_barracks' | 'constructing' | 'select_barracks' | 'train_rifleman' | 'training' | 'complete';

/** Presentation memory only. Reads own entities; never sends commands or changes the world. */
export class OpeningGuide {
  private complete = false;

  constructor(private enabled = true) {}

  dismiss(): void { this.enabled = false; }

  /** A retry keeps the player's choice to hide guidance. */
  reset(): void { this.complete = false; }

  read(world: World, seat: number, selected: ReadonlySet<number>, buildingId: number | null): OpeningStep | null {
    if (!this.enabled || world.winner !== 0) return null;
    const units = world.units.filter(unit => unit.owner === seat && unit.hp > 0);
    if (units.some(unit => unit.kind === 'rifleman')) this.complete = true;
    if (this.complete) return 'complete';
    const barracks = world.buildings.filter(building => building.owner === seat && building.kind === 'barracks' && building.hp > 0);
    if (barracks.length === 0) {
      return units.some(unit => unit.kind === 'engineer' && selected.has(unit.id)) ? 'build_barracks' : 'select_engineer';
    }
    const finished = barracks.filter(building => building.progress >= BUILDINGS.barracks.buildTicks);
    if (finished.length === 0) return 'constructing';
    if (finished.some(building => building.prod?.kind === 'rifleman' || building.queue.some(job => job.kind === 'rifleman'))) return 'training';
    return finished.some(building => building.id === buildingId) ? 'train_rifleman' : 'select_barracks';
  }
}
