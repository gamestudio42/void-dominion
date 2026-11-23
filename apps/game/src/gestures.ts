/**
 * Touch and pen gestures for the field. A mouse never enters this reducer:
 * button 0 still draws a selection box, the wheel still zooms, and a right
 * click still orders. One finger drags to pan, a still finger holds to order,
 * and two fingers pinch to zoom while their midpoint pans.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pinch {
  distance: number;
  mid: Vec2;
}

export interface Gesture {
  fingers: Readonly<Record<number, Vec2>>;
  primary: number | null;
  origin: Vec2 | null;
  last: Vec2 | null;
  moved: boolean;
  ordered: boolean;
  pinch: Pinch | null;
}

export interface GestureStep {
  gesture: Gesture;
  /** Screen-space drag since the previous sample. */
  pan: Vec2 | null;
  /** Scale since the previous pinch sample. Greater than 1 zooms in. */
  zoom: number | null;
  /** Screen point of a long-press order. */
  order: Vec2 | null;
  /** Screen point of a tap that did not pan or order. */
  tap: Vec2 | null;
}

/** A finger that stays inside the slop this long orders, as a right click would. */
export const HOLD_MS = 480;

/** Movement below this, on either axis, is still a tap. Matches the box-select test. */
export const TOUCH_SLOP = 12;

export function emptyGesture(): Gesture {
  return { fingers: {}, primary: null, origin: null, last: null, moved: false, ordered: false, pinch: null };
}

export function fingerDown(gesture: Gesture, id: number, at: Vec2): GestureStep {
  const fingers = { ...gesture.fingers, [id]: at };
  if (Object.keys(fingers).length >= 2) {
    return step({
      fingers,
      primary: null,
      origin: null,
      last: null,
      moved: true,
      ordered: gesture.ordered,
      pinch: pinchOf(fingers),
    });
  }
  return step({
    fingers,
    primary: id,
    origin: at,
    last: at,
    moved: false,
    ordered: false,
    pinch: null,
  });
}

export function fingerMove(gesture: Gesture, id: number, at: Vec2, slop: number): GestureStep {
  if (gesture.fingers[id] === undefined) return step(gesture);
  const fingers = { ...gesture.fingers, [id]: at };
  if (gesture.pinch !== null && Object.keys(fingers).length >= 2) {
    const next = pinchOf(fingers);
    const raw = gesture.pinch.distance > 0 ? next.distance / gesture.pinch.distance : 1;
    return step(
      { ...gesture, fingers, pinch: next, moved: true },
      { x: next.mid.x - gesture.pinch.mid.x, y: next.mid.y - gesture.pinch.mid.y },
      clampZoom(raw),
    );
  }
  if (gesture.primary !== id || gesture.last === null || gesture.origin === null) return step({ ...gesture, fingers });
  const totalX = at.x - gesture.origin.x;
  const totalY = at.y - gesture.origin.y;
  if (!gesture.moved && Math.abs(totalX) < slop && Math.abs(totalY) < slop) return step({ ...gesture, fingers });
  return step({ ...gesture, fingers, last: at, moved: true }, { x: at.x - gesture.last.x, y: at.y - gesture.last.y });
}

export function fingerHold(gesture: Gesture): GestureStep {
  if (gesture.primary === null || gesture.moved || gesture.ordered || gesture.pinch !== null || gesture.origin === null) {
    return step(gesture);
  }
  if (Object.keys(gesture.fingers).length !== 1) return step(gesture);
  return step({ ...gesture, moved: true, ordered: true }, null, null, gesture.origin);
}

/** `commit` is false when the pointer is cancelled, so a tap is not invented. */
export function fingerUp(gesture: Gesture, id: number, commit = true): GestureStep {
  if (gesture.fingers[id] === undefined) return step(gesture);
  const fingers = dropFinger(gesture.fingers, id);
  const left = Object.keys(fingers).length;
  if (gesture.pinch !== null || gesture.primary === null) {
    if (left >= 2) return step({ ...gesture, fingers, pinch: pinchOf(fingers), moved: true, primary: null });
    if (left === 1) {
      const onlyId = Number(Object.keys(fingers)[0]);
      const only = fingers[onlyId];
      if (!only) return step(emptyGesture());
      return step({ fingers, primary: onlyId, origin: only, last: only, moved: true, ordered: false, pinch: null });
    }
    return step(emptyGesture());
  }
  const tap = commit && gesture.primary === id && !gesture.moved && !gesture.ordered ? gesture.origin : null;
  if (left === 0) return step(emptyGesture(), null, null, null, tap);
  const primary = gesture.primary === id ? null : gesture.primary;
  return step({ ...gesture, fingers, primary, origin: primary === null ? null : gesture.origin, last: primary === null ? null : gesture.last }, null, null, null, tap);
}

/** Keep the ground point that was under the finger under the finger. */
export function groundShift(before: Vec2 | null, after: Vec2 | null): Vec2 | null {
  if (!before || !after) return null;
  return { x: before.x - after.x, y: before.y - after.y };
}

function step(
  gesture: Gesture,
  pan: Vec2 | null = null,
  zoom: number | null = null,
  order: Vec2 | null = null,
  tap: Vec2 | null = null,
): GestureStep {
  return { gesture, pan, zoom, order, tap };
}

function dropFinger(fingers: Readonly<Record<number, Vec2>>, id: number): Record<number, Vec2> {
  const next: Record<number, Vec2> = {};
  for (const key of Object.keys(fingers)) {
    if (Number(key) === id) continue;
    const point = fingers[Number(key)];
    if (point) next[Number(key)] = point;
  }
  return next;
}

function pinchOf(fingers: Readonly<Record<number, Vec2>>): Pinch {
  const points = Object.values(fingers);
  const a = points[0] ?? { x: 0, y: 0 };
  const b = points[1] ?? a;
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

function clampZoom(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(2, Math.max(0.5, factor));
}
