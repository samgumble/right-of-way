import * as THREE from 'three';

/** Shared insulator-string geometry, reused by every entity that hangs conductors
 * (Tower's cross-arms, Substation's transmission side) — one shape, so "insulator count
 * = real connection capacity" reads as a single consistent visual language across
 * entity types rather than two independently-tuned shapes that could drift apart. */
export const insulatorGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.34, 5);
