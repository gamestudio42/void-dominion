import { describe, expect, it } from 'vitest';
import { FIXED_DT, Fnv1a, FixedStepper, Rng, SIMULATION_HZ } from '../src/index.ts';

describe('Rng', () => {
  it('repeats the same stream for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextUint32()).toBe(b.nextUint32());
    expect(new Rng(1).nextUint32()).not.toBe(new Rng(2).nextUint32());
  });
});

describe('Fnv1a', () => {
  it('is stable for the same bytes', () => {
    const a = new Fnv1a().u32(7).f64Value(1.5).digest();
    const b = new Fnv1a().u32(7).f64Value(1.5).digest();
    expect(a).toBe(b);
    expect(new Fnv1a().u32(8).digest()).not.toBe(a);
  });
});

describe('FixedStepper', () => {
  const options = { dt: FIXED_DT, maxFrameTime: 0.25, maxStepsPerFrame: 8 };

  it('runs at 20 Hz', () => {
    expect(SIMULATION_HZ).toBe(20);
    expect(FIXED_DT).toBe(1 / 20);
  });

  it('runs whole steps and carries the remainder', () => {
    const stepper = new FixedStepper(options);
    const first = stepper.advance(FIXED_DT * 2 + 0.001);
    expect(first.steps).toBe(2);
    expect(first.alpha).toBeGreaterThan(0);
    expect(first.alpha).toBeLessThan(1);
  });

  it('drops time beyond the frame cap', () => {
    const stepper = new FixedStepper(options);
    const result = stepper.advance(1);
    expect(result.steps).toBeLessThanOrEqual(8);
    expect(result.droppedTime).toBeGreaterThan(0);
  });
});
