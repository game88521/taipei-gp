import { Grid, terrainHeight, type CityData, type NetWay, type Terrain } from './citydata';

// 立體路面：地面（地面高度場）＋高架橋面（路網 net.decks，e: 1）＋隧道（e: 2）。
// 車子在哪一層用「上一刻的高度」決定：找正下方的橋面，取高度最接近的那層（差 2.2 m 以上不算），
// 所以從橋下開不會突然跳上橋、從匝道開上去高度是連續的。
// 護欄沿每條橋面兩側擺；匝道分岔、匯入（另一條橋面的路面範圍內）或貼地的那段留開口。

/** 路面比「地面高度」低 0.25 m（沿用原本的路面高度）；橋面、隧道路面也一樣 */
export const ROAD_Y = -0.25;

export interface DeckSeg {
  ax: number; az: number; bx: number; bz: number;
  ya: number; yb: number; // 路面高度（已含 ROAD_Y）
  hw: number; // 半寬
  ux: number; uz: number; len: number;
  way: NetWay;
}
/** 護欄（隧道是側牆）：一段牆線＋擋車的高度範圍 */
export interface Rail { x1: number; z1: number; x2: number; z2: number; ya: number; yb: number /* 兩端的路面高度 */; y1: number; y2: number; e: 1 | 2; way: NetWay }

export interface SurfaceHit { y: number; seg: DeckSeg | null }

export class Surface {
  private ground: Terrain | null;
  private grid = new Grid<DeckSeg>(20);
  private tmp: DeckSeg[] = [];
  segs: DeckSeg[] = [];
  rails: Rail[] = [];
  /** 地面道路是否照地形起伏（M4 打開前，地面路面維持平的） */
  followGround = true;
  /** 隧道能不能開進去（M5 打開前只開放高架） */
  tunnels = false;

  constructor(d: CityData) {
    this.ground = d.terrain ?? null; // 統一地面（真實地形＋道路挖填）
    const N = d.net.nodes, Y = d.net.y ?? [];
    for (const w of d.net.decks ?? []) {
      for (let k = 0; k + 1 < w.n.length; k++) {
        const a = w.n[k], b = w.n[k + 1];
        const ax = N[a * 2], az = N[a * 2 + 1], bx = N[b * 2], bz = N[b * 2 + 1], len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        const s: DeckSeg = { ax, az, bx, bz, ya: (Y[a] ?? 0) + ROAD_Y, yb: (Y[b] ?? 0) + ROAD_Y, hw: w.w / 2, ux: (bx - ax) / len, uz: (bz - az) / len, len, way: w };
        this.segs.push(s);
        this.grid.addBox(Math.min(ax, bx) - s.hw, Math.min(az, bz) - s.hw, Math.max(ax, bx) + s.hw, Math.max(az, bz) + s.hw, s);
      }
    }
    this.buildRails();
  }

  /** 地面路面高度 */
  groundY(x: number, z: number): number {
    return (this.followGround ? terrainHeight(this.ground, x, z) : 0) + ROAD_Y;
  }
  /** 地面原始高度（地面高度場，不含路面的 −0.25）；碰撞判斷「地面帶」用 */
  groundAt(x: number, z: number): number { return this.followGround ? terrainHeight(this.ground, x, z) : 0; }

  private usable(s: DeckSeg) { return s.way.e === 1 || this.tunnels; }

  /** 這一點在某條橋面上的話，回傳那裡的路面高度；pad = 往外多算幾公尺 */
  private onSeg(s: DeckSeg, x: number, z: number, pad: number): number | null {
    const t = ((x - s.ax) * s.ux + (z - s.az) * s.uz) / s.len;
    if (t < -0.02 || t > 1.02) return null;
    const tc = Math.max(0, Math.min(1, t));
    const px = s.ax + (s.bx - s.ax) * tc, pz = s.az + (s.bz - s.az) * tc;
    if (Math.hypot(x - px, z - pz) > s.hw + pad) return null;
    return s.ya + (s.yb - s.ya) * tc;
  }

  /**
   * (x, z) 的路面：車子底下「不比現在高 0.6 m 以上」的路面裡最高的那層（跟真的車一樣：爬得上小坎、上不去頭頂的橋）。
   * 在橋上 → 橋面；在橋下 → 地面（橋面太高）；上匝道起點橋面只比地面高一點 → 選到橋面、一路爬上去；
   * 隧道 → 地面在頭頂上不算、選到隧道路面。比現在低很多的話，車子會照重力掉下去（freecar.ts）
   */
  at(x: number, z: number, prevY: number, out: SurfaceHit = { y: 0, seg: null }): SurfaceHit {
    const lim = prevY + 0.6, gy = this.groundY(x, z);
    let best = gy <= lim ? gy : -Infinity, seg: DeckSeg | null = null, tun: DeckSeg | null = null, ty = 0;
    for (const s of this.grid.query(x, z, 1, this.tmp)) {
      if (!this.usable(s)) continue;
      const y = this.onSeg(s, x, z, 0.3);
      if (y == null) continue;
      if (y <= lim && y > best) { best = y; seg = s; }
      // 隧道：洞口那段路面往下沉、頭頂的山坡沒挖掉；車子已經在隧道路面的高度上 → 跟著隧道走，不爬上山坡
      if (s.way.e === 2 && Math.abs(y - prevY) < 0.8 && (!tun || Math.abs(y - prevY) < Math.abs(ty - prevY))) { tun = s; ty = y; }
    }
    if (tun && ty < best) { best = ty; seg = tun; }
    out.y = best > -Infinity ? best : gy; // 比所有路面都低（剛放下來）→ 地面
    out.seg = best > -Infinity ? seg : null;
    return out;
  }

  /** (x, z) 是不是在某條「比 y 低 1 m 以上」的橋面／隧道路面上（pad = 往外多算）：上層的橋墩不能立在下層的車道上 */
  deckBelow(x: number, z: number, y: number, pad = 0.8): boolean {
    for (const s of this.grid.query(x, z, pad + 1, this.tmp)) {
      const sy = this.onSeg(s, x, z, pad);
      if (sy != null && sy < y - 1) return true;
    }
    return false;
  }

  /** 離 (x, z) 最近、高度接近 y 的橋面（重新放回路上用）；找不到回傳 null */
  nearestDeck(x: number, z: number, y: number, r = 40): DeckSeg | null {
    let best: DeckSeg | null = null, bd = Infinity;
    for (const s of this.grid.query(x, z, r, this.tmp)) {
      if (!this.usable(s)) continue;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * s.ux + (z - s.az) * s.uz) / s.len));
      const sy = s.ya + (s.yb - s.ya) * t, d = Math.hypot(x - s.ax - (s.bx - s.ax) * t, z - s.az - (s.bz - s.az) * t) + Math.abs(sy - y) * 3;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /**
   * 護欄：每條橋面兩側每 3 m 取一點，這點落在「另一條高度接近的橋面」上（分岔、匯入）或路面貼地（匝道腳）就留開口，
   * 其他連成一段段牆。擋車的高度範圍：路面下 0.3 m ~ 路面上 1.2 m（橋下、橋上的車都不會被別層的護欄擋到）
   */
  private buildRails() {
    const STEP = 3;
    for (const s of this.segs) {
      for (const sd of [-1, 1]) {
        const ox = -s.uz * sd * s.hw, oz = s.ux * sd * s.hw;
        let run: { x: number; z: number; y: number }[] = [];
        const flush = () => {
          if (run.length >= 2) {
            const a = run[0], b = run[run.length - 1];
            this.rails.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, ya: a.y, yb: b.y, y1: Math.min(a.y, b.y) - 0.3, y2: Math.max(a.y, b.y) + 1.2, e: s.way.e === 2 ? 2 : 1, way: s.way });
          }
          run = [];
        };
        const n = Math.max(1, Math.round(s.len / STEP));
        for (let k = 0; k <= n; k++) {
          const f = k / n, x = s.ax + (s.bx - s.ax) * f + ox, z = s.az + (s.bz - s.az) * f + oz, y = s.ya + (s.yb - s.ya) * f;
          let open = s.way.e === 1 && y - this.groundY(x, z) < 0.6; // 匝道貼地的那段：接地面道路
          if (!open) for (const o of this.grid.query(x, z, 1, this.tmp)) {
            if (o.way === s.way) continue; // 同一條路的下一段（轉彎處）不算
            const oy = this.onSeg(o, x, z, -0.4);
            // 那條路面比護欄低 2.2 m 內（車頂會撞到這段護欄）或高 1.5 m 內（分岔、匯入）→ 留開口
            if (oy != null && oy > y - 2.2 && oy < y + 1.5) { open = true; break; }
          }
          if (open) flush(); else run.push({ x, z, y });
          // 每 12 m 斷成一段（牆線短一點，高度範圍才貼得住坡）
          if (run.length >= 5) { const last = run[run.length - 1]; flush(); run.push(last); }
        }
        flush();
      }
    }
  }
}
