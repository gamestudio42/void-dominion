export {
  DEMO_OBSTACLE,
  DEMO_SEED,
  DIAGONAL_COST,
  ENEMY_ID,
  MAP_SIZE,
  MATCH,
  VAREK_LEVELS,
  ORTHOGONAL_COST,
  PLAYER_ID,
  demoSpawns,
  inMap,
  rectContains,
} from './field.ts';
export type { CellRect, Spawn, StartBase, VarekLevel, VarekPlan } from './field.ts';
export {
  BUILDINGS,
  BUILDING_KINDS,
  UNITS,
  UNIT_KINDS,
  QUEUE_LIMIT,
  buildingDef,
  isBuildingKind,
  isUnitKind,
  unitDef,
} from './catalog.ts';
export type { BuildingDef, BuildingKind, UnitDef, UnitKind } from './catalog.ts';
