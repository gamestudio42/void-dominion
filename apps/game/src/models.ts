/**
 * Verified unit meshes from the Blender pipeline. Each file has a manifest beside it
 * under assets/models/<kind>/. The renderer keeps a box for any kind missing here.
 */
export const UNIT_MODELS: Readonly<Record<string, string>> = {
  engineer: new URL('../../../assets/models/engineer/engineer.glb', import.meta.url).href,
  rifleman: new URL('../../../assets/models/rifleman/rifleman.glb', import.meta.url).href,
  rocketeer: new URL('../../../assets/models/rocketeer/rocketeer.glb', import.meta.url).href,
  scout_rover: new URL('../../../assets/models/scout_rover/scout_rover.glb', import.meta.url).href,
  assault_walker: new URL('../../../assets/models/assault_walker/assault_walker.glb', import.meta.url).href,
};
