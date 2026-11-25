import { buildingDef, unitDef, type UnitKind } from '@void-dominion/content';
import { FIXED_DT, FixedStepper } from '@void-dominion/kernel';
import { powerGive, powerTake, type Building, type World } from '@void-dominion/simulation';

/** Pausing is local frame scheduling, never a command or a world mutation. */
export class SessionClock {
  paused = false;
  private readonly stepper = new FixedStepper({ dt: FIXED_DT, maxFrameTime: 0.25, maxStepsPerFrame: 8 });

  constructor(readonly canPause: boolean) {}

  toggle(): void {
    if (this.canPause) this.paused = !this.paused;
  }

  advance(elapsed: number, running: boolean) {
    return this.stepper.advance(running && !this.paused ? elapsed : 0);
  }

  reset(): void {
    this.paused = false;
    this.stepper.reset();
  }
}

export interface ProductionCard {
  construction: number;
  available: boolean;
  current: { kind: UnitKind; seconds: number; percent: number } | null;
  queue: UnitKind[];
  powerShort: boolean;
}

/** Read the same fields in a local world or the guest's fog-filtered mirror. */
export function productionCard(world: World, building: Building, seat: number): ProductionCard | null {
  if (building.owner !== seat) return null;
  const def = buildingDef(building.kind);
  const current = building.prod;
  return {
    construction: Math.min(100, Math.floor(building.progress * 100 / def.buildTicks)),
    available: def.produces.length > 0 && building.progress >= def.buildTicks,
    current: current ? {
      kind: current.kind,
      seconds: Math.ceil(building.prodLeft * FIXED_DT),
      percent: Math.max(0, Math.min(100, Math.floor((1 - building.prodLeft / unitDef(current.kind).trainTicks) * 100))),
    } : null,
    queue: building.queue.map((job) => job.kind),
    powerShort: powerTake(world, seat) > powerGive(world, seat),
  };
}
