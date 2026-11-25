import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * GLSL ES 3 reserves words that are legal in the script around the shader.
 * ANGLE, and SwiftShader behind it, rejects them as identifiers and the
 * material draws nothing. `patch` is one of those words.
 */
const RESERVED = ['patch', 'sample', 'filter', 'common', 'active', 'half', 'fixed', 'input', 'output'];

function shaderSources(source: string): string[] {
  return [...source.matchAll(/(?:vertex|fragment)Shader:\s*`([\s\S]*?)`/g)].map((match) => match[1] ?? '');
}

function identifiers(glsl: string): string[] {
  const code = glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  return code.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
}

describe('field shaders', () => {
  const source = readFileSync(new URL('../src/field.ts', import.meta.url), 'utf8');
  const shaders = shaderSources(source);

  it('finds the ground and fog programs', () => {
    expect(shaders.length).toBe(4);
  });

  it('does not use a reserved GLSL word as an identifier', () => {
    for (const shader of shaders) {
      const names = new Set(identifiers(shader));
      for (const word of RESERVED) expect(names.has(word)).toBe(false);
      expect(shader.toLowerCase()).not.toContain('patch');
    }
  });
});
