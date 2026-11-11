import { groundH } from './citydata';
import { ROAD_Y } from './surface';

export interface RoadPosition { x: number; z: number; y?: number }
/** 車輛／互動點一律使用路面高度；沒有高度的舊呼叫視為地面。 */
export function roadHeight(p: RoadPosition) { return p.y ?? groundH(p.x, p.z) + ROAD_Y; }
export function sameRoadLevel(a: RoadPosition, b: RoadPosition) {
  return Math.abs(roadHeight(a) - roadHeight(b)) <= 2;
}
export function streetRecordKey(id: string, duel: boolean) { return `${duel ? 'duel' : 'solo'}:${id}`; }

/** 沿路線投影後的剩餘道路距離，另加車到路線的距離；ys 是 Router 的節點高度（未含 ROAD_Y）。 */
export function routeRemaining(path: [number, number][], x: number, z: number, ys?: number[] | null, y?: number): number {
  if (!path.length) return 0;
  let best = Infinity, remain = 0, suffix = 0;
  for (let i = path.length - 2; i >= 0; i--) {
    const [a, b] = [path[i], path[i + 1]], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (len * len))) : 0;
    const off = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    const ry = ys ? (ys[i] + (ys[i + 1] - ys[i]) * t) + ROAD_Y : undefined;
    const cost = off * off + (ry != null && y != null ? ((ry - y) * 8) ** 2 : 0);
    if (cost < best) { best = cost; remain = suffix + len * (1 - t) + off; }
    suffix += len;
  }
  return path.length === 1 ? Math.hypot(x - path[0][0], z - path[0][1]) : remain;
}
