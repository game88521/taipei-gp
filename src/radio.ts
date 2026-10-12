// 車隊無線電：比賽中工程師的提示（左下角、隊色邊條）。同一類訊息有冷卻時間，一次只顯示一則，其他排隊

export class TeamRadio {
  private queue: string[] = [];
  private showing = 0; // 這一則還要顯示幾秒
  private gapT = 0; // 兩則之間至少隔多久
  private last = new Map<string, number>(); // 每一類訊息上次說的時間
  private t = 0;
  count = 0; // 測試用：說了幾則
  log: string[] = [];
  onSay: (() => void) | null = null; // 播一聲無線電的嗶聲

  constructor(private el: HTMLElement) {}

  /** 開新的一場比賽 */
  reset(color: string) {
    this.queue = []; this.showing = 0; this.gapT = 0; this.last.clear(); this.t = 0; this.count = 0; this.log = [];
    this.el.style.setProperty('--team', color);
    this.el.classList.remove('show');
  }

  /** key：訊息類別（冷卻用）；cool：這一類多久內不再說（秒）；Infinity = 一場只說一次 */
  say(key: string, text: string, cool = 30) {
    const at = this.last.get(key);
    if (at != null && this.t - at < cool) return;
    this.last.set(key, this.t);
    if (this.queue.length < 3) this.queue.push(text);
  }

  /** 讓某一類訊息之後可以再說（例如換了新胎之後，磨耗提醒重新算） */
  rearm(key: string) { this.last.delete(key); }

  update(dt: number) {
    this.t += dt;
    if (this.showing > 0) {
      this.showing -= dt;
      if (this.showing <= 0) { this.el.classList.remove('show'); this.gapT = 1.5; }
      return;
    }
    if (this.gapT > 0) { this.gapT -= dt; return; }
    const msg = this.queue.shift();
    if (!msg) return;
    this.el.querySelector('span')!.textContent = msg;
    this.el.classList.add('show');
    this.showing = 4.5;
    this.count++;
    this.log.push(msg);
    this.onSay?.();
  }

  hide() { this.el.classList.remove('show'); this.queue = []; this.showing = 0; }
}
