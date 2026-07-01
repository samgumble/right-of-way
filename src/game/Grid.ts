import * as THREE from 'three';
import { COLORS, GRID, TERRAIN } from './constants';

export interface GridNode {
  i: number;
  j: number;
  world: THREE.Vector3;
}

export type Terrain = 'flat' | 'hill' | 'water' | 'marsh';

/**
 * Deterministic, fixed layered-sine value field — no external noise library, and no
 * seed/randomness, so terrain never needs to be persisted: it regenerates identically
 * every time the grid is built.
 */
function terrainNoise(i: number, j: number): number {
  const a = Math.sin(i * 0.35 + 1.7) * Math.cos(j * 0.28 - 0.5);
  const b = Math.sin(i * 0.12 - 2.3 + j * 0.09) * 0.6;
  const c = Math.cos(j * 0.31 + 0.8 - i * 0.05) * 0.4;
  return a + b + c;
}

/** Deterministic pseudo-random in [0, 1) from integer coords + a seed, so patch jitter
 * needs no persistence either — it falls out of the same fixed math every time. Exported
 * for reuse by other deterministic-jitter needs (e.g. Neighborhood's house layout). */
export function hash01(i: number, j: number, seed: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.3) * 43758.5453;
  return s - Math.floor(s);
}

const PATCH_RADIUS = GRID.cellSize * 0.55;

/** Non-uniform scale + spin + small position jitter so instanced patches read as
 * organic terrain rather than a grid of identical stamped circles. */
function buildPatchMatrix(node: GridNode, y: number): THREE.Matrix4 {
  const scaleX = 0.8 + hash01(node.i, node.j, 1) * 0.4;
  const scaleZ = 0.8 + hash01(node.i, node.j, 2) * 0.4;
  const spin = hash01(node.i, node.j, 3) * Math.PI * 2;
  const offsetX = (hash01(node.i, node.j, 4) - 0.5) * GRID.cellSize * 0.3;
  const offsetZ = (hash01(node.i, node.j, 5) - 0.5) * GRID.cellSize * 0.3;

  const rotation = new THREE.Matrix4().multiplyMatrices(
    new THREE.Matrix4().makeRotationX(-Math.PI / 2),
    new THREE.Matrix4().makeRotationZ(spin),
  );
  const m = new THREE.Matrix4().multiplyMatrices(rotation, new THREE.Matrix4().makeScale(scaleX, scaleZ, 1));
  m.setPosition(node.world.x + offsetX, y, node.world.z + offsetZ);
  return m;
}

export class Grid {
  readonly group: THREE.Group;
  readonly groundMesh: THREE.Mesh;
  private readonly half: number;
  private readonly occupied = new Set<string>();

  constructor() {
    this.half = (GRID.cells * GRID.cellSize) / 2;
    this.group = new THREE.Group();

    const groundGeo = new THREE.PlaneGeometry(this.half * 2, this.half * 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.95, metalness: 0.05 });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);

    this.buildTerrainPatches();

    const gridHelper = new THREE.GridHelper(
      this.half * 2,
      GRID.cells,
      COLORS.steelBlueDim,
      COLORS.steelBlueDim,
    );
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.5;
    this.group.add(gridHelper);
  }

  private buildTerrainPatches(): void {
    const hillNodes: GridNode[] = [];
    const waterNodes: GridNode[] = [];
    const marshNodes: GridNode[] = [];
    for (let i = 0; i <= GRID.cells; i++) {
      for (let j = 0; j <= GRID.cells; j++) {
        const terrain = this.terrainAt(i, j);
        if (terrain === 'hill') hillNodes.push({ i, j, world: this.nodeToWorld(i, j) });
        else if (terrain === 'water') waterNodes.push({ i, j, world: this.nodeToWorld(i, j) });
        else if (terrain === 'marsh') marshNodes.push({ i, j, world: this.nodeToWorld(i, j) });
      }
    }

    const patchGeo = new THREE.CircleGeometry(PATCH_RADIUS, 16);

    if (hillNodes.length) {
      const hillMat = new THREE.MeshStandardMaterial({
        color: COLORS.hillTint,
        transparent: true,
        opacity: 0.35,
        roughness: 0.85,
        metalness: 0.05,
      });
      const hillMesh = new THREE.InstancedMesh(patchGeo, hillMat, hillNodes.length);
      hillNodes.forEach((n, idx) => hillMesh.setMatrixAt(idx, buildPatchMatrix(n, 0.015)));
      hillMesh.receiveShadow = true;
      this.group.add(hillMesh);
    }

    if (waterNodes.length) {
      const waterMat = new THREE.MeshStandardMaterial({
        color: COLORS.waterTint,
        transparent: true,
        opacity: 0.6,
        roughness: 0.3,
        metalness: 0.1,
      });
      const waterMesh = new THREE.InstancedMesh(patchGeo, waterMat, waterNodes.length);
      waterNodes.forEach((n, idx) => waterMesh.setMatrixAt(idx, buildPatchMatrix(n, 0.01)));
      waterMesh.receiveShadow = true;
      this.group.add(waterMesh);
    }

    if (marshNodes.length) {
      const marshMat = new THREE.MeshStandardMaterial({
        color: COLORS.marshTint,
        transparent: true,
        opacity: 0.4,
        roughness: 0.7,
        metalness: 0.05,
      });
      const marshMesh = new THREE.InstancedMesh(patchGeo, marshMat, marshNodes.length);
      marshNodes.forEach((n, idx) => marshMesh.setMatrixAt(idx, buildPatchMatrix(n, 0.012)));
      marshMesh.receiveShadow = true;
      this.group.add(marshMesh);
    }
  }

  terrainAt(i: number, j: number): Terrain {
    const n = terrainNoise(i, j);
    if (n < TERRAIN.waterThreshold) return 'water';
    if (n < TERRAIN.marshThreshold) return 'marsh';
    if (n > TERRAIN.hillThreshold) return 'hill';
    return 'flat';
  }

  isBuildable(i: number, j: number): boolean {
    return this.terrainAt(i, j) !== 'water' && !this.isOccupied(i, j);
  }

  towerCostMultiplier(i: number, j: number): number {
    const terrain = this.terrainAt(i, j);
    if (terrain === 'hill') return TERRAIN.hillCostMultiplier;
    if (terrain === 'marsh') return TERRAIN.marshCostMultiplier;
    return 1;
  }

  nodeToWorld(i: number, j: number): THREE.Vector3 {
    return new THREE.Vector3(-this.half + i * GRID.cellSize, 0, -this.half + j * GRID.cellSize);
  }

  nearestNode(point: THREE.Vector3): GridNode | null {
    const i = Math.round((point.x + this.half) / GRID.cellSize);
    const j = Math.round((point.z + this.half) / GRID.cellSize);
    if (!Number.isFinite(i) || !Number.isFinite(j)) return null;
    if (i < 0 || i > GRID.cells || j < 0 || j > GRID.cells) return null;
    return { i, j, world: this.nodeToWorld(i, j) };
  }

  private key(i: number, j: number): string {
    return `${i},${j}`;
  }

  isOccupied(i: number, j: number): boolean {
    return this.occupied.has(this.key(i, j));
  }

  setOccupied(i: number, j: number): void {
    this.occupied.add(this.key(i, j));
  }
}
