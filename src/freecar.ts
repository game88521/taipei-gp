import type { Collider } from './citydata';

// 自由駕駛的一般汽車：油門、煞車、倒車；轉向照真實的輪距幾何，再受抓地力限制

export const CAR_VMAX = 44; // m/s ≈ 158 km/h
const ENGINE = 6.5;
const BRAKE = 13;
const REVERSE_MAX = 7;
const WHEELBASE = 2.7;
const MAX_STEER = 0.55; // 前輪最大轉角 (rad)
const GRIP = 8.5; // 橫向加速度上限 m/s²
const R = 1.05; // 車身用前後兩個圓近似

export class FreeCar {
  x = 0;
  z = 0;
  h = 0;
  v = 0;
  steer = 0;
  private hitCool = 0;
  private push = [0, 0];

  place(x: number, z: number, h: number) {
    this.x = x; this.z = z; this.h = h; this.v = 0; this.steer = 0;
  }

  /** 回傳撞擊力道（0 = 沒撞） */
  update(dt: number, steerIn: number, throttle: boolean, brake: boolean, col: Collider | null): number {
    const rate = Math.abs(steerIn) > Math.abs(this.steer) ? 3.5 : 6;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * rate);

    let v = this.v, a = 0;
    if (throttle) a = v < -0.3 ? BRAKE : ENGINE * (1 - Math.max(0, v / CAR_VMAX) ** 2);
    else if (brake) a = v > 0.3 ? -BRAKE : -3.5; // 停下來後繼續按＝倒車
    else a = -Math.sign(v) * Math.min(Math.abs(v) / dt, 0.8); // 放開滑行
    a -= 0.0005 * v * Math.abs(v);
    v += a * dt;
    if (!throttle && !brake && Math.abs(v) < 0.05) v = 0;
    v = Math.max(-REVERSE_MAX, Math.min(CAR_VMAX, v));
    this.v = v;

    let yaw = (v / WHEELBASE) * Math.tan(MAX_STEER * this.steer);
    const lim = GRIP / Math.max(Math.abs(v), 1);
    yaw = Math.max(-lim, Math.min(lim, yaw));
    this.h -= yaw * dt;
    this.x += Math.sin(this.h) * v * dt;
    this.z += Math.cos(this.h) * v * dt;

    this.hitCool = Math.max(0, this.hitCool - dt);
    if (!col) return 0;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    let impact = 0;
    for (const off of [1.3, -1.3]) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      if (!col.push(cx, cz, R, this.push)) continue;
      const [px, pz] = this.push, pl = Math.hypot(px, pz);
      this.x += px;
      this.z += pz;
      // 撞進牆的速度分量歸零，留下沿牆滑動的部分
      const nx = px / pl, nz = pz / pl;
      const vx = fx * this.v, vz = fz * this.v, vn = vx * nx + vz * nz;
      if (vn < 0) {
        const tx = vx - nx * vn, tz = vz - nz * vn;
        this.v = (tx * fx + tz * fz) * 0.85;
        if (this.hitCool === 0 && -vn > 2) { impact = Math.max(impact, -vn); this.hitCool = 0.3; }
      }
    }
    return impact;
  }
}
