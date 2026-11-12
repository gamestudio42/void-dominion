/** A level pad so a building or a node does not straddle a slope. */
export interface Pad {
  x: number;
  z: number;
  width: number;
  depth: number;
}

/**
 * The view mesh is level. The simulation stays on a flat grid; this is only
 * where the view sets a mesh down. A full-map roll was tried and removed:
 * the field does not need to undulate everywhere.
 */
export function terrainHeight(_x: number, _z: number): number {
  return 0;
}

/** One sample per integer corner, row `z`, column `x`. */
export function bakeRelief(mapSize: number, pads: readonly Pad[]): Float32Array {
  const stride = mapSize + 1;
  const heights = new Float32Array(stride * stride);
  for (let z = 0; z <= mapSize; z++) {
    for (let x = 0; x <= mapSize; x++) heights[z * stride + x] = terrainHeight(x, z);
  }
  for (const pad of pads) stampPad(heights, mapSize, pad);
  return heights;
}

function stampPad(heights: Float32Array, mapSize: number, pad: Pad): void {
  const stride = mapSize + 1;
  const flat = terrainHeight(pad.x + pad.width / 2, pad.z + pad.depth / 2);
  const skirt = 1.5;
  const minX = Math.max(0, Math.floor(pad.x - skirt));
  const maxX = Math.min(mapSize, Math.ceil(pad.x + pad.width + skirt));
  const minZ = Math.max(0, Math.floor(pad.z - skirt));
  const maxZ = Math.min(mapSize, Math.ceil(pad.z + pad.depth + skirt));
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const outsideX = x < pad.x ? pad.x - x : x > pad.x + pad.width ? x - (pad.x + pad.width) : 0;
      const outsideZ = z < pad.z ? pad.z - z : z > pad.z + pad.depth ? z - (pad.z + pad.depth) : 0;
      const dist = Math.sqrt(outsideX * outsideX + outsideZ * outsideZ);
      const mix = Math.min(1, dist / skirt);
      const index = z * stride + x;
      heights[index] = flat * (1 - mix) + heights[index]! * mix;
    }
  }
}

/** Bilinear height inside the baked grid. Coordinates are cell-space. */
export function sampleRelief(heights: Float32Array, mapSize: number, x: number, z: number): number {
  const stride = mapSize + 1;
  const fx = Math.min(mapSize, Math.max(0, x));
  const fz = Math.min(mapSize, Math.max(0, z));
  const x0 = Math.min(mapSize, Math.floor(fx));
  const z0 = Math.min(mapSize, Math.floor(fz));
  const x1 = Math.min(mapSize, x0 + 1);
  const z1 = Math.min(mapSize, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const h00 = heights[z0 * stride + x0]!;
  const h10 = heights[z0 * stride + x1]!;
  const h01 = heights[z1 * stride + x0]!;
  const h11 = heights[z1 * stride + x1]!;
  const top = h00 * (1 - tx) + h10 * tx;
  const bottom = h01 * (1 - tx) + h11 * tx;
  return top * (1 - tz) + bottom * tz;
}
