import * as THREE from 'three';
import { COLORS, DENY_SHAKE_DURATION_MS, ECONOMY, LOCAL_GLOW, TOWER_DETAIL } from './constants';
import { denyShakeOffset, easeOutBack } from './feedback';
import { insulatorGeo } from './sharedGeometry';

export type TowerEvent = 'permitCleared';
export type TowerBranch = 'capacity' | 'resilience';

/** A short hardware stub hanging just below an insulator nub — reads as a real
 * connection point rather than a bare cylinder with nothing attached. Added alongside
 * every insulator this project creates (both the base build below and each tier's
 * `addArm`), so the detail is consistent regardless of tier. */
function addJumper(group: THREE.Group, material: THREE.Material, x: number, y: number): void {
  const jumper = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_DETAIL.jumperRadius, TOWER_DETAIL.jumperRadius, TOWER_DETAIL.jumperLength, 5), material);
  jumper.position.set(x, y - 0.17 - TOWER_DETAIL.jumperLength / 2, 0);
  jumper.castShadow = true;
  group.add(jumper);
}

/** One diagonal X cross-brace (two mirrored thin boxes) at a fixed `heightFrac` of the
 * tower's height — pure structural silhouette, deliberately not capacity-encoding
 * (unlike arm/insulator count). `heightFrac` is always one of
 * `TOWER_DETAIL.braceHeightFracs`' 4 fixed slots, indexed directly rather than
 * recomputed from a live total — so a later tier's addition can never reposition an
 * earlier tier's already-placed brace (same "each tier gets its own row" discipline as
 * Substation's tier-nub system). All 4 slots sit comfortably below the lowest possible
 * arm height across every tier/branch (tier-3 Resilience's second arm sits at
 * `0.24 * height`). */
function addXBrace(group: THREE.Group, material: THREE.Material, height: number, heightFrac: number): void {
  const y = height * heightFrac;
  const dy = TOWER_DETAIL.braceHalfSpan * 2;
  const dx = TOWER_DETAIL.braceHalfWidth * 2;
  const braceLength = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  for (const mirror of [1, -1]) {
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(braceLength, TOWER_DETAIL.braceThickness, TOWER_DETAIL.braceThickness),
      material,
    );
    brace.position.set(0, y, 0);
    brace.rotation.z = mirror * angle;
    brace.castShadow = true;
    group.add(brace);
  }
}

/** Shared low-poly lattice-tower geometry, reused by real towers and the hover ghost.
 * `padMaterial` defaults to `material` (the ghost preview stays a single translucent
 * material, no pad/shaft distinction needed for a hover state) — a real `Tower` passes
 * its own separate, always-neutral concrete-pad material so selection highlighting
 * never touches it (see `Tower`'s own comment on `padMaterial`). */
export function buildTowerVisual(material: THREE.Material, height: number, padMaterial: THREE.Material = material): THREE.Group {
  const group = new THREE.Group();

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.5, height, 6), material);
  shaft.position.y = height / 2;
  group.add(shaft);

  const armUpper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.18), material);
  armUpper.position.y = height * 0.86;
  group.add(armUpper);

  // Insulator strings at the arm tips, where the conductor actually attaches.
  for (const side of [-1, 1]) {
    const insulatorY = height * 0.86 - 0.2;
    const insulator = new THREE.Mesh(insulatorGeo, material);
    insulator.position.set(side * 1.04, insulatorY, 0);
    group.add(insulator);
    addJumper(group, material, side * 1.04, insulatorY);
  }

  const armLower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.14), material);
  armLower.position.y = height * 0.68;
  group.add(armLower);

  // Tier 1's base 2 X-braces (slots 0-1) — later tiers add slots 2-3 via
  // `Tower.addBracingForTier`, never touching these.
  addXBrace(group, material, height, TOWER_DETAIL.braceHeightFracs[0]);
  addXBrace(group, material, height, TOWER_DETAIL.braceHeightFracs[1]);

  // 4 corner footing piers, not one monolithic slab — a real lattice tower sits on
  // separate footings per leg.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const footing = new THREE.Mesh(
        new THREE.BoxGeometry(TOWER_DETAIL.footingSize, TOWER_DETAIL.footingHeight, TOWER_DETAIL.footingSize),
        padMaterial,
      );
      footing.position.set(sx * TOWER_DETAIL.footingOffset, TOWER_DETAIL.footingHeight / 2, sz * TOWER_DETAIL.footingOffset);
      group.add(footing);
    }
  }

  return group;
}

interface ArmSpec {
  heightFrac: number;
  width: number;
  /** Insulator nubs hung under this arm — set to the *capacity gained at this tier
   * step*, so a tower's total visible insulator count always equals its real
   * connection capacity. This is what makes "more lines" an honest readout, not
   * decoration: 2 (tier 1, in buildTowerVisual) + this arm's count + any further
   * arms' counts always sums to `ECONOMY.towerTierCapacity`/the Capacity-branch total. */
  insulatorCount: number;
}

/** Extra cross-arms added lower on the shaft as a tower upgrades, signalling more capacity
 * without moving the top attachment point (which would detach already-strung spans).
 * Only the universal tier 1→2 arm lives here — tier 2→3 branches into two shapes below.
 * Capacity 2→4: +2 insulators. */
const TIER_ARMS: ArmSpec[] = [{ heightFrac: 0.5, width: 1.8, insulatorCount: 2 }];

/** Tier 2→3 arm shape differs by branch — same `BoxGeometry` primitive, geometry-only
 * differentiation (no new colors), same discipline as terrain tints. Capacity reads as
 * one wide arm carrying all 4 newly-gained lines (4→8 capacity); Resilience reads as two
 * stacked arms — only the first carries insulators (4→6 capacity, +2), the second is
 * pure bracing/reinforcement with none, visually distinguishing "more lines" from
 * "sturdier existing lines." */
const TIER3_BRANCH_ARMS: Record<TowerBranch, ArmSpec[]> = {
  capacity: [{ heightFrac: 0.32, width: 2.0, insulatorCount: 4 }],
  resilience: [
    { heightFrac: 0.32, width: 1.4, insulatorCount: 2 },
    { heightFrac: 0.24, width: 1.4, insulatorCount: 0 },
  ],
};

export class Tower {
  readonly group: THREE.Group;
  readonly gridI: number;
  readonly gridJ: number;
  /** World-space attachment point where spans connect. Fixed at construction, never moves. */
  readonly topPos: THREE.Vector3;

  private readonly material: THREE.MeshStandardMaterial;
  /** Separate, always-neutral concrete-footing material — never touched by
   * `setSelected()`/the energized glow, matching real inspection practice (you
   * wouldn't highlight a footing when calling out the structure above it). */
  private readonly padMaterial: THREE.MeshStandardMaterial;
  private readonly basePos: THREE.Vector3;
  private readonly height: number;
  private selected = false;
  private tier = 1;
  private branch: TowerBranch | null = null;
  private connections = 0;

  private readonly spawnTime = performance.now();
  private settled = false;
  private denyStart: number | null = null;
  private upgradePulseStart: number | null = null;
  private permitClearAt: number | null = null;
  private activationPulseStart: number | null = null;
  /** Set by `Game.recomputeNetworkState()` — true iff at least one span connected to
   * this tower is currently energized. Purely a "this thing has power" glow cue, read
   * every `update()` frame; never an independent trigger of its own. */
  private energized = false;

  constructor(gridI: number, gridJ: number, worldPos: THREE.Vector3, height: number, pendingDurationMs = 0) {
    this.gridI = gridI;
    this.gridJ = gridJ;
    this.height = height;
    this.basePos = worldPos.clone();

    this.material = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlue,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      transparent: true,
      opacity: 1,
      roughness: 0.35,
      metalness: 0.65,
    });

    this.padMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlueDim,
      roughness: 0.9,
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });

    this.group = buildTowerVisual(this.material, height, this.padMaterial);
    this.group.position.copy(this.basePos);
    this.group.scale.setScalar(0.001);
    this.group.userData.isTower = true;
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    this.topPos = new THREE.Vector3(worldPos.x, height * 0.86, worldPos.z);

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

  /** Boosts `emissiveIntensity` toward `LOCAL_GLOW.nodeGlowIntensity` while idle
   * (applied every `update()` frame, not written directly here) — routed entirely
   * through the existing bloom pass, deliberately not a new dynamic light. */
  setEnergizedGlow(active: boolean): void {
    this.energized = active;
  }

  getTier(): number {
    return this.tier;
  }

  getBranch(): TowerBranch | null {
    return this.branch;
  }

  canUpgrade(): boolean {
    return this.tier < ECONOMY.towerMaxTier;
  }

  private capacity(): number {
    const base = ECONOMY.towerTierCapacity[this.tier - 1];
    if (this.tier === 3 && this.branch === 'capacity') return base + ECONOMY.tier3CapacityBonus;
    return base;
  }

  hasFreeCapacity(): boolean {
    return this.connections < this.capacity();
  }

  addConnection(): void {
    this.connections++;
  }

  /** `tier` is the tower's tier *before* upgrading (matching `upgrade()`'s call
   * convention) — 1 for the universal tier 1→2 arm, 2 for a branch-specific tier 2→3
   * arm (`branch` required in that case). */
  private addArmForTier(tier: number, branch?: TowerBranch): void {
    if (tier === 1) {
      this.addArm(TIER_ARMS[0]);
      return;
    }
    if (tier === 2 && branch) {
      for (const arm of TIER3_BRANCH_ARMS[branch]) this.addArm(arm);
    }
  }

  /** Adds one cross-arm mesh plus its insulator nubs (if any). New meshes get
   * `castShadow` set explicitly here — the constructor's one-time shadow traversal
   * only covers geometry that exists at construction time, before any tier upgrades. */
  private addArm(arm: ArmSpec): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(arm.width, 0.16, 0.16), this.material);
    mesh.position.y = this.height * arm.heightFrac;
    mesh.castShadow = true;
    this.group.add(mesh);

    const usableWidth = arm.width * 0.85;
    for (let i = 0; i < arm.insulatorCount; i++) {
      const t = arm.insulatorCount === 1 ? 0.5 : i / (arm.insulatorCount - 1);
      const insulatorX = (t - 0.5) * usableWidth;
      const insulatorY = this.height * arm.heightFrac - 0.2;
      const insulator = new THREE.Mesh(insulatorGeo, this.material);
      insulator.position.set(insulatorX, insulatorY, 0);
      insulator.castShadow = true;
      this.group.add(insulator);
      addJumper(this.group, this.material, insulatorX, insulatorY);
    }
  }

  /** Diagonal X cross-bracing gained *reaching* the next tier — `tier` matches
   * `addArmForTier`'s own "current tier before upgrading" convention. Slots 0-1 (tier
   * 1's base 2 braces) are built directly in `buildTowerVisual`, never here. */
  private addBracingForTier(tier: number): void {
    if (tier === 1) {
      addXBrace(this.group, this.material, this.height, TOWER_DETAIL.braceHeightFracs[2]);
      return;
    }
    if (tier === 2) {
      addXBrace(this.group, this.material, this.height, TOWER_DETAIL.braceHeightFracs[3]);
    }
  }

  /** Tier 1→2 is universal (`branch` is ignored). Tier 2→3 requires a branch —
   * Capacity (more connection capacity) or Resilience (this tower's spans become less
   * likely storm targets, see `Game.spanStormWeight`). */
  upgrade(branch?: TowerBranch): void {
    if (!this.canUpgrade()) return;
    this.addArmForTier(this.tier, this.tier === 2 ? branch : undefined);
    this.addBracingForTier(this.tier);
    if (this.tier === 2 && branch) this.branch = branch;
    this.tier++;
    this.upgradePulseStart = performance.now();
  }

  /** Applies saved tier/connection/pending/branch state instantly, skipping spawn and
   * upgrade animations. `branch` is only meaningful (and only applied) at tier 3 —
   * safely ignored for pre-Wave-6 saves that never had one. */
  materializeFromSave(tier: number, connections: number, pendingMs?: number, branch?: TowerBranch): void {
    this.settled = true;
    this.group.scale.setScalar(1);
    for (let t = 1; t < tier; t++) {
      this.addArmForTier(t, t === 2 ? branch : undefined);
      this.addBracingForTier(t);
    }
    this.tier = tier;
    this.branch = tier >= 3 ? (branch ?? null) : null;
    this.connections = connections;
    if (pendingMs && pendingMs > 0) {
      this.permitClearAt = performance.now() + pendingMs;
      this.material.opacity = 0.65;
      this.padMaterial.opacity = 0.65;
    }
  }

  denyFeedback(): void {
    this.denyStart = performance.now();
  }

  isPending(): boolean {
    return this.permitClearAt !== null && performance.now() < this.permitClearAt;
  }

  /** Remaining pending time, or null once the permit has cleared — used for persistence. */
  getPendingRemainingMs(): number | null {
    if (this.permitClearAt === null) return null;
    return Math.max(0, this.permitClearAt - performance.now());
  }

  update(now: number): TowerEvent | null {
    let event: TowerEvent | null = null;

    if (!this.settled) {
      const t = Math.min((now - this.spawnTime) / 280, 1);
      this.group.scale.setScalar(Math.max(0.001, easeOutBack(t)));
      if (t >= 1) {
        this.group.scale.setScalar(1);
        this.settled = true;
      }
    } else if (this.upgradePulseStart !== null) {
      const elapsed = now - this.upgradePulseStart;
      const duration = 320;
      if (elapsed >= duration) {
        this.group.scale.setScalar(1);
        this.upgradePulseStart = null;
      } else {
        const t = elapsed / duration;
        this.group.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.12);
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

    // Energized glow — only once every transient pulse (spawn/upgrade/activation/pending)
    // has settled and selection isn't already claiming the emissive channel, matching
    // the existing "selection wins visually" precedent.
    if (
      this.settled &&
      !this.selected &&
      this.upgradePulseStart === null &&
      this.activationPulseStart === null &&
      this.permitClearAt === null
    ) {
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
