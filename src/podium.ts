import * as THREE from 'three';
import type { Track } from './track';

// 頒獎台：起跑線前的賽道上搭一座 1、2、3 名的台子，三位車手（車隊色賽車服、安全帽）站上去，冠軍雙手舉高；
// 香檳往前噴、彩帶從天上飄下來，鏡頭繞著台子慢慢轉。第一次用到才蓋

interface Figure { g: THREE.Group; suit: THREE.MeshLambertMaterial; helmet: THREE.MeshLambertMaterial; armL: THREE.Object3D; armR: THREE.Object3D; bottle: THREE.Object3D }
interface Drop { p: THREE.Vector3; v: THREE.Vector3; life: number }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Podium {
  private g = new THREE.Group();
  private figs: Figure[] = [];
  private spray: THREE.Points;
  private drops: Drop[] = [];
  private confetti: THREE.InstancedMesh;
  private conf: { p: THREE.Vector3; v: number; r: number; s: number }[] = [];
  private t = 0;
  private center = new THREE.Vector3();
  private toTrack = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(scene: THREE.Scene, t: Track) {
    // 位置：直接搭在起跑線前方 80 m 的賽道上（賽道上一定沒有建築擋住，兩側有護牆），正面朝起跑線
    // （頒獎時賽車都先藏起來）
    const i = Math.round(80 / t.ds) % t.N;
    const x = t.px[i], z = t.pz[i];
    this.g.position.set(x, 0, z);
    this.toTrack.set(-t.tx[i], 0, -t.tz[i]); // 正面方向（鏡頭在這一側）
    this.g.rotation.y = Math.atan2(this.toTrack.x, this.toTrack.z);
    this.center.set(x, 2.6, z);
    const white = new THREE.MeshLambertMaterial({ color: '#f4f4f4' }), red = new THREE.MeshLambertMaterial({ color: '#d40000' });
    // 台子：中間 1 名最高；從正面看 2 名在左、3 名在右（跟真的頒獎台一樣）
    const H = [1.7, 1.15, 0.8], X = [0, -3.1, 3.1];
    for (let k = 0; k < 3; k++) {
      const num = canvasTex(128, 128, (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#d40000'; c.font = '900 96px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k + 1), 64, 70); });
      const box = new THREE.Mesh(new THREE.BoxGeometry(3, H[k], 2.6), [white, white, white, white, new THREE.MeshLambertMaterial({ map: num }), white]);
      box.position.set(X[k], H[k] / 2, 0);
      this.g.add(box);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.12, 2.62), red);
      trim.position.set(X[k], H[k] - 0.06, 0);
      this.g.add(trim);
    }
    // 背板
    const board = canvasTex(1024, 384, (c) => {
      const grd = c.createLinearGradient(0, 0, 1024, 384);
      grd.addColorStop(0, '#16182a'); grd.addColorStop(1, '#3a0a12');
      c.fillStyle = grd; c.fillRect(0, 0, 1024, 384);
      c.fillStyle = '#e10600'; c.fillRect(0, 318, 1024, 14);
      c.fillStyle = '#ffffff'; c.textAlign = 'center';
      c.font = '900 110px sans-serif'; c.fillText('台北街道賽', 512, 160);
      c.font = '700 44px sans-serif'; c.fillStyle = '#f2c14e'; c.fillText('TAIPEI STREET GP · 頒獎典禮', 512, 250);
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5), new THREE.MeshBasicMaterial({ map: board }));
    back.position.set(0, 4.2, -2.2);
    this.g.add(back);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.2, 6), new THREE.MeshLambertMaterial({ color: '#2b2e36' }));
    floor.position.set(0, 0.1, 0.4);
    this.g.add(floor);
    // 三位車手
    for (let k = 0; k < 3; k++) {
      const suit = new THREE.MeshLambertMaterial({ color: '#d40000' }), helmet = new THREE.MeshLambertMaterial({ color: '#ffd400' });
      const f = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.85, 0.28), suit);
      legs.position.y = 0.43;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.7, 0.32), suit);
      body.position.y = 1.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), helmet);
      head.position.y = 1.78;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.08), new THREE.MeshLambertMaterial({ color: '#111' }));
      visor.position.set(0, 1.8, 0.18);
      const arm = () => { const a = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.15), suit); m.position.y = -0.3; a.add(m); return a; };
      const armL = arm(), armR = arm();
      armL.position.set(-0.36, 1.5, 0); armR.position.set(0.36, 1.5, 0);
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.36, 8), new THREE.MeshLambertMaterial({ color: '#1f5a2a' }));
      bottle.position.y = -0.7;
      armR.add(bottle);
      f.add(legs, body, head, visor, armL, armR);
      f.position.set(X[k], H[k], 0.2);
      this.g.add(f);
      this.figs.push({ g: f, suit, helmet, armL, armR, bottle });
    }
    // 香檳：小點點往前噴、會掉下來
    const N = 400;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    this.spray = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff1c2', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
    this.spray.frustumCulled = false;
    for (let k = 0; k < N; k++) this.drops.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0 });
    // 彩帶
    const C = ['#e10600', '#ffd400', '#ffffff', '#2fbf6c', '#3a7bff', '#ff6fa8'].map((c) => new THREE.Color(c));
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 220);
    this.confetti.frustumCulled = false;
    for (let k = 0; k < 220; k++) { this.conf.push({ p: new THREE.Vector3(), v: 0, r: 0, s: 0 }); this.confetti.setColorAt(k, C[k % C.length]); }
    this.g.visible = false;
    this.spray.visible = this.confetti.visible = false;
    scene.add(this.g, this.spray, this.confetti);
  }

  /** top：前三名的顏色（賽車服、安全帽） */
  show(top: { suit: string; helmet: string }[]) {
    this.t = 0;
    top.forEach((d, k) => { this.figs[k].suit.color.set(d.suit); this.figs[k].helmet.color.set(d.helmet); });
    for (const d of this.drops) d.life = 0;
    for (const c of this.conf) { c.p.set((Math.random() - 0.5) * 12, 4 + Math.random() * 9, (Math.random() - 0.5) * 6); c.v = 0.6 + Math.random() * 0.8; c.r = Math.random() * 6; c.s = (Math.random() - 0.5) * 6; }
    this.g.visible = this.spray.visible = this.confetti.visible = true;
  }
  hide() { this.g.visible = this.spray.visible = this.confetti.visible = false; }

  frame(dt: number, camera: THREE.PerspectiveCamera) {
    this.t += dt;
    const t = this.t;
    // 冠軍雙手舉高、跳一跳；二、三名舉一隻手；舉起香檳往前噴（2 秒後開始）
    this.figs.forEach((f, k) => {
      const up = k === 0 ? 2.7 : 2.3;
      f.armR.rotation.z = up * Math.min(1, t / 0.8);
      f.armL.rotation.z = -(k === 0 ? up : 0.4) * Math.min(1, t / 0.8);
      f.armR.rotation.x = t > 2 ? -0.9 : 0; // 把瓶口朝前
      f.g.position.y = [1.7, 1.15, 0.8][k] + (k === 0 ? Math.abs(Math.sin(t * 5)) * 0.12 * Math.max(0, 1 - t / 4) : 0);
    });
    this.g.updateMatrixWorld();
    const pos = this.spray.geometry.attributes.position as THREE.BufferAttribute;
    const tip = new THREE.Vector3(), fwd = this.toTrack;
    let emit = t > 2 && t < 9 ? Math.floor(dt * 240) : 0;
    for (const d of this.drops) {
      if (d.life <= 0 && emit > 0) {
        const f = this.figs[emit % 3];
        f.bottle.getWorldPosition(tip);
        d.p.copy(tip);
        d.v.set(fwd.x * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2, 2.5 + Math.random() * 3, fwd.z * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2);
        d.life = 1.2;
        emit--;
      }
      if (d.life > 0) { d.life -= dt; d.v.y -= 9 * dt; d.p.addScaledVector(d.v, dt); if (d.life <= 0) d.p.set(0, -99, 0); }
    }
    this.drops.forEach((d, k) => pos.setXYZ(k, d.p.x, d.p.y, d.p.z));
    pos.needsUpdate = true;
    // 彩帶：轉著飄下來，落地重來
    const base = this.g.position;
    this.conf.forEach((c, k) => {
      c.p.y -= c.v * dt;
      if (c.p.y < 0.2) c.p.y = 8 + Math.random() * 4;
      c.r += c.s * dt;
      this.e.set(c.r, c.r * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m4.compose(new THREE.Vector3(base.x + c.p.x, base.y + c.p.y, base.z + c.p.z), this.q, new THREE.Vector3(1, 1, 1));
      this.confetti.setMatrixAt(k, this.m4);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    // 鏡頭：在台子前方慢慢左右繞、慢慢推近；往下看一點，台子和車手在畫面上半部（下半部是名單）
    const a = Math.sin(t * 0.25) * 0.45, R = 19 - Math.min(4, t * 0.5);
    const dir = this.toTrack.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    camera.position.set(this.center.x + dir.x * R, 2.6, this.center.z + dir.z * R);
    camera.lookAt(this.center.x, 0.2, this.center.z);
    if (Math.abs(camera.fov - 45) > 0.05) { camera.fov = 45; camera.updateProjectionMatrix(); }
  }
}
