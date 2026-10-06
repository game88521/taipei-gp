// 車內視角的畫面疊層（2D canvas，蓋在 3D 畫面上）：儀表板與 A 柱（F1 是 Halo 護環）、擋風玻璃上的雨滴、雨刷
// 雨刷刷過的地方雨滴會被刮掉；車子開得快，雨滴會被風往上吹

interface Drop { x: number; y: number; r: number; age: number }

export class Cockpit {
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private drops: Drop[] = [];
  private wiperT = 0;
  private wiperA = -1.25; // 雨刷角度（弧度，0 = 直立）
  constructor(canvas: HTMLCanvasElement) {
    this.c = canvas;
    this.g = canvas.getContext('2d')!;
  }

  hide() { this.c.style.display = 'none'; this.drops.length = 0; }

  /** open：F1（開放式座艙，沒有擋風玻璃與雨刷）；raining：下雨；v：車速 m/s */
  draw(dt: number, open: boolean, raining: boolean, v: number, steer: number) {
    const c = this.c, g = this.g;
    c.style.display = 'block';
    const W = Math.round(innerWidth), H = Math.round(innerHeight);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    g.clearRect(0, 0, W, H);

    // ---- 雨滴：隨機落在玻璃上，慢慢變大；車速快時往上滑走
    if (raining) {
      const rate = (open ? 25 : 60) * dt * (W * H) / (1280 * 720);
      for (let k = 0; k < rate || (k === 0 && Math.random() < rate); k++) {
        if (this.drops.length > 260) break;
        this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.78, r: 1.5 + Math.random() * 3.5, age: 0 });
      }
    }
    const wind = Math.min(1, Math.abs(v) / 25);
    for (const d of this.drops) {
      d.age += dt;
      d.r = Math.min(7, d.r + dt * 0.6);
      d.y += (d.r > 4.5 ? 30 : 4) * dt - wind * 260 * dt; // 大顆的往下流，開快了被風往上吹
      d.x += (d.x - W / 2) / W * wind * 120 * dt;
    }
    // ---- 雨刷（只有一般車）：左右來回，刷過的地方雨滴清掉
    const pivot = { x: W * 0.5, y: H * 1.02 }, len = H * 0.95;
    if (!open && raining) {
      this.wiperT += dt;
      const prev = this.wiperA;
      this.wiperA = -1.25 * Math.cos((this.wiperT * Math.PI * 2) / 1.3);
      const lo = Math.min(prev, this.wiperA), hi = Math.max(prev, this.wiperA);
      this.drops = this.drops.filter((d) => {
        const a = Math.atan2(d.x - pivot.x, pivot.y - d.y), r = Math.hypot(d.x - pivot.x, d.y - pivot.y);
        return !(a >= lo - 0.04 && a <= hi + 0.04 && r < len);
      });
    }
    this.drops = this.drops.filter((d) => d.y > -10 && d.y < H && d.x > -10 && d.x < W + 10);
    for (const d of this.drops) {
      const grd = g.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r);
      grd.addColorStop(0, 'rgba(235,245,255,0.55)');
      grd.addColorStop(0.7, 'rgba(160,185,215,0.22)');
      grd.addColorStop(1, 'rgba(30,40,60,0.35)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(d.x, d.y, d.r, d.r * (d.r > 4.5 ? 1.5 : 1), 0, 0, Math.PI * 2);
      g.fill();
    }

    // ---- 車身框
    g.fillStyle = '#0d0e11';
    if (open) {
      // F1：Halo（上方的弧形護環＋中間的支柱）、兩側車身、方向盤
      g.lineWidth = Math.max(10, H * 0.035);
      g.strokeStyle = '#121316';
      g.beginPath();
      g.ellipse(W / 2, H * 0.62, W * 0.42, H * 0.5, 0, Math.PI * 1.08, Math.PI * 1.92);
      g.stroke();
      g.fillRect(W / 2 - H * 0.018, H * 0.12, H * 0.036, H * 0.5);
      g.beginPath();
      g.moveTo(0, H); g.lineTo(0, H * 0.74); g.quadraticCurveTo(W * 0.2, H * 0.8, W * 0.32, H); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(W, H); g.lineTo(W, H * 0.74); g.quadraticCurveTo(W * 0.8, H * 0.8, W * 0.68, H); g.closePath(); g.fill();
      this.wheel(g, W / 2, H * 1.0, H * 0.22, steer, true);
    } else {
      // 一般車：兩根 A 柱、上緣、後照鏡、儀表板、方向盤
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(W * 0.1, 0); g.lineTo(W * 0.02, H * 0.62); g.lineTo(0, H * 0.66); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(W, 0); g.lineTo(W * 0.9, 0); g.lineTo(W * 0.98, H * 0.62); g.lineTo(W, H * 0.66); g.closePath(); g.fill();
      g.fillRect(0, 0, W, H * 0.045);
      g.fillStyle = '#1a1c21';
      this.round(g, W / 2 - W * 0.08, H * 0.05, W * 0.16, H * 0.07, 8);
      g.fill();
      g.fillStyle = '#5b6170';
      this.round(g, W / 2 - W * 0.075, H * 0.058, W * 0.15, H * 0.054, 6);
      g.fill();
      // 儀表板：一條往兩邊壓低的弧
      const grd = g.createLinearGradient(0, H * 0.72, 0, H);
      grd.addColorStop(0, '#24262c');
      grd.addColorStop(1, '#0b0c0e');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, H * 0.82); g.quadraticCurveTo(W / 2, H * 0.68, W, H * 0.82); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      this.wheel(g, W * 0.3, H * 1.02, H * 0.26, steer, false);
    }
    if (!open && raining) {
      // 雨刷：從下方中間轉出去的細桿
      const ax = pivot.x + Math.sin(this.wiperA) * len, ay = pivot.y - Math.cos(this.wiperA) * len;
      g.strokeStyle = '#08090b';
      g.lineWidth = Math.max(4, H * 0.01);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(pivot.x, pivot.y); g.lineTo(ax, ay); g.stroke();
    }
  }

  private round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  private wheel(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, steer: number, f1: boolean) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-steer * 1.6); // 方向盤跟著轉
    g.strokeStyle = '#141518';
    g.lineWidth = r * 0.16;
    if (f1) {
      // F1 方向盤：扁的、上面一排燈
      g.fillStyle = '#141518';
      this.round(g, -r, -r * 0.55, r * 2, r * 0.7, r * 0.2);
      g.fill();
      const lights = ['#3f3', '#3f3', '#ff3', '#ff3', '#f33', '#f33'];
      lights.forEach((col, i) => { g.fillStyle = col; g.fillRect(-r * 0.6 + i * r * 0.22, -r * 0.48, r * 0.14, r * 0.07); });
    } else {
      g.beginPath(); g.arc(0, 0, r, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.lineWidth = r * 0.12;
      g.beginPath(); g.moveTo(-r * 0.95, -r * 0.25); g.lineTo(r * 0.95, -r * 0.25); g.stroke();
    }
    g.restore();
  }
}
