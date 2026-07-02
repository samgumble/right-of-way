import * as THREE from 'three';
import { COLORS, DENY_SHAKE_DURATION_MS, LOCAL_GLOW, SUBSTATION, SUBSTATION_DETAIL } from './constants';
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

/** Insulator nubs gained *reaching* `targetTier` (mirrors Tower's
 * `addArmForTier`/`addArm` convention exactly: `targetTier` 1 means tier 1's own base
 * count, built once by `buildSubstationVisual`; `targetTier` 2+ is called from
 * `Substation.upgrade()`/`materializeFromSave()` and only adds that tier's *newly
 * gained* nubs). Each tier's nubs sit in their own row (lower on the fence line than
 * the last) rather than reflowing earlier tiers' already-placed meshes — no overlap,
 * reads as "another row of capacity," matching the arm-per-tier idiom Tower already
 * established. Visible nub count always equals `maxConnectionsByTier[tier - 1]`
 * exactly — not decoration, same "visual quantity = real capacity" discipline. */
function addInsulatorsForTier(group: THREE.Group, material: THREE.Material, targetTier: number): void {
  const countAtThisTier =
    targetTier === 1
      ? SUBSTATION.maxConnectionsByTier[0]
      : SUBSTATION.maxConnectionsByTier[targetTier - 1] - SUBSTATION.maxConnectionsByTier[targetTier - 2];
  const usableWidth = PAD_WIDTH * 0.7;
  const y = PAD_HEIGHT + TANK_HEIGHT + 0.35 - (targetTier - 1) * 0.3;
  for (let i = 0; i < countAtThisTier; i++) {
    const t = countAtThisTier === 1 ? 0.5 : i / (countAtThisTier - 1);
    const insulator = new THREE.Mesh(insulatorGeo, material);
    insulator.position.set((t - 0.5) * usableWidth, y, -1.1);
    insulator.castShadow = true;
    group.add(insulator);
  }
}

/** Shared low-poly substation geometry — a fenced utility-yard silhouette, deliberately
 * distinct from both the lattice tower and the house cluster, so all three new entity
 * types read apart from Tower and each other at a glance. Tier 1 only — tier 2's nubs
 * are added later by `addInsulatorsForTier` (`Substation.upgrade()`/
 * `materializeFromSave()`), never rebuilt here. */
export function buildSubstationVisual(material: THREE.Material, padMaterial: THREE.Material = material): THREE.Group {
  const group = new THREE.Group();

  const pad = new THREE.Mesh(new THREE.BoxGeometry(PAD_WIDTH, PAD_HEIGHT, PAD_DEPTH), padMaterial);
  pad.position.y = PAD_HEIGHT / 2;
  group.add(pad);

  for (const [x, z] of TANK_POSITIONS) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, TANK_HEIGHT, 8), material);
    tank.position.set(x, PAD_HEIGHT + TANK_HEIGHT / 2, z);
    group.add(tank);

    // Ceramic bushings atop the tank — real hardware detail, fixed regardless of tier
    // (distinct from the fence-line insulator nubs, which do encode tier capacity).
    for (let i = 0; i < SUBSTATION_DETAIL.bushingsPerTank; i++) {
      const bushingOffset = (i - (SUBSTATION_DETAIL.bushingsPerTank - 1) / 2) * 0.18;
      const bushing = new THREE.Mesh(insulatorGeo, material);
      bushing.position.set(x + bushingOffset, PAD_HEIGHT + TANK_HEIGHT + 0.15, z);
      group.add(bushing);
    }

    // Radiator fins on the tank's outward side — real transformer cooling-fin
    // silhouette, pure polish (every tank has fins regardless of tier).
    for (const finOffset of [-0.35, 0, 0.35]) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(SUBSTATION_DETAIL.finWidth, SUBSTATION_DETAIL.finHeight, SUBSTATION_DETAIL.finDepth),
        material,
      );
      const outwardSign = z >= 0 ? 1 : -1;
      fin.position.set(x, PAD_HEIGHT + TANK_HEIGHT / 2 + finOffset * 0.4, z + outwardSign * 0.4);
      group.add(fin);
    }
  }

  // Chain-link fence posts around the pad perimeter — finally delivers on this
  // module's own doc comment ("a fenced utility-yard silhouette"), which had no actual
  // fence geometry until this wave.
  const halfWidth = PAD_WIDTH / 2;
  const halfDepth = PAD_DEPTH / 2;
  const fencePositions: [number, number][] = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, halfDepth],
    [0, -halfDepth],
    [0, halfDepth],
    [-halfWidth, 0],
    [halfWidth, 0],
  ];
  for (const [x, z] of fencePositions) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(SUBSTATION_DETAIL.fencePostRadius, SUBSTATION_DETAIL.fencePostRadius, SUBSTATION_DETAIL.fencePostHeight, 5),
      padMaterial,
    );
    post.position.set(x, PAD_HEIGHT + SUBSTATION_DETAIL.fencePostHeight / 2, z);
    group.add(post);
  }

  addInsulatorsForTier(group, material, 1);

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
  /** Separate, always-neutral concrete-pad material — never touched by
   * `setSelected()`/the energized glow, same precedent as `Tower.padMaterial`. */
  private readonly padMaterial: THREE.MeshStandardMaterial;
  private readonly basePos: THREE.Vector3;
  private selected = false;
  private connections = 0;
  private tier = 1;

  private readonly spawnTime = performance.now();
  private settled = false;
  private denyStart: number | null = null;
  private permitClearAt: number | null = null;
  private activationPulseStart: number | null = null;
  /** Set by `Game.recomputeNetworkState()` — true iff at least one connected span is
   * currently energized. Same idiom as `Tower`'s own energized glow. */
  private energized = false;

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
      roughness: 0.25,
      metalness: 0.55,
    });

    this.padMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlueDim,
      roughness: 0.9,
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });

    this.group = buildSubstationVisual(this.material, this.padMaterial);
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

  /** Same "this thing has power" cue as `Tower.setEnergizedGlow` — routed through the
   * existing bloom pass, not a new dynamic light. */
  setEnergizedGlow(active: boolean): void {
    this.energized = active;
  }

  getTier(): number {
    return this.tier;
  }

  canUpgrade(): boolean {
    return this.tier < SUBSTATION.maxTier;
  }

  /** The MW throughput ceiling the network algorithm reads — sourced from the exact
   * same tier-indexed table as `maxConnections()` so there's one place either number
   * could ever drift from the other. */
  capacityMW(): number {
    return SUBSTATION.capacityMWByTier[this.tier - 1];
  }

  /** Tier 1→2 only — no branch choice (Substation has no second axis like Tower's
   * storm-weighting Resilience branch to justify one). Adds this tier's newly-gained
   * insulator nubs to the existing group, same "grow in place" idiom as Tower's
   * `addArm` — never rebuilds the base geometry. */
  upgrade(): void {
    if (!this.canUpgrade()) return;
    this.tier++;
    addInsulatorsForTier(this.group, this.material, this.tier);
    this.activationPulseStart = performance.now();
  }

  hasFreeCapacity(): boolean {
    return this.connections < SUBSTATION.maxConnectionsByTier[this.tier - 1];
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

  /** `tier` defaults to 1 — legacy pre-Wave-10 saves have no `tier` field at all
   * (`Persistence`/`Game.loadSavedGame` pass `undefined`, resolved to 1 here), and stay
   * fully upgradeable from that point exactly like a freshly-placed tier-1 Substation. */
  materializeFromSave(pendingMs?: number, tier = 1): void {
    this.settled = true;
    this.group.scale.setScalar(1);
    if (pendingMs && pendingMs > 0) {
      this.permitClearAt = performance.now() + pendingMs;
      this.material.opacity = 0.65;
      this.padMaterial.opacity = 0.65;
    }
    for (let t = 2; t <= tier; t++) addInsulatorsForTier(this.group, this.material, t);
    this.tier = tier;
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
        this.padMaterial.opacity = 1;
        event = 'permitCleared';
      } else {
        const cycle = (now % 1400) / 1400;
        const pendingOpacity = 0.45 + (0.5 + 0.5 * Math.sin(cycle * Math.PI * 2)) * 0.4;
        this.material.opacity = pendingOpacity;
        this.padMaterial.opacity = pendingOpacity;
      }
    }

    // Energized glow — only once every transient pulse has settled and selection isn't
    // already claiming the emissive channel, same precedent as `Tower`.
    if (this.settled && !this.selected && this.activationPulseStart === null && this.permitClearAt === null) {
      this.material.emissive.set(this.energized ? COLORS.keyLight : 0x000000);
      this.material.emissiveIntensity = this.energized ? LOCAL_GLOW.nodeGlowIntensity : 0;
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
