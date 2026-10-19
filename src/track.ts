import * as THREE from 'three';
import trackData from './data/track.json' with { type: 'json' };
/** city.json 解壓縮後的位元組數（載入進度條用） */
export const CITY_SIZE: number = (trackData as { citySize?: number }).citySize ?? 5.5e6;

// 車子性能與「建議速度曲線」共用同一組數字，輔助線才會跟手感一致
// 台北街道賽是原本的手感；各國賽道（setRealPerf）比較接近真實 F1：極速、下壓力、煞車都更強
export let VMAX = 84; // m/s ≈ 302 km/h
export let ENGINE = 14; // 低速時的加速度 m/s²
export let BRAKE = 38; // 煞車減速度 m/s²
export let GRIP0 = 20, GRIPK = 0.004, GRIPMAX = 50; // 橫向抓地力 = GRIP0 + GRIPK × v²（上限 GRIPMAX）
export const HALF_WIDTH = 7; // 路面半寬 (m)
export const WALL_OFF = 9.5; // 護牆到中心線的距離 (m)

/** 下壓力：越快抓地力越大（m/s² 的橫向加速度上限） */
export function gripAt(v: number): number {
  return Math.min(GRIPMAX, GRIP0 + GRIPK * v * v);
}
/** 各國賽道：接近真實 F1 的性能（要在 buildTrack 之前呼叫，建議速度曲線才會用同一組） */
export function setRealPerf(p: { vmax: number; engine: number; brake: number; g0: number; gk: number; gmax: number }) {
  ({ vmax: VMAX, engine: ENGINE, brake: BRAKE, g0: GRIP0, gk: GRIPK, gmax: GRIPMAX } = p);
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
  py: Float32Array; // 路面高度（各國賽道有高低起伏；台北全是 0）
  grade: Float32Array; // 坡度（每公尺升高幾公尺，上坡正）
  bank: Float32Array; // 傾斜彎：路面橫向每公尺升高幾公尺（橫向正 = 右邊；外側比較高），0 = 平的
  bankGrip: Float32Array; // 傾斜彎的抓地力倍率（平的 = 1）
  gap: Float32Array; // 到賽道上「別的路段」（前後 200 m 以外）中心線的最近距離（m）；折返、發夾彎旁邊的路肩、碎石區要收窄用
}

/** 傾斜彎：at = 彎心在一圈的幾成處（0~1）、deg = 傾斜角度、len = 傾斜的長度（公尺，前後各有 30 m 漸變） */
export interface Bank { at: number; deg: number; len: number }

/** 第 i 點、橫向 lat 處的路面高度：只有路面（±HALF_WIDTH）傾斜，路面外維持路緣的高度 */
export function surfaceY(t: Track, i: number, lat: number): number {
  return t.py[i] + Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, lat)) * t.bank[i];
}
/** 車子在傾斜路面上的側傾角（模型的 rotation.z；模型 +x 是車子左邊） */
export function bankRoll(t: Track, i: number, lat: number): number {
  return Math.abs(lat) <= HALF_WIDTH ? Math.atan(-t.bank[i]) : 0;
}

/** 賽道上 s 處的路面高度（線性內插） */
export function heightAt(t: Track, s: number): number {
  const f = (((s / t.ds) % t.N) + t.N) % t.N, i = Math.floor(f), j = (i + 1) % t.N;
  return t.py[i] + (t.py[j] - t.py[i]) * (f - i);
}

/** points：各國賽道的中心線（circuits.ts）；不給就是台北信義街道賽。elev：每個 points 的高度（相對起跑線）；banks：傾斜彎 */
export function buildTrack(points: [number, number][] = CONTROL, elev?: number[], banks: Bank[] = []): Track {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
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

  // 傾斜彎：彎心前後 len/2 全傾斜、再往外 30 m 漸變回平的；外側（彎的反方向）比較高。
  // 抓地力加成 1 + 0.9·sinθ（19° 約多三成；真實的公式在 F1 這麼大的下壓力下會算出不合理的數字，取保守的經驗值）
  const bank = new Float32Array(N), bankGrip = new Float32Array(N).fill(1);
  for (const b of banks) {
    const c = Math.round(b.at * N) % N, half = b.len / 2 / ds, ramp = 30 / ds;
    const sg = Math.sign(curv[c]) || 1, tan = Math.tan((b.deg * Math.PI) / 180), sin = Math.sin((b.deg * Math.PI) / 180);
    for (let k = -Math.ceil(half + ramp); k <= Math.ceil(half + ramp); k++) {
      const i = (c + k + N) % N, d = Math.abs(k);
      const w = d <= half ? 1 : 0.5 + 0.5 * Math.cos(((d - half) / ramp) * Math.PI); // 漸變
      bank[i] = -sg * tan * w;
      bankGrip[i] = 1 + 0.9 * sin * w;
    }
  }
  // 建議速度：先算每一點的過彎極速（留 8% 餘裕），再往回推煞車點、往前推出彎加速
  const G0 = GRIP0 * 0.92, GK = GRIPK * 0.92;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(curv[i]), g0 = G0 * bankGrip[i], gk = GK * bankGrip[i];
    vTarget[i] = k > gk + 1e-5 ? Math.min(VMAX, Math.sqrt(g0 / (k - gk))) : VMAX;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      vTarget[i] = Math.min(vTarget[i], Math.sqrt(vTarget[j] ** 2 + 2 * 30 * (BRAKE / 38) * ds));
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i - 1 + N) % N;
      vTarget[i] = Math.min(vTarget[i], Math.sqrt(vTarget[j] ** 2 + 2 * 11 * (ENGINE / 14) * ds));
    }
  }

  // 高度：原本的點照沿線距離比例對到新的取樣點，再算坡度（前後各 4 m）
  const py = new Float32Array(N), grade = new Float32Array(N);
  if (elev && elev.length === points.length) {
    const cum = [0];
    for (let k = 1; k <= points.length; k++) { const a = points[k - 1], b = points[k % points.length]; cum.push(cum[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const L0 = cum[points.length];
    let k = 0;
    for (let i = 0; i < N; i++) {
      const s = (i / N) * L0;
      while (k < points.length - 1 && cum[k + 1] < s) k++;
      const f = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
      py[i] = elev[k] + (elev[(k + 1) % points.length] - elev[k]) * f;
    }
  }
  // 傾斜的軸在路面內側邊緣：中心線跟著抬高半個路寬，內側路緣維持原本高度（旁邊的地面才不會穿出路面）
  for (let i = 0; i < N; i++) py[i] += HALF_WIDTH * Math.abs(bank[i]);
  for (let i = 0; i < N; i++) grade[i] = (py[(i + 2) % N] - py[(i - 2 + N) % N]) / (4 * ds);
  // 別的路段有多近：格子索引（每 40 m 一格），只看前後 200 m 以外的點
  const gap = new Float32Array(N).fill(1e3);
  {
    const G = 40, cells = new Map<string, number[]>(), skip = Math.round(200 / ds);
    for (let i = 0; i < N; i++) { const k = `${Math.floor(px[i] / G)},${Math.floor(pz[i] / G)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(i); }
    for (let i = 0; i < N; i++) {
      const cx = Math.floor(px[i] / G), cz = Math.floor(pz[i] / G);
      let best = 1e3;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const j of cells.get(`${cx + a},${cz + b}`) ?? []) {
        const di = Math.abs(i - j);
        if (Math.min(di, N - di) <= skip) continue;
        const d = Math.hypot(px[i] - px[j], pz[i] - pz[j]);
        if (d < best) best = d;
      }
      gap[i] = best;
    }
  }
  return { N, length, ds, px, pz, tx, tz, dist, curv, vTarget, py, grade, bank, bankGrip, gap };
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
