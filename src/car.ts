import { VMAX, ENGINE, BRAKE, WALL_OFF, gripAt, locate, type Track, type Locate } from './track';

const LIMIT = WALL_OFF - 1.0; // 車寬一半，撞牆判定線

/**
 * 街機式車輛：不用物理引擎。
 * - 轉向角速度受抓地力限制：越快能轉的越少，所以進彎前一定要煞車
 * - 撞牆：推回牆內、掉速、車頭往賽道方向扳
 */
export class Car {
  x = 0;
  z = 0;
  h = 0; // 車頭方向：前進向量 = (sin h, cos h)
  v = 0;
  steer = 0; // -1 左 … +1 右（已平滑）
  pos: Locate = { i: 0, lat: 0, s: 0 };
  private hitCool = 0;

  placeAt(t: Track, i: number) {
    this.x = t.px[i];
    this.z = t.pz[i];
    this.h = Math.atan2(t.tx[i], t.tz[i]);
    this.v = 0;
    this.steer = 0;
    this.pos.i = i;
    locate(t, this.x, this.z, this.pos);
  }

  /** 回傳撞擊力道（0 = 沒撞） */
  update(dt: number, t: Track, steerIn: number, brake: boolean): number {
    const rate = Math.abs(steerIn) > Math.abs(this.steer) ? 6 : 9;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * rate);

    const v = this.v;
    let a = brake ? -BRAKE * Math.min(1, v / 2) : ENGINE * (1 - (v / VMAX) ** 2);
    a -= 0.4; // 滾動阻力
    a -= Math.abs(this.steer) * (v / VMAX) * 5; // 打滿方向會磨胎掉速
    this.v = Math.max(0, v + a * dt);

    const yawMax = Math.min(1.5, gripAt(v) / Math.max(v, 3)) * Math.min(1, v / 4);
    this.h -= this.steer * yawMax * dt;
    this.x += Math.sin(this.h) * this.v * dt;
    this.z += Math.cos(this.h) * this.v * dt;

    locate(t, this.x, this.z, this.pos);
    this.hitCool = Math.max(0, this.hitCool - dt);
    const over = Math.abs(this.pos.lat) - LIMIT;
    if (over <= 0) return 0;

    const i = this.pos.i, side = Math.sign(this.pos.lat);
    this.x -= -t.tz[i] * side * over;
    this.z -= t.tx[i] * side * over;
    this.pos.lat = side * LIMIT;
    const tan = Math.atan2(t.tx[i], t.tz[i]);
    let d = tan - this.h;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const into = Math.abs(Math.sin(d)); // 撞牆角度：0 = 擦牆，1 = 正面撞
    this.h += d * 0.6;
    if (this.hitCool > 0) {
      this.v *= 1 - 1.2 * dt;
      return 0;
    }
    this.hitCool = 0.25;
    const impact = this.v * (0.15 + into);
    this.v *= 1 - Math.min(0.75, 0.2 + into * 0.9);
    return impact;
  }
}
