import * as THREE from 'three';

const BASE_ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const CAMERA_DISTANCE = 120;
const MIN_ZOOM = 10;
const MAX_ZOOM = 90;
const PAN_BOUND = 80;
/** Fraction of the remaining zoom gap closed per frame — higher is snappier. */
const ZOOM_EASE = 0.18;
const ZOOM_SNAP_EPSILON = 0.02;
/** Same eased-target shape as zoom, applied to camera rotation. */
const ROTATION_EASE = 0.18;
const ROTATION_SNAP_EPSILON = 0.001;

/**
 * Fixed-elevation orthographic isometric camera with right-drag pan,
 * scroll-wheel zoom, and 90°-stepped rotation around the vertical axis —
 * always isometric, just from any of 4 compass corners.
 */
export class IsoCameraRig {
  readonly camera: THREE.OrthographicCamera;
  private readonly target = new THREE.Vector3(0, 0, 0);
  private readonly panRight = new THREE.Vector3();
  private readonly panForward = new THREE.Vector3();
  private zoom = 44;
  private targetZoom = 44;
  private rotationAngle = 0;
  private targetRotationAngle = 0;
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

    this.updatePanBasis();
    this.updateCameraPosition();

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private currentIsoDir(): THREE.Vector3 {
    return BASE_ISO_DIR.clone().applyAxisAngle(UP, this.rotationAngle);
  }

  /** Pan directions are relative to the current screen orientation, so they need
   * recomputing whenever rotation changes — otherwise "drag right" would stop meaning
   * "view moves right" once the camera turns. */
  private updatePanBasis(): void {
    const forward = this.currentIsoDir().negate();
    forward.y = 0;
    forward.normalize();
    this.panForward.copy(forward);
    this.panRight.crossVectors(forward, UP).normalize();
  }

  private updateCameraPosition(): void {
    this.camera.position.copy(this.target).addScaledVector(this.currentIsoDir(), CAMERA_DISTANCE);
    this.camera.lookAt(this.target);
  }

  /** `direction` is +1 or -1 — one 90° step per call, always the same rotational
   * direction per call, so the eased transition never has to pick a "shortest path"
   * across a wraparound. */
  rotate(direction: 1 | -1): void {
    this.targetRotationAngle += direction * (Math.PI / 2);
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

  /** Eases zoom toward its scroll target and rotation toward its Q/E target. Called
   * once per frame; each quantity only touches its dependent state when it actually
   * moves, same as the zoom-only version before it. */
  update(): void {
    const zoomGap = this.targetZoom - this.zoom;
    if (Math.abs(zoomGap) < ZOOM_SNAP_EPSILON) {
      if (this.zoom !== this.targetZoom) {
        this.zoom = this.targetZoom;
        this.applyZoom();
      }
    } else {
      this.zoom += zoomGap * ZOOM_EASE;
      this.applyZoom();
    }

    const rotationGap = this.targetRotationAngle - this.rotationAngle;
    if (Math.abs(rotationGap) < ROTATION_SNAP_EPSILON) {
      if (this.rotationAngle !== this.targetRotationAngle) {
        this.rotationAngle = this.targetRotationAngle;
        this.updatePanBasis();
        this.updateCameraPosition();
      }
    } else {
      this.rotationAngle += rotationGap * ROTATION_EASE;
      this.updatePanBasis();
      this.updateCameraPosition();
    }
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
