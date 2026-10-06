// 由 main.ts 拆出來（行為不變）：汽車物理測試（?phys），結果寫在分頁標題
import { FreeCar } from './freecar';
import type { Collider } from './citydata';
import type { Traffic } from './traffic';
import type { Breakables } from './breakables';

const STEP = 1 / 120;

export function physicsTest(fcar: FreeCar, collider: Collider | null, traffic: Traffic | null, breakables: Breakables | null): string {
  const out: string[] = [];
  const c = new FreeCar();
  // 1) 0→100 km/h
  c.place(0, 0, 0);
  let t = 0;
  while (c.v < 27.8 && t < 30) { c.update(STEP, 0, true, false, null); t += STEP; }
  out.push(`0-100:${t.toFixed(1)}s`);
  // 2) 60 km/h 方向盤打滿的迴轉半徑
  c.place(0, 0, 0);
  while (c.v < 16.7) c.update(STEP, 0, true, false, null);
  for (let k = 0; k < 240; k++) c.update(STEP, 1, c.v < 16.7, false, null);
  out.push(`R60:${(Math.abs(c.v / c.w)).toFixed(1)}m`);
  // 3) 120 km/h 打滿
  c.place(0, 0, 0);
  while (c.v < 33.3) c.update(STEP, 0, true, false, null);
  for (let k = 0; k < 240; k++) c.update(STEP, 1, c.v < 33.3, false, null);
  out.push(`R120:${(Math.abs(c.v / c.w)).toFixed(1)}m`);
  // 4) 撞牆：朝起點附近 60~250 m 最近的一面牆直衝，記錄撞擊、反彈後速度，再倒車 1.5 秒、打方向加油 3 秒看能不能脫困
  //    （地圖變大後，從起點照原方向直衝 40 秒可能一路都沒牆）
  if (collider) {
    const probe: { nx: number; nz: number; depth: number }[] = [];
    let wallH = fcar.h, wallD = Infinity;
    for (let a = 0; a < 72; a++) {
      const h = (a / 72) * Math.PI * 2;
      for (let d = 60; d < Math.min(250, wallD); d += 2)
        if (collider.contacts(fcar.x + Math.sin(h) * d, fcar.z + Math.cos(h) * d, 1, probe).length) { wallD = d; wallH = h; break; }
    }
    c.place(fcar.x, fcar.z, wallH);
    let hitAt = -1, maxImpact = 0, bounce = 0;
    for (let k = 0; k < 120 * 40 && hitAt < 0; k++) {
      const imp = c.update(STEP, 0, true, false, collider);
      if (imp > 0) { hitAt = k; maxImpact = imp; }
    }
    for (let k = 0; k < 30; k++) { c.update(STEP, 0, false, false, collider); bounce = Math.min(bounce, c.v); }
    const x0 = c.x, z0 = c.z;
    for (let k = 0; k < 180; k++) c.update(STEP, 0, false, true, collider);
    const back = Math.hypot(c.x - x0, c.z - z0);
    const x1 = c.x, z1 = c.z;
    for (let k = 0; k < 360; k++) c.update(STEP, 1, true, false, collider);
    const away = Math.hypot(c.x - x1, c.z - z1);
    out.push(`撞擊:${(maxImpact * 3.6).toFixed(0)}km/h 反彈:${(bounce * 3.6).toFixed(1)}km/h 倒車退:${back.toFixed(1)}m 轉向開走:${away.toFixed(1)}m`);
    // 4b) 撞車流：時速 60 從正後方撞上停著的轎車／機車／公車，3 秒後看對方被撞開多遠、玩家剩多快
    if (traffic) {
      const res: string[] = [];
      for (const [k, nm] of [[0, '轎車'], [3, '機車'], [2, '公車']] as const) {
        traffic.update(STEP, fcar);
        const a = traffic.testAgent(k);
        if (!a) continue;
        const t = new FreeCar(), fx = Math.sin(a.h), fz = Math.cos(a.h);
        t.place(a.x - fx * 12, a.z - fz * 12, a.h);
        t.vx = fx * 16.7; t.vz = fz * 16.7;
        let vAfter = -1;
        for (let n = 0; n < 120 * 3; n++) {
          t.update(STEP, 0, false, false, null);
          if (traffic.collidePlayer(t) && vAfter < 0) vAfter = t.v;
          traffic.update(STEP, { x: t.x, z: t.z, h: t.h, v: t.v });
        }
        res.push(`${nm}被撞開${Math.hypot(a.kx, a.kz).toFixed(1)}m轉${(Math.abs(a.kh) * 57.3).toFixed(0)}°${a.fall > 0.5 ? '倒地' : ''}/玩家剩${(vAfter * 3.6).toFixed(0)}km/h`);
      }
      // 連環車禍：撞停著的轎車，它往前滑撞到前面 6.5 m 那台
      traffic.update(STEP, fcar);
      const a1 = traffic.testAgent(0), a2 = a1 && traffic.agents.find((b) => b.alive && b !== a1 && b.kind !== 2);
      if (a1 && a2) {
        Object.assign(a2, { kind: 0, v: 0, stunned: 6, kx: 0, kz: 0, kh: 0, kvx: 0, kvz: 0, kw: 0, x: a1.x + Math.sin(a1.h) * 6.5, z: a1.z + Math.cos(a1.h) * 6.5, h: a1.h });
        const x2 = a2.x, z2 = a2.z;
        const t = new FreeCar(), fx = Math.sin(a1.h), fz = Math.cos(a1.h);
        t.place(a1.x - fx * 12, a1.z - fz * 12, a1.h);
        t.vx = fx * 16.7; t.vz = fz * 16.7;
        for (let n = 0; n < 120 * 3; n++) { t.update(STEP, 0, false, false, null); traffic.collidePlayer(t); traffic.update(STEP, { x: t.x, z: t.z, h: t.h, v: t.v }); }
        res.push(`連環：前車被推${Math.hypot(a2.x + a2.kx - x2, a2.z + a2.kz - z2).toFixed(1)}m`);
      }
      out.push('撞車流 ' + res.join(' '));
    }
    // 5) 撞倒測試：從起點全油門直衝 25 秒，路上的樹／路燈會被撞倒，看能跑多遠、撞倒幾個
    c.place(fcar.x, fcar.z, fcar.h);
    const before = breakables?.knocked ?? 0, x0b = c.x, z0b = c.z;
    let minV = Infinity, started = false;
    for (let k = 0; k < 120 * 25; k++) {
      c.update(STEP, 0, true, false, collider);
      breakables?.hit(c);
      if (c.v > 20) started = true;
      if (started) minV = Math.min(minV, c.v);
    }
    out.push(`直衝25秒:${Math.hypot(c.x - x0b, c.z - z0b).toFixed(0)}m 撞倒:${(breakables?.knocked ?? 0) - before} 期間最低速:${(minV * 3.6).toFixed(0)}km/h`);
  }
  return 'PHYS ' + out.join(' ');
}
