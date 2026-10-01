// 操作：手機（左下拖曳轉向 / 右下按住煞車 / 可選傾斜轉向），電腦（方向鍵、WASD、空白鍵）

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export class Input {
  tilt = false;
  private padSteer = 0;
  private padId = -1;
  private brakeIds = new Set<number>();
  private keys = new Set<string>();
  private tiltSteer = 0;

  constructor(pad: HTMLElement, dot: HTMLElement, brakeBtn: HTMLElement) {
    const padMove = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      let s = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.38);
      if (Math.abs(s) < 0.08) s = 0;
      this.padSteer = clamp(s);
      dot.style.transform = `translateX(${this.padSteer * r.width * 0.38}px)`;
    };
    const padEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.padId) return;
      this.padId = -1;
      this.padSteer = 0;
      dot.style.transform = '';
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.padId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      padMove(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === this.padId) padMove(e); });
    pad.addEventListener('pointerup', padEnd);
    pad.addEventListener('pointercancel', padEnd);

    brakeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      brakeBtn.setPointerCapture(e.pointerId);
      this.brakeIds.add(e.pointerId);
      brakeBtn.classList.add('on');
    });
    const brakeEnd = (e: PointerEvent) => {
      this.brakeIds.delete(e.pointerId);
      if (!this.brakeIds.size) brakeBtn.classList.remove('on');
    };
    brakeBtn.addEventListener('pointerup', brakeEnd);
    brakeBtn.addEventListener('pointercancel', brakeEnd);

    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.brakeIds.clear(); brakeBtn.classList.remove('on'); });

    // 橫向握手機像握方向盤：左右轉動手機就是 beta 的變化。
    // 方向在不同手機上可能相反，相反的話把下面 sign 對調即可。
    addEventListener('deviceorientation', (e) => {
      const angle = screen.orientation?.angle ?? 0;
      const beta = e.beta ?? 0, gamma = e.gamma ?? 0;
      let s = gamma;
      if (angle === 90) s = beta;
      else if (angle === 270 || angle === -90) s = -beta;
      this.tiltSteer = clamp(s / 22);
    });
  }

  /** iOS 要在使用者點擊時才能要求陀螺儀權限 */
  async enableTilt(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try { return (await DOE.requestPermission()) === 'granted'; } catch { return false; }
    }
    return 'DeviceOrientationEvent' in window;
  }

  read() {
    const k = this.keys;
    let steer = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
    if (this.padId >= 0) steer = this.padSteer;
    else if (this.tilt && steer === 0) steer = this.tiltSteer;
    const brake = this.brakeIds.size > 0 || k.has('ArrowDown') || k.has('KeyS') || k.has('Space');
    return { steer, brake };
  }
}
