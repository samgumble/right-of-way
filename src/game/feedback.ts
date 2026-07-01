import { DENY_SHAKE_DURATION_MS } from './constants';

/** Decaying horizontal shake used to signal a denied action (can't afford / at capacity). */
export function denyShakeOffset(elapsedMs: number): number {
  if (elapsedMs >= DENY_SHAKE_DURATION_MS) return 0;
  const t = elapsedMs / DENY_SHAKE_DURATION_MS;
  const decay = 1 - t;
  return Math.sin(t * Math.PI * 6) * 0.18 * decay;
}
