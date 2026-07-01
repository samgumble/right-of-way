import * as THREE from 'three';

const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
const CAMERA_DISTANCE = 120;
const MIN_ZOOM = 10;
const MAX_ZOOM = 90;
const PAN_BOUND = 80;
/** Fraction of the remaining zoom gap closed per frame — higher is snappier. */
const ZOOM_EASE = 0.18;
const ZOOM_SNAP_EPSILON = 0.02;

/**
 * Fixed-angle orthographic isometric camera with right-drag pan and
 * scroll-wheel zoom. Never rotates, matching the diorama/blueprint framing.
 */
export class IsoCameraRig {
  readonly camera: THREE.OrthographicCamera;
  private readonly target = new THREE.Vector3(0, 0, 0);
  private readonly panRight: THREE.Vector3;
  private readonly panForward: THREE.Vector3;
  private zoom = 44;
  private targetZoom = 44;
  private isPanning = false;
  private lastX = 0;
  private lastY = 0;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    const aspect = el.clientWidth / el.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -this.zoom * aspect,
      this.zoom * aspect,
      this.zoom,
      -this.zoom,
      0.1,
      500,
    );

    const forward = ISO_DIR.clone().negate();
    forward.y = 0;
    forward.normalize();
    this.panForward = forward;
    this.panRight = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    this.updateCameraPosition();

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private updateCameraPosition(): void {
    this.camera.position.copy(this.target).addScaledVector(ISO_DIR, CAMERA_DISTANCE);
    this.camera.lookAt(this.target);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 2) return;
    this.isPanning = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPanning) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    const worldPerPixel = (this.zoom * 2) / this.el.clientHeight;
    this.target
      .addScaledVector(this.panRight, -dx * worldPerPixel)
      .addScaledVector(this.panForward, dy * worldPerPixel);
    this.target.x = THREE.MathUtils.clamp(this.target.x, -PAN_BOUND, PAN_BOUND);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -PAN_BOUND, PAN_BOUND);

    this.updateCameraPosition();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 2) this.isPanning = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.targetZoom = THREE.MathUtils.clamp(this.targetZoom + e.deltaY * 0.04, MIN_ZOOM, MAX_ZOOM);
  };

  private applyZoom(): void {
    const aspect = this.el.clientWidth / this.el.clientHeight;
    this.camera.left = -this.zoom * aspect;
    this.camera.right = this.zoom * aspect;
    this.camera.top = this.zoom;
    this.camera.bottom = -this.zoom;
    this.camera.updateProjectionMatrix();
  }

  /** Eases the current zoom toward the scroll target. Called once per frame. */
  update(): void {
    const gap = this.targetZoom - this.zoom;
    if (Math.abs(gap) < ZOOM_SNAP_EPSILON) {
      if (this.zoom !== this.targetZoom) {
        this.zoom = this.targetZoom;
        this.applyZoom();
      }
      return;
    }
    this.zoom += gap * ZOOM_EASE;
    this.applyZoom();
  }

  onResize(): void {
    this.applyZoom();
  }

  getView(): { x: number; z: number; zoom: number } {
    return { x: this.target.x, z: this.target.z, zoom: this.zoom };
  }

  setView(x: number, z: number, zoom: number): void {
    this.target.x = THREE.MathUtils.clamp(x, -PAN_BOUND, PAN_BOUND);
    this.target.z = THREE.MathUtils.clamp(z, -PAN_BOUND, PAN_BOUND);
    this.zoom = THREE.MathUtils.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = this.zoom;
    this.updateCameraPosition();
    this.applyZoom();
  }
}
