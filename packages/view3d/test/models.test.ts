import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDING_KINDS, UNIT_KINDS, buildingDef } from '@void-dominion/content';
import { Box3, Mesh, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BUILDING_MODELS, TERRAIN_MODELS, UNIT_MODELS } from '../../../apps/game/src/models.ts';

/** Building specs fill this share of the footprint, as the boxes did. */
const FOOTPRINT_MARGIN = 0.92;

function parse(bytes: Buffer) {
  const buffer = new Uint8Array(bytes).buffer;
  return new GLTFLoader().parseAsync(buffer, '');
}

/** The interceptor embeds PNG maps. Node's GLTFLoader cannot decode those, so the test reads the JSON chunk. */
function gltfDocument(bytes: Buffer): { materials?: { name?: string }[]; accessors?: { min?: number[]; max?: number[] }[] } {
  const magic = bytes.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('not a glb');
  const length = bytes.readUInt32LE(8);
  let offset = 12;
  while (offset + 8 <= length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkType === 0x4e4f534a) return JSON.parse(bytes.subarray(offset, offset + chunkLength).toString('utf8'));
    offset += chunkLength;
  }
  throw new Error('glb has no json chunk');
}

/** Read a shipped model, check it against its manifest, and return its bounds and material names. */
async function load(url: string) {
  const path = fileURLToPath(url);
  const bytes = readFileSync(path);
  const manifest = JSON.parse(readFileSync(path.replace(/[^/]+\.glb$/, 'manifest.json'), 'utf8'));
  expect(manifest.verdict).toBe('pass');
  expect(manifest.exports.at(-1).export.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const gltf = await parse(bytes);
  const names: string[] = [];
  gltf.scene.traverse((child) => {
    if (child instanceof Mesh) names.push((child.material as MeshStandardMaterial).name);
  });
  return { names, bounds: new Box3().setFromObject(gltf.scene) };
}

describe('unit models', () => {
  it('ships one verified model for every unit kind', () => {
    expect(Object.keys(UNIT_MODELS).sort()).toEqual([...UNIT_KINDS].sort());
  });

  for (const kind of UNIT_KINDS) {
    it(`loads ${kind} standing on the ground`, async () => {
      if (kind === 'interceptor') {
        const path = fileURLToPath(UNIT_MODELS[kind]!);
        const bytes = readFileSync(path);
        const manifest = JSON.parse(readFileSync(path.replace(/[^/]+\.glb$/, 'manifest.json'), 'utf8'));
        expect(manifest.verdict).toBe('pass');
        expect(manifest.exports.at(-1).export.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        const doc = gltfDocument(bytes);
        const names = (doc.materials ?? []).map((material) => material.name);
        expect(names).toContain('hull');
        expect(names).toContain('glow');
        expect(names).not.toContain('team');
        const position = doc.accessors?.find((accessor) => accessor.min && accessor.max);
        expect(position?.min?.[1]).toBeCloseTo(0, 3);
        const span = Math.max(
          (position?.max?.[0] ?? 0) - (position?.min?.[0] ?? 0),
          (position?.max?.[2] ?? 0) - (position?.min?.[2] ?? 0),
        );
        expect(span).toBeCloseTo(1.6, 1);
        return;
      }
      const { names, bounds } = await load(UNIT_MODELS[kind]!);
      expect(names).toContain('team');
      expect(bounds.min.y).toBeCloseTo(0, 3);
      expect(bounds.max.y).toBeGreaterThan(0.2);
    });
  }
});

describe('building models', () => {
  it('ships one verified model for every building kind', () => {
    expect(Object.keys(BUILDING_MODELS).sort()).toEqual([...BUILDING_KINDS].sort());
  });

  for (const kind of BUILDING_KINDS) {
    it(`fits ${kind} to its footprint, standing on the ground`, async () => {
      const { names, bounds } = await load(BUILDING_MODELS[kind]!);
      const def = buildingDef(kind);
      expect(names).toContain('team');
      expect(bounds.min.y).toBeCloseTo(0, 3);
      /** Width runs along x and the footprint height along z, centred on the footprint. */
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(def.width * FOOTPRINT_MARGIN, 2);
      expect(bounds.max.z - bounds.min.z).toBeCloseTo(def.height * FOOTPRINT_MARGIN, 2);
      expect(bounds.min.x + bounds.max.x).toBeCloseTo(0, 2);
      expect(bounds.min.z + bounds.max.z).toBeCloseTo(0, 2);
    });
  }
});

describe('terrain models', () => {
  it('ships a node model for both resources and two boulders', () => {
    expect(Object.keys(TERRAIN_MODELS).sort()).toEqual(['aether_node', 'ore_node', 'rock', 'rock_spire']);
  });

  for (const kind of ['ore_node', 'aether_node']) {
    it(`keeps ${kind} inside its one cell, standing on the ground`, async () => {
      const { names, bounds } = await load(TERRAIN_MODELS[kind]!);
      expect(names).not.toContain('team');
      expect(bounds.min.y).toBeCloseTo(0, 3);
      expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(1.0001);
      expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(1.0001);
    });
  }

  for (const kind of ['rock', 'rock_spire']) {
    it(`sizes ${kind} to about two cells, standing on the ground`, async () => {
      const { names, bounds } = await load(TERRAIN_MODELS[kind]!);
      expect(names).not.toContain('team');
      expect(bounds.min.y).toBeCloseTo(0, 3);
      expect(Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z)).toBeLessThanOrEqual(2.0001);
    });
  }
});
