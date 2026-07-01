import * as THREE from 'three';
import { COLORS, DENY_SHAKE_DURATION_MS, SUBSTATION } from './constants';
import { denyShakeOffset, easeOutBack } from './feedback';
import { insulatorGeo } from './sharedGeometry';

export type SubstationEvent = 'permitCleared';

const PAD_WIDTH = 2.6;
const PAD_DEPTH = 2.6;
const PAD_HEIGHT = 0.3;
const TANK_HEIGHT = 1.4;
const TANK_POSITIONS: [number, number][] = [
  [-0.8, -0.6],
  [0.8, -0.6],
  [0, 0.75],
];

/** Shared low-poly substation geometry — a fenced utility-yard silhouette, deliberately
 * distinct from both the lattice tower and the house cluster, so all three new entity
 * types read apart from Tower and each other at a glance. */
export function buildSubstationVisual(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();

  const pad = new THREE.Mesh(new THREE.BoxGeometry(PAD_WIDTH, PAD_HEIGHT, PAD_DEPTH), material);
  pad.position.y = PAD_HEIGHT / 2;
  group.add(pad);

  for (const [x, z] of TANK_POSITIONS) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, TANK_HEIGHT, 8), material);
    tank.position.set(x, PAD_HEIGHT + TANK_HEIGHT / 2, z);
    group.add(tank);
  }

  // Insulator nubs on the transmission-side edge — count matches
  // `SUBSTATION.maxConnections` exactly, same "visual quantity = real capacity"
  // discipline as Tower's cross-arms.
  const usableWidth = PAD_WIDTH * 0.7;
  const maxConnections: number = SUBSTATION.maxConnections;
  for (let i = 0; i < maxConnections; i++) {
    const t = maxConnections === 1 ? 0.5 : i / (maxConnections - 1);
    const insulator = new THREE.Mesh(insulatorGeo, material);
    insulator.position.set((t - 0.5) * usableWidth, PAD_HEIGHT + TANK_HEIGHT + 0.35, -1.1);
    group.add(insulator);
  }

  return group;
}

/** Player-placed exactly like Tower (same cost/terrain-gating/permitting flow), but a
 * distinct class — no tier/branch upgrade system, a single fixed-capacity purchase. The
 * voltage-transition node between transmission (Plant↔Substation) and distribution
 * (Substation↔Neighborhood, Wave 2+). */
export class Substation {
  readonly group: THREE.Group;
  readonly gridI: number;
  readonly gridJ: number;
  /** Transmission-side attachment point, matching Tower.topPos's role. */
  readonly topPos: THREE.Vector3;
  /** Distribution-side attachment point — used starting Wave 2 for the
   * Substation→Neighborhood connect action; visually lower/separate from `topPos`. */
  readonly distPos: THREE.Vector3;

  private readonly material: THREE.MeshStandardMaterial;
  private readonly basePos: THREE.Vector3;
  private selected = false;
  private connections = 0;

  private readonly spawnTime = performance.now();
  private settled = false;
  private denyStart: number | null = null;
  private permitClearAt: number | null = null;
  private activationPulseStart: number | null = null;

  constructor(gridI: number, gridJ: number, worldPos: THREE.Vector3, pendingDurationMs = 0) {
    this.gridI = gridI;
    this.gridJ = gridJ;
    this.basePos = worldPos.clone();

    this.material = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlue,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      transparent: true,
      opacity: 1,
      roughness: 0.5,
      metalness: 0.45,
    });

    this.group = buildSubstationVisual(this.material);
    this.group.position.copy(this.basePos);
    this.group.scale.setScalar(0.001);
    this.group.userData.isSubstation = true;
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    this.topPos = new THREE.Vector3(worldPos.x, PAD_HEIGHT + TANK_HEIGHT + 0.35, worldPos.z - 1.1);
    this.distPos = new THREE.Vector3(worldPos.x, PAD_HEIGHT + 0.4, worldPos.z + 1.1);

    if (pendingDurationMs > 0) {
      this.permitClearAt = performance.now() + pendingDurationMs;
    }
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.material.color.set(selected ? COLORS.safetyOrange : COLORS.steelBlue);
    this.material.emissive.set(selected ? COLORS.safetyOrange : 0x000000);
    this.material.emissiveIntensity = selected ? 0.55 : 0;
  }

  isSelected(): boolean {
    return this.selected;
  }

  hasFreeCapacity(): boolean {
    return this.connections < SUBSTATION.maxConnections;
  }

  addConnection(): void {
    this.connections++;
  }

  denyFeedback(): void {
    this.denyStart = performance.now();
  }

  isPending(): boolean {
    return this.permitClearAt !== null && performance.now() < this.permitClearAt;
  }

  getPendingRemainingMs(): number | null {
    if (this.permitClearAt === null) return null;
    return Math.max(0, this.permitClearAt - performance.now());
  }

  materializeFromSave(pendingMs?: number): void {
    this.settled = true;
    this.group.scale.setScalar(1);
    if (pendingMs && pendingMs > 0) {
      this.permitClearAt = performance.now() + pendingMs;
      this.material.opacity = 0.65;
    }
  }

  update(now: number): SubstationEvent | null {
    let event: SubstationEvent | null = null;

    if (!this.settled) {
      const t = Math.min((now - this.spawnTime) / 280, 1);
      this.group.scale.setScalar(Math.max(0.001, easeOutBack(t)));
      if (t >= 1) {
        this.group.scale.setScalar(1);
        this.settled = true;
      }
    } else if (this.activationPulseStart !== null) {
      const elapsed = now - this.activationPulseStart;
      const duration = 300;
      if (elapsed >= duration) {
        this.group.scale.setScalar(1);
        this.activationPulseStart = null;
        if (!this.selected) {
          this.material.emissive.set(0x000000);
          this.material.emissiveIntensity = 0;
        }
      } else {
        const t = elapsed / duration;
        this.group.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.1);
        if (!this.selected) {
          this.material.emissive.set(COLORS.steelBlue);
          this.material.emissiveIntensity = (1 - t) * 0.9;
        }
      }
    }

    if (this.permitClearAt !== null) {
      if (now >= this.permitClearAt) {
        this.permitClearAt = null;
        this.activationPulseStart = now;
        this.material.opacity = 1;
        event = 'permitCleared';
      } else {
        const cycle = (now % 1400) / 1400;
        this.material.opacity = 0.45 + (0.5 + 0.5 * Math.sin(cycle * Math.PI * 2)) * 0.4;
      }
    }

    this.group.position.copy(this.basePos);
    if (this.denyStart !== null) {
      const elapsed = now - this.denyStart;
      this.group.position.x += denyShakeOffset(elapsed);
      if (elapsed >= DENY_SHAKE_DURATION_MS) this.denyStart = null;
    }

    return event;
  }
}
