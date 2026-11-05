import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNIT_KINDS } from '@void-dominion/content';
import { Box3, Mesh, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { UNIT_MODELS } from '../../../apps/game/src/models.ts';

function parse(bytes: Buffer) {
  const buffer = new Uint8Array(bytes).buffer;
  return new GLTFLoader().parseAsync(buffer, '');
}

describe('unit models', () => {
  it('ships one verified model for every unit kind', () => {
    expect(Object.keys(UNIT_MODELS).sort()).toEqual([...UNIT_KINDS].sort());
  });

  for (const kind of UNIT_KINDS) {
    it(`loads ${kind} with a team material, standing on the ground`, async () => {
      const path = fileURLToPath(UNIT_MODELS[kind]!);
      const bytes = readFileSync(path);
      const manifest = JSON.parse(readFileSync(path.replace(/[^/]+\.glb$/, 'manifest.json'), 'utf8'));
      expect(manifest.verdict).toBe('pass');
      expect(manifest.exports.at(-1).export.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));

      const gltf = await parse(bytes);
      const names: string[] = [];
      gltf.scene.traverse((child) => {
        if (child instanceof Mesh) names.push((child.material as MeshStandardMaterial).name);
      });
      expect(names).toContain('team');
      const bounds = new Box3().setFromObject(gltf.scene);
      expect(bounds.min.y).toBeCloseTo(0, 3);
      expect(bounds.max.y).toBeGreaterThan(0.2);
    });
  }
});
