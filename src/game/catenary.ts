import * as THREE from 'three';

/**
 * Solves a * (cosh(halfSpan / a) - 1) = sag for `a` via Newton's method.
 * `a` is the catenary parameter (horizontal tension / weight per unit length).
 */
function solveCatenaryParameter(halfSpan: number, sag: number): number {
  if (halfSpan <= 0 || sag <= 0) return Infinity;

  // Parabolic approximation (sag ~= halfSpan^2 / (2a)) as the initial guess.
  let a = (halfSpan * halfSpan) / (2 * sag);

  for (let i = 0; i < 24; i++) {
    const x = halfSpan / a;
    const f = a * (Math.cosh(x) - 1) - sag;
    const df = Math.cosh(x) - 1 - x * Math.sinh(x);
    const next = a - f / df;
    if (!Number.isFinite(next) || next <= 0) break;
    if (Math.abs(next - a) < 1e-5) {
      a = next;
      break;
    }
    a = next;
  }

  return a;
}

/**
 * Builds points along a catenary curve strung between two tower-top points.
 * Sag scales with span length so short spans don't look over-slack.
 */
export function computeCatenaryPoints(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  sagRatio = 0.12,
  segments = 40,
): THREE.Vector3[] {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const dy = p2.y - p1.y;
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);
  const halfSpan = horizontalDist / 2;
  const sag = Math.max(horizontalDist * sagRatio, 0.05);
  const a = solveCatenaryParameter(halfSpan, sag);

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const s = -halfSpan + t * horizontalDist;
    const sagY = Number.isFinite(a) ? a * (Math.cosh(s / a) - Math.cosh(halfSpan / a)) : 0;
    points.push(
      new THREE.Vector3(p1.x + dx * t, p1.y + dy * t + sagY, p1.z + dz * t),
    );
  }
  return points;
}
