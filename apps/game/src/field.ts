import {
  BUILDINGS,
  MAP_SIZE,
  MATCH,
  PLAYER_ID,
  buildingDef,
  unitDef,
  type BuildingKind,
  type UnitKind,
} from '@void-dominion/content';
import { FIXED_DT, FixedStepper } from '@void-dominion/kernel';
import {
  Simulation,
  canSee,
  canSeeFootprint,
  deserializeReplay,
  isWalkable,
  powerGive,
  powerTake,
  serializeReplay,
  siteRefusal,
  supplyCap,
  supplyUsed,
  type Command,
} from '@void-dominion/simulation';
import { createField } from '@void-dominion/view3d';
import { messagesFor, reasonText } from './locales.ts';
import { UNIT_MODELS } from './models.ts';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TrainChoice {
  kind: UnitKind;
  ore: number;
  aether: number;
}

export type OrderMode = 'none' | 'attack' | 'build';

export interface FieldUi {
  selectedLabel: string;
  rejection: string | null;
  debug: boolean;
  tick: number;
  fps: number;
  box: Box | null;
  ore: number;
  aether: number;
  supplyUsed: number;
  supplyCap: number;
  powerGive: number;
  powerTake: number;
  clock: string;
  mode: OrderMode;
  buildKind: BuildingKind | null;
  buildOpen: boolean;
  trains: TrainChoice[];
  contact: boolean;
  banner: 'victory' | 'defeat' | 'draw' | null;
}

export interface FieldActions {
  stop(): void;
  mine(): void;
  attack(): void;
  toggleBuild(): void;
  chooseBuild(kind: BuildingKind): void;
  produce(kind: UnitKind): void;
  cancel(): void;
  saveReplay(): void;
  loadReplay(text: string): void;
}

interface Point {
  x: number;
  y: number;
}

const DRAG_SLOP = 5;
const PICK_RADIUS = 28;

/** Runs the match and the view. Selection and the command card stay here; they are not rules. */
export function startField(
  canvas: HTMLCanvasElement,
  minimap: HTMLCanvasElement,
  onUi: (ui: FieldUi) => void,
  language: string,
  actions: { current: FieldActions | null },
): () => void {
  const messages = messagesFor(language);
  let sim = Simulation.create();
  const home = MATCH.bases[0]!;
  const view = createField(canvas, MAP_SIZE, { x: home.cc.x + 6, z: home.cc.y + 2 });
  view.setRocks(sim.world.rocks);
  view.setUnitModels(UNIT_MODELS);
  const stepper = new FixedStepper({ dt: FIXED_DT, maxFrameTime: 0.25, maxStepsPerFrame: 8 });
  const selected = new Set<number>();
  const keys = new Set<string>();
  const blot = document.createElement('canvas');
  blot.width = MAP_SIZE;
  blot.height = MAP_SIZE;
  let previous = capture();
  let current = capture();
  let refusedAt: Point | null = null;
  let pendingOrder = false;
  let hideRejection = false;
  let note: string | null = null;
  let debug = false;
  let box: Box | null = null;
  let mode: OrderMode = 'none';
  let buildKind: BuildingKind | null = null;
  let buildOpen = false;
  let selectedBuilding: number | null = null;
  let hover: Point | null = null;
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

  function selectedIds(): number[] {
    return [...selected].sort((a, b) => a - b);
  }

  function engineerIds(): number[] {
    return selectedIds().filter((id) => sim.world.units.find((unit) => unit.id === id)?.kind === 'engineer');
  }

  function playing(): boolean {
    return sim.world.winner === 0;
  }

  function issue(cmd: Command, mark: Point | null): void {
    if (!playing()) return;
    pendingOrder = true;
    hideRejection = false;
    note = null;
    refusedAt = mark;
    sim.enqueue(cmd);
  }

  function shownUnits(alpha: number) {
    const draws = [];
    for (const unit of sim.world.units) {
      const cellX = Math.floor(unit.x);
      const cellY = Math.floor(unit.y);
      if (unit.owner !== PLAYER_ID && !canSee(sim.world, PLAYER_ID, cellX, cellY)) continue;
      const from = previous.get(unit.id) ?? unit;
      const to = current.get(unit.id) ?? unit;
      draws.push({
        id: unit.id,
        x: from.x + (to.x - from.x) * alpha,
        y: from.y + (to.y - from.y) * alpha,
        owner: unit.owner,
        kind: unit.kind,
        selected: selected.has(unit.id),
        hp: unit.hp,
        maxHp: unitDef(unit.kind).hp,
      });
    }
    return draws;
  }

  function shownBuildings() {
    const draws = [];
    for (const building of sim.world.buildings) {
      const def = buildingDef(building.kind);
      const seen = building.owner === PLAYER_ID || canSeeFootprint(sim.world, PLAYER_ID, building.x, building.y, def.width, def.height);
      if (!seen) continue;
      draws.push({
        id: building.id,
        x: building.x,
        y: building.y,
        width: def.width,
        height: def.height,
        owner: building.owner,
        progress: def.buildTicks > 0 ? building.progress / def.buildTicks : 1,
        selected: selectedBuilding === building.id,
        wreck: false,
        hp: building.hp,
        maxHp: def.hp,
      });
    }
    for (const ghost of sim.world.memory[PLAYER_ID - 1] ?? []) {
      if (ghost.owner === PLAYER_ID || draws.some((draw) => draw.id === ghost.id)) continue;
      const def = buildingDef(ghost.kind);
      draws.push({
        id: ghost.id,
        x: ghost.x,
        y: ghost.y,
        width: def.width,
        height: def.height,
        owner: ghost.owner,
        progress: ghost.wreck || def.buildTicks === 0 ? 0 : ghost.progress / def.buildTicks,
        selected: false,
        wreck: ghost.wreck,
        hp: ghost.hp,
        maxHp: def.hp,
      });
    }
    return draws;
  }

  function shownNodes() {
    const explored = sim.world.explored[PLAYER_ID - 1]!;
    return sim.world.nodes
      .filter((node) => node.amount > 0 && explored[node.y * MAP_SIZE + node.x] === 1)
      .map((node) => ({ id: node.id, x: node.x, y: node.y, kind: node.kind }));
  }

  function banner(): FieldUi['banner'] {
    if (sim.world.winner === 0) return null;
    if (sim.world.winner === PLAYER_ID) return 'victory';
    if (sim.world.winner < 0) return 'draw';
    return 'defeat';
  }

  function selectionLabel(): string {
    if (selectedBuilding !== null) {
      const building = sim.world.buildings.find((entry) => entry.id === selectedBuilding);
      if (!building) return '';
      const name = messages.buildingName(building.kind);
      const def = buildingDef(building.kind);
      if (building.progress < def.buildTicks) return messages.constructing(name, Math.floor((building.progress / def.buildTicks) * 100));
      return name;
    }
    if (selected.size === 0) return '';
    return messages.selected(selected.size);
  }

  function trainChoices(): TrainChoice[] {
    if (selectedBuilding === null) return [];
    const building = sim.world.buildings.find((entry) => entry.id === selectedBuilding);
    if (!building || building.owner !== PLAYER_ID) return [];
    const def = buildingDef(building.kind);
    if (building.progress < def.buildTicks) return [];
    return def.produces.map((kind) => ({ kind, ore: unitDef(kind).ore, aether: unitDef(kind).aether }));
  }

  function clock(tick: number): string {
    const total = Math.floor(tick / 20);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function enemyVisible(): boolean {
    for (const unit of sim.world.units) {
      if (unit.owner === PLAYER_ID) continue;
      if (canSee(sim.world, PLAYER_ID, Math.floor(unit.x), Math.floor(unit.y))) return true;
    }
    return false;
  }

  function publish(): void {
    const stock = sim.world.players.find((entry) => entry.id === PLAYER_ID);
    const trains = trainChoices();
    const next: FieldUi = {
      selectedLabel: selectionLabel(),
      rejection: note ?? (pendingOrder || hideRejection ? null : reasonText(messages, sim.lastRejection)),
      debug,
      tick: sim.world.tick,
      fps,
      box,
      ore: stock?.ore ?? 0,
      aether: stock?.aether ?? 0,
      supplyUsed: supplyUsed(sim.world, PLAYER_ID),
      supplyCap: supplyCap(sim.world, PLAYER_ID),
      powerGive: powerGive(sim.world, PLAYER_ID),
      powerTake: powerTake(sim.world, PLAYER_ID),
      clock: clock(sim.world.tick),
      mode,
      buildKind,
      buildOpen,
      trains,
      contact: enemyVisible(),
      banner: banner(),
    };
    const key = JSON.stringify(next);
    if (key === lastUi) return;
    lastUi = key;
    onUi(next);
  }

  function siteOk(kind: BuildingKind, at: Point): boolean {
    return siteRefusal(sim.world, PLAYER_ID, kind, at) === null;
  }

  function paint(alpha: number): void {
    view.setUnits(shownUnits(alpha));
    view.setBuildings(shownBuildings());
    view.setNodes(shownNodes());
    const explored = sim.world.explored[PLAYER_ID - 1]!;
    const visible = sim.world.visible[PLAYER_ID - 1]!;
    view.setFog(explored, visible);
    if (mode === 'build' && buildKind && hover) {
      const def = BUILDINGS[buildKind];
      view.setGhost({ x: hover.x, y: hover.y, width: def.width, height: def.height, ok: siteOk(buildKind, hover) });
    } else view.setGhost(null);
    const accepted = !pendingOrder && sim.lastRejection === null && sim.world.marker !== null;
    const marker = accepted ? sim.world.marker : pendingOrder ? null : refusedAt;
    const raised = marker !== null && !isWalkable(sim.world.blocked, marker.x, marker.y);
    view.setMarker(marker, accepted, raised);
    view.render();
    drawMinimap();
  }

  function drawMinimap(): void {
    const ctx = blot.getContext('2d');
    const board = minimap.getContext('2d');
    if (!ctx || !board) return;
    const image = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    const explored = sim.world.explored[PLAYER_ID - 1]!;
    const visible = sim.world.visible[PLAYER_ID - 1]!;
    for (let index = 0; index < MAP_SIZE * MAP_SIZE; index++) {
      const offset = index * 4;
      const seen = visible[index] === 1;
      const known = explored[index] === 1;
      image.data[offset] = seen ? 132 : known ? 78 : 24;
      image.data[offset + 1] = seen ? 146 : known ? 86 : 28;
      image.data[offset + 2] = seen ? 162 : known ? 98 : 34;
      image.data[offset + 3] = 255;
    }
    const paintCell = (x: number, y: number, red: number, green: number, blue: number) => {
      if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return;
      const offset = (y * MAP_SIZE + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
    };
    for (const rock of sim.world.rocks) {
      for (let y = rock.y; y < rock.y + rock.height; y++) {
        for (let x = rock.x; x < rock.x + rock.width; x++) {
          if (explored[y * MAP_SIZE + x] !== 1) continue;
          paintCell(x, y, 74, 64, 54);
        }
      }
    }
    for (const building of shownBuildings()) {
      for (let y = building.y; y < building.y + building.height; y++) {
        for (let x = building.x; x < building.x + building.width; x++) {
          paintCell(x, y, building.owner === PLAYER_ID ? 196 : 176, building.owner === PLAYER_ID ? 140 : 64, building.owner === PLAYER_ID ? 70 : 58);
        }
      }
    }
    for (const unit of shownUnits(lastAlpha)) {
      paintCell(Math.floor(unit.x), Math.floor(unit.y), unit.owner === PLAYER_ID ? 240 : 236, unit.owner === PLAYER_ID ? 190 : 92, unit.owner === PLAYER_ID ? 90 : 80);
    }
    ctx.putImageData(image, 0, 0);
    board.imageSmoothingEnabled = false;
    board.clearRect(0, 0, minimap.width, minimap.height);
    board.drawImage(blot, 0, 0, minimap.width, minimap.height);
  }

  function unitsIn(rect: Box, alpha: number): number[] {
    const ids: number[] = [];
    for (const unit of shownUnits(alpha)) {
      if (unit.owner !== PLAYER_ID) continue;
      const screen = view.project(unit.x, unit.y, 0.35);
      if (screen.x >= rect.left && screen.x <= rect.left + rect.width && screen.y >= rect.top && screen.y <= rect.top + rect.height) {
        ids.push(unit.id);
      }
    }
    return ids;
  }

  function pick(clientX: number, clientY: number, alpha: number, owner: number | null): number | null {
    let best: number | null = null;
    let bestDistance = PICK_RADIUS;
    for (const unit of shownUnits(alpha)) {
      if (owner !== null && unit.owner !== owner) continue;
      const screen = view.project(unit.x, unit.y, 0.35);
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

  function ownBuildingAt(clientX: number, clientY: number): number | null {
    return pickBuilding(clientX, clientY, true);
  }

  function enemyBuildingAt(clientX: number, clientY: number): number | null {
    return pickBuilding(clientX, clientY, false);
  }

  function pickBuilding(clientX: number, clientY: number, own: boolean): number | null {
    const ground = view.groundAt(clientX, clientY);
    if (ground) {
      const x = Math.floor(ground.x);
      const y = Math.floor(ground.y);
      for (const building of sim.world.buildings) {
        if ((building.owner === PLAYER_ID) !== own) continue;
        const def = buildingDef(building.kind);
        if (x < building.x || y < building.y || x >= building.x + def.width || y >= building.y + def.height) continue;
        if (!own && !canSeeFootprint(sim.world, PLAYER_ID, building.x, building.y, def.width, def.height)) continue;
        return building.id;
      }
    }
    let best: number | null = null;
    let bestDistance = 72;
    for (const building of sim.world.buildings) {
      if ((building.owner === PLAYER_ID) !== own) continue;
      const def = buildingDef(building.kind);
      if (!own && !canSeeFootprint(sim.world, PLAYER_ID, building.x, building.y, def.width, def.height)) continue;
      const screen = view.project(building.x + def.width / 2, building.y + def.height / 2, 0.7);
      const dx = screen.x - clientX;
      const dy = screen.y - clientY;
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = building.id;
      }
    }
    return best;
  }

  function selectIds(ids: number[], add: boolean): void {
    if (!add) {
      selected.clear();
      selectedBuilding = null;
    }
    for (const id of ids) selected.add(id);
    if (ids.length > 0) selectedBuilding = null;
    hideRejection = true;
  }

  function cellAt(clientX: number, clientY: number): Point | null {
    const ground = view.groundAt(clientX, clientY);
    if (!ground) return null;
    return { x: Math.floor(ground.x), y: Math.floor(ground.y) };
  }

  function orderAt(clientX: number, clientY: number): void {
    const ids = selectedIds();
    if (ids.length === 0 || !playing()) return;
    const enemy = pick(clientX, clientY, lastAlpha, null);
    const enemyUnit = enemy === null ? null : sim.world.units.find((unit) => unit.id === enemy && unit.owner !== PLAYER_ID);
    if (enemyUnit) {
      issue({ type: 'attack', playerId: PLAYER_ID, unitIds: ids, targetId: enemyUnit.id }, { x: Math.floor(enemyUnit.x), y: Math.floor(enemyUnit.y) });
      return;
    }
    const cell = cellAt(clientX, clientY);
    if (!cell) return;
    const structure = enemyBuildingAt(clientX, clientY);
    if (structure !== null) {
      issue({ type: 'attack', playerId: PLAYER_ID, unitIds: ids, targetId: structure }, cell);
      return;
    }
    const node = sim.world.nodes.find((entry) => entry.x === cell.x && entry.y === cell.y && entry.amount > 0);
    const miners = engineerIds();
    if (node && miners.length > 0) {
      issue({ type: 'gather', playerId: PLAYER_ID, unitIds: miners, nodeId: node.id }, cell);
      return;
    }
    const military = ids.every((id) => {
      const unit = sim.world.units.find((entry) => entry.id === id);
      return unit ? unitDef(unit.kind).damage > 0 : false;
    });
    issue(
      military
        ? { type: 'attack_move', playerId: PLAYER_ID, unitIds: ids, to: cell }
        : { type: 'move', playerId: PLAYER_ID, unitIds: ids, to: cell },
      cell,
    );
  }

  function place(clientX: number, clientY: number): void {
    if (!buildKind || !playing()) return;
    const cell = cellAt(clientX, clientY);
    if (!cell) return;
    const miners = engineerIds();
    const ids = miners.length > 0 ? miners : selectedIds();
    if (ids.length === 0) return;
    issue({ type: 'build', playerId: PLAYER_ID, unitIds: ids, kind: buildKind, at: cell }, cell);
  }

  function nearestOre(): number | null {
    const anchor = sim.world.units.find((unit) => selected.has(unit.id) && unit.kind === 'engineer');
    if (!anchor) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const node of sim.world.nodes) {
      if (node.kind !== 'ore' || node.amount <= 0) continue;
      const dx = node.x - anchor.x;
      const dy = node.y - anchor.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = node.id;
      }
    }
    return best;
  }

  actions.current = {
    stop() {
      const ids = selectedIds();
      if (ids.length === 0) return;
      issue({ type: 'stop', playerId: PLAYER_ID, unitIds: ids }, null);
    },
    mine() {
      const miners = engineerIds();
      const ids = miners.length > 0 ? miners : selectedIds();
      const nodeId = nearestOre();
      if (ids.length === 0 || nodeId === null) return;
      const node = sim.world.nodes.find((entry) => entry.id === nodeId);
      issue({ type: 'gather', playerId: PLAYER_ID, unitIds: ids, nodeId }, node ? { x: node.x, y: node.y } : null);
    },
    attack() {
      mode = mode === 'attack' ? 'none' : 'attack';
      if (mode === 'attack') buildKind = null;
      publish();
    },
    toggleBuild() {
      buildOpen = !buildOpen;
      if (!buildOpen) {
        mode = 'none';
        buildKind = null;
      }
      publish();
    },
    chooseBuild(kind) {
      buildKind = kind;
      mode = 'build';
      buildOpen = true;
      publish();
    },
    produce(kind) {
      if (selectedBuilding === null) return;
      issue({ type: 'produce', playerId: PLAYER_ID, buildingId: selectedBuilding, kind }, null);
    },
    cancel() {
      mode = 'none';
      buildKind = null;
      buildOpen = false;
      publish();
    },
    saveReplay() {
      const blob = new Blob([serializeReplay(sim.log, sim.world.tick)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'void-dominion-replay.json';
      link.click();
      URL.revokeObjectURL(url);
    },
    loadReplay(text) {
      const file = deserializeReplay(text);
      if (!file) {
        note = messages.replay_invalid;
        publish();
        return;
      }
      sim = Simulation.replay(file.commands, file.ticks);
      previous = capture();
      current = capture();
      selected.clear();
      selectedBuilding = null;
      mode = 'none';
      buildKind = null;
      buildOpen = false;
      pendingOrder = false;
      note = null;
      refusedAt = null;
      publish();
    },
  };

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (mode === 'build' || mode === 'attack') return;
    drag = { x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    const cell = cellAt(event.clientX, event.clientY);
    hover = cell;
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
      if (mode !== 'none') {
        mode = 'none';
        buildKind = null;
        buildOpen = false;
      }
      if (!drag?.moved) orderAt(event.clientX, event.clientY);
      return;
    }
    if (mode === 'build') {
      place(event.clientX, event.clientY);
      return;
    }
    if (mode === 'attack') {
      orderAt(event.clientX, event.clientY);
      mode = 'none';
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved && box) selectIds(unitsIn(box, lastAlpha), event.shiftKey);
    else {
      const id = pick(event.clientX, event.clientY, lastAlpha, PLAYER_ID);
      if (id !== null) selectIds([id], event.shiftKey);
      else {
        const building = ownBuildingAt(event.clientX, event.clientY);
        if (building !== null) {
          if (!event.shiftKey) selected.clear();
          selectedBuilding = building;
          hideRejection = true;
        } else if (!event.shiftKey) {
          selected.clear();
          selectedBuilding = null;
        }
      }
    }
    box = null;
    drag = null;
  }

  function onKey(event: KeyboardEvent, down: boolean): void {
    if (event.code === 'F3' && down) {
      debug = !debug;
      event.preventDefault();
      return;
    }
    if (event.code === 'Escape' && down) {
      mode = 'none';
      buildKind = null;
      buildOpen = false;
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

  function onMap(event: PointerEvent): void {
    const rect = minimap.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * MAP_SIZE;
    const y = ((event.clientY - rect.top) / rect.height) * MAP_SIZE;
    view.focus(x, y);
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
      if (selectedBuilding !== null && !sim.world.buildings.some((building) => building.id === selectedBuilding)) {
        selectedBuilding = null;
      }
      for (const id of [...selected]) {
        if (!sim.world.units.some((unit) => unit.id === id)) selected.delete(id);
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
  minimap.addEventListener('pointerdown', onMap);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('resize', view.resize);

  paint(0);
  publish();
  frame = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    actions.current = null;
    cancelAnimationFrame(frame);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
    minimap.removeEventListener('pointerdown', onMap);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('resize', view.resize);
    view.dispose();
  };
}
