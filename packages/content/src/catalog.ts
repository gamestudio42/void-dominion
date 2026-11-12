export const UNIT_KINDS = ['engineer', 'rifleman', 'rocketeer', 'scout_rover', 'assault_walker', 'interceptor'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const BUILDING_KINDS = [
  'command_center',
  'ore_extractor',
  'aether_refinery',
  'power_generator',
  'barracks',
  'vehicle_factory',
  'defense_turret',
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export interface UnitDef {
  hp: number;
  armor: number;
  /** Cells travelled each simulation tick. */
  speed: number;
  sight: number;
  ore: number;
  aether: number;
  supply: number;
  damage: number;
  range: number;
  cooldown: number;
  carry: number;
  /** Ticks to pull one resource from a node. */
  gatherTicks: number;
  trainTicks: number;
}

export interface BuildingDef {
  width: number;
  height: number;
  ore: number;
  aether: number;
  buildTicks: number;
  hp: number;
  armor: number;
  sight: number;
  supply: number;
  powerGive: number;
  powerTake: number;
  produces: readonly UnitKind[];
  damage: number;
  range: number;
  cooldown: number;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  engineer: { hp: 40, armor: 0, speed: 0.22, sight: 7, ore: 50, aether: 0, supply: 1, damage: 0, range: 0, cooldown: 0, carry: 8, gatherTicks: 8, trainTicks: 80 },
  rifleman: { hp: 45, armor: 0, speed: 0.26, sight: 8, ore: 50, aether: 0, supply: 1, damage: 6, range: 5, cooldown: 15, carry: 0, gatherTicks: 0, trainTicks: 100 },
  rocketeer: { hp: 55, armor: 0, speed: 0.24, sight: 8, ore: 75, aether: 25, supply: 2, damage: 12, range: 6, cooldown: 22, carry: 0, gatherTicks: 0, trainTicks: 140 },
  scout_rover: { hp: 70, armor: 1, speed: 0.38, sight: 11, ore: 75, aether: 0, supply: 2, damage: 5, range: 4, cooldown: 12, carry: 0, gatherTicks: 0, trainTicks: 120 },
  assault_walker: { hp: 160, armor: 2, speed: 0.16, sight: 8, ore: 150, aether: 50, supply: 3, damage: 16, range: 5, cooldown: 18, carry: 0, gatherTicks: 0, trainTicks: 220 },
  /** Studio hull. Faster and sharper-eyed than the scout, lighter than the walker. It still walks the ground grid. */
  interceptor: { hp: 80, armor: 0, speed: 0.46, sight: 12, ore: 100, aether: 25, supply: 2, damage: 8, range: 5, cooldown: 12, carry: 0, gatherTicks: 0, trainTicks: 160 },
};

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  command_center: { width: 4, height: 4, ore: 400, aether: 0, buildTicks: 1, hp: 1500, armor: 1, sight: 9, supply: 12, powerGive: 12, powerTake: 0, produces: ['engineer'], damage: 0, range: 0, cooldown: 0 },
  ore_extractor: { width: 2, height: 2, ore: 75, aether: 0, buildTicks: 160, hp: 500, armor: 0, sight: 6, supply: 2, powerGive: 0, powerTake: 0, produces: [], damage: 0, range: 0, cooldown: 0 },
  aether_refinery: { width: 3, height: 3, ore: 100, aether: 0, buildTicks: 200, hp: 600, armor: 0, sight: 6, supply: 2, powerGive: 0, powerTake: 1, produces: [], damage: 0, range: 0, cooldown: 0 },
  power_generator: { width: 2, height: 2, ore: 100, aether: 0, buildTicks: 180, hp: 450, armor: 0, sight: 5, supply: 8, powerGive: 15, powerTake: 0, produces: [], damage: 0, range: 0, cooldown: 0 },
  barracks: { width: 3, height: 3, ore: 150, aether: 0, buildTicks: 240, hp: 900, armor: 1, sight: 7, supply: 4, powerGive: 0, powerTake: 2, produces: ['rifleman', 'rocketeer'], damage: 0, range: 0, cooldown: 0 },
  vehicle_factory: { width: 4, height: 3, ore: 200, aether: 50, buildTicks: 320, hp: 1100, armor: 1, sight: 7, supply: 4, powerGive: 0, powerTake: 4, produces: ['scout_rover', 'assault_walker', 'interceptor'], damage: 0, range: 0, cooldown: 0 },
  defense_turret: { width: 2, height: 2, ore: 100, aether: 0, buildTicks: 180, hp: 350, armor: 1, sight: 8, supply: 0, powerGive: 0, powerTake: 2, produces: [], damage: 10, range: 7, cooldown: 12 },
};

export function unitDef(kind: UnitKind): UnitDef {
  return UNITS[kind];
}

export function buildingDef(kind: BuildingKind): BuildingDef {
  return BUILDINGS[kind];
}

/** Train jobs waiting on one building, including the job already in progress. */
export const QUEUE_LIMIT = 5;

export function isUnitKind(value: string): value is UnitKind {
  return (UNIT_KINDS as readonly string[]).includes(value);
}

export function isBuildingKind(value: string): value is BuildingKind {
  return (BUILDING_KINDS as readonly string[]).includes(value);
}
