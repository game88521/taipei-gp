import * as THREE from 'three';
import type { CityData } from './citydata';

// 捷運文湖線的列車：把高架軌道（elevated k = 2）依端點接成連續路線，每條線一列 4 節的車來回跑，經過月台停一下

const GROUND = -0.6;
const CAR_LEN = 13, GAP = 0.8, CARS = 4, SPEED = 18, DWELL = 10;

interface Line { pts: [number, number, number][]; s: number[]; len: number }
interface Train { line: Line; s: number; dir: 1 | -1; wait: number; stops: number[]; lastStop: number }

export class Trains {
  private trains: Train[] = [];
  private body: THREE.InstancedMesh;
  private band: THREE.InstancedMesh;
  private win: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  constructor(scene: THREE.Scene, d: CityData) {
    const segs = (d.elevated ?? []).filter((e) => e.k === 2).map((e) => {
      const pts: [number, number, number][] = [];
      for (let i = 0; i < e.p.length / 2; i++) pts.push([e.p[i * 2], GROUND + e.y[i] + 0.6, e.p[i * 2 + 1]]);
      return pts;
    });
    const platforms = (d.elevated ?? []).filter((e) => e.k === 3).map((e) => {
      let x = 0, z = 0;
      for (let i = 0; i < e.p.length; i += 2) { x += e.p[i]; z += e.p[i + 1]; }
      return [x / (e.p.length / 2), z / (e.p.length / 2)];
    });
    // 端點相距 4 m 內的段接起來（需要時反轉方向）
    const used = new Set<number>();
    const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]) < 4;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      let chain = [...segs[i]];
      for (let grow = true; grow;) {
        grow = false;
        for (let j = 0; j < segs.length; j++) {
          if (used.has(j)) continue;
          const s = segs[j], head = chain[0], tail = chain[chain.length - 1];
          if (near(tail, s[0])) chain = [...chain, ...s.slice(1)];
          else if (near(tail, s[s.length - 1])) chain = [...chain, ...[...s].reverse().slice(1)];
          else if (near(head, s[s.length - 1])) chain = [...s.slice(0, -1), ...chain];
          else if (near(head, s[0])) chain = [...[...s].reverse().slice(0, -1), ...chain];
          else continue;
          used.add(j);
          grow = true;
        }
      }
      const sArr = [0];
      for (let k = 1; k < chain.length; k++) sArr.push(sArr[k - 1] + Math.hypot(chain[k][0] - chain[k - 1][0], chain[k][2] - chain[k - 1][2]));
      const len = sArr[sArr.length - 1];
      if (len < 300) continue;
      const line: Line = { pts: chain, s: sArr, len };
      // 這條線上的月台位置（沿線距離）
      const stops: number[] = [];
      for (const [px, pz] of platforms) {
        let best = Infinity, bs = 0;
        for (let k = 0; k + 1 < chain.length; k++) {
          const a = chain[k], b = chain[k + 1], dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[2]) * dz) / l2));
          const dd = Math.hypot(px - a[0] - dx * t, pz - a[2] - dz * t);
          if (dd < best) { best = dd; bs = sArr[k] + Math.sqrt(l2) * t; }
        }
        if (best < 25) stops.push(bs);
      }
      const k = this.trains.length; // 起始位置固定（每次載入一樣），不同線錯開
      this.trains.push({ line, s: len * (0.25 + 0.5 * ((k * 0.37) % 1)), dir: k % 2 ? -1 : 1, wait: 0, stops, lastStop: -1 });
    }
    // 車廂外型：白色車身、棕色腰帶、深色車窗（晚上亮燈：weather.ts 的 nightEmissive）
    const n = Math.max(1, this.trains.length * CARS);
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 3.2, CAR_LEN).translate(0, 1.9, 0), new THREE.MeshLambertMaterial({ color: '#eef0ee' }), n);
    this.band = new THREE.InstancedMesh(new THREE.BoxGeometry(2.86, 0.35, CAR_LEN - 0.4).translate(0, 1.15, 0), new THREE.MeshLambertMaterial({ color: '#7a4a2a' }), n);
    const winMat = new THREE.MeshLambertMaterial({ color: '#1d2833', emissive: '#000000' });
    winMat.userData.nightEmissive = ['#000000', '#ffd99a'];
    this.win = new THREE.InstancedMesh(new THREE.BoxGeometry(2.86, 1.0, CAR_LEN - 1.2).translate(0, 2.35, 0), winMat, n);
    for (const im of [this.body, this.band, this.win]) { im.count = this.trains.length * CARS; im.frustumCulled = false; scene.add(im); }
    this.update(0);
  }

  get count() { return this.trains.length; }
  frozen = false; // 測試截圖用
  /** 第 i 列車的中心位置（測試截圖用） */
  pos(i: number) { const t = this.trains[i]; return t ? this.at(t.line, t.s) : null; }

  /** 沿線距離 s 的位置與方向 */
  private at(l: Line, s: number) {
    s = Math.max(0, Math.min(l.len, s));
    let k = 0;
    while (k < l.s.length - 2 && l.s[k + 1] < s) k++;
    const a = l.pts[k], b = l.pts[k + 1], f = (s - l.s[k]) / (l.s[k + 1] - l.s[k] || 1);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, h: Math.atan2(b[0] - a[0], b[2] - a[2]) };
  }

  update(dt: number) {
    if (this.frozen) dt = 0;
    let i = 0;
    const up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const trainLen = CARS * (CAR_LEN + GAP);
    for (const t of this.trains) {
      if (t.wait > 0) t.wait -= dt;
      else {
        t.s += t.dir * SPEED * dt;
        // 到端點就折返；經過月台停一下（每個月台只停一次，離開後才會再停）
        if (t.s > t.line.len - trainLen / 2) { t.s = t.line.len - trainLen / 2; t.dir = -1; t.wait = DWELL; t.lastStop = -1; }
        if (t.s < trainLen / 2) { t.s = trainLen / 2; t.dir = 1; t.wait = DWELL; t.lastStop = -1; }
        for (let k = 0; k < t.stops.length; k++) if (k !== t.lastStop && Math.abs(t.s - t.stops[k]) < SPEED * dt * 1.5) { t.wait = DWELL; t.lastStop = k; }
      }
      for (let c = 0; c < CARS; c++) {
        const off = (c - (CARS - 1) / 2) * (CAR_LEN + GAP);
        const a = this.at(t.line, t.s + off);
        this.q.setFromAxisAngle(up, a.h);
        this.m.compose(p.set(a.x, a.y, a.z), this.q, one);
        this.body.setMatrixAt(i, this.m);
        this.band.setMatrixAt(i, this.m);
        this.win.setMatrixAt(i, this.m);
        i++;
      }
    }
    for (const im of [this.body, this.band, this.win]) im.instanceMatrix.needsUpdate = true;
  }
}
