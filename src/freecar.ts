import type { Collider } from './citydata';

// 自由駕駛／街頭比賽的汽車：2D 剛體
// - 速度是向量（可以甩尾、被撞歪），另外有角速度
// - 輪胎：把側向速度拉回 0（上限＝抓地力），把角速度拉向方向盤要的轉向率
// - 碰撞：在接觸點施加衝量（反彈係數＋摩擦），車會彈開、被撞得轉向，不會黏在牆上

export const CAR_VMAX = 46; // m/s ≈ 165 km/h
const ENGINE = 8.5; // 起步加速度 m/s²
const BRAKE = 16;
const REVERSE_MAX = 9;
const WHEELBASE = 2.7;
const GRIP = 13.5; // 側向加速度上限（偏街機，約 1.4 g）
const INERTIA = 2.2; // 轉動慣量 ÷ 質量（m²），4.6 m × 1.8 m 的車約 2
const R = 0.95; // 車身用三個圓近似
const OFFS = [1.45, 0, -1.45];

export interface Contact { nx: number; nz: number; depth: number }

export class FreeCar {
  x = 0;
  z = 0;
  h = 0; // 車頭方向：前進向量 = (sin h, cos h)；h 增加 = 左轉
  vx = 0;
  vz = 0;
  w = 0; // 角速度 dh/dt
  steer = 0;
  private hitCool = 0;
  private contacts: Contact[] = [];

  /** 沿車頭方向的速度（HUD、車流、行人都用這個） */
  get v() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }
  /** 設定速度：保留方向、只改大小（別的系統用 v *= 0.7 這種寫法減速） */
  set v(n: number) {
    const cur = this.v;
    if (Math.abs(cur) > 0.05) { const k = n / cur; this.vx *= k; this.vz *= k; } else { this.vx = Math.sin(this.h) * n; this.vz = Math.cos(this.h) * n; }
  }

  place(x: number, z: number, h: number) {
    this.x = x; this.z = z; this.h = h; this.vx = this.vz = this.w = 0; this.steer = 0;
  }

  /**
   * 與另一個物體接觸：n 從對方指向自己、depth 為重疊深度、(cx, cz) 接觸點、(ovx, ovz) 對方速度（當作質量無限大）。
   * 回傳撞擊力道（接觸點的法向相對速度）。
   */
  contact(nx: number, nz: number, depth: number, cx: number, cz: number, ovx = 0, ovz = 0, e = 0.35, mu = 0.45, otherInvMass = 0): number {
    // 先把車推出重疊（多推一點點，下一步才不會又黏住）
    this.x += nx * (depth + 0.01);
    this.z += nz * (depth + 0.01);
    const rx = cx - this.x, rz = cz - this.z;
    // 接觸點速度 = 質心速度 + ω × r（在這個座標系：ω × (rx, rz) = ω·(rz, −rx)）
    const pvx = this.vx + this.w * rz - ovx, pvz = this.vz - this.w * rx - ovz;
    const vn = pvx * nx + pvz * nz;
    if (vn >= 0) return 0;
    const k = rz * nx - rx * nz; // 法向衝量對角速度的力臂
    // otherInvMass：對方的「質量倒數 ÷ 我的」；牆＝0（推不動）、同樣的車＝1（兩邊各吃一半）
    const J = (-(1 + e) * vn) / (1 + (k * k) / INERTIA + otherInvMass);
    this.vx += J * nx;
    this.vz += J * nz;
    this.w += (J * k) / INERTIA;
    // 摩擦：沿接觸面的相對速度往 0 拉，上限 μ·J
    const tx = -nz, tz = nx, vt = pvx * tx + pvz * tz, kt = rz * tx - rx * tz;
    let Jt = -vt / (1 + (kt * kt) / INERTIA + otherInvMass);
    Jt = Math.max(-mu * J, Math.min(mu * J, Jt));
    this.vx += Jt * tx;
    this.vz += Jt * tz;
    this.w += (Jt * kt) / INERTIA;
    const impact = -vn;
    if (this.hitCool > 0 || impact < 2) return 0;
    this.hitCool = 0.25;
    return impact;
  }

  /** 回傳撞擊力道（0 = 沒撞） */
  update(dt: number, steerIn: number, throttle: boolean, brake: boolean, col: Collider | null): number {
    // 方向盤：打進去快、回正更快
    const rate = Math.abs(steerIn) > Math.abs(this.steer) ? 7 : 10;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * rate);

    const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx; // 前、右
    let vl = this.vx * fx + this.vz * fz, vlat = this.vx * rx + this.vz * rz;

    // ---- 縱向：油門／煞車／倒車／滑行
    let a = 0;
    if (throttle) a = vl < -0.3 ? BRAKE : ENGINE * (1 - Math.max(0, vl / CAR_VMAX) ** 2);
    else if (brake) a = vl > 0.3 ? -BRAKE : -5; // 停下來後繼續按＝倒車
    else a = -Math.sign(vl) * Math.min(Math.abs(vl) / dt, 1.0);
    a -= 0.0004 * vl * Math.abs(vl);
    vl += a * dt;
    if (!throttle && !brake && Math.abs(vl) < 0.05) vl = 0;
    vl = Math.max(-REVERSE_MAX, Math.min(CAR_VMAX, vl));

    // ---- 側向：輪胎把側滑速度拉回 0（上限＝抓地力），甩出去也會自己回正
    const dLat = Math.min(Math.abs(vlat), GRIP * 1.15 * dt);
    vlat -= Math.sign(vlat) * dLat;

    // ---- 轉向：低速打得多、高速打得少（但反應一樣快）；受抓地力限制
    const maxSteer = 0.62 / (1 + Math.abs(vl) / 16);
    let target = -(vl / WHEELBASE) * Math.tan(maxSteer * this.steer);
    const lim = (GRIP * 1.05) / Math.max(Math.abs(vl), 1);
    target = Math.max(-lim, Math.min(lim, target));
    // 側滑時輪胎抓不住，角速度回到目標比較慢（被撞歪會轉一下才回來）
    const settle = 9 / (1 + Math.abs(vlat) / 3);
    this.w += (target - this.w) * Math.min(1, dt * settle);

    this.vx = fx * vl + rx * vlat;
    this.vz = fz * vl + rz * vlat;
    this.h += this.w * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.hitCool = Math.max(0, this.hitCool - dt);
    if (!col) return 0;
    // ---- 與建築、樹幹碰撞：三個圓各自找接觸，逐一施加衝量
    let impact = 0;
    const nfx = Math.sin(this.h), nfz = Math.cos(this.h);
    for (const off of OFFS) {
      const cx = this.x + nfx * off, cz = this.z + nfz * off;
      for (const c of col.contacts(cx, cz, R, this.contacts)) {
        impact = Math.max(impact, this.contact(c.nx, c.nz, c.depth, cx - c.nx * R, cz - c.nz * R));
      }
    }
    return impact;
  }

  /** 車身三個圓的位置（給車流、對手做碰撞） */
  circles(): [number, number][] {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    return OFFS.map((o) => [this.x + fx * o, this.z + fz * o]);
  }
  static readonly RADIUS = R;
}
