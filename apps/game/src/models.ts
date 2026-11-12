/**
 * Verified meshes from the Blender pipeline. Each file has a manifest beside it
 * under assets/models/<kind>/. The renderer keeps a box for any kind missing here.
 */
function model(kind: string): string {
  return new URL(`../../../assets/models/${kind}/${kind}.glb`, import.meta.url).href;
}

export const UNIT_MODELS: Readonly<Record<string, string>> = {
  engineer: model('engineer'),
  rifleman: model('rifleman'),
  rocketeer: model('rocketeer'),
  scout_rover: model('scout_rover'),
  assault_walker: model('assault_walker'),
  interceptor: model('interceptor'),
};

export const BUILDING_MODELS: Readonly<Record<string, string>> = {
  command_center: model('command_center'),
  ore_extractor: model('ore_extractor'),
  aether_refinery: model('aether_refinery'),
  power_generator: model('power_generator'),
  barracks: model('barracks'),
  vehicle_factory: model('vehicle_factory'),
  defense_turret: model('defense_turret'),
};

/** Resource nodes, keyed `<node kind>_node`, and the boulders that tile impassable rock. */
export const TERRAIN_MODELS: Readonly<Record<string, string>> = {
  ore_node: model('ore_node'),
  aether_node: model('aether_node'),
  rock: model('rock'),
  rock_spire: model('rock_spire'),
};
