import * as THREE from 'three';
import { computeCatenaryPoints } from './catenary';
import { COLORS } from './constants';

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

type Phase = 'stringing' | 'energizing' | 'energized' | 'faulted';
export type SpanEvent = 'energized' | 'repaired';

const STRING_DURATION = 420;
const ENERGIZE_DURATION = 650;
const STRIKE_FLASH_DURATION = 220;
const FAULT_PULSE_PERIOD = 1100;
const TUBE_RADIUS = 0.09;
/** Wider invisible tube layered over the visible one, purely to make a thin 3D line clickable. */
const HIT_RADIUS = 0.7;

/** A catenary conductor between two tower tops that strings itself in, then energizes.
 * Can later be struck by a storm (faulted) and clicked to repair. */
export class Span {
  readonly group: THREE.Group;

  private readonly points: THREE.Vector3[];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly pulse: THREE.Mesh;
  private readonly pulseMaterial: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh | null = null;

  private phase: Phase = 'stringing';
  private phaseStart = performance.now();
  private energizeStartColor = new THREE.Color(COLORS.steelBlue);
  private faultStart = 0;
  private strikeFlashStart: number | null = null;
  private repairing = false;

  constructor(p1: THREE.Vector3, p2: THREE.Vector3) {
    this.group = new THREE.Group();
    this.group.userData.isSpan = true;
    this.points = computeCatenaryPoints(p1, p2);

    this.material = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlue,
      emissive: new THREE.Color(COLORS.steelBlue),
      emissiveIntensity: 0.05,
      roughness: 0.45,
      metalness: 0.35,
    });

    this.pulseMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.energizedGreen,
      transparent: true,
      opacity: 0,
    });
    this.pulse = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), this.pulseMaterial);
    this.group.add(this.pulse);

    const hitCurve = new THREE.CatmullRomCurve3(this.points);
    const hitGeo = new THREE.TubeGeometry(hitCurve, Math.max(1, this.points.length - 1), HIT_RADIUS, 6, false);
    const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.group.add(hitMesh);

    this.rebuildGeometry(2 / this.points.length);
  }

  private rebuildGeometry(revealFraction: number): void {
    const count = Math.max(2, Math.round(this.points.length * revealFraction));
    const slice = this.points.slice(0, count);

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    const curve = new THREE.CatmullRomCurve3(slice);
    const geo = new THREE.TubeGeometry(curve, Math.max(1, count - 1), TUBE_RADIUS, 6, false);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.group.add(this.mesh);
  }

  update(now: number): SpanEvent | null {
    if (this.phase === 'stringing') {
      const t = Math.min((now - this.phaseStart) / STRING_DURATION, 1);
      this.rebuildGeometry(easeOutCubic(t));
      if (t >= 1) {
        this.phase = 'energizing';
        this.phaseStart = now;
        this.energizeStartColor = new THREE.Color(COLORS.steelBlue);
      }
      return null;
    }

    if (this.phase === 'energizing') {
      const t = Math.min((now - this.phaseStart) / ENERGIZE_DURATION, 1);
      const color = this.energizeStartColor.clone().lerp(new THREE.Color(COLORS.energizedGreen), t);
      this.material.color.copy(color);
      this.material.emissive.copy(color);
      this.material.emissiveIntensity = 0.05 + t * 0.95;

      const idx = Math.min(this.points.length - 1, Math.floor(t * (this.points.length - 1)));
      this.pulse.position.copy(this.points[idx]);
      this.pulseMaterial.opacity = Math.sin(Math.min(t, 1) * Math.PI);

      if (t >= 1) {
        this.phase = 'energized';
        this.pulseMaterial.opacity = 0;
        const wasRepairing = this.repairing;
        this.repairing = false;
        return wasRepairing ? 'repaired' : 'energized';
      }
      return null;
    }

    if (this.phase === 'faulted') {
      const cycle = ((now - this.faultStart) % FAULT_PULSE_PERIOD) / FAULT_PULSE_PERIOD;
      let intensity = 0.35 + (0.5 + 0.5 * Math.sin(cycle * Math.PI * 2)) * 0.55;

      if (this.strikeFlashStart !== null) {
        const elapsed = now - this.strikeFlashStart;
        if (elapsed < STRIKE_FLASH_DURATION) {
          intensity += (1 - elapsed / STRIKE_FLASH_DURATION) * 2.5;
        } else {
          this.strikeFlashStart = null;
        }
      }
      this.material.emissiveIntensity = intensity;
    }

    return null;
  }

  /** World-space midpoint along the catenary — for effects that need one anchor point
   * without exposing the full points array (e.g. fault-spark placement). */
  midpoint(): THREE.Vector3 {
    return this.points[Math.floor(this.points.length / 2)].clone();
  }

  isEnergized(): boolean {
    return this.phase === 'energized';
  }

  isFaulted(): boolean {
    return this.phase === 'faulted';
  }

  /** A storm strikes this span: goes fault-red and stops counting toward income until repaired. */
  fault(): void {
    if (this.phase !== 'energized') return;
    this.phase = 'faulted';
    this.faultStart = performance.now();
    this.strikeFlashStart = this.faultStart;
    const red = new THREE.Color(COLORS.faultRed);
    this.material.color.copy(red);
    this.material.emissive.copy(red);
  }

  /** Re-energizes a faulted span, lerping from its current fault-red back to energized-green. */
  repair(): void {
    if (this.phase !== 'faulted') return;
    this.energizeStartColor = this.material.color.clone();
    this.phase = 'energizing';
    this.phaseStart = performance.now();
    this.repairing = true;
  }

  /** Skips the stringing/energizing animations and jumps straight to steady-state, for restored saves. */
  materializeEnergized(): void {
    this.phase = 'energized';
    this.rebuildGeometry(1);
    const color = new THREE.Color(COLORS.energizedGreen);
    this.material.color.copy(color);
    this.material.emissive.copy(color);
    this.material.emissiveIntensity = 1;
    this.pulseMaterial.opacity = 0;
  }
}
