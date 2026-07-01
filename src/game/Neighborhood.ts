import * as THREE from 'three';
import { COLORS, DENY_SHAKE_DURATION_MS, NEIGHBORHOOD } from './constants';
import { denyShakeOffset, easeOutBack } from './feedback';
import { hash01 } from './Grid';

const HOUSE_COUNT = 4;

function buildHouse(material: THREE.Material, x: number, z: number, scale: number): THREE.Group {
  const house = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * scale, 0.7 * scale, 0.9 * scale), material);
  body.position.set(x, 0.35 * scale, z);
  house.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75 * scale, 0.55 * scale, 4), material);
  roof.position.set(x, 0.7 * scale + 0.275 * scale, z);
  roof.rotation.y = Math.PI / 4;
  house.add(roof);

  return house;
}

/** A small cluster of low-poly houses, jittered via the same deterministic hash `Grid`
 * uses for terrain patches — no randomness, so a Neighborhood's layout is identical
 * every time it's spawned at the same grid coordinates. */
export function buildNeighborhoodVisual(material: THREE.Material, gridI: number, gridJ: number): THREE.Group {
  const group = new THREE.Group();
  for (let n = 0; n < HOUSE_COUNT; n++) {
    const angle = (n / HOUSE_COUNT) * Math.PI * 2 + hash01(gridI, gridJ, n) * 0.6;
    const radius = 1.1 + hash01(gridI, gridJ, n + 10) * 0.5;
    const scale = 0.85 + hash01(gridI, gridJ, n + 20) * 0.3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    group.add(buildHouse(material, x, z, scale));
  }
  return group;
}

export type NeighborhoodEvent = 'blackoutStarted' | 'blackoutCleared';

/** Fault-pulse timing shared with `Span`'s faulted-alarm animation — same visual family
 * ("something is actively wrong"), reused rather than a second independently-tuned
 * pulse shape. */
const BLACKOUT_PULSE_PERIOD = 1100;

/** Game-spawned only — never player-placed. Fixed grid location; `demandMW` grows over
 * time starting Wave 7. */
export class Neighborhood {
  readonly group: THREE.Group;
  readonly gridI: number;
  readonly gridJ: number;
  /** World-space attachment point for its incoming distribution span (Wave 2+). */
  readonly attachPos: THREE.Vector3;
  readonly id: string;

  private readonly material: THREE.MeshStandardMaterial;
  private readonly basePos: THREE.Vector3;
  private selected = false;
  private demandMW: number;
  private readonly spawnTime = performance.now();
  private settled = false;
  private denyStart: number | null = null;
  /** Set by `Game.recomputeNetworkState()` (Wave 3). `served` is economically
   * consequential since Wave 4; `redundant` gates milestone completion (Wave 6) and,
   * combined with `served`, derives `blackedOut` below. */
  private served = false;
  private redundant = false;
  /** Last-known bottleneck capacity reaching this Neighborhood (Wave 3's algorithm
   * output) — cached here so the capacity warning telegraph (Wave 7) can project
   * against it every tick without re-running the graph algorithm. */
  private bottleneckMW = 0;
  /** Dedup token for the capacity warning, mirroring `Game`'s `lastStormWarningFor`
   * pattern but scoped per-Neighborhood: fires once per approach, resets once no longer
   * approaching so it can fire again on a later approach. */
  private warnedForCapacity = false;
  /** Worse than a per-span fault (decision #6) — but purely *derived*, never an
   * independent trigger: only ever flips inside `setNetworkState`, in response to a
   * real network-state transition, never on a timer or its own random roll. This is
   * what keeps the storm softlock-prevention invariant intact — blackout adds no new
   * strike mechanism, just a classification of an existing strike's consequences. */
  private blackedOut = false;

  constructor(gridI: number, gridJ: number, worldPos: THREE.Vector3, demandMW: number = NEIGHBORHOOD.startingDemandMW) {
    this.gridI = gridI;
    this.gridJ = gridJ;
    this.demandMW = demandMW;
    this.id = `neighborhood-${gridI}-${gridJ}`;
    this.basePos = worldPos.clone();

    this.material = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlueDim,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.6,
      metalness: 0.15,
    });

    this.group = buildNeighborhoodVisual(this.material, gridI, gridJ);
    this.group.position.copy(this.basePos);
    this.group.scale.setScalar(0.001);
    this.group.userData.isNeighborhood = true;
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    this.attachPos = new THREE.Vector3(worldPos.x, 0.5, worldPos.z - 1.3);
  }

  currentDemandMW(): number {
    return this.demandMW;
  }

  /** Blackout triggers the instant a previously-served, at-risk (non-redundant)
   * Neighborhood becomes not-served — reads `this.redundant`/`this.served` (the *old*
   * values) before they're overwritten below, matching "at risk *before* the triggering
   * change." Clears the instant a blacked-out Neighborhood becomes served again — no
   * timer, no auto-heal, matching the existing player-triggered-repair philosophy. */
  setNetworkState(served: boolean, redundant: boolean, bottleneckMW: number): NeighborhoodEvent | null {
    let event: NeighborhoodEvent | null = null;
    if (this.served && !this.redundant && !served) {
      this.blackedOut = true;
      event = 'blackoutStarted';
    } else if (this.blackedOut && served) {
      this.blackedOut = false;
      event = 'blackoutCleared';
    }
    this.served = served;
    this.redundant = redundant;
    this.bottleneckMW = bottleneckMW;
    return event;
  }

  isServed(): boolean {
    return this.served;
  }

  isRedundant(): boolean {
    return this.redundant;
  }

  isBlackedOut(): boolean {
    return this.blackedOut;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    if (selected) {
      this.material.emissive.set(COLORS.safetyOrange);
      this.material.emissiveIntensity = 0.5;
    }
    // Deselecting: no direct material write here — the next `update()` call (every
    // frame) restores the correct served/blackout look, same precedent as Tower's
    // activation-pulse-vs-selection interaction.
  }

  isSelected(): boolean {
    return this.selected;
  }

  /** Used when a distribution-span connect attempt targeting this Neighborhood is
   * denied (already connected, unaffordable) — same shake language every other denial
   * in the game already uses. */
  denyFeedback(): void {
    this.denyStart = performance.now();
  }

  /** True if `demandMW` is projected to exceed the last-known bottleneck within
   * `leadSec`, given its own linear growth rate. An already-not-served Neighborhood
   * doesn't need a warning — that problem has already happened, this is for catching it
   * *before* it does. */
  private isApproachingCapacity(leadSec: number): boolean {
    if (this.demandMW > this.bottleneckMW) return false;
    const projectedDemand = this.demandMW + NEIGHBORHOOD.demandGrowthMWPerSec * leadSec;
    return projectedDemand > this.bottleneckMW;
  }

  /** Checked every tick by `Game` — returns true exactly once per approach (not every
   * frame while still approaching), resetting once the Neighborhood is no longer
   * approaching so a later approach can fire again. */
  checkCapacityWarning(leadSec: number): boolean {
    const approaching = this.isApproachingCapacity(leadSec);
    if (approaching && !this.warnedForCapacity) {
      this.warnedForCapacity = true;
      return true;
    }
    if (!approaching) this.warnedForCapacity = false;
    return false;
  }

  /** Live "is the warning currently active" query for the HUD — distinct from
   * `checkCapacityWarning`'s one-shot "just started" signal, this stays true for the
   * whole approach window, not just the instant it began. Reflects whatever
   * `checkCapacityWarning` last computed this tick. */
  isCapacityWarningActive(): boolean {
    return this.warnedForCapacity;
  }

  update(now: number, dt: number): void {
    this.demandMW = Math.min(this.demandMW + NEIGHBORHOOD.demandGrowthMWPerSec * dt, NEIGHBORHOOD.demandGrowthCapMW);

    if (!this.settled) {
      const t = Math.min((now - this.spawnTime) / 280, 1);
      this.group.scale.setScalar(Math.max(0.001, easeOutBack(t)));
      if (t >= 1) {
        this.group.scale.setScalar(1);
        this.settled = true;
      }
    }

    // Selection (orange) wins visually over served/blackout state, same precedent as
    // Tower's activation-pulse-vs-selection interaction.
    if (!this.selected) {
      if (this.blackedOut) {
        const cycle = (now % BLACKOUT_PULSE_PERIOD) / BLACKOUT_PULSE_PERIOD;
        this.material.color.set(COLORS.faultRed);
        this.material.emissive.set(COLORS.faultRed);
        this.material.emissiveIntensity = 0.35 + (0.5 + 0.5 * Math.sin(cycle * Math.PI * 2)) * 0.55;
      } else if (this.served) {
        this.material.color.set(COLORS.steelBlueDim);
        this.material.emissive.set(COLORS.keyLight);
        this.material.emissiveIntensity = 0.35;
      } else {
        this.material.color.set(COLORS.steelBlueDim);
        this.material.emissive.set(0x000000);
        this.material.emissiveIntensity = 0;
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
