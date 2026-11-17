import type { Ghost } from './save';

/** 保留整圈首尾與實際時間；逐次減半只降低錄製解析度，不裁掉時間軸。 */
export const GHOST_POINT_LIMIT = 8192;
export const REPLAY_FRAME_LIMIT = 12000;
export const officialLapTime = (time: number) => Number.isFinite(time) && time >= 10 && time <= 3600;
export function appendGhostPoint(g: Ghost, point: { t: number; s: number; x: number; z: number; h: number }, capacity = GHOST_POINT_LIMIT) {
  const last = g.t.at(-1);
  if (![point.t, point.s, point.x, point.z, point.h].every(Number.isFinite) || (last !== undefined && point.t <= last)) return false;
  for (const key of ['t', 's', 'x', 'z', 'h'] as const) g[key].push(point[key]);
  if (g.t.length > Math.max(4, capacity)) {
    const end = g.t.length - 1;
    for (const key of ['t', 's', 'x', 'z', 'h'] as const) g[key] = g[key].filter((_, i) => i % 2 === 0 || i === end);
  }
  return true;
}
export function recordingBracket(times: readonly number[], time: number): { a: number; b: number; f: number } {
  if (!times.length || !Number.isFinite(time) || time <= times[0]) return { a: 0, b: 0, f: 0 };
  let a = 0, b = times.length - 1;
  if (time >= times[b]) return { a: b, b, f: 0 };
  while (b - a > 1) { const m = (a + b) >> 1; if (times[m] <= time) a = m; else b = m; }
  return { a, b, f: (time - times[a]) / Math.max(1e-9, times[b] - times[a]) };
}
