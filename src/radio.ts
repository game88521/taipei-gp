// 車隊無線電：比賽中工程師的提示（左下角、隊色邊條）。同一類訊息有冷卻時間，一次只顯示一則，其他排隊

export type RadioPriority = 0 | 1 | 2; // 一般、重要、緊急
interface RadioMessage { key: string; text: string; priority: RadioPriority }
const QUEUE_LIMIT = 3;

export class TeamRadio {
  private queue: RadioMessage[] = [];
  private current: RadioMessage | null = null;
  private priorityRun = 0; // 連播兩則優先訊息後，讓最舊待播訊息先播一次
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
    this.queue = []; this.current = null; this.priorityRun = 0; this.showing = 0; this.gapT = 0; this.last.clear(); this.t = 0; this.count = 0; this.log = [];
    this.el.style.setProperty('--team', color);
    this.el.classList.remove('show');
    this.el.querySelector('span')!.textContent = '';
  }

  /** 成功排入才記冷卻。priority 較高者可取代最舊的較低優先提醒；不打斷目前訊息，同級維持先到先播。 */
  say(key: string, text: string, cool = 30, priority: RadioPriority = 0): boolean {
    if (typeof key !== 'string' || !key.trim() || typeof text !== 'string' || !text.trim() || typeof cool !== 'number' || !(cool >= 0) || ![0, 1, 2].includes(priority)) return false;
    if (this.current?.key === key || this.queue.some((m) => m.key === key)) return false;
    const at = this.last.get(key);
    if (at != null && this.t - at < cool) return false;
    if (this.queue.length >= QUEUE_LIMIT) {
      // 只擠掉較低優先的舊提醒；同級新訊息不能反覆清掉已等候的訊息。
      const lowest = Math.min(...this.queue.map((m) => m.priority));
      if (lowest >= priority) return false;
      const index = this.queue.findIndex((m) => m.priority === lowest);
      const [removed] = this.queue.splice(index, 1);
      this.last.delete(removed.key); // 尚未播出，不能因此永久消耗 Infinity 提醒
    }
    this.queue.push({ key, text, priority });
    this.last.set(key, this.t);
    return true;
  }

  /** 條件恢復時取消這一類舊提醒，之後可重新觸發；例如換新胎／電量恢復。 */
  rearm(key: string) {
    this.queue = this.queue.filter((m) => m.key !== key);
    if (this.current?.key === key) { this.current = null; this.showing = 0; this.el.classList.remove('show'); this.gapT = 1.5; }
    this.last.delete(key);
  }

  update(dt: number) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.t += dt;
    if (this.showing > 0) {
      this.showing -= dt;
      if (this.showing <= 0) { this.current = null; this.el.classList.remove('show'); this.gapT = 1.5; }
      return;
    }
    if (this.gapT > 0) { this.gapT -= dt; return; }
    let index = 0;
    const oldestTurn = this.priorityRun >= 2;
    if (!oldestTurn) for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority > this.queue[index].priority) index = i;
    const [msg] = this.queue.splice(index, 1);
    if (!msg) { this.priorityRun = 0; return; }
    this.current = msg;
    this.priorityRun = oldestTurn || msg.priority === 0 ? 0 : this.priorityRun + 1;
    this.el.querySelector('span')!.textContent = msg.text;
    this.el.classList.add('show');
    this.showing = 4.5;
    this.count++;
    this.log.push(msg.text);
    this.onSay?.();
  }

  /** 關閉畫面並放棄待播訊息；未播冷卻解除，已播的冷卻與歷史保留。開新場使用 reset。 */
  hide() {
    for (const m of this.queue) this.last.delete(m.key);
    this.el.classList.remove('show'); this.queue = []; this.current = null; this.showing = 0; this.gapT = 0; this.priorityRun = 0;
  }
}
