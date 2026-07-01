import { DENY_SHAKE_DURATION_MS } from './constants';

/** Decaying horizontal shake used to signal a denied action (can't afford / at capacity). */
export function denyShakeOffset(elapsedMs: number): number {
  if (elapsedMs >= DENY_SHAKE_DURATION_MS) return 0;
  const t = elapsedMs / DENY_SHAKE_DURATION_MS;
  const decay = 1 - t;
  return Math.sin(t * Math.PI * 6) * 0.18 * decay;
}

/** Overshoot-then-settle easing, shared by every entity's spawn/pop-in animation
 * (Tower, and now PowerPlant/Neighborhood/Substation) so they all share one "just
 * appeared" feel instead of each defining their own copy. */
export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
