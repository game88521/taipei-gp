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
  power = 1; // 引擎力（AI 對手各自不同）
  boost = 0; // 尾流加成
  drs = false; // DRS 打開：尾翼襟翼放平、極速提高
  gripMul = 1; // 輪胎抓地力（胎種 × 磨耗）
  // 2026 規則：沒有 DRS，改成主動空力（直線區段大家都放平翼片）＋電池＋超車模式
  r26 = false;
  aeroZone = false; // 在直線模式區段裡
  ovt = false; // 超車模式：多放電
  energy = 1; // 電池 0~1
  speedCap = Infinity; // 安全車期間的限速（m/s）
  pos: Locate = { i: 0, lat: 0, s: 0 };
  /** 這一步車身貼著護牆（音效的「刮牆」聲看這個；撞擊力道在冷卻期間會回報 0） */
  touch = false;
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
    if (brake) this.drs = false; // 一踩煞車 DRS 就關
    let p = this.power + this.boost + (this.drs ? 0.08 : 0);
    if (this.r26) {
      // 直線模式：翼片放平少風阻（大家都有）；電力：踩油門放電、煞車回收；超車模式多放一截，電用完直線就變慢
      p = this.power + this.boost + (this.aeroZone && !brake ? 0.05 : 0);
      if (brake) { this.energy = Math.min(1, this.energy + 0.09 * Math.min(1, v / 40) * dt); this.ovt = false; }
      else if (v > 25 && this.energy > 0) {
        let drain = 0.016; // 一圈（約 54 秒、煞車約 8 秒回收）大致收支平衡
        p += 0.03;
        if (this.ovt) { p += 0.07; drain += 0.06; } // 一個直線區開一次超車模式約用掉 4 成電
        this.energy = Math.max(0, this.energy - drain * dt);
      } else if (this.energy <= 0 && v > 25) p -= 0.02; // 沒電：引擎得分一部分力去發電
      if (this.energy <= 0) this.ovt = false;
    }
    let a = brake ? -BRAKE * Math.min(1, v / 2) : ENGINE * p * (1 - (v / (VMAX * p)) ** 2);
    a -= 0.4; // 滾動阻力
    a -= 9.81 * t.grade[this.pos.i]; // 坡度：上坡掉速、下坡加速（台北的賽道是平的）
    a -= Math.abs(this.steer) * (v / VMAX) * 5; // 打滿方向會磨胎掉速
    this.v = Math.max(0, v + a * dt);
    if (this.v > this.speedCap) this.v = Math.max(this.speedCap, this.v - 14 * dt); // 安全車：超過限速就慢慢降下來

    const yawMax = Math.min(1.5, (gripAt(v) * this.gripMul * t.bankGrip[this.pos.i]) / Math.max(v, 3)) * Math.min(1, v / 4); // 傾斜彎抓地力比較大
    this.h -= this.steer * yawMax * dt;
    this.x += Math.sin(this.h) * this.v * dt;
    this.z += Math.cos(this.h) * this.v * dt;

    locate(t, this.x, this.z, this.pos);
    this.hitCool = Math.max(0, this.hitCool - dt);
    const over = Math.abs(this.pos.lat) - LIMIT;
    this.touch = over > -0.05; // 貼到牆（含剛好被推回來的那一步）
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
