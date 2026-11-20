/** Explicit safe-v1 policy. Legacy races never call these helpers. Distances are metres. */
export type AiPolicy = 'legacy' | 'safe-v1';
export interface AiTraffic { s: number; lat: number; v: number; x: number; z: number }
export function signedGap(a: number, b: number, length: number) { return ((a - b + length * 1.5) % length) - length / 2; }
export function canRejoin(target: AiTraffic, others: readonly AiTraffic[], length: number): boolean {
  return others.every(o => {
    const d = signedGap(o.s, target.s, length);
    // Check the complete approach corridor, including a fast car that crosses it between frames.
    if (Math.abs(o.lat - target.lat) < 2.8 && d > -(10 + o.v * 1.5) && d < 14) return false;
    return Math.hypot(o.x - target.x, o.z - target.z) >= 7;
  });
}
export function safeLane(current: number, desired: number, speed: number, others: readonly AiTraffic[], s: number, length: number, edge: number, dt: number) {
  let target = Math.max(-edge, Math.min(edge, desired)), brake = false, constrained = false;
  for (const o of others) {
    const d = signedGap(o.s, s, length);
    if (Math.abs(d) > 8 + Math.abs(o.v - speed) * .6) continue;
    // Keep the occupied side until the whole car has cleared; no defensive chop across an overlap.
    const side = current <= o.lat ? -1 : 1, limit = o.lat + side * 2.8;
    if (side < 0 && target > limit) { target = Math.min(target, limit); constrained = true; }
    if (side > 0 && target < limit) { target = Math.max(target, limit); constrained = true; }
    if (Math.abs(current - o.lat) < 2.5 && d > 0 && d < 10 + speed * .25) brake = true;
  }
  if (target < -edge || target > edge) brake = true;
  target = Math.max(-edge, Math.min(edge, target));
  // Preserve the original formula when no nearby car constrains the manoeuvre.
  if (constrained) target = current + Math.max(-1.8 * dt, Math.min(1.8 * dt, target - current));
  return { target, brake, constrained };
}
