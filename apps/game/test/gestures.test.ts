import { describe, expect, it } from 'vitest';
import { emptyGesture, fingerDown, fingerHold, fingerMove, fingerUp, groundShift, TOUCH_SLOP } from '../src/gestures.ts';

describe('touch gestures', () => {
  it('treats a still finger as a tap and not a pan', () => {
    const down = fingerDown(emptyGesture(), 1, { x: 40, y: 50 });
    const nudge = fingerMove(down.gesture, 1, { x: 40 + TOUCH_SLOP - 1, y: 50 }, TOUCH_SLOP);
    const up = fingerUp(nudge.gesture, 1);
    expect(nudge.pan).toBeNull();
    expect(up.tap).toEqual({ x: 40, y: 50 });
    expect(up.order).toBeNull();
    expect(up.gesture.primary).toBeNull();
  });

  it('pans once the finger leaves the slop and does not also tap', () => {
    const down = fingerDown(emptyGesture(), 1, { x: 10, y: 10 });
    const move = fingerMove(down.gesture, 1, { x: 10 + TOUCH_SLOP, y: 14 }, TOUCH_SLOP);
    const up = fingerUp(move.gesture, 1);
    expect(move.pan).toEqual({ x: TOUCH_SLOP, y: 4 });
    expect(move.gesture.moved).toBe(true);
    expect(up.tap).toBeNull();
    expect(up.order).toBeNull();
  });

  it('orders on a hold and does not tap when the finger lifts', () => {
    const down = fingerDown(emptyGesture(), 1, { x: 80, y: 90 });
    const hold = fingerHold(down.gesture);
    const up = fingerUp(hold.gesture, 1);
    expect(hold.order).toEqual({ x: 80, y: 90 });
    expect(hold.gesture.ordered).toBe(true);
    expect(up.tap).toBeNull();
    expect(fingerHold(hold.gesture).order).toBeNull();
  });

  it('does not order once the finger has panned', () => {
    const down = fingerDown(emptyGesture(), 1, { x: 0, y: 0 });
    const move = fingerMove(down.gesture, 1, { x: 30, y: 0 }, TOUCH_SLOP);
    expect(fingerHold(move.gesture).order).toBeNull();
  });

  it('zooms by the pinch ratio and pans by the midpoint', () => {
    const first = fingerDown(emptyGesture(), 1, { x: 0, y: 0 });
    const second = fingerDown(first.gesture, 2, { x: 100, y: 0 });
    const spread = fingerMove(second.gesture, 2, { x: 140, y: 0 }, TOUCH_SLOP);
    const lift = fingerUp(spread.gesture, 2);
    const last = fingerUp(lift.gesture, 1);
    expect(second.gesture.pinch).toEqual({ distance: 100, mid: { x: 50, y: 0 } });
    expect(spread.zoom).toBeCloseTo(1.4);
    expect(spread.pan).toEqual({ x: 20, y: 0 });
    expect(lift.tap).toBeNull();
    expect(last.tap).toBeNull();
  });

  it('drops a tap when the pointer is cancelled', () => {
    const down = fingerDown(emptyGesture(), 1, { x: 4, y: 6 });
    expect(fingerUp(down.gesture, 1, false).tap).toBeNull();
  });

  it('shifts the camera opposite the ground point under the finger', () => {
    expect(groundShift({ x: 10, y: 20 }, { x: 14, y: 17 })).toEqual({ x: -4, y: 3 });
    expect(groundShift(null, { x: 1, y: 1 })).toBeNull();
  });
});
