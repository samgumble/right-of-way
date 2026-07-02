import * as THREE from 'three';
import { ATMOSPHERE, COLORS, DENY_SHAKE_DURATION_MS, LOCAL_GLOW, PLANT, PLANT_DETAIL, WIND_TURBINE } from './constants';
import { denyShakeOffset, easeOutBack } from './feedback';
import { hash01 } from './Grid';

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
 * cooling-tower profile, a dam, a panel array, turbines) rather than a decorative variant.
 * Returns the wind case's blade pivots (empty for every other fuel type) so `PowerPlant`
 * can keep a live reference to animate — populated in place via `windPivotsOut` rather
 * than returned directly, so the function's shape stays a plain `void` builder like every
 * other geometry-factory free function in this project. */
function addFuelDetail(
  group: THREE.Group,
  material: THREE.Material,
  fuelType: FuelType,
  windPivotsOut: THREE.Group[],
): void {
  switch (fuelType) {
    case 'coal': {
      // Stacks read as concrete/lined steel — a real, distinct surface finish from the
      // plant's structural steel base, not just a color swap. Local to this call
      // (matching the existing spillway/panel material precedent below), so it's never
      // touched by selection or the energized glow.
      const stackMat = new THREE.MeshStandardMaterial({
        color: COLORS.steelBlue,
        roughness: 0.7,
        metalness: 0.2,
      });
      for (const side of [-0.7, 0.7]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 3.2, 8), stackMat);
        stack.position.set(side, BASE_HEIGHT + 1.6, 0);
        group.add(stack);

        const collar = new THREE.Mesh(
          new THREE.CylinderGeometry(PLANT_DETAIL.stackCollarRadius, PLANT_DETAIL.stackCollarRadius, PLANT_DETAIL.stackCollarHeight, 8),
          stackMat,
        );
        collar.position.set(side, BASE_HEIGHT + 0.15, 0);
        group.add(collar);
      }

      // On-site fuel stockpile — the one real decoration-as-data opportunity in this
      // wave: pile size reflects nameplate capacity relative to nuclear's (the largest
      // fuel type), so a bigger coal plant genuinely shows a bigger pile.
      const pileMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlueDim, roughness: 0.95, metalness: 0 });
      const pileRadius =
        PLANT_DETAIL.coalPileMaxRadius * (PLANT.fuelSpecs.coal.nameplateCapacityMW / PLANT.fuelSpecs.nuclear.nameplateCapacityMW);
      const pile = new THREE.Mesh(new THREE.ConeGeometry(pileRadius, pileRadius * 0.8, 8), pileMat);
      pile.position.set(0, (pileRadius * 0.8) / 2, BASE_DEPTH * 0.5 + pileRadius * 0.6);
      group.add(pile);
      break;
    }
    case 'gas': {
      const stackMat = new THREE.MeshStandardMaterial({
        color: COLORS.steelBlue,
        roughness: 0.7,
        metalness: 0.2,
      });
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 4.4, 8), stackMat);
      stack.position.set(0, BASE_HEIGHT + 2.2, 0);
      group.add(stack);

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(PLANT_DETAIL.stackCollarRadius * 0.7, PLANT_DETAIL.stackCollarRadius * 0.7, PLANT_DETAIL.stackCollarHeight, 8),
        stackMat,
      );
      collar.position.set(0, BASE_HEIGHT + 0.15, 0);
      group.add(collar);

      // Small on-site gas storage tanks, distinct from coal's fuel pile — a real fuel
      // type gets a real, distinct fuel-handling silhouette, not just a stack.
      const tankMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlue, roughness: 0.3, metalness: 0.6 });
      for (const side of [-0.9, 0.9]) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(PLANT_DETAIL.gasTankRadius, PLANT_DETAIL.gasTankRadius, PLANT_DETAIL.gasTankHeight, 8), tankMat);
        tank.rotation.z = Math.PI / 2;
        tank.position.set(side, PLANT_DETAIL.gasTankRadius + 0.05, BASE_DEPTH * 0.5 + 0.4);
        group.add(tank);
      }
      break;
    }
    case 'nuclear': {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 3.6, 12), material);
      tower.position.set(0, BASE_HEIGHT + 1.8, 0);
      group.add(tower);

      // A second, smaller domed reactor containment building — real nuclear plants
      // have both the hyperboloid cooling tower *and* a domed reactor building; only
      // the cooling tower existed before this wave.
      const domeMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlueDim, roughness: 0.5, metalness: 0.3 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(PLANT_DETAIL.nuclearDomeRadius, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.position.set(2.0, BASE_HEIGHT, -0.5);
      group.add(dome);

      // Low switchyard fence detail around the site perimeter.
      const fenceMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlueDim, roughness: 0.6, metalness: 0.4 });
      for (const side of [-1, 1]) {
        const fence = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, BASE_DEPTH + 0.6), fenceMat);
        fence.position.set(side * (BASE_WIDTH * 0.5 + 0.3), 0.15, 0);
        group.add(fence);
      }
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

      // A brighter water-foam plane at the spillway base, plus 2 dam support piers.
      const foamMat = new THREE.MeshStandardMaterial({ color: COLORS.waterTint, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.7 });
      const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), foamMat);
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(0, 0.03, BASE_DEPTH * -0.1);
      group.add(foam);

      const pierMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlueDim, roughness: 0.9, metalness: 0.05 });
      for (const side of [-1, 1]) {
        const pier = new THREE.Mesh(
          new THREE.BoxGeometry(PLANT_DETAIL.hydroPierWidth, PLANT_DETAIL.hydroPierHeight, PLANT_DETAIL.hydroPierWidth),
          pierMat,
        );
        pier.position.set(side * (BASE_WIDTH * 0.5 + 0.7), PLANT_DETAIL.hydroPierHeight / 2, -BASE_DEPTH * 0.5);
        group.add(pier);
      }
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

      // Support struts beneath each row (currently the panels float with no visible
      // mounting) plus a small inverter box at the array's edge.
      const strutMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlueDim, roughness: 0.7, metalness: 0.3 });
      for (let row = 0; row < 2; row++) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, PLANT_DETAIL.solarStrutLength, 0.08), strutMat);
        strut.rotation.x = -0.35;
        strut.position.set(-1.5, BASE_HEIGHT * 0.5 + row * 0.5 - 0.35, -1 + row * 1.0);
        group.add(strut);
      }

      const inverterMat = new THREE.MeshStandardMaterial({ color: COLORS.steelBlue, roughness: 0.5, metalness: 0.4 });
      const inverter = new THREE.Mesh(
        new THREE.BoxGeometry(PLANT_DETAIL.solarInverterSize, PLANT_DETAIL.solarInverterSize, PLANT_DETAIL.solarInverterSize),
        inverterMat,
      );
      inverter.position.set(2.0, PLANT_DETAIL.solarInverterSize / 2, -1.5);
      group.add(inverter);
      break;
    }
    case 'wind':
      for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const x = Math.cos(angle) * 1.6;
        const z = Math.sin(angle) * 1.6 - 2.0;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 6), material);
        mast.position.set(x, BASE_HEIGHT + 1.6, z);
        group.add(mast);

        // The blade lives inside a pivot positioned at the hub (the mast top) — rotating
        // the *pivot* sweeps the blade around the mast axis every tick; rotating the
        // blade mesh directly would only spin its own local geometry in place, with no
        // stable hub reference once a later change (e.g. a non-centered blade shape)
        // stopped the two from coinciding by coincidence.
        const pivot = new THREE.Group();
        pivot.position.set(x, BASE_HEIGHT + 3.1, z);
        group.add(pivot);

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.18), material);
        pivot.add(blade);
        windPivotsOut.push(pivot);

        // A nacelle housing at the hub — previously blades pivoted directly off the bare
        // mast top with nothing to visually anchor them.
        const nacelle = new THREE.Mesh(
          new THREE.BoxGeometry(PLANT_DETAIL.windNacelleWidth, PLANT_DETAIL.windNacelleHeight, PLANT_DETAIL.windNacelleWidth),
          material,
        );
        nacelle.position.set(x, BASE_HEIGHT + 3.1, z);
        group.add(nacelle);
      }
      break;
  }
}

export function buildPlantVisual(
  material: THREE.Material,
  fuelType: FuelType,
  windPivotsOut: THREE.Group[],
): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(BASE_WIDTH, BASE_HEIGHT, BASE_DEPTH), material);
  base.position.y = BASE_HEIGHT / 2;
  group.add(base);
  addFuelDetail(group, material, fuelType, windPivotsOut);
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
  /** Oscillates around 1.0 for solar/wind (real intermittency); stays exactly 1 for
   * coal/gas/nuclear/hydro (dispatchable/steady, unchanged). Cached from `update()`,
   * read by `effectiveCapacityMW()` and the wind-blade rotation speed below. */
  private outputMultiplier = 1;
  /** Empty for every fuel type except wind. Rotation speed reads `outputMultiplier`
   * directly every tick — a real turbine's blades turn because of wind, not because
   * it's grid-connected. */
  private readonly windPivots: THREE.Group[] = [];

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

    this.group = buildPlantVisual(this.material, fuelType, this.windPivots);
    this.group.position.copy(this.basePos);
    this.group.scale.setScalar(0.001);
    this.group.userData.isPlant = true;
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    this.topPos = new THREE.Vector3(worldPos.x, BASE_HEIGHT + 0.4, worldPos.z + BASE_DEPTH * 0.5 + 0.4);
  }

  effectiveCapacityMW(): number {
    return this.nameplateCapacityMW * PLANT.fuelSpecs[this.fuelType].capacityFactor * this.outputMultiplier;
  }

  /** The live generation-variability signal — 1 for dispatchable fuel types, oscillating
   * for solar/wind. Read directly by Wave 6's wind-blade rotation speed. */
  getOutputMultiplier(): number {
    return this.outputMultiplier;
  }

  /** Phase-locked to the exact same day/night cycle `Game.updateAtmosphere` drives (0 =
   * solar noon, 0.5 = midnight) — real panels aren't perfectly zero at night, hence the
   * `solarNightFloor`. */
  private solarOutputMultiplier(now: number): number {
    const cyclePos = (now / 1000 / ATMOSPHERE.dayNightCycleSec) % 1;
    const dayFactor = 0.5 + 0.5 * Math.cos(cyclePos * Math.PI * 2);
    return PLANT.solarNightFloor + (1 - PLANT.solarNightFloor) * dayFactor;
  }

  /** A slow layered-sine pseudo-random walk over time — same hand-rolled technique as
   * `Grid.terrainNoise`, just parameterized by time instead of grid coordinates.
   * Phase-offset per-plant via `hash01` (keyed on this plant's fixed grid location) so
   * multiple wind plants don't swing in lockstep. Clamped to a sane, never-negative
   * range rather than trusting the layered sum's loose bound. */
  private windOutputMultiplier(now: number): number {
    const phase = hash01(this.gridI, this.gridJ, 40) * Math.PI * 2;
    const t = now / 1000;
    const wave =
      Math.sin(t * 0.07 + phase) * 0.6 + Math.sin(t * 0.023 - phase * 1.3) * 0.3 + Math.cos(t * 0.041 + phase * 0.7) * 0.1;
    const raw = 1 + wave * PLANT.windAmplitude;
    return Math.min(PLANT.windMultiplierMax, Math.max(PLANT.windMultiplierMin, raw));
  }

  private computeOutputMultiplier(now: number): number {
    if (this.fuelType === 'solar') return this.solarOutputMultiplier(now);
    if (this.fuelType === 'wind') return this.windOutputMultiplier(now);
    return 1;
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

  update(now: number, dt: number): void {
    this.outputMultiplier = this.computeOutputMultiplier(now);

    // A real turbine's blades turn because of wind, not because it's grid-connected —
    // rotation speed reads the live multiplier directly, never a flat constant spin or
    // a separate "energized" gate.
    for (const pivot of this.windPivots) {
      pivot.rotation.x += WIND_TURBINE.bladeRotationRadPerSec * this.outputMultiplier * dt;
    }

    // Always-on "this thing is hot" glow, scaled by live output fraction — a solar/wind
    // plant genuinely glows less at low output, not just a flat constant. Selection
    // wins visually (same precedent as every other entity), routed through the existing
    // bloom pass, not a new dynamic light.
    if (!this.selected) {
      const outputFraction = this.effectiveCapacityMW() / this.nameplateCapacityMW;
      this.material.emissive.set(COLORS.keyLight);
      this.material.emissiveIntensity = LOCAL_GLOW.nodeGlowIntensity * outputFraction;
    }

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
