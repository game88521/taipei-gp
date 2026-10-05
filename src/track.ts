import * as THREE from 'three';
import trackData from './data/track.json' with { type: 'json' };
/** city.json 解壓縮後的位元組數（載入進度條用） */
export const CITY_SIZE: number = (trackData as { citySize?: number }).citySize ?? 5.5e6;

// 車子性能與「建議速度曲線」共用同一組數字，輔助線才會跟手感一致
export const VMAX = 84; // m/s ≈ 302 km/h
export const ENGINE = 14; // 低速時的加速度 m/s²
export const BRAKE = 38; // 煞車減速度 m/s²
export const HALF_WIDTH = 7; // 路面半寬 (m)
export const WALL_OFF = 9.5; // 護牆到中心線的距離 (m)

/** 下壓力：越快抓地力越大（m/s² 的橫向加速度上限） */
export function gripAt(v: number): number {
  return Math.min(50, 20 + 0.004 * v * v);
}

// 真實台北街道：由 tools/build-city.mjs 從 OpenStreetMap 產生（x 向東、z 向南，單位公尺）
// 順時針：信義路往西 → 基隆路往北 → 忠孝東路往東 → 松仁路往南，起跑線在 101 前的信義路上
const CONTROL = trackData.points as [number, number][];

export const TOWER_101 = { x: trackData.tower101[0], z: trackData.tower101[1] };

export interface Track {
  N: number;
  length: number;
  ds: number;
  px: Float32Array; // 中心線
  pz: Float32Array;
  tx: Float32Array; // 單位切線（前進方向）
  tz: Float32Array;
  dist: Float32Array; // 從起跑線算起的距離
  curv: Float32Array; // 帶正負號的曲率，正 = 右彎
  vTarget: Float32Array; // 建議速度 (m/s)
}

export function buildTrack(): Track {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  const length = curve.getLength();
  const N = Math.round(length / 2);
  const ds = length / N;
  const pts = curve.getSpacedPoints(N);

  const px = new Float32Array(N), pz = new Float32Array(N);
  const tx = new Float32Array(N), tz = new Float32Array(N);
  const dist = new Float32Array(N), curv = new Float32Array(N), vTarget = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = pts[i].x;
    pz[i] = pts[i].z;
    dist[i] = i * ds;
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    raw[i] = (tx[a] * tz[b] - tz[a] * tx[b]) / (2 * ds);
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += raw[(i + k + N) % N];
    curv[i] = s / 9;
  }

  // 建議速度：先算每一點的過彎極速（留 8% 餘裕），再往回推煞車點、往前推出彎加速
  const G0 = 20 * 0.92, GK = 0.004 * 0.92;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(curv[i]);
    vTarget[i] = k > GK + 1e-5 ? Math.min(VMAX, Math.sqrt(G0 / (k - GK))) : VMAX;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      vTarget[i] = Math.min(vTarget[i], Math.sqrt(vTarget[j] ** 2 + 2 * 30 * ds));
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i - 1 + N) % N;
      vTarget[i] = Math.min(vTarget[i], Math.sqrt(vTarget[j] ** 2 + 2 * 11 * ds));
    }
  }

  return { N, length, ds, px, pz, tx, tz, dist, curv, vTarget };
}

export interface Locate {
  i: number; // 最近的取樣點
  lat: number; // 橫向偏移，正 = 偏右
  s: number; // 圈內距離 [0, length)
}

/** 找車子在賽道上的位置；平常只搜尋上一點附近，偏太遠才全圈搜尋 */
export function locate(t: Track, x: number, z: number, out: Locate): Locate {
  let best = out.i, bd = Infinity;
  for (let k = -40; k <= 40; k++) {
    const i = (out.i + k + t.N) % t.N;
    const d = (x - t.px[i]) ** 2 + (z - t.pz[i]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (bd > 400) {
    for (let i = 0; i < t.N; i++) {
      const d = (x - t.px[i]) ** 2 + (z - t.pz[i]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  const dx = x - t.px[best], dz = z - t.pz[best];
  out.i = best;
  out.lat = dx * -t.tz[best] + dz * t.tx[best];
  let s = t.dist[best] + dx * t.tx[best] + dz * t.tz[best];
  if (s < 0) s += t.length;
  if (s >= t.length) s -= t.length;
  out.s = s;
  return out;
}
