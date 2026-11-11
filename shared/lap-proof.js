import manifest from './taipei-track.json' with { type: 'json' };

export const RECORD_VERSION = 1;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isBoard = (b) => b?.track === 'taipei' && (b.rules === 'classic' || b.rules === '2026') && b.version === RECORD_VERSION;
export const boardKey = (b) => `taipei-gp:tt:v3:${b.track}:${b.rules}:${b.version}`;
export const trackManifest = manifest;

/** 寬鬆的軌跡合理性檢查。無法證明軌跡確由遊戲產生，不是權威反作弊。 */
export function validateLapProof(proof, time, rules) {
  const fail = (reason) => ({ ok: false, reason });
  if (!proof || proof.v !== 1 || proof.trackStamp !== manifest.stamp || !Array.isArray(proof.samples)) return fail('schema');
  const points = proof.samples, n = points.length;
  if (n < 201 || n > 6500) return fail('samples');
  if (points.some((p) => !Array.isArray(p) || p.length !== 4 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) return fail('numbers');
  const first = points[0], last = points[n - 1], length = manifest.length;
  if (Math.abs(first[0]) > 0.001 || Math.abs(last[0] - time) > 0.003) return fail('endpoints-time');
  if (first[1] < -2 || first[1] > 20 || last[1] < length || last[1] > length + 20 || last[1] - first[1] < length - 20) return fail('incomplete-lap');
  const maxSpeed = rules === '2026' ? 115 : 105;
  for (let i = 0; i < n; i++) {
    const [t, s, x, z] = points[i];
    if (t < 0 || t > time + 0.003 || s < -2 || s > length + 20) return fail('range');
    const f = (((s / manifest.ds) % manifest.points.length) + manifest.points.length) % manifest.points.length;
    const k = Math.floor(f), a = manifest.points[k], b = manifest.points[(k + 1) % manifest.points.length];
    if (Math.hypot(x - a[0] - (b[0] - a[0]) * (f - k), z - a[1] - (b[1] - a[1]) * (f - k)) > manifest.maxOffset) return fail('path');
    if (i) {
      const prev = points[i - 1], dt = t - prev[0], ds = s - prev[1];
      if (dt <= 0 || dt > 0.201) return fail('time-gap');
      if (Math.abs(ds) > maxSpeed * dt + 3 || Math.hypot(x - prev[2], z - prev[3]) > maxSpeed * dt + 0.6) return fail('speed');
    }
  }
  return { ok: true };
}
