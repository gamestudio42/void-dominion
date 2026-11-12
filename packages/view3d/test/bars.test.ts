import { describe, expect, it } from 'vitest';
import { healthBarFrame } from '../src/field.ts';

describe('health bar', () => {
  it('stays hidden at full health and after the unit is gone', () => {
    expect(healthBarFrame(40, 40).show).toBe(false);
    expect(healthBarFrame(0, 40).show).toBe(false);
    expect(healthBarFrame(10, 0).show).toBe(false);
  });

  it('shrinks from the left and shifts colour as the unit is hurt', () => {
    const healthy = healthBarFrame(30, 40);
    const mid = healthBarFrame(16, 40);
    const low = healthBarFrame(8, 40);
    expect(healthy.show).toBe(true);
    expect(healthy.shown).toBeCloseTo(0.9 * 0.75);
    expect(healthy.color).toBe('#9be7b4');
    expect(mid.color).toBe('#ffb03a');
    expect(low.color).toBe('#ff5a52');
    expect(low.shown).toBeLessThan(mid.shown);
  });
});
