import {
  AmbientLight,
  BoxGeometry,
  ClampToEdgeWrapping,
  CanvasTexture,
  Color,
  DataTexture,
  DirectionalLight,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  Object3D,
  OrthographicCamera,
  Plane,
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
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  zoomBy(wheelDelta: number): void;
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
  /** Owner-tinted material: the box material, or this body's copy of the model's team material. */
  tint: MeshStandardMaterial | null;
  box: boolean;
  /** A model already repainted as a wreck. */
  wrecked: boolean;
  lastX: number;
  lastZ: number;
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
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const hit = new Vector3();
  const right = new Vector3();
  const ahead = new Vector3();

  const unitGeometry = new BoxGeometry(1, 1, 1);
  const buildingGeometry = new BoxGeometry(1, 1, 1);
  const ringGeometry = new RingGeometry(0.42, 0.56, 24);
  ringGeometry.rotateX(-Math.PI / 2);
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
  const rockMeshes: { root: Object3D; cell: number }[] = [];
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

  const ghostMaterial = new MeshStandardMaterial({
    color: MARKER_OK,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const ghost = new Mesh(buildingGeometry, ghostMaterial);
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
        gl_FragColor = texture2D(fogMap, vec2(u, v));
      }
    `,
  });
  const fog = new Mesh(new PlaneGeometry(mapSize, mapSize), fogMaterial);
  fog.rotation.x = -Math.PI / 2;
  fog.position.set(mapSize / 2, 0.95, mapSize / 2);
  fog.renderOrder = 2;
  scene.add(fog);

  const nodeSlots = Array.from({ length: 8 }, () => new Vector3());
  const groundMaterial = new ShaderMaterial({
    uniforms: {
      nodes: { value: nodeSlots },
      nodeCount: { value: 0 },
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
      varying vec3 vWorld;
      float hash(vec2 p) {
        vec2 q = fract(p * vec2(0.1031, 0.11369));
        q += dot(q, q.yx + 19.19);
        return fract((q.x + q.y) * q.x);
      }
      void main() {
        vec2 cell = floor(vWorld.xz);
        float speck = hash(cell);
        float patch = hash(floor(cell / 4.0));
        vec3 color = mix(vec3(0.17, 0.19, 0.21), vec3(0.34, 0.26, 0.18), speck);
        color = mix(color, vec3(0.22, 0.24, 0.27), patch * 0.85);
        for (int i = 0; i < 8; i++) {
          float live = step(float(i) + 0.5, nodeCount);
          float dist = distance(vWorld.xz, nodes[i].xy);
          float stain = smoothstep(6.5, 0.4, dist) * live;
          vec3 tint = mix(vec3(0.72, 0.42, 0.16), vec3(0.16, 0.62, 0.60), step(0.5, nodes[i].z));
          color = mix(color, tint, stain * 0.78);
        }
        vec2 grid = fract(vWorld.xz / 4.0);
        float line = clamp(step(0.93, grid.x) + step(0.93, grid.y), 0.0, 1.0);
        color = mix(color, vec3(0.55, 0.62, 0.70), line * 0.55);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const floorGeometry = new BoxGeometry(mapSize, 0.02, mapSize);
  const floor = new Mesh(floorGeometry, groundMaterial);
  floor.position.set(mapSize / 2, -0.01, mapSize / 2);
  scene.add(floor);

  scene.add(new AmbientLight('#c9d2de', 0.42));
  const sun = new DirectionalLight('#ffe2b4', 1.35);
  sun.position.set(48, 72, 16);
  scene.add(sun);
  const rim = new DirectionalLight('#7ecfd2', 0.48);
  rim.position.set(-40, 36, -30);
  scene.add(rim);

  function placeCamera(): void {
    camera.position.set(
      target.x + distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch),
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

  function makeBody(kind: string, fallback: BoxGeometry, roughness: number, x: number, z: number): Body {
    const ring = new Mesh(ringGeometry, new MeshStandardMaterial({ color: '#f4e7c8', emissive: '#f4e7c8', emissiveIntensity: 0.4 }));
    const template = models.get(kind);
    if (!template) {
      const material = new MeshStandardMaterial({ roughness, metalness: 0.08 });
      return { root: new Mesh(fallback, material), ring, tint: material, box: true, wrecked: false, lastX: x, lastZ: z };
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
    return { root, ring, tint, box: false, wrecked: false, lastX: x, lastZ: z };
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
    scene.remove(body.root, body.ring);
    body.tint?.dispose();
    (body.ring.material as MeshStandardMaterial).dispose();
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

  /** Tile each rock rect with boulders about two cells apart, or keep one box per rect until both models load. */
  function placeRocks(): void {
    clearRocks();
    const boulder = models.get('rock');
    const spire = models.get('rock_spire');
    for (const rect of rockRects) {
      if (!boulder || !spire) {
        const mesh = new Mesh(new BoxGeometry(rect.width, 0.7, rect.height), rockMaterial);
        mesh.position.set(rect.x + rect.width / 2, 0.35, rect.y + rect.height / 2);
        scene.add(mesh);
        rockMeshes.push({ root: mesh, cell: -1 });
        continue;
      }
      /** A low slab under the boulders, so the ridge reads as one wall and not loose stones. */
      const slab = new Mesh(new BoxGeometry(rect.width, 0.18, rect.height), rockMaterial);
      slab.position.set(rect.x + rect.width / 2, 0.09, rect.y + rect.height / 2);
      scene.add(slab);
      rockMeshes.push({ root: slab, cell: -1 });
      const columns = Math.max(1, Math.round(rect.width / 2));
      const rows = Math.max(1, Math.round(rect.height / 2));
      const stepX = rect.width / columns;
      const stepZ = rect.height / rows;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const x = rect.x + stepX * (column + 0.5 + (scatter(column, row, 1) - 0.5) * 0.4);
          const z = rect.y + stepZ * (row + 0.5 + (scatter(column, row, 2) - 0.5) * 0.4);
          const root = (scatter(column, row, 3) < 0.22 ? spire : boulder).clone(true);
          const size = 0.9 + scatter(column, row, 4) * 0.25;
          root.scale.set(size, 0.75 + scatter(column, row, 5) * 0.45, size);
          root.rotation.y = scatter(column, row, 6) * Math.PI * 2;
          root.position.set(x, 0, z);
          scene.add(root);
          rockMeshes.push({ root, cell: Math.floor(z) * mapSize + Math.floor(x) });
        }
      }
    }
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
      sprite.position.set(x, height, z);
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
          body = makeBody(unit.kind, unitGeometry, 0.55, unit.x, unit.y);
          scene.add(body.root, body.ring);
          bodies.set(unit.id, body);
        }
        if (body.box) {
          const scale = UNIT_SCALE[unit.kind] ?? UNIT_SCALE.engineer!;
          const fraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
          const height = scale[1] * (0.45 + 0.55 * fraction);
          body.root.scale.set(scale[0], height, scale[2]);
          body.root.position.set(unit.x, height / 2, unit.y);
        } else {
          body.root.position.set(unit.x, 0, unit.y);
          /** Face the way the unit moved. Models look down -Z, as the Blender export contract fixes. */
          const dx = unit.x - body.lastX;
          const dz = unit.y - body.lastZ;
          if (dx * dx + dz * dz > 1e-6) body.root.rotation.y = Math.atan2(-dx, -dz);
        }
        body.lastX = unit.x;
        body.lastZ = unit.y;
        body.ring.position.set(unit.x, 0.08, unit.y);
        body.ring.visible = unit.selected;
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
          body = makeBody(building.kind, buildingGeometry, 0.72, centerX, centerZ);
          scene.add(body.root, body.ring);
          structures.set(building.id, body);
        }
        const progress = Math.max(0, Math.min(1, building.progress));
        if (body.box) {
          const raised = building.wreck ? 0.16 : 0.25 + progress * 1.15;
          body.root.scale.set(building.width * 0.92, raised, building.height * 0.92);
          body.root.position.set(centerX, raised / 2, centerZ);
          if (building.wreck && body.tint) {
            body.tint.color.copy(WRECK);
            body.tint.emissive.set('#000000');
          }
        } else {
          /** The spec already sizes the model to the footprint. Height shows construction, or a flattened wreck. */
          body.root.scale.set(1, building.wreck ? 0.25 : 0.15 + progress * 0.85, 1);
          body.root.position.set(centerX, 0, centerZ);
          if (building.wreck && !body.wrecked) wreckModel(body);
        }
        body.ring.position.set(centerX, 0.08, centerZ);
        body.ring.scale.setScalar(Math.max(building.width, building.height));
        body.ring.visible = building.selected;
        if (!building.wreck && body.tint) paintOwner(body.tint, building.owner, building.selected, building.hp, building.maxHp);
      }
      for (const [id, body] of structures) {
        if (seen.has(id)) continue;
        dropBody(body);
        structures.delete(id);
      }
    },
    setNodes(nodes) {
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
        if (shown.box) shown.root.position.set(node.x + 0.5, node.kind === 'ore' ? 0.28 : 0.45, node.y + 0.5);
        else shown.root.position.set(node.x + 0.5, 0, node.y + 0.5);
      }
      for (const [id, shown] of nodeMeshes) {
        if (seen.has(id)) continue;
        dropNode(shown);
        nodeMeshes.delete(id);
      }
    },
    setRocks(rocks) {
      rockRects = rocks.map((rock) => ({ ...rock }));
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
      ghost.scale.set(next.width * 0.92, 0.2, next.height * 0.92);
      ghost.position.set(next.x + next.width / 2, 1.05, next.y + next.height / 2);
      ghostMaterial.color.copy(next.ok ? MARKER_OK : MARKER_BAD);
    },
    setMarker(cell, accepted, raised = false) {
      if (!cell) {
        marker.visible = false;
        return;
      }
      marker.visible = true;
      marker.position.set(cell.x + 0.5, raised ? 1.35 : 0.16, cell.y + 0.5);
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
    zoomBy(wheelDelta) {
      const factor = wheelDelta > 0 ? 0.9 : 1.1;
      camera.zoom = Math.min(4, Math.max(0.45, camera.zoom * factor));
      camera.updateProjectionMatrix();
    },
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
      if (!raycaster.ray.intersectPlane(ground, hit)) return null;
      if (hit.x < 0 || hit.z < 0 || hit.x >= mapSize || hit.z >= mapSize) return null;
      return { x: hit.x, y: hit.z };
    },
    project(x, y, height = 0) {
      const rect = canvas.getBoundingClientRect();
      hit.set(x, height, y);
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
      oreGeometry.dispose();
      aetherGeometry.dispose();
      markerGeometry.dispose();
      floorGeometry.dispose();
      groundMaterial.dispose();
      fog.geometry.dispose();
      fogMaterial.dispose();
      fogTexture.dispose();
      for (const texture of panels.values()) texture.dispose();
      panels.clear();
      markerMaterial.dispose();
      ghostMaterial.dispose();
    },
  };
}
