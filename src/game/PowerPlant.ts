import * as THREE from 'three';
import { COLORS, DENY_SHAKE_DURATION_MS, PLANT } from './constants';
import { denyShakeOffset, easeOutBack } from './feedback';

export type FuelType = 'coal' | 'gas' | 'nuclear' | 'hydro' | 'solar' | 'wind';

const BASE_WIDTH = 3.2;
const BASE_DEPTH = 2.4;
const BASE_HEIGHT = 1.6;

/** Weighted so nuclear/coal (the biggest, steadiest fuel types) aren't the *only* thing
 * that ever spawns, but also aren't as common as the smaller/more common real-world fuel
 * mix — first-pass weighting, same tunable-not-validated caveat as every other constant. */
const FUEL_WEIGHTS: Record<FuelType, number> = {
  gas: 3,
  coal: 2,
  nuclear: 1,
  hydro: 2,
  solar: 2,
  wind: 2,
};

/** Semi-random fuel type for a newly-spawned objective (Wave 6) — weighted, not
 * uniform, so every fuel type is reachable but the mix reads plausible. */
export function pickRandomFuelType(): FuelType {
  const entries = Object.entries(FUEL_WEIGHTS) as [FuelType, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [fuel, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return fuel;
  }
  return 'gas'; // floating-point fallback, never reached in practice
}

/** Fuel-type differentiation is geometry only — no new color hues — same discipline as
 * the tower upgrade branches. Each silhouette is a real, recognizable shape (stacks, a
 * cooling-tower profile, a dam, a panel array, turbines) rather than a decorative variant. */
function addFuelDetail(group: THREE.Group, material: THREE.Material, fuelType: FuelType): void {
  switch (fuelType) {
    case 'coal':
      for (const side of [-0.7, 0.7]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 3.2, 8), material);
        stack.position.set(side, BASE_HEIGHT + 1.6, 0);
        group.add(stack);
      }
      break;
    case 'gas': {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 4.4, 8), material);
      stack.position.set(0, BASE_HEIGHT + 2.2, 0);
      group.add(stack);
      break;
    }
    case 'nuclear': {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 3.6, 12), material);
      tower.position.set(0, BASE_HEIGHT + 1.8, 0);
      group.add(tower);
      break;
    }
    case 'hydro': {
      const dam = new THREE.Mesh(new THREE.BoxGeometry(BASE_WIDTH + 1.2, 1.0, BASE_DEPTH * 0.5), material);
      dam.position.set(0, BASE_HEIGHT + 0.5, -BASE_DEPTH * 0.5);
      group.add(dam);
      // The one deliberate exception to "reuse `material`" — `waterTint` already exists
      // in the palette and is water-related, so reusing it here isn't a new hue.
      const spillwayMat = new THREE.MeshStandardMaterial({
        color: COLORS.waterTint,
        roughness: 0.3,
        metalness: 0.1,
      });
      const spillway = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, BASE_DEPTH * 0.6), spillwayMat);
      spillway.position.set(0, BASE_HEIGHT + 0.2, -BASE_DEPTH * 0.3);
      group.add(spillway);
      break;
    }
    case 'solar': {
      const panelMat = new THREE.MeshStandardMaterial({
        color: COLORS.steelBlueDim,
        roughness: 0.3,
        metalness: 0.5,
      });
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.9), panelMat);
          panel.position.set(-1.5 + col * 0.75, BASE_HEIGHT * 0.5 + row * 0.5, -1 + row * 1.0);
          panel.rotation.x = -0.35;
          group.add(panel);
        }
      }
      break;
    }
    case 'wind':
      for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const x = Math.cos(angle) * 1.6;
        const z = Math.sin(angle) * 1.6 - 2.0;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 6), material);
        mast.position.set(x, BASE_HEIGHT + 1.6, z);
        group.add(mast);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.18), material);
        blade.position.set(x, BASE_HEIGHT + 3.1, z);
        group.add(blade);
      }
      break;
  }
}

export function buildPlantVisual(material: THREE.Material, fuelType: FuelType): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(BASE_WIDTH, BASE_HEIGHT, BASE_DEPTH), material);
  base.position.y = BASE_HEIGHT / 2;
  group.add(base);
  addFuelDetail(group, material, fuelType);
  return group;
}

/** Game-spawned only — never player-placed. Fixed grid location, fixed fuel type and
 * nameplate capacity for its lifetime; `effectiveCapacityMW()` is what the Wave 3
 * network algorithm actually reads. */
export class PowerPlant {
  readonly group: THREE.Group;
  readonly gridI: number;
  readonly gridJ: number;
  /** World-space attachment point for its outgoing transmission span. */
  readonly topPos: THREE.Vector3;
  readonly fuelType: FuelType;
  readonly nameplateCapacityMW: number;
  readonly id: string;

  private readonly material: THREE.MeshStandardMaterial;
  private readonly basePos: THREE.Vector3;
  private selected = false;
  private readonly spawnTime = performance.now();
  private settled = false;
  private denyStart: number | null = null;

  constructor(gridI: number, gridJ: number, worldPos: THREE.Vector3, fuelType: FuelType) {
    this.gridI = gridI;
    this.gridJ = gridJ;
    this.fuelType = fuelType;
    this.nameplateCapacityMW = PLANT.fuelSpecs[fuelType].nameplateCapacityMW;
    this.id = `plant-${gridI}-${gridJ}`;
    this.basePos = worldPos.clone();

    this.material = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlue,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.55,
      metalness: 0.35,
    });

    this.group = buildPlantVisual(this.material, fuelType);
    this.group.position.copy(this.basePos);
    this.group.scale.setScalar(0.001);
    this.group.userData.isPlant = true;
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    this.topPos = new THREE.Vector3(worldPos.x, BASE_HEIGHT + 0.4, worldPos.z + BASE_DEPTH * 0.5 + 0.4);
  }

  effectiveCapacityMW(): number {
    return this.nameplateCapacityMW * PLANT.fuelSpecs[this.fuelType].capacityFactor;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.material.emissive.set(selected ? COLORS.safetyOrange : 0x000000);
    this.material.emissiveIntensity = selected ? 0.5 : 0;
  }

  isSelected(): boolean {
    return this.selected;
  }

  /** A Plant's own outgoing-connection count is deliberately uncapped — a real plant's
   * switchyard can host many outgoing lines, and there's no existing "tier" concept for
   * Plant the way Tower/Substation have one to hang a cap off of. */
  hasFreeCapacity(): boolean {
    return true;
  }

  addConnection(): void {
    // Intentionally a no-op — see `hasFreeCapacity`.
  }

  denyFeedback(): void {
    this.denyStart = performance.now();
  }

  update(now: number): void {
    if (!this.settled) {
      const t = Math.min((now - this.spawnTime) / 280, 1);
      this.group.scale.setScalar(Math.max(0.001, easeOutBack(t)));
      if (t >= 1) {
        this.group.scale.setScalar(1);
        this.settled = true;
      }
    }

    this.group.position.copy(this.basePos);
    if (this.denyStart !== null) {
      const elapsed = now - this.denyStart;
      this.group.position.x += denyShakeOffset(elapsed);
      if (elapsed >= DENY_SHAKE_DURATION_MS) this.denyStart = null;
    }
  }

  materializeFromSave(): void {
    this.settled = true;
    this.group.scale.setScalar(1);
  }
}
