import { TOWER_101 } from './track';
import type { RoadNet, Seg } from './citydata';

// 小地圖：以車子為中心、車頭朝上，畫半徑 220 m 內的道路

const RANGE = 220;
const COLORS = ['#f4c84a', '#e8e8e8', '#cfcfcf', '#9a9a9a', '#777'];
const WIDTH = [4, 3.2, 2.6, 1.6, 1.2];

export class Minimap {
  private g: CanvasRenderingContext2D;
  private tmp: Seg[] = [];
  constructor(private canvas: HTMLCanvasElement, private net: RoadNet) {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = canvas.clientWidth * dpr || 300;
    canvas.height = canvas.clientHeight * dpr || 300;
    this.g = canvas.getContext('2d')!;
  }

  draw(x: number, z: number, h: number) {
    const g = this.g, W = this.canvas.width, H = this.canvas.height, k = W / 2 / RANGE;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(14,16,24,0.78)';
    g.fillRect(0, 0, W, H);
    // 世界座標 → 畫面：車子在中心，車頭方向朝上
    g.translate(W / 2, H / 2);
    g.rotate(Math.PI + h);
    g.scale(k, k);
    g.translate(-x, -z);
    g.lineCap = 'round';
    const segs = this.net.segGrid.query(x, z, RANGE * 1.42, this.tmp);
    for (let c = 4; c >= 0; c--) {
      g.strokeStyle = COLORS[c];
      g.lineWidth = WIDTH[c] / k * (W / 300);
      g.beginPath();
      for (const s of segs) {
        if (s.way.c !== c) continue;
        g.moveTo(s.x1, s.z1);
        g.lineTo(s.x2, s.z2);
      }
      g.stroke();
    }
    // 101
    g.fillStyle = '#5fd0c0';
    g.beginPath();
    g.arc(TOWER_101.x, TOWER_101.z, 9 / k * (W / 300), 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 自己的車（固定在中心朝上）
    g.setTransform(1, 0, 0, 1, W / 2, H / 2);
    g.fillStyle = '#ff3b30';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -12 * (W / 300));
    g.lineTo(8 * (W / 300), 9 * (W / 300));
    g.lineTo(-8 * (W / 300), 9 * (W / 300));
    g.closePath();
    g.fill();
    g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    g.stroke();
  }
}
