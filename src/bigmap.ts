import * as THREE from 'three';
import { groundH, type RoadNet } from './citydata';
import type { Landmark } from './decor';

// 全螢幕大地圖：整個路網、地標、玩家位置；拖曳平移、滾輪／雙指縮放，點一下設成目的地
// 導航：路上一排發光的箭頭指路（NavArrows）

export class BigMap {
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement; // 路網畫一次存起來
  private x0 = 0; private z0 = 0; private x1 = 0; private z1 = 0; private bs = 1; // 底圖的範圍與比例（px/m）
  cx = 0; cz = 0; zoom = 0.35; // 畫面中心（世界座標）、每公尺幾 px
  private ptrs = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch0 = 0;
  onPick: (x: number, z: number) => void = () => {};
  constructor(private c: HTMLCanvasElement, net: RoadNet, private marks: Landmark[]) {
    this.g = c.getContext('2d')!;
    const N = net.nodes;
    this.x0 = Infinity; this.z0 = Infinity; this.x1 = -Infinity; this.z1 = -Infinity;
    for (let i = 0; i < N.length; i += 2) { this.x0 = Math.min(this.x0, N[i]); this.x1 = Math.max(this.x1, N[i]); this.z0 = Math.min(this.z0, N[i + 1]); this.z1 = Math.max(this.z1, N[i + 1]); }
    this.bs = 2048 / (this.x1 - this.x0);
    this.base = document.createElement('canvas');
    this.base.width = 2048;
    this.base.height = Math.ceil((this.z1 - this.z0) * this.bs);
    const b = this.base.getContext('2d')!;
    b.fillStyle = '#14171f';
    b.fillRect(0, 0, this.base.width, this.base.height);
    b.lineCap = b.lineJoin = 'round';
    // 小路先畫、大路後畫
    for (const lvl of [4, 3, 2, 1, 0]) {
      b.strokeStyle = lvl <= 0 ? '#f2c04a' : lvl === 1 ? '#e6e0cf' : lvl === 2 ? '#a9adb6' : '#6b707a';
      b.lineWidth = lvl <= 0 ? 3.2 : lvl === 1 ? 2.4 : lvl === 2 ? 1.6 : 1;
      b.beginPath();
      for (const w of net.ways) {
        if (w.c !== lvl) continue;
        for (let k = 0; k < w.n.length; k++) {
          const x = (N[w.n[k] * 2] - this.x0) * this.bs, y = (N[w.n[k] * 2 + 1] - this.z0) * this.bs;
          if (k) b.lineTo(x, y); else b.moveTo(x, y);
        }
      }
      b.stroke();
    }
    // 拖曳、縮放、點選
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.moved = 0; if (this.ptrs.size === 2) this.pinch0 = this.pinchDist(); });
    c.addEventListener('pointermove', (e) => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      if (this.ptrs.size === 1) {
        this.cx -= (e.clientX - p.x) / this.zoom; this.cz -= (e.clientY - p.y) / this.zoom;
        this.moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
        this.clamp();
      }
      p.x = e.clientX; p.y = e.clientY;
      if (this.ptrs.size === 2) { const d = this.pinchDist(); if (this.pinch0) this.setZoom(this.zoom * (d / this.pinch0)); this.pinch0 = d; this.moved = 99; }
    });
    const up = (e: PointerEvent) => {
      if (this.ptrs.size === 1 && this.moved < 8) {
        const r = c.getBoundingClientRect();
        this.onPick(this.cx + (e.clientX - r.left - r.width / 2) / this.zoom, this.cz + (e.clientY - r.top - r.height / 2) / this.zoom);
      }
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size < 2) this.pinch0 = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.ptrs.delete(e.pointerId));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  }
  private pinchDist() { const [a, b] = [...this.ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  /** 右邊選單蓋住的寬度（px）：「看得到的畫面中心」要往左挪一半 */
  side = 220;
  areas: [string, number, number][] = [];
  /** 剛好看得到整張地圖的縮放（西門町、淡水河那頭也在裡面） */
  fitZoom() {
    const W = Math.max(100, this.c.clientWidth - this.side), H = Math.max(100, this.c.clientHeight);
    return 0.92 * Math.min(W / (this.x1 - this.x0), H / (this.z1 - this.z0));
  }
  setZoom(z: number) { this.zoom = Math.max(Math.min(0.08, this.fitZoom()), Math.min(3, z)); this.clamp(); }
  /** 把（x, z）放到看得到的畫面正中間 */
  focus(x: number, z: number) { this.cx = x + this.side / 2 / this.zoom; this.cz = z; this.clamp(); }
  showAll() { this.zoom = this.fitZoom(); this.focus((this.x0 + this.x1) / 2, (this.z0 + this.z1) / 2); }
  /** 別讓地圖被拖到畫面外面（拖丟了就找不回來） */
  private clamp() {
    const m = this.side / 2 / this.zoom;
    this.cx = Math.max(this.x0, Math.min(this.x1 + m, this.cx));
    this.cz = Math.max(this.z0, Math.min(this.z1, this.cz));
  }

  draw(px: number, pz: number, h: number, dest: { x: number; z: number } | null, route: [number, number][] | null) {
    const c = this.c, g = this.g;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    g.fillStyle = '#0c0e14';
    g.fillRect(0, 0, W, H);
    const sx = (x: number) => W / 2 + (x - this.cx) * this.zoom, sy = (z: number) => H / 2 + (z - this.cz) * this.zoom;
    const k = this.zoom / this.bs;
    g.drawImage(this.base, sx(this.x0), sy(this.z0), this.base.width * k, this.base.height * k);
    // 地標
    g.font = '12px "Microsoft JhengHei","PingFang TC",sans-serif';
    g.textAlign = 'center';
    for (const m of this.marks) {
      if (m.r < 50 && this.zoom < 0.6) continue;
      const x = sx(m.x), y = sy(m.z);
      if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
      g.fillStyle = '#ff8a1a';
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      if (this.zoom > 0.5 || (m.r > 90 && this.zoom > 0.1)) { g.fillStyle = '#f0e6d8'; g.fillText(m.nm, x, y - 6); }
    }
    // 區域名稱（西門町、台北車站…）：不在地標清單裡，縮小時也要看得到
    g.font = 'bold 14px "Microsoft JhengHei","PingFang TC",sans-serif';
    for (const [nm, ax, az] of this.areas) {
      const x = sx(ax), y = sy(az);
      if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
      g.lineWidth = 3; g.strokeStyle = '#0c0e14'; g.strokeText(nm, x, y);
      g.fillStyle = '#7fe6ff'; g.fillText(nm, x, y);
    }
    // 導航路線
    if (route && route.length > 1) {
      g.strokeStyle = '#3fe0ff';
      g.lineWidth = 4;
      g.beginPath();
      route.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z))));
      g.stroke();
    }
    if (dest) {
      g.fillStyle = '#3fe0ff';
      g.beginPath(); g.arc(sx(dest.x), sy(dest.z), 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0c0e14';
      g.beginPath(); g.arc(sx(dest.x), sy(dest.z), 3, 0, Math.PI * 2); g.fill();
    }
    // 玩家：箭頭（地圖北朝上；車頭方向 h：前進 = (sin h, cos h)）
    g.save();
    g.translate(sx(px), sy(pz));
    g.rotate(Math.PI - h);
    g.fillStyle = '#ff3b30';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}

/** 路上的導航箭頭：沿路線前面一段，每 9 m 一個發光的「＞」 */
export class NavArrows {
  private mesh: THREE.InstancedMesh;
  constructor(scene: THREE.Scene) {
    const s = new THREE.Shape();
    s.moveTo(-1.3, -0.6); s.lineTo(0, 0.7); s.lineTo(1.3, -0.6); s.lineTo(0.8, -0.6); s.lineTo(0, 0.2); s.lineTo(-0.8, -0.6); s.closePath();
    const geo = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.6), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -60 }), 40);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(route: [number, number][] | null, px: number, pz: number, t: number) {
    if (!route || route.length < 2) { this.mesh.count = 0; return; }
    // 從離玩家最近的點開始，往前放
    let bi = 0, bd = Infinity;
    for (let i = 0; i < route.length; i++) { const d = (route[i][0] - px) ** 2 + (route[i][1] - pz) ** 2; if (d < bd) { bd = d; bi = i; } }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let n = 0, carry = 6 - ((t * 6) % 9); // 箭頭會往前流動
    for (let i = bi; i + 1 < route.length && n < 40; i++) {
      const [ax, az] = route[i], [bx, bz] = route[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.1) continue;
      const h = Math.atan2(bx - ax, bz - az);
      let s = carry;
      for (; s < l && n < 40; s += 9) {
        q.setFromAxisAngle(up, h);
        { const xx = ax + ((bx - ax) * s) / l, zz = az + ((bz - az) * s) / l; m.compose(p.set(xx, groundH(xx, zz) - 0.18, zz), q, sc); }
        this.mesh.setMatrixAt(n++, m);
      }
      carry = s - l;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
