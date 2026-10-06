import * as THREE from 'three';
import { Grid } from './citydata';
import type { FreeCar } from './freecar';

// 可以撞倒的東西（行道樹、路燈）：撞到時順著車子行進方向倒下，車子只稍微減速、不會被卡住；
// 玩家開遠之後（250 m 外、倒下 20 秒以上）會自己立回去

interface Item {
  x: number;
  z: number;
  r: number; // 碰撞半徑
  slow: number; // 撞倒時車速保留比例
  // 各部位（hide：倒下就消失，例如地上的影子）。base＝原本的矩陣：第一次被撞倒時才從 InstancedMesh 讀出來存
  // （大地圖有 7 萬多棵樹，每個部位都先複製一份矩陣會多吃幾十 MB）
  parts: { mesh: THREE.InstancedMesh; idx: number; base?: THREE.Matrix4; hide?: boolean }[];
  // （樹幹＋樹冠、燈桿＋燈臂＋燈頭、號誌桿＋燈…）
  obj?: THREE.Object3D; // 或是一整個物件（路名牌：柱子＋兩片招牌）
  state: 0 | 1 | 2; // 0 立著、1 倒下中、2 倒在地上
  t: number; // 倒下的進度（秒）
  down: number; // 倒在地上多久了
  ax: number; az: number; // 倒下時的旋轉軸（水平）
}

const FALL_TIME = 0.8;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const FALL_ANGLE = 1.48; // 約 85°（倒在地上）

export class Breakables {
  private items: Item[] = [];
  private grid = new Grid<Item>(10);
  private moving = new Set<Item>();
  private tmp: Item[] = [];
  private m = new THREE.Matrix4();
  private rot = new THREE.Matrix4();
  private tr = new THREE.Matrix4();
  private axis = new THREE.Vector3();
  knocked = 0; // 測試用：撞倒的數量

  /** 同一個 index、同一個矩陣的多個部位（樹、路燈） */
  add(x: number, z: number, r: number, slow: number, meshes: THREE.InstancedMesh[], idx: number, base: THREE.Matrix4) {
    this.addParts(x, z, r, slow, meshes.map((mesh) => ({ mesh, idx, base })));
  }
  /** 一整個物件（座標用世界座標、物件本身在原點）：倒下時直接改它的矩陣 */
  addObject(x: number, z: number, r: number, slow: number, obj: THREE.Object3D) {
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
    const it: Item = { x, z, r, slow, parts: [], obj, state: 0, t: 0, down: 0, ax: 1, az: 0 };
    this.items.push(it);
    this.grid.addBox(x, z, x, z, it);
  }
  /** 各部位各自的 index 與矩陣（紅綠燈：桿、橫桿、燈箱、三顆燈） */
  addParts(x: number, z: number, r: number, slow: number, parts: { mesh: THREE.InstancedMesh; idx: number; base?: THREE.Matrix4; hide?: boolean }[]) {
    // 呼叫前 InstancedMesh 的矩陣都已經設好了，所以不存 base（撞倒時再讀）
    const it: Item = { x, z, r, slow, parts: parts.map((p) => ({ mesh: p.mesh, idx: p.idx, hide: p.hide })), state: 0, t: 0, down: 0, ax: 1, az: 0 };
    this.items.push(it);
    this.grid.addBox(x, z, x, z, it);
  }

  /** 玩家的車碰到：夠快就撞倒（車速打折），很慢就輕輕推開。回傳撞擊力道（給音效） */
  hit(car: FreeCar): number {
    let impact = 0;
    const R = 0.95;
    for (const [cx, cz] of car.circles()) {
      for (const it of this.grid.query(cx, cz, 2, this.tmp)) {
        if (it.state !== 0) continue;
        const dx = cx - it.x, dz = cz - it.z, d = Math.hypot(dx, dz), rr = R + it.r;
        if (d >= rr || d < 1e-4) continue;
        const sp = Math.hypot(car.vx, car.vz);
        if (sp > 1.6) {
          // 撞倒：往車子行進的方向倒；旋轉軸 = 上 × 倒下方向
          const fx = car.vx / sp, fz = car.vz / sp;
          it.ax = fz;
          it.az = -fx;
          it.state = 1;
          it.t = 0;
          for (const p of it.parts) if (!p.base) { p.base = new THREE.Matrix4(); p.mesh.getMatrixAt(p.idx, p.base); }
          this.moving.add(it);
          this.knocked++;
          car.vx *= it.slow;
          car.vz *= it.slow;
          impact = Math.max(impact, sp * (1 - it.slow) * 3);
        } else {
          // 慢慢頂到：當成柔軟的障礙物推開，不會卡住
          car.contact(dx / d, dz / d, rr - d, it.x + (dx / d) * it.r, it.z + (dz / d) * it.r, 0, 0, 0.1, 0.2);
        }
      }
    }
    return impact;
  }

  /** 倒下的動畫；離玩家很遠的倒地物體立回去 */
  update(dt: number, px: number, pz: number) {
    for (const it of this.moving) {
      if (it.state === 1) {
        it.t = Math.min(FALL_TIME, it.t + dt);
        // 先慢後快（像真的倒下），最後微微彈一下
        const f = it.t / FALL_TIME, ang = FALL_ANGLE * (f * f) * (f < 1 ? 1 : 1);
        this.pose(it, ang);
        if (it.t >= FALL_TIME) { it.state = 2; it.down = 0; }
      } else if (it.state === 2) {
        it.down += dt;
        if (it.down > 20 && Math.hypot(it.x - px, it.z - pz) > 250) {
          it.state = 0;
          this.pose(it, 0);
          this.moving.delete(it);
        }
      }
    }
  }

  /** 繞著底部（地面那一點）往倒下方向轉 ang */
  private pose(it: Item, ang: number) {
    this.axis.set(it.ax, 0, it.az);
    this.rot.makeRotationAxis(this.axis, ang);
    // M = T(底部) · R · T(−底部) · 原本的矩陣
    const pivot = this.tr.makeTranslation(it.x, 0, it.z).multiply(this.rot).multiply(new THREE.Matrix4().makeTranslation(-it.x, 0, -it.z));
    for (const p of it.parts) {
      if (!p.base) continue;
      if (p.hide) { p.mesh.setMatrixAt(p.idx, ang > 0 ? ZERO : p.base); p.mesh.instanceMatrix.needsUpdate = true; continue; }
      this.m.copy(pivot).multiply(p.base);
      p.mesh.setMatrixAt(p.idx, this.m);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    if (it.obj) {
      it.obj.matrix.copy(pivot);
      it.obj.matrixWorldNeedsUpdate = true;
    }
  }

  get count() { return this.items.length; }
}
