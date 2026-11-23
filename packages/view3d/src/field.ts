import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  RGBAFormat,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeRelief, sampleRelief, type Pad } from './relief.ts';

export interface DrawUnit {
  id: number;
  x: number;
  y: number;
  owner: number;
  kind: string;
  selected: boolean;
  hp: number;
  maxHp: number;
}

export interface DrawBuilding {
  id: number;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  owner: number;
  progress: number;
  selected: boolean;
  wreck: boolean;
  hp: number;
  maxHp: number;
}

export interface DrawNode {
  id: number;
  x: number;
  y: number;
  kind: 'ore' | 'aether';
}

export interface DrawRock {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sprite sheet of square cells, read left to right, then top to bottom. */
export interface EffectSheet {
  url: string;
  columns: number;
  rows: number;
  frames: number;
  fps: number;
}

export interface DrawGhost {
  x: number;
  y: number;
  width: number;
  height: number;
  ok: boolean;
}

export interface FieldView {
  resize(): void;
  render(): void;
  setUnits(units: DrawUnit[]): void;
  /** Load one GLB per unit or building kind. A kind keeps its box until its model arrives, or for good if it fails. */
  setModels(urls: Readonly<Record<string, string>>): void;
  /** Load one sheet per effect kind. An effect whose sheet has not loaded is skipped. */
  setEffectSheets(sheets: Readonly<Record<string, EffectSheet>>): void;
  /** Play an effect once at a cell position, `height` above the ground and `size` cells wide. */
  addEffect(kind: string, x: number, z: number, height: number, size: number): void;
  setBuildings(buildings: DrawBuilding[]): void;
  setNodes(nodes: DrawNode[]): void;
  setRocks(rocks: DrawRock[]): void;
  setFog(explored: Uint8Array, visible: Uint8Array): void;
  setGhost(ghost: DrawGhost | null): void;
  setMarker(cell: { x: number; y: number } | null, accepted: boolean, raised?: boolean): void;
  pan(strafe: number, advance: number): void;
  /** Move the look-at point in world x/z. Touch pan uses this so the ground stays under the finger. */
  shift(dx: number, dz: number): void;
  /** Pan by screen pixels when the ground ray misses. `dx` right and `dy` down follow the finger. */
  panPixels(dx: number, dy: number): void;
  zoomBy(wheelDelta: number): void;
  /** Multiply the orthographic zoom. The wheel uses 0.9 and 1.1; a pinch uses the finger ratio. */
  zoomScale(factor: number): void;
  focus(x: number, z: number): void;
  groundAt(clientX: number, clientY: number): { x: number; y: number } | null;
  project(x: number, y: number, height?: number): { x: number; y: number };
  dispose(): void;
}

const GROUND = new Color('#1a222e');
const PLAYER = new Color('#e0a045');
/** Red, so enemy panels stand apart from the grey hull, the cyan glow and the player's amber. */
const ENEMY = new Color('#d0504a');
const MARKER_OK = new Color('#8fd0a8');
const MARKER_BAD = new Color('#d4766a');

/** Material name in each GLB that takes the owner colour. Set by the Blender spec palette. */
const TEAM_MATERIAL = 'team';
/** Textured hull. The atlas stays visible; the owner only shifts its colour. */
const HULL_MATERIAL = 'hull';
const WRECK = new Color('#3a342c');
/** Buildings wear a generated panel map on `hull`. Units keep the flat metal so the silhouette stays the spec. */
const PANELED = new Set([
  'command_center',
  'ore_extractor',
  'aether_refinery',
  'power_generator',
  'barracks',
  'vehicle_factory',
  'defense_turret',
]);

interface Body {
  root: Object3D;
  ring: Mesh;
  shadow: Mesh;
  /** Set for a unit. Hidden until that unit has lost hit points. */
  bar: Group | null;
  fill: Mesh | null;
  /** Owner-tinted material: the box material, or this body's copy of the model's team material. */
  tint: MeshStandardMaterial | null;
  box: boolean;
  /** A model already repainted as a wreck. */
  wrecked: boolean;
  lastX: number;
  lastZ: number;
}

/** Disc diameter under a unit. The circle geometry has radius 0.5, so this is the world span. */
function unitShadow(kind: string): number {
  if (kind === 'interceptor') return 1.7;
  if (kind === 'assault_walker') return 1.35;
  if (kind === 'scout_rover') return 1.2;
  return 1.15;
}

/** Just above the mesh. A fixed height left the bar floating over the infantry. */
function barHeight(kind: string): number {
  if (kind === 'assault_walker') return 1.15;
  if (kind === 'rocketeer' || kind === 'rifleman') return 0.95;
  if (kind === 'interceptor') return 0.72;
  if (kind === 'scout_rover') return 0.55;
  return 0.62;
}

const BAR_WIDTH = 0.9;

/** A world bar only after the unit is wounded. Full health stays unmarked. */
export function healthBarFrame(hp: number, maxHp: number): { show: boolean; shown: number; color: string } {
  const show = maxHp > 0 && hp > 0 && hp < maxHp;
  if (!show) return { show: false, shown: 0, color: '#9be7b4' };
  const fraction = hp / maxHp;
  const shown = Math.max(0.05, BAR_WIDTH * fraction);
  const color = fraction > 0.5 ? '#9be7b4' : fraction > 0.25 ? '#ffb03a' : '#ff5a52';
  return { show: true, shown, color };
}

/** Fallback box sizes while a unit model is missing. */
const UNIT_SCALE: Record<string, [number, number, number]> = {
  engineer: [0.55, 0.48, 0.55],
  rifleman: [0.38, 0.72, 0.38],
  rocketeer: [0.48, 0.78, 0.48],
  scout_rover: [0.86, 0.32, 0.44],
  assault_walker: [0.95, 0.9, 0.95],
  interceptor: [1.42, 0.48, 1.6],
};

/**
 * Isometric field. Positions are cell-space: x across, y depth, matching the simulation.
 * The view never writes orders.
 */
export function createField(
  canvas: HTMLCanvasElement,
  mapSize: number,
  focusAt = { x: mapSize / 2, z: mapSize / 2 },
): FieldView {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(GROUND, 1);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
  camera.zoom = 1.15;

  const target = new Vector3(focusAt.x, 0, focusAt.z);
  const pitch = Math.PI / 5;
  const yaw = Math.PI / 4;
  const distance = 140;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const hit = new Vector3();
  const right = new Vector3();
  const ahead = new Vector3();

  const unitGeometry = new BoxGeometry(1, 1, 1);
  const buildingGeometry = new BoxGeometry(1, 1, 1);
  const ringGeometry = new RingGeometry(0.58, 0.78, 40);
  ringGeometry.rotateX(-Math.PI / 2);
  const shadowGeometry = new CircleGeometry(0.5, 24);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new MeshBasicMaterial({
    color: '#05070b',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const barGeometry = new PlaneGeometry(1, 1);
  const barBackMaterial = new MeshBasicMaterial({
    color: '#1a1210',
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const oreGeometry = new BoxGeometry(0.7, 0.55, 0.7);
  const aetherGeometry = new BoxGeometry(0.45, 0.9, 0.45);

  const bodies = new Map<number, Body>();
  const models = new Map<string, Object3D>();
  const wreckMaterial = new MeshStandardMaterial({ color: WRECK, roughness: 0.95, metalness: 0 });
  const loader = new GLTFLoader();
  let disposed = false;
  const structures = new Map<number, Body>();
  const nodeMeshes = new Map<number, { root: Object3D; box: boolean }>();
  /** Boulders keep the cell they stand on, so unexplored rock never pokes through the black fog. */
  const rockMeshes: { root: Object3D; cell: number; lift: number }[] = [];
  let rockRects: DrawRock[] = [];

  /** Sprites draw after the fog and through the meshes, so a hit inside a building still shows. */
  const EFFECT_LIMIT = 96;
  const sheets = new Map<string, { sheet: EffectSheet; texture: Texture }>();
  const effects: { sprite: Sprite; sheet: EffectSheet; born: number }[] = [];
  const textureLoader = new TextureLoader();
  const rockMaterial = new MeshStandardMaterial({ color: '#4a4036', roughness: 0.9, metalness: 0.04 });

  const markerGeometry = new RingGeometry(0.35, 0.55, 4);
  markerGeometry.rotateX(-Math.PI / 2);
  const markerMaterial = new MeshStandardMaterial({ color: MARKER_OK, emissive: MARKER_OK, emissiveIntensity: 0.35 });
  const marker = new Mesh(markerGeometry, markerMaterial);
  marker.visible = false;
  marker.position.y = 0.2;
  scene.add(marker);

  const ghostMaterial = new MeshBasicMaterial({
    color: MARKER_OK,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const ghostBar = new BoxGeometry(1, 0.08, 1);
  const ghost = new Group();
  const ghostEdges = [0, 1, 2, 3].map(() => {
    const edge = new Mesh(ghostBar, ghostMaterial);
    edge.renderOrder = 1;
    ghost.add(edge);
    return edge;
  });
  ghost.visible = false;
  scene.add(ghost);

  const fogBytes = new Uint8Array(mapSize * mapSize * 4);
  const fogTexture = new DataTexture(fogBytes, mapSize, mapSize, RGBAFormat);
  fogTexture.colorSpace = NoColorSpace;
  fogTexture.magFilter = LinearFilter;
  fogTexture.minFilter = LinearFilter;
  fogTexture.wrapS = ClampToEdgeWrapping;
  fogTexture.wrapT = ClampToEdgeWrapping;
  fogTexture.flipY = false;
  fogTexture.needsUpdate = true;
  const fogMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      fogMap: { value: fogTexture },
      mapSize: { value: mapSize },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform sampler2D fogMap;
      uniform float mapSize;
      varying vec3 vWorld;
      void main() {
        float u = clamp(vWorld.x / mapSize, 0.0, 1.0);
        float v = clamp(vWorld.z / mapSize, 0.0, 1.0);
        vec4 fog = texture2D(fogMap, vec2(u, v));
        gl_FragColor = fog;
      }
    `,
  });
  const groundGeometry = reliefGeometry(mapSize);
  let heights = bakeRelief(mapSize, []);
  let buildingPads: Pad[] = [];
  let nodePads: Pad[] = [];
  let shapeKey = '';

  function surface(x: number, z: number): number {
    return sampleRelief(heights, mapSize, x, z);
  }

  function reshape(): void {
    let key = '';
    for (const pad of buildingPads) key += `${pad.x},${pad.z},${pad.width},${pad.depth};`;
    key += '#';
    for (const pad of nodePads) key += `${pad.x},${pad.z};`;
    if (key === shapeKey) return;
    shapeKey = key;
    heights = bakeRelief(mapSize, [...buildingPads, ...nodePads]);
    writeHeights(groundGeometry, heights);
    liftRocks();
    placeCamera();
  }

  const nodeSlots = Array.from({ length: 8 }, () => new Vector3());
  const bedSlots = Array.from({ length: 4 }, () => new Vector4());
  const groundMaterial = new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      nodes: { value: nodeSlots },
      nodeCount: { value: 0 },
      beds: { value: bedSlots },
      bedCount: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 nodes[8];
      uniform float nodeCount;
      uniform vec4 beds[4];
      uniform float bedCount;
      varying vec3 vWorld;
      float cellNoise(vec2 p) {
        vec2 q = fract(p * vec2(0.1031, 0.11369));
        q += dot(q, q.yx + 19.19);
        return fract((q.x + q.y) * q.x);
      }
      float mottle(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = cellNoise(i);
        float b = cellNoise(i + vec2(1.0, 0.0));
        float c = cellNoise(i + vec2(0.0, 1.0));
        float d = cellNoise(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        vec2 xz = vWorld.xz;
        // Soft mottling, not a squared grit. A lattice of constant cells reads as tiles here.
        vec2 diag = vec2(xz.x * 0.8 + xz.y, xz.x - xz.y * 1.3);
        float broad = mottle(xz * 0.09 + vec2(2.0, 7.0));
        float mid = mottle(diag * 0.2 + 4.0);
        float fine = mottle(vec2(xz.y * 1.25, xz.x * 1.05) + 9.0);
        vec3 color = mix(vec3(0.20, 0.19, 0.16), vec3(0.48, 0.36, 0.24), broad);
        color = mix(color, vec3(0.15, 0.14, 0.12), smoothstep(0.55, 0.88, mid) * 0.62);
        color = mix(color, vec3(0.56, 0.45, 0.31), smoothstep(0.62, 0.9, fine) * 0.45);
        color *= 0.94 + 0.12 * mottle(xz * 3.2 + 1.0);
        float bed = 0.0;
        for (int i = 0; i < 4; i++) {
          float live = step(float(i) + 0.5, bedCount);
          vec2 origin = beds[i].xy;
          vec2 span = beds[i].zw;
          float outsideX = max(max(origin.x - xz.x, xz.x - (origin.x + span.x)), 0.0);
          float outsideZ = max(max(origin.y - xz.y, xz.y - (origin.y + span.y)), 0.0);
          float wobble = mottle(xz * 0.47 + float(i) * 9.0) - 0.5;
          float outside = length(vec2(outsideX, outsideZ)) - wobble * 1.6;
          bed = max(bed, (1.0 - smoothstep(0.0, 2.8, outside)) * live);
        }
        float chips = mottle(xz * 3.4 + 6.0);
        float pits = mottle(xz * 1.15 + 21.0);
        vec3 stone = mix(vec3(0.36, 0.33, 0.28), vec3(0.64, 0.57, 0.46), chips);
        stone = mix(stone, vec3(0.24, 0.22, 0.19), smoothstep(0.55, 0.95, pits) * 0.55);
        stone *= 0.94 + 0.1 * mottle(xz * 4.5 + 8.0);
        color = mix(color, stone, smoothstep(0.02, 0.4, bed));
        for (int i = 0; i < 8; i++) {
          float live = step(float(i) + 0.5, nodeCount);
          float dist = distance(xz, nodes[i].xy);
          float stain = smoothstep(6.5, 0.4, dist) * live;
          vec3 tint = mix(vec3(0.72, 0.42, 0.16), vec3(0.16, 0.62, 0.60), step(0.5, nodes[i].z));
          color = mix(color, tint, stain * 0.78);
        }
        vec2 grid = fract(xz / 4.0);
        float line = clamp(step(0.992, grid.x) + step(0.992, grid.y), 0.0, 1.0);
        float open = 1.0 - smoothstep(0.04, 0.35, bed);
        color = mix(color, vec3(0.58, 0.60, 0.54), line * 0.035 * open);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  writeHeights(groundGeometry, heights);
  const floor = new Mesh(groundGeometry, groundMaterial);
  floor.frustumCulled = false;
  scene.add(floor);
  /** The shroud sits just above the ground, so a hidden cell stays covered. */
  const fog = new Mesh(groundGeometry, fogMaterial);
  fog.position.y = 0.22;
  fog.renderOrder = 2;
  fog.frustumCulled = false;
  scene.add(fog);

  scene.add(new AmbientLight('#c9d2de', 0.42));
  const sun = new DirectionalLight('#ffe2b4', 1.35);
  sun.position.set(48, 72, 16);
  scene.add(sun);
  const rim = new DirectionalLight('#7ecfd2', 0.48);
  rim.position.set(-40, 36, -30);
  scene.add(rim);

  function placeCamera(): void {
    const groundY = surface(target.x, target.z);
    target.y = groundY;
    camera.position.set(
      target.x + distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch) + groundY,
      target.z + distance * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function frameCamera(): void {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const half = 22;
    const aspect = width / height;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
  }

  function zoomScale(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    camera.zoom = Math.min(4, Math.max(0.45, camera.zoom * factor));
    camera.updateProjectionMatrix();
  }

  function shift(dx: number, dz: number): void {
    target.x = Math.min(mapSize, Math.max(0, target.x + dx));
    target.z = Math.min(mapSize, Math.max(0, target.z + dz));
    placeCamera();
  }

  function panPixels(dx: number, dy: number): void {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const spanY = (camera.top - camera.bottom) / (camera.zoom || 1);
    const spanX = spanY * (width / height);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    ahead.setFromMatrixColumn(camera.matrixWorld, 1);
    right.y = 0;
    ahead.y = 0;
    if (right.lengthSq() > 0) right.normalize();
    if (ahead.lengthSq() > 0) ahead.normalize();
    target.addScaledVector(right, -(dx / width) * spanX);
    target.addScaledVector(ahead, (dy / height) * spanY);
    shift(0, 0);
  }

  function paintOwner(material: MeshStandardMaterial, owner: number, selected: boolean, hp: number, maxHp: number): void {
    const tint = owner === 1 ? PLAYER : ENEMY;
    const fraction = maxHp > 0 ? hp / maxHp : 1;
    if (material.name === HULL_MATERIAL) {
      material.color.set('#ffffff').lerp(tint, 0.35).multiplyScalar(0.55 + 0.45 * fraction);
      if (selected) material.color.lerp(new Color('#f6e2bc'), 0.25);
      return;
    }
    material.color.copy(tint).multiplyScalar(0.4 + 0.6 * fraction);
    if (selected) material.color.lerp(new Color('#f6e2bc'), 0.45);
    material.emissive.set(selected ? '#6a4a16' : '#000000');
  }

  const panels = new Map<string, CanvasTexture>();

  /** A small original atlas per building. Each face of the Blender cube already carries a 0–1 UV. */
  function panelMap(kind: string): CanvasTexture {
    const cached = panels.get(kind);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const empty = new CanvasTexture(canvas);
      panels.set(kind, empty);
      return empty;
    }
    ctx.fillStyle = '#c5ced8';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#1c2430';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, 58, 58);
    for (let i = 16; i < 64; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 4);
      ctx.lineTo(i, 60);
      ctx.moveTo(4, i);
      ctx.lineTo(60, i);
      ctx.stroke();
    }
    ctx.fillStyle = markColor(kind);
    paintMark(ctx, kind);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.needsUpdate = true;
    panels.set(kind, texture);
    return texture;
  }

  function markColor(kind: string): string {
    if (kind === 'ore_extractor' || kind === 'power_generator') return '#e0a045';
    if (kind === 'aether_refinery') return '#5ec4c0';
    if (kind === 'defense_turret') return '#d0504a';
    return '#7ecfd2';
  }

  function paintMark(ctx: CanvasRenderingContext2D, kind: string): void {
    if (kind === 'command_center') ctx.fillRect(6, 26, 52, 8);
    else if (kind === 'ore_extractor') ctx.fillRect(8, 8, 48, 10);
    else if (kind === 'aether_refinery') {
      ctx.fillRect(14, 8, 8, 48);
      ctx.fillRect(42, 8, 8, 48);
    } else if (kind === 'power_generator') ctx.fillRect(8, 40, 48, 10);
    else if (kind === 'barracks') {
      for (let x = 10; x <= 46; x += 12) ctx.fillRect(x, 22, 8, 8);
    } else if (kind === 'vehicle_factory') ctx.fillRect(10, 14, 44, 28);
    else {
      ctx.beginPath();
      ctx.arc(32, 32, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function disposeTree(root: Object3D): void {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
  }

  function makeBody(kind: string, fallback: BoxGeometry, roughness: number, x: number, z: number, bars: boolean): Body {
    const ring = new Mesh(
      ringGeometry,
      new MeshBasicMaterial({ color: '#ffe7b0', transparent: true, opacity: 0.95, depthWrite: false }),
    );
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.renderOrder = 1;
    let bar: Group | null = null;
    let fill: Mesh | null = null;
    if (bars) {
      bar = new Group();
      const back = new Mesh(barGeometry, barBackMaterial);
      back.scale.set(0.98, 0.18, 1);
      fill = new Mesh(
        barGeometry,
        new MeshBasicMaterial({ color: '#9be7b4', depthWrite: false, side: DoubleSide, toneMapped: false }),
      );
      fill.position.z = 0.08;
      bar.add(back, fill);
      bar.visible = false;
      bar.renderOrder = 3;
    }
    const template = models.get(kind);
    if (!template) {
      const material = new MeshStandardMaterial({ roughness, metalness: 0.08 });
      return { root: new Mesh(fallback, material), ring, shadow, bar, fill, tint: material, box: true, wrecked: false, lastX: x, lastZ: z };
    }
    /** Geometry stays shared. Team (or the interceptor hull) is copied per body. Building hulls take a panel map. */
    const root = template.clone(true);
    let tint: MeshStandardMaterial | null = null;
    let plated: MeshStandardMaterial | null = null;
    const ownerSlot = kind === 'interceptor' ? HULL_MATERIAL : TEAM_MATERIAL;
    root.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof MeshStandardMaterial)) return;
      if (child.material.name === ownerSlot) {
        tint ??= child.material.clone();
        child.material = tint;
        return;
      }
      if (PANELED.has(kind) && child.material.name === 'hull') {
        plated ??= child.material.clone();
        plated.map = panelMap(kind);
        plated.color.set('#ffffff');
        child.material = plated;
      }
    });
    return { root, ring, shadow, bar, fill, tint, box: false, wrecked: false, lastX: x, lastZ: z };
  }

  function placeShadow(shadow: Mesh, x: number, z: number, width: number, depth: number): void {
    shadow.position.set(x, surface(x, z) + 0.03, z);
    /** The disc is rotated flat, so local Y is world Z. */
    shadow.scale.set(width, depth, 1);
  }

  function placeBar(body: Body, x: number, z: number, hp: number, maxHp: number, height: number): void {
    if (!body.bar || !body.fill) return;
    const frame = healthBarFrame(hp, maxHp);
    body.bar.visible = frame.show;
    if (!frame.show) return;
    body.fill.scale.set(frame.shown, 0.11, 1);
    /** The bar copies the camera orientation, whose local +Z points back at the viewer. */
    body.fill.position.set(-BAR_WIDTH / 2 + frame.shown / 2, 0, 0.08);
    (body.fill.material as MeshBasicMaterial).color.set(frame.color);
    body.bar.position.set(x, surface(x, z) + height, z);
    body.bar.quaternion.copy(camera.quaternion);
  }

  /** Repaint a model with the shared wreck material. Its own team copy is no longer drawn. */
  function wreckModel(body: Body): void {
    body.root.traverse((child) => {
      if (child instanceof Mesh) child.material = wreckMaterial;
    });
    body.wrecked = true;
  }

  function nodeBox(kind: DrawNode['kind']): Mesh {
    return new Mesh(
      kind === 'ore' ? oreGeometry : aetherGeometry,
      new MeshStandardMaterial({
        color: kind === 'ore' ? '#d08a45' : '#5ec4c0',
        emissive: kind === 'ore' ? '#6a3a12' : '#1a4a48',
        emissiveIntensity: 0.35,
        roughness: 0.45,
      }),
    );
  }

  /** A model clone shares the template's geometry and materials, so only a box owns its material. */
  function dropNode(shown: { root: Object3D; box: boolean }): void {
    scene.remove(shown.root);
    if (shown.box) ((shown.root as Mesh).material as MeshStandardMaterial).dispose();
  }

  function showFrame(map: Texture, sheet: EffectSheet, frame: number): void {
    const column = frame % sheet.columns;
    const row = Math.floor(frame / sheet.columns);
    map.offset.set(column / sheet.columns, 1 - (row + 1) / sheet.rows);
  }

  function dropEffect(effect: { sprite: Sprite }): void {
    scene.remove(effect.sprite);
    effect.sprite.material.map?.dispose();
    effect.sprite.material.dispose();
  }

  function dropBody(body: Body): void {
    scene.remove(body.root, body.ring, body.shadow);
    if (body.bar) scene.remove(body.bar);
    body.tint?.dispose();
    (body.ring.material as MeshBasicMaterial).dispose();
    if (body.fill) (body.fill.material as MeshBasicMaterial).dispose();
  }

  /** Small integer hash, so a boulder's look depends only on where it stands. */
  function scatter(x: number, z: number, salt: number): number {
    let h = (x * 374761393 + z * 668265263 + salt * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function clearRocks(): void {
    for (const rock of rockMeshes) {
      scene.remove(rock.root);
      if (rock.root instanceof Mesh && rock.root.material === rockMaterial) rock.root.geometry.dispose();
    }
    rockMeshes.length = 0;
  }

  /** Tile each rock rect with boulders a little over a cell apart, or keep one box per rect until both models load. */
  function liftRocks(): void {
    for (const rock of rockMeshes) {
      rock.root.position.y = surface(rock.root.position.x, rock.root.position.z) + rock.lift;
    }
  }

  function placeRocks(): void {
    clearRocks();
    const boulder = models.get('rock');
    const spire = models.get('rock_spire');
    for (const rect of rockRects) {
      if (!boulder || !spire) {
        const mesh = new Mesh(new BoxGeometry(rect.width, 0.7, rect.height), rockMaterial);
        mesh.position.set(rect.x + rect.width / 2, 0, rect.y + rect.height / 2);
        scene.add(mesh);
        rockMeshes.push({ root: mesh, cell: -1, lift: 0.35 });
        continue;
      }
      const rockModel = boulder;
      const spireModel = spire;
      const spacing = 1.2;
      const columns = Math.max(1, Math.ceil(rect.width / spacing));
      const rows = Math.max(1, Math.ceil(rect.height / spacing));
      const stepX = rect.width / columns;
      const stepZ = rect.height / rows;
      const margin = 0.35;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const mainX = rect.x + stepX * (column + 0.5 + (scatter(column, row, 1) - 0.5) * 0.45);
          const mainZ = rect.y + stepZ * (row + 0.5 + (scatter(column, row, 2) - 0.5) * 0.45);
          placeStone(mainX, mainZ, column, row, 0, 0.9 + scatter(column, row, 4) * 0.45);
          if (scatter(column, row, 8) > 0.38) {
            const fillX = rect.x + stepX * (column + 0.2 + (scatter(column, row, 9) - 0.5) * 0.25);
            const fillZ = rect.y + stepZ * (row + 0.8 + (scatter(column, row, 10) - 0.5) * 0.25);
            placeStone(fillX, fillZ, column, row, 1, 0.48 + scatter(column, row, 11) * 0.22);
          }
          if (scatter(column, row, 12) > 0.7) {
            const chipX = rect.x + stepX * (column + 0.72 + (scatter(column, row, 13) - 0.5) * 0.2);
            const chipZ = rect.y + stepZ * (row + 0.28 + (scatter(column, row, 14) - 0.5) * 0.2);
            placeStone(chipX, chipZ, column, row, 2, 0.28 + scatter(column, row, 15) * 0.14);
          }
        }
      }

      function placeStone(x: number, z: number, column: number, row: number, pass: number, size: number): void {
        const clampedX = Math.min(rect.x + rect.width - margin, Math.max(rect.x + margin, x));
        const clampedZ = Math.min(rect.y + rect.height - margin, Math.max(rect.y + margin, z));
        const root = (pass === 0 && scatter(column, row, 3) < 0.16 ? spireModel : rockModel).clone(true);
        root.scale.set(size, pass === 0 ? 0.8 + scatter(column, row, 5) * 0.55 : size, size);
        root.rotation.y = scatter(column, row, 6 + pass) * Math.PI * 2;
        root.position.set(clampedX, 0, clampedZ);
        scene.add(root);
        rockMeshes.push({ root, cell: Math.floor(clampedZ) * mapSize + Math.floor(clampedX), lift: 0 });
      }
    }
    liftRocks();
  }

  placeCamera();
  frameCamera();

  return {
    resize() {
      frameCamera();
    },
    render() {
      const now = performance.now();
      for (let index = effects.length - 1; index >= 0; index--) {
        const effect = effects[index]!;
        const frame = Math.floor(((now - effect.born) / 1000) * effect.sheet.fps);
        if (frame >= effect.sheet.frames) {
          dropEffect(effect);
          effects.splice(index, 1);
          continue;
        }
        showFrame(effect.sprite.material.map!, effect.sheet, frame);
      }
      renderer.render(scene, camera);
    },
    setEffectSheets(next) {
      for (const [kind, sheet] of Object.entries(next)) {
        textureLoader.load(
          sheet.url,
          (texture) => {
            if (disposed) {
              texture.dispose();
              return;
            }
            texture.colorSpace = SRGBColorSpace;
            texture.repeat.set(1 / sheet.columns, 1 / sheet.rows);
            sheets.set(kind, { sheet, texture });
          },
          undefined,
          (error) => console.warn(`effect ${kind} failed to load; it will not play`, error),
        );
      }
    },
    addEffect(kind, x, z, height, size) {
      const loaded = sheets.get(kind);
      if (!loaded) return;
      if (effects.length >= EFFECT_LIMIT) dropEffect(effects.shift()!);
      /** A clone shares the image with the sheet; only its frame offset is its own. */
      const map = loaded.texture.clone();
      showFrame(map, loaded.sheet, 0);
      const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
      sprite.renderOrder = 3;
      sprite.scale.set(size, size, 1);
      sprite.position.set(x, surface(x, z) + height, z);
      scene.add(sprite);
      effects.push({ sprite, sheet: loaded.sheet, born: performance.now() });
    },
    setUnits(units) {
      const seen = new Set<number>();
      for (const unit of units) {
        seen.add(unit.id);
        let body = bodies.get(unit.id);
        if (body && body.box && models.has(unit.kind)) {
          dropBody(body);
          body = undefined;
        }
        if (!body) {
          body = makeBody(unit.kind, unitGeometry, 0.55, unit.x, unit.y, true);
          scene.add(body.root, body.ring, body.shadow);
          if (body.bar) scene.add(body.bar);
          bodies.set(unit.id, body);
        }
        if (body.box) {
          const scale = UNIT_SCALE[unit.kind] ?? UNIT_SCALE.engineer!;
          const fraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
          const height = scale[1] * (0.45 + 0.55 * fraction);
          body.root.scale.set(scale[0], height, scale[2]);
          body.root.position.set(unit.x, height / 2 + surface(unit.x, unit.y), unit.y);
        } else {
          body.root.position.set(unit.x, surface(unit.x, unit.y), unit.y);
          /** Face the way the unit moved. Models look down -Z, as the Blender export contract fixes. */
          const dx = unit.x - body.lastX;
          const dz = unit.y - body.lastZ;
          if (dx * dx + dz * dz > 1e-6) body.root.rotation.y = Math.atan2(-dx, -dz);
        }
        body.lastX = unit.x;
        body.lastZ = unit.y;
        const groundY = surface(unit.x, unit.y);
        body.ring.position.set(unit.x, groundY + 0.12, unit.y);
        body.ring.scale.set(1.25, 1.25, 1);
        body.ring.visible = unit.selected;
        const span = unitShadow(unit.kind);
        placeShadow(body.shadow, unit.x, unit.y, span, span);
        placeBar(body, unit.x, unit.y, unit.hp, unit.maxHp, barHeight(unit.kind));
        if (body.tint) paintOwner(body.tint, unit.owner, unit.selected, unit.hp, unit.maxHp);
      }
      for (const [id, body] of bodies) {
        if (seen.has(id)) continue;
        dropBody(body);
        bodies.delete(id);
      }
    },
    setModels(urls) {
      for (const [kind, url] of Object.entries(urls)) {
        loader.load(
          url,
          (gltf) => {
            if (disposed) {
              disposeTree(gltf.scene);
              return;
            }
            models.set(kind, gltf.scene);
            if (kind === 'rock' || kind === 'rock_spire') placeRocks();
          },
          undefined,
          (error) => console.warn(`model ${kind} failed to load; keeping the box`, error),
        );
      }
    },
    setBuildings(buildings) {
      buildingPads = buildings.map((building) => ({
        x: building.x,
        z: building.y,
        width: building.width,
        depth: building.height,
      }));
      reshape();
      const seen = new Set<number>();
      for (const building of buildings) {
        seen.add(building.id);
        const centerX = building.x + building.width / 2;
        const centerZ = building.y + building.height / 2;
        let body = structures.get(building.id);
        if (body && body.box && models.has(building.kind)) {
          dropBody(body);
          body = undefined;
        }
        if (!body) {
          body = makeBody(building.kind, buildingGeometry, 0.72, centerX, centerZ, false);
          scene.add(body.root, body.ring, body.shadow);
          structures.set(building.id, body);
        }
        const progress = Math.max(0, Math.min(1, building.progress));
        if (body.box) {
          const raised = building.wreck ? 0.16 : 0.25 + progress * 1.15;
          body.root.scale.set(building.width * 0.92, raised, building.height * 0.92);
          body.root.position.set(centerX, surface(centerX, centerZ) + raised / 2, centerZ);
          if (building.wreck && body.tint) {
            body.tint.color.copy(WRECK);
            body.tint.emissive.set('#000000');
          }
        } else {
          /** The spec already sizes the model to the footprint. Height shows construction, or a flattened wreck. */
          body.root.scale.set(1, building.wreck ? 0.25 : 0.15 + progress * 0.85, 1);
          body.root.position.set(centerX, surface(centerX, centerZ), centerZ);
          if (building.wreck && !body.wrecked) wreckModel(body);
        }
        const groundY = surface(centerX, centerZ);
        body.ring.position.set(centerX, groundY + 0.12, centerZ);
        body.ring.scale.setScalar(Math.max(building.width, building.height) * 1.05);
        body.ring.visible = building.selected;
        placeShadow(body.shadow, centerX, centerZ, building.width * 1.35, building.height * 1.35);
        if (!building.wreck && body.tint) paintOwner(body.tint, building.owner, building.selected, building.hp, building.maxHp);
      }
      for (const [id, body] of structures) {
        if (seen.has(id)) continue;
        dropBody(body);
        structures.delete(id);
      }
    },
    setNodes(nodes) {
      nodePads = nodes.map((node) => ({ x: node.x, z: node.y, width: 1, depth: 1 }));
      reshape();
      const count = Math.min(nodes.length, nodeSlots.length);
      for (let i = 0; i < nodeSlots.length; i++) {
        const node = nodes[i];
        if (i < count && node) nodeSlots[i].set(node.x + 0.5, node.y + 0.5, node.kind === 'aether' ? 1 : 0);
        else nodeSlots[i].set(0, 0, 0);
      }
      groundMaterial.uniforms.nodeCount!.value = count;
      const seen = new Set<number>();
      for (const node of nodes) {
        seen.add(node.id);
        const model = models.get(`${node.kind}_node`);
        let shown = nodeMeshes.get(node.id);
        if (shown && shown.box && model) {
          dropNode(shown);
          shown = undefined;
        }
        if (!shown) {
          shown = model ? { root: model.clone(true), box: false } : { root: nodeBox(node.kind), box: true };
          scene.add(shown.root);
          nodeMeshes.set(node.id, shown);
        }
        const groundY = surface(node.x + 0.5, node.y + 0.5);
        if (shown.box) shown.root.position.set(node.x + 0.5, groundY + (node.kind === 'ore' ? 0.28 : 0.45), node.y + 0.5);
        else shown.root.position.set(node.x + 0.5, groundY, node.y + 0.5);
      }
      for (const [id, shown] of nodeMeshes) {
        if (seen.has(id)) continue;
        dropNode(shown);
        nodeMeshes.delete(id);
      }
    },
    setRocks(rocks) {
      rockRects = rocks.map((rock) => ({ ...rock }));
      const count = Math.min(rocks.length, bedSlots.length);
      for (let i = 0; i < bedSlots.length; i++) {
        const rock = rocks[i];
        if (i < count && rock) bedSlots[i].set(rock.x, rock.y, rock.width, rock.height);
        else bedSlots[i].set(0, 0, 0, 0);
      }
      groundMaterial.uniforms.bedCount!.value = count;
      placeRocks();
    },
    setFog(explored, visible) {
      const cells = mapSize * mapSize;
      for (let index = 0; index < cells; index++) {
        const offset = index * 4;
        if (visible[index]) {
          fogBytes[offset] = 0;
          fogBytes[offset + 1] = 0;
          fogBytes[offset + 2] = 0;
          fogBytes[offset + 3] = 0;
        } else if (explored[index]) {
          fogBytes[offset] = 8;
          fogBytes[offset + 1] = 12;
          fogBytes[offset + 2] = 18;
          fogBytes[offset + 3] = 150;
        } else {
          fogBytes[offset] = 5;
          fogBytes[offset + 1] = 7;
          fogBytes[offset + 2] = 12;
          fogBytes[offset + 3] = 255;
        }
      }
      fogTexture.needsUpdate = true;
      for (const rock of rockMeshes) rock.root.visible = rock.cell < 0 || explored[rock.cell] !== 0;
    },
    setGhost(next) {
      if (!next) {
        ghost.visible = false;
        return;
      }
      ghost.visible = true;
      ghostMaterial.color.copy(next.ok ? MARKER_OK : MARKER_BAD);
      const thickness = 0.14;
      const north = ghostEdges[0];
      const south = ghostEdges[1];
      const west = ghostEdges[2];
      const east = ghostEdges[3];
      if (!north || !south || !west || !east) return;
      north.scale.set(next.width, 1, thickness);
      north.position.set(next.x + next.width / 2, surface(next.x + next.width / 2, next.y + thickness / 2) + 0.08, next.y + thickness / 2);
      south.scale.set(next.width, 1, thickness);
      south.position.set(next.x + next.width / 2, surface(next.x + next.width / 2, next.y + next.height - thickness / 2) + 0.08, next.y + next.height - thickness / 2);
      west.scale.set(thickness, 1, next.height);
      west.position.set(next.x + thickness / 2, surface(next.x + thickness / 2, next.y + next.height / 2) + 0.08, next.y + next.height / 2);
      east.scale.set(thickness, 1, next.height);
      east.position.set(next.x + next.width - thickness / 2, surface(next.x + next.width - thickness / 2, next.y + next.height / 2) + 0.08, next.y + next.height / 2);
    },
    setMarker(cell, accepted, raised = false) {
      if (!cell) {
        marker.visible = false;
        return;
      }
      marker.visible = true;
      marker.position.set(cell.x + 0.5, surface(cell.x + 0.5, cell.y + 0.5) + (raised ? 1.35 : 0.16), cell.y + 0.5);
      marker.scale.setScalar(raised ? 2.2 : 1);
      markerMaterial.color.copy(accepted ? MARKER_OK : MARKER_BAD);
      markerMaterial.emissive.copy(accepted ? MARKER_OK : MARKER_BAD);
    },
    pan(strafe, advance) {
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      right.y = 0;
      if (right.lengthSq() > 0) right.normalize();
      camera.getWorldDirection(ahead);
      ahead.y = 0;
      if (ahead.lengthSq() > 0) ahead.normalize();
      target.addScaledVector(right, strafe);
      target.addScaledVector(ahead, advance);
      target.x = Math.min(mapSize, Math.max(0, target.x));
      target.z = Math.min(mapSize, Math.max(0, target.z));
      placeCamera();
    },
    shift,
    panPixels,
    zoomBy(wheelDelta) {
      zoomScale(wheelDelta > 0 ? 0.9 : 1.1);
    },
    zoomScale,
    focus(x, z) {
      target.x = Math.min(mapSize, Math.max(0, x));
      target.z = Math.min(mapSize, Math.max(0, z));
      placeCamera();
    },
    groundAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const point = raycaster.intersectObject(floor, false)[0]?.point;
      if (!point || point.x < 0 || point.z < 0 || point.x >= mapSize || point.z >= mapSize) return null;
      return { x: point.x, y: point.z };
    },
    project(x, y, height = 0) {
      const rect = canvas.getBoundingClientRect();
      hit.set(x, surface(x, y) + height, y);
      hit.project(camera);
      return {
        x: (hit.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-hit.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    },
    dispose() {
      disposed = true;
      for (const body of bodies.values()) dropBody(body);
      bodies.clear();
      for (const body of structures.values()) dropBody(body);
      structures.clear();
      for (const shown of nodeMeshes.values()) dropNode(shown);
      nodeMeshes.clear();
      clearRocks();
      rockMaterial.dispose();
      for (const effect of effects) dropEffect(effect);
      effects.length = 0;
      for (const { texture } of sheets.values()) texture.dispose();
      sheets.clear();
      for (const model of models.values()) disposeTree(model);
      models.clear();
      wreckMaterial.dispose();
      renderer.dispose();
      unitGeometry.dispose();
      buildingGeometry.dispose();
      ringGeometry.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      barGeometry.dispose();
      barBackMaterial.dispose();
      oreGeometry.dispose();
      aetherGeometry.dispose();
      markerGeometry.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      fogMaterial.dispose();
      fogTexture.dispose();
      for (const texture of panels.values()) texture.dispose();
      panels.clear();
      markerMaterial.dispose();
      ghostMaterial.dispose();
      ghostBar.dispose();
    },
  };
}

/** A grid in cell space, one vertex per corner. Y is filled by `writeHeights`. */
function reliefGeometry(mapSize: number): BufferGeometry {
  const stride = mapSize + 1;
  const positions = new Float32Array(stride * stride * 3);
  const indices = new Uint32Array(mapSize * mapSize * 6);
  for (let z = 0; z <= mapSize; z++) {
    for (let x = 0; x <= mapSize; x++) {
      const index = (z * stride + x) * 3;
      positions[index] = x;
      positions[index + 2] = z;
    }
  }
  let cursor = 0;
  for (let z = 0; z < mapSize; z++) {
    for (let x = 0; x < mapSize; x++) {
      const a = z * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

function writeHeights(geometry: BufferGeometry, heights: Float32Array): void {
  const source = geometry.getAttribute('position').array as Float32Array;
  const copy = new Float32Array(source);
  for (let i = 0; i < heights.length; i++) copy[i * 3 + 1] = heights[i] ?? 0;
  // A fresh attribute is what actually reaches the GPU. Updating the original
  // buffer in place left the mesh flat.
  geometry.setAttribute('position', new BufferAttribute(copy, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
