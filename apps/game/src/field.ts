import { DEMO_OBSTACLE, MAP_SIZE, PLAYER_ID } from '@void-dominion/content';
import { FIXED_DT, FixedStepper } from '@void-dominion/kernel';
import { Simulation } from '@void-dominion/simulation';
import { createField } from '@void-dominion/view3d';
import { messagesFor, reasonText } from './locales.ts';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FieldUi {
  selectedCount: number;
  rejection: string | null;
  debug: boolean;
  tick: number;
  fps: number;
  box: Box | null;
}

interface Point {
  x: number;
  y: number;
}

const DRAG_SLOP = 5;
const PICK_RADIUS = 28;

/** Runs the simulation and the view. Selection stays here; it is not a rule. */
export function startField(canvas: HTMLCanvasElement, onUi: (ui: FieldUi) => void, language: string): () => void {
  const messages = messagesFor(language);
  const sim = Simulation.create();
  const view = createField(canvas, MAP_SIZE);
  view.setObstacle(DEMO_OBSTACLE);
  const stepper = new FixedStepper({ dt: FIXED_DT, maxFrameTime: 0.25, maxStepsPerFrame: 8 });
  const selected = new Set<number>();
  const keys = new Set<string>();
  let previous = capture();
  let current = capture();
  let refusedAt: Point | null = null;
  let pendingOrder = false;
  let debug = false;
  let box: Box | null = null;
  let drag: { x: number; y: number; moved: boolean; pointerId: number } | null = null;
  let lastUi = '';
  let fps = 0;
  let fpsStamp = performance.now();
  let frames = 0;
  let lastAlpha = 0;
  let stopped = false;

  function capture(): Map<number, Point> {
    const positions = new Map<number, Point>();
    for (const unit of sim.world.units) positions.set(unit.id, { x: unit.x, y: unit.y });
    return positions;
  }

  function shownUnits(alpha: number) {
    return sim.world.units.map((unit) => {
      const from = previous.get(unit.id) ?? unit;
      const to = current.get(unit.id) ?? unit;
      return {
        id: unit.id,
        x: from.x + (to.x - from.x) * alpha,
        y: from.y + (to.y - from.y) * alpha,
        selected: selected.has(unit.id),
      };
    });
  }

  function publish(): void {
    const next: FieldUi = {
      selectedCount: selected.size,
      rejection: pendingOrder ? null : reasonText(messages, sim.lastRejection),
      debug,
      tick: sim.world.tick,
      fps,
      box,
    };
    const key = `${next.selectedCount}|${next.rejection}|${next.debug}|${debug ? next.tick : 0}|${debug ? next.fps : 0}|${box?.left ?? ''}|${box?.top ?? ''}|${box?.width ?? ''}|${box?.height ?? ''}`;
    if (key === lastUi) return;
    lastUi = key;
    onUi(next);
  }

  function paint(alpha: number): void {
    view.setUnits(shownUnits(alpha));
    const accepted = !pendingOrder && sim.lastRejection === null && sim.world.marker !== null;
    const marker = accepted ? sim.world.marker : pendingOrder ? null : refusedAt;
    view.setMarker(marker, accepted);
    view.render();
  }

  function unitsIn(rect: Box, alpha: number): number[] {
    const ids: number[] = [];
    for (const unit of shownUnits(alpha)) {
      const screen = view.project(unit.x, unit.y, 0.25);
      if (
        screen.x >= rect.left &&
        screen.x <= rect.left + rect.width &&
        screen.y >= rect.top &&
        screen.y <= rect.top + rect.height
      ) {
        ids.push(unit.id);
      }
    }
    return ids;
  }

  function pick(clientX: number, clientY: number, alpha: number): number | null {
    let best: number | null = null;
    let bestDistance = PICK_RADIUS;
    for (const unit of shownUnits(alpha)) {
      const screen = view.project(unit.x, unit.y, 0.25);
      const dx = screen.x - clientX;
      const dy = screen.y - clientY;
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = unit.id;
      }
    }
    return best;
  }

  function selectIds(ids: number[], add: boolean): void {
    if (!add) selected.clear();
    for (const id of ids) selected.add(id);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const width = event.clientX - drag.x;
    const height = event.clientY - drag.y;
    if (!drag.moved && Math.abs(width) < DRAG_SLOP && Math.abs(height) < DRAG_SLOP) return;
    drag.moved = true;
    box = {
      left: width < 0 ? event.clientX : drag.x,
      top: height < 0 ? event.clientY : drag.y,
      width: Math.abs(width),
      height: Math.abs(height),
    };
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.button === 2) {
      if (!drag?.moved) orderMove(event.clientX, event.clientY);
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved && box) selectIds(unitsIn(box, lastAlpha), event.shiftKey);
    else {
      const id = pick(event.clientX, event.clientY, lastAlpha);
      if (id === null) {
        if (!event.shiftKey) selected.clear();
      } else selectIds([id], event.shiftKey);
    }
    box = null;
    drag = null;
  }

  function orderMove(clientX: number, clientY: number): void {
    if (selected.size === 0) return;
    const ground = view.groundAt(clientX, clientY);
    if (!ground) return;
    const cell = { x: Math.floor(ground.x), y: Math.floor(ground.y) };
    pendingOrder = true;
    refusedAt = cell;
    sim.enqueue({
      type: 'move',
      playerId: PLAYER_ID,
      unitIds: [...selected].sort((a, b) => a - b),
      to: cell,
    });
  }

  function onKey(event: KeyboardEvent, down: boolean): void {
    if (event.code === 'F3' && down) {
      debug = !debug;
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD') {
      if (down) keys.add(event.code);
      else keys.delete(event.code);
      event.preventDefault();
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    view.zoomBy(event.deltaY);
  }

  let lastTime = performance.now();
  let frame = 0;

  function tick(now: number): void {
    if (stopped) return;
    const elapsed = Math.max(0, (now - lastTime) / 1000);
    lastTime = now;
    frames += 1;
    if (now - fpsStamp >= 250) {
      fps = Math.round((frames * 1000) / (now - fpsStamp));
      frames = 0;
      fpsStamp = now;
    }
    const pan = 24 * elapsed;
    if (keys.has('KeyA')) view.pan(-pan, 0);
    if (keys.has('KeyD')) view.pan(pan, 0);
    if (keys.has('KeyW')) view.pan(0, pan);
    if (keys.has('KeyS')) view.pan(0, -pan);

    const stepped = stepper.advance(elapsed);
    if (stepped.steps > 0) {
      previous = current;
      for (let i = 0; i < stepped.steps; i++) sim.step();
      current = capture();
      if (pendingOrder) {
        pendingOrder = false;
        if (sim.lastRejection === null) refusedAt = null;
      }
    }
    lastAlpha = stepped.alpha;
    paint(stepped.alpha);
    publish();
    frame = requestAnimationFrame(tick);
  }

  const keyDown = (event: KeyboardEvent) => onKey(event, true);
  const keyUp = (event: KeyboardEvent) => onKey(event, false);
  const onContextMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('resize', view.resize);

  paint(0);
  publish();
  frame = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('resize', view.resize);
    view.dispose();
  };
}
