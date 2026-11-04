import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Plane,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

export interface DrawUnit {
  id: number;
  x: number;
  y: number;
  selected: boolean;
}

export interface FieldView {
  resize(): void;
  render(): void;
  setUnits(units: DrawUnit[]): void;
  setObstacle(rect: { x: number; y: number; width: number; height: number }): void;
  setMarker(cell: { x: number; y: number } | null, accepted: boolean): void;
  pan(strafe: number, advance: number): void;
  zoomBy(wheelDelta: number): void;
  /** Continuous point on the ground, or null when the ray misses the map. */
  groundAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Screen point of a cell-space position. `height` lifts the point off the ground, in world units. */
  project(x: number, y: number, height?: number): { x: number; y: number };
  dispose(): void;
}

const GROUND = new Color('#1a222e');
const UNIT = new Color('#e0a045');
const UNIT_SELECTED = new Color('#f6e2bc');
const MARKER_OK = new Color('#8fd0a8');
const MARKER_BAD = new Color('#d4766a');

/**
 * Isometric field. Positions are cell-space: x across, y depth, matching the simulation.
 * The view never writes orders.
 */
export function createField(canvas: HTMLCanvasElement, mapSize: number): FieldView {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(GROUND, 1);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
  camera.zoom = 1.35;

  const target = new Vector3(16, 0, 60);
  const pitch = Math.PI / 5;
  const yaw = Math.PI / 4;
  const distance = 140;
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const hit = new Vector3();
  const right = new Vector3();
  const ahead = new Vector3();

  const bodies = new Map<number, { mesh: Mesh; ring: Mesh }>();
  const bodyGeometry = new BoxGeometry(0.72, 0.5, 0.72);
  const ringGeometry = new RingGeometry(0.42, 0.56, 28);
  ringGeometry.rotateX(-Math.PI / 2);

  const markerGeometry = new RingGeometry(0.35, 0.55, 4);
  markerGeometry.rotateX(-Math.PI / 2);
  const markerMaterial = new MeshStandardMaterial({ color: MARKER_OK, emissive: MARKER_OK, emissiveIntensity: 0.35 });
  const marker = new Mesh(markerGeometry, markerMaterial);
  marker.visible = false;
  marker.position.y = 0.08;
  scene.add(marker);
  let obstacle: { x: number; y: number; width: number; height: number } | null = null;

  const floorGeometry = new BoxGeometry(mapSize, 0.02, mapSize);
  const floor = new Mesh(
    floorGeometry,
    new MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 }),
  );
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

  placeCamera();
  frameCamera();

  return {
    resize() {
      frameCamera();
    },
    render() {
      renderer.render(scene, camera);
    },
    setObstacle(rect) {
      obstacle = rect;
      const block = new Mesh(
        new BoxGeometry(rect.width, 0.7, rect.height),
        new MeshStandardMaterial({ color: '#4a4036', roughness: 0.9, metalness: 0.04 }),
      );
      block.position.set(rect.x + rect.width / 2, 0.35, rect.y + rect.height / 2);
      scene.add(block);
    },
    setUnits(units) {
      const seen = new Set<number>();
      for (const unit of units) {
        seen.add(unit.id);
        let body = bodies.get(unit.id);
        if (!body) {
          const mesh = new Mesh(
            bodyGeometry,
            new MeshStandardMaterial({ color: UNIT, roughness: 0.55, metalness: 0.08 }),
          );
          const ring = new Mesh(
            ringGeometry,
            new MeshStandardMaterial({ color: '#f4e7c8', emissive: '#f4e7c8', emissiveIntensity: 0.4 }),
          );
          scene.add(mesh, ring);
          body = { mesh, ring };
          bodies.set(unit.id, body);
        }
        body.mesh.position.set(unit.x, 0.25, unit.y);
        body.ring.position.set(unit.x, 0.03, unit.y);
        body.ring.visible = unit.selected;
        const material = body.mesh.material as MeshStandardMaterial;
        material.color.copy(unit.selected ? UNIT_SELECTED : UNIT);
        material.emissive.set(unit.selected ? '#6a4a16' : '#000000');
      }
      for (const [id, body] of bodies) {
        if (seen.has(id)) continue;
        scene.remove(body.mesh, body.ring);
        bodies.delete(id);
      }
    },
    setMarker(cell, accepted) {
      if (!cell) {
        marker.visible = false;
        return;
      }
      marker.visible = true;
      const onBlock = obstacle !== null
        && cell.x >= obstacle.x && cell.y >= obstacle.y
        && cell.x < obstacle.x + obstacle.width && cell.y < obstacle.y + obstacle.height;
      marker.position.set(cell.x + 0.5, onBlock ? 0.9 : 0.06, cell.y + 0.5);
      marker.scale.setScalar(onBlock ? 2.4 : 1);
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
      bodyGeometry.dispose();
      ringGeometry.dispose();
      markerGeometry.dispose();
      floorGeometry.dispose();
    },
  };
}
