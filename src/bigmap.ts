import * as THREE from 'three';
import type { RoadNet } from './citydata';
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
  setZoom(z: number) { this.zoom = Math.max(0.08, Math.min(3, z)); }

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
      if (this.zoom > 0.5 || m.r > 90) { g.fillStyle = '#f0e6d8'; g.fillText(m.nm, x, y - 6); }
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
        m.compose(p.set(ax + ((bx - ax) * s) / l, -0.18, az + ((bz - az) * s) / l), q, sc);
        this.mesh.setMatrixAt(n++, m);
      }
      carry = s - l;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
