export type NetworkFeel = 'balanced' | 'responsive' | 'stable';
export const NETWORK_FEEL_KEY = 'taipei-gp-expedition-network-v1';
export const networkFeel = (v: unknown): NetworkFeel => v === 'responsive' || v === 'stable' ? v : 'balanced';
export const NETWORK_FEELS = { balanced: '平衡', responsive: '反應優先', stable: '平順優先' } as const;

/** Presentation only. Authority and velocity impulses are never interpolated away. */
export function reconciliationOffset(x: number, z: number, contact: boolean, reset: boolean) {
  const distance = Math.hypot(x, z);
  if (reset || !Number.isFinite(distance) || distance > (contact ? 3 : 20)) return { x: 0, z: 0, rate: 24 };
  const limit = contact ? .65 : 5, scale = distance > limit ? limit / distance : 1;
  return { x: x * scale, z: z * scale, rate: contact ? 30 : 14 + Math.min(10, distance * 2) };
}

/** Extrapolate at most 70ms after the newest snapshot, without changing it. */
export function remotePresentation<T extends { x: number; z: number; h: number; v: number }>(a: T, b: T, atA: number, atB: number, target: number, allowed: boolean): T {
  // Hold the capped pose through a long outage; returning to b after a timeout
  // would move the rendered car backwards even when no new authority arrived.
  if (!allowed || ![atA,atB,target].every(Number.isFinite) || target <= atB || atB - atA < 10 || atB - atA > 200) return { ...b };
  const seconds = Math.min(70, target - atB) / 1000, dt = (atB - atA) / 1000;
  const vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt, speed = Math.hypot(vx, vz);
  if (![vx, vz, speed, b.v].every(Number.isFinite) || speed > Math.min(160, Math.abs(b.v) + 12)) return { ...b };
  return { ...b, x: b.x + vx * seconds, z: b.z + vz * seconds };
}
