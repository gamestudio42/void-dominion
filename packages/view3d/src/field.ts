import {
  AmbientLight,
  BoxGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RGBAFormat,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

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
const ENEMY = new Color('#8aa0b5');
const MARKER_OK = new Color('#8fd0a8');
const MARKER_BAD = new Color('#d4766a');

const UNIT_SCALE: Record<string, [number, number, number]> = {
  engineer: [0.55, 0.48, 0.55],
  rifleman: [0.38, 0.72, 0.38],
  rocketeer: [0.48, 0.78, 0.48],
  scout_rover: [0.86, 0.32, 0.44],
  assault_walker: [0.95, 0.9, 0.95],
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

  const bodies = new Map<number, { mesh: Mesh; ring: Mesh }>();
  const structures = new Map<number, { mesh: Mesh; ring: Mesh }>();
  const nodeMeshes = new Map<number, Mesh>();
  const rockMeshes: Mesh[] = [];

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
  fogTexture.magFilter = NearestFilter;
  fogTexture.minFilter = NearestFilter;
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
        float u = (floor(vWorld.x) + 0.5) / mapSize;
        float v = (floor(vWorld.z) + 0.5) / mapSize;
        gl_FragColor = texture2D(fogMap, vec2(u, v));
      }
    `,
  });
  const fog = new Mesh(new PlaneGeometry(mapSize, mapSize), fogMaterial);
  fog.rotation.x = -Math.PI / 2;
  fog.position.set(mapSize / 2, 0.95, mapSize / 2);
  fog.renderOrder = 2;
  scene.add(fog);

  const floorGeometry = new BoxGeometry(mapSize, 0.02, mapSize);
  const floor = new Mesh(floorGeometry, new MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 }));
  floor.position.set(mapSize / 2, -0.01, mapSize / 2);
  scene.add(floor);

  const grid = new GridHelper(mapSize, 32, '#314054', '#263140');
  grid.position.set(mapSize / 2, 0.01, mapSize / 2);
  scene.add(grid);

  scene.add(new AmbientLight('#d5dbe6', 0.72));
  const sun = new DirectionalLight('#fff4e0', 1.15);
  sun.position.set(40, 80, 20);
  scene.add(sun);

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
    material.color.copy(tint).multiplyScalar(0.4 + 0.6 * fraction);
    if (selected) material.color.lerp(new Color('#f6e2bc'), 0.45);
    material.emissive.set(selected ? '#6a4a16' : '#000000');
  }

  placeCamera();
  frameCamera();

  return {
    resize() {
      frameCamera();
    },
    render() {
      renderer.render(scene, camera);
    },
    setUnits(units) {
      const seen = new Set<number>();
      for (const unit of units) {
        seen.add(unit.id);
        let body = bodies.get(unit.id);
        if (!body) {
          const mesh = new Mesh(unitGeometry, new MeshStandardMaterial({ roughness: 0.55, metalness: 0.08 }));
          const ring = new Mesh(ringGeometry, new MeshStandardMaterial({ color: '#f4e7c8', emissive: '#f4e7c8', emissiveIntensity: 0.4 }));
          scene.add(mesh, ring);
          body = { mesh, ring };
          bodies.set(unit.id, body);
        }
        const scale = UNIT_SCALE[unit.kind] ?? UNIT_SCALE.engineer!;
        const fraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
        const height = scale[1] * (0.45 + 0.55 * fraction);
        body.mesh.scale.set(scale[0], height, scale[2]);
        body.mesh.position.set(unit.x, height / 2, unit.y);
        body.ring.position.set(unit.x, 0.08, unit.y);
        body.ring.visible = unit.selected;
        paintOwner(body.mesh.material as MeshStandardMaterial, unit.owner, unit.selected, unit.hp, unit.maxHp);
      }
      for (const [id, body] of bodies) {
        if (seen.has(id)) continue;
        scene.remove(body.mesh, body.ring);
        (body.mesh.material as MeshStandardMaterial).dispose();
        (body.ring.material as MeshStandardMaterial).dispose();
        bodies.delete(id);
      }
    },
    setBuildings(buildings) {
      const seen = new Set<number>();
      for (const building of buildings) {
        seen.add(building.id);
        let body = structures.get(building.id);
        if (!body) {
          const mesh = new Mesh(buildingGeometry, new MeshStandardMaterial({ roughness: 0.72, metalness: 0.05 }));
          const ring = new Mesh(ringGeometry, new MeshStandardMaterial({ color: '#f4e7c8', emissive: '#f4e7c8', emissiveIntensity: 0.4 }));
          scene.add(mesh, ring);
          body = { mesh, ring };
          structures.set(building.id, body);
        }
        const raised = building.wreck ? 0.16 : 0.25 + Math.max(0, Math.min(1, building.progress)) * 1.15;
        body.mesh.scale.set(building.width * 0.92, raised, building.height * 0.92);
        body.mesh.position.set(building.x + building.width / 2, raised / 2, building.y + building.height / 2);
        body.ring.position.set(building.x + building.width / 2, 0.08, building.y + building.height / 2);
        body.ring.scale.setScalar(Math.max(building.width, building.height));
        body.ring.visible = building.selected;
        const material = body.mesh.material as MeshStandardMaterial;
        if (building.wreck) {
          material.color.set('#3a342c');
          material.emissive.set('#000000');
        } else {
          paintOwner(material, building.owner, building.selected, building.hp, building.maxHp);
        }
      }
      for (const [id, body] of structures) {
        if (seen.has(id)) continue;
        scene.remove(body.mesh, body.ring);
        (body.mesh.material as MeshStandardMaterial).dispose();
        (body.ring.material as MeshStandardMaterial).dispose();
        structures.delete(id);
      }
    },
    setNodes(nodes) {
      const seen = new Set<number>();
      for (const node of nodes) {
        seen.add(node.id);
        let mesh = nodeMeshes.get(node.id);
        if (!mesh) {
          mesh = new Mesh(
            node.kind === 'ore' ? oreGeometry : aetherGeometry,
            new MeshStandardMaterial({
              color: node.kind === 'ore' ? '#d08a45' : '#5ec4c0',
              emissive: node.kind === 'ore' ? '#6a3a12' : '#1a4a48',
              emissiveIntensity: 0.35,
              roughness: 0.45,
            }),
          );
          scene.add(mesh);
          nodeMeshes.set(node.id, mesh);
        }
        mesh.position.set(node.x + 0.5, node.kind === 'ore' ? 0.28 : 0.45, node.y + 0.5);
      }
      for (const [id, mesh] of nodeMeshes) {
        if (seen.has(id)) continue;
        scene.remove(mesh);
        (mesh.material as MeshStandardMaterial).dispose();
        nodeMeshes.delete(id);
      }
    },
    setRocks(rocks) {
      for (const mesh of rockMeshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      rockMeshes.length = 0;
      for (const rock of rocks) {
        const mesh = new Mesh(
          new BoxGeometry(rock.width, 0.7, rock.height),
          new MeshStandardMaterial({ color: '#4a4036', roughness: 0.9, metalness: 0.04 }),
        );
        mesh.position.set(rock.x + rock.width / 2, 0.35, rock.y + rock.height / 2);
        scene.add(mesh);
        rockMeshes.push(mesh);
      }
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
      renderer.dispose();
      unitGeometry.dispose();
      buildingGeometry.dispose();
      ringGeometry.dispose();
      oreGeometry.dispose();
      aetherGeometry.dispose();
      markerGeometry.dispose();
      floorGeometry.dispose();
      fog.geometry.dispose();
      fogMaterial.dispose();
      fogTexture.dispose();
      markerMaterial.dispose();
      ghostMaterial.dispose();
    },
  };
}
