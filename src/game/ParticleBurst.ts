import * as THREE from 'three';
import { PARTICLE_BURST } from './constants';

export type BurstStyle = keyof typeof PARTICLE_BURST;

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const identityQuat = new THREE.Quaternion();

/** Short one-shot particle pop — placement dust or fault sparks. One instance per
 * burst event, added to the scene, ticked until its duration elapses, then discarded.
 * Same "own small file, pure enough to test in isolation" precedent as feedback.ts. */
export class ParticleBurst {
  readonly group: THREE.Group;

  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly velocities: THREE.Vector3[] = [];
  private readonly startTime: number;
  private readonly durationMs: number;

  constructor(origin: THREE.Vector3, style: BurstStyle, now: number) {
    const cfg = PARTICLE_BURST[style];
    this.startTime = now;
    this.durationMs = cfg.durationMs;

    this.material = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: 1,
    });
    const geo = new THREE.BoxGeometry(cfg.size, cfg.size, cfg.size);
    this.mesh = new THREE.InstancedMesh(geo, this.material, cfg.count);

    this.group = new THREE.Group();
    this.group.position.copy(origin);
    this.group.add(this.mesh);

    for (let i = 0; i < cfg.count; i++) {
      const theta = (i / cfg.count) * Math.PI * 2 + Math.random() * 0.6;
      const phi = Math.random() * Math.PI * 0.45; // biased toward "up", not a full sphere
      const dir = new THREE.Vector3(
        Math.cos(theta) * Math.sin(phi),
        Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
      );
      this.velocities.push(dir.multiplyScalar(cfg.speed * (0.6 + Math.random() * 0.4)));
      this.mesh.setMatrixAt(i, scratchMatrix.identity());
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Returns false once the burst has finished — caller removes/disposes it then. */
  update(now: number): boolean {
    const t = (now - this.startTime) / this.durationMs;
    if (t >= 1) return false;

    const scale = 1 - t;
    scratchScale.setScalar(scale);
    for (let i = 0; i < this.velocities.length; i++) {
      scratchPos.copy(this.velocities[i]).multiplyScalar(t);
      scratchPos.y -= 2.2 * t * t; // slight gravity arc
      scratchMatrix.compose(scratchPos, identityQuat, scratchScale);
      this.mesh.setMatrixAt(i, scratchMatrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.opacity = 1 - t;
    return true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
