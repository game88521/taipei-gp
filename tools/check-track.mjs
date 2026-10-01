// 賽道健檢：長度、最急的彎、有沒有兩段路靠太近（會穿牆）、101 會不會壓到路
// 用法：npm run check-track（Node 22.6+ 直接吃 .ts）
import { buildTrack, WALL_OFF, TOWER_101 } from '../src/track.ts';

const t = buildTrack();
console.log(`長度 ${t.length.toFixed(0)} m，取樣 ${t.N} 點（每 ${t.ds.toFixed(2)} m）`);

let kMax = 0, kAt = 0;
for (let i = 0; i < t.N; i++) if (Math.abs(t.curv[i]) > kMax) { kMax = Math.abs(t.curv[i]); kAt = i; }
console.log(`最急的彎：半徑 ${(1 / kMax).toFixed(1)} m，在 ${t.dist[kAt].toFixed(0)} m 處，建議 ${(t.vTarget[kAt] * 3.6).toFixed(0)} km/h`);

const skip = Math.ceil(60 / t.ds);
let minGap = Infinity, gapAt = [0, 0];
for (let i = 0; i < t.N; i += 2) {
  for (let j = 0; j < t.N; j += 2) {
    const di = Math.min(Math.abs(i - j), t.N - Math.abs(i - j));
    if (di < skip) continue;
    const d = Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]);
    if (d < minGap) { minGap = d; gapAt = [i, j]; }
  }
}
const need = 2 * WALL_OFF + 4;
console.log(`不相鄰路段最近距離 ${minGap.toFixed(1)} m（需 > ${need} m）：${t.dist[gapAt[0]].toFixed(0)} m ↔ ${t.dist[gapAt[1]].toFixed(0)} m ${minGap > need ? 'OK' : '太近！'}`);

let d101 = Infinity;
for (let i = 0; i < t.N; i++) d101 = Math.min(d101, Math.hypot(t.px[i] - TOWER_101.x, t.pz[i] - TOWER_101.z));
console.log(`101 到賽道最近 ${d101.toFixed(0)} m ${d101 > 60 ? 'OK' : '太近！'}`);

let est = 0;
for (let i = 0; i < t.N; i++) est += t.ds / Math.max(5, t.vTarget[i]);
console.log(`照建議速度跑一圈約 ${est.toFixed(1)} s`);
