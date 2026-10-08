import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Vehicle } from './vehicles';

// 車庫的 3D 預覽：選單車庫分頁裡一個小畫布，車子在展示台上慢慢轉（可以拖曳轉動）。
// 用自己的一個小 WebGL 畫布（跟遊戲的場景分開），只在車庫分頁看得到時才畫；第一次用到才建立。
// 車子另外建一台（遊戲裡那台掛著頭燈、頂燈），烤漆每格照遊戲那台的顏色同步。

function floorTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.22)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  // 展示台的細圓環
  g.strokeStyle = 'rgba(255,80,60,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

export class GaragePreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private failed = false;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 2, 0.1, 100);
  private turn = new THREE.Group();
  private models = new Map<string, { root: THREE.Object3D; paint?: THREE.MeshStandardMaterial; size: number }>();
  private cur: { root: THREE.Object3D; paint?: THREE.MeshStandardMaterial; size: number } | null = null;
  private ang = 0.6;
  private idle = 0; // 拖曳放開後幾秒才繼續自己轉
  private drag: { x: number; a: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, a: this.ang }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag) { this.ang = this.drag.a + (e.clientX - this.drag.x) * 0.012; this.idle = 2.5; } });
    const up = () => { this.drag = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  private init() {
    if (this.renderer || this.failed) return !!this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      this.failed = true; // 開不了第二個 WebGL（很舊的手機）：只顯示文字介紹
      this.canvas.style.display = 'none';
      return false;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.82;
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#cfd8ff', '#1a1210', 0.6));
    const key = new THREE.DirectionalLight('#fff1e0', 1.5);
    key.position.set(4, 6, 3);
    const rim = new THREE.DirectionalLight('#ff4a3a', 1.4); // 背後一道紅光勾出車身輪廓
    rim.position.set(-5, 2.5, -4);
    this.scene.add(key, rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: floorTex(), transparent: true, depthWrite: false }));
    floor.position.y = 0.01;
    this.turn.add(floor);
    this.scene.add(this.turn);
    return true;
  }

  private want: Vehicle | null = null;
  private shown: Vehicle | null = null;
  /** 換成這台車（真的看得到時才建立畫布、蓋模型） */
  show(v: Vehicle) { this.want = v; }

  private apply(v: Vehicle) {
    this.shown = v;
    let m = this.models.get(v.id);
    if (!m) {
      const model = v.build();
      const box = new THREE.Box3().setFromObject(model.root), size = box.getSize(new THREE.Vector3());
      model.root.position.y -= box.min.y; // 輪子貼地
      m = { root: model.root, paint: model.root.userData.paint as THREE.MeshStandardMaterial | undefined, size: Math.max(size.x, size.z) };
      this.models.set(v.id, m);
      this.turn.add(m.root);
    }
    for (const o of this.models.values()) o.root.visible = o === m;
    this.cur = m;
    const floor = this.turn.children[0];
    floor.scale.setScalar(m.size * 1.35);
  }

  /** 每格呼叫：visible = 車庫分頁現在看得到；paintColor = 遊戲那台目前的烤漆 */
  frame(dt: number, visible: boolean, paintColor: THREE.Color | null) {
    if (!visible || !this.want || !this.init()) return;
    if (this.want !== this.shown) this.apply(this.want);
    if (!this.renderer || !this.cur) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const r = this.renderer, size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) { r.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    if (this.idle > 0) this.idle -= dt; else if (!this.drag) this.ang += dt * 0.45;
    this.turn.rotation.y = this.ang;
    if (paintColor && this.cur.paint) this.cur.paint.color.copy(paintColor);
    // 鏡頭：依車長拉開，從斜前方略高處看
    const d = this.cur.size * 1.08 + 0.8;
    this.camera.position.set(d * 0.78, d * 0.3, d * 0.62);
    this.camera.lookAt(0, this.cur.size * 0.08, 0);
    r.render(this.scene, this.camera);
  }
}
