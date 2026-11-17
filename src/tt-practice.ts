export interface PracticeSegment { id: string; label: string; start: number; length: number }
export interface PracticeConfig { segment: PracticeSegment; flying: boolean; targetTime: number | null; targetExit: number | null }
export interface PracticeResult { time: number; exitSpeed: number; valid: boolean; timeMet: boolean | null; exitMet: boolean | null }
export function practiceSegments(track: { length: number; ds: number; curv: ArrayLike<number> }): PracticeSegment[] {
  const L = track.length;
  const segments: PracticeSegment[] = [{ id: 'lap', label: '完整飛行圈', start: 0, length: L }];
  for (let i = 0; i < 3; i++) segments.push({ id: `s${i + 1}`, label: `第 ${i + 1} 分段`, start: L * i / 3, length: L / 3 });
  const bends: { s: number; k: number }[] = [];
  for (let i = 1; i < track.curv.length - 1; i++) {
    const k = Math.abs(track.curv[i]);
    if (k > .002 && k >= Math.abs(track.curv[i - 1]) && k > Math.abs(track.curv[i + 1])) bends.push({ s: i * track.ds, k });
  }
  const chosen: typeof bends = [];
  for (const bend of bends.sort((a, b) => b.k - a.k)) if (chosen.every(b => Math.min(Math.abs(b.s - bend.s), L - Math.abs(b.s - bend.s)) > 220) && chosen.length < 12) chosen.push(bend);
  chosen.sort((a, b) => a.s - b.s).forEach((bend, i) => segments.push({ id: `bend${i + 1}`, label: `彎道 ${i + 1}（${Math.round(bend.s)} m）`, start: (bend.s - 100 + L) % L, length: Math.min(260, L / 3) }));
  return segments;
}
/** 只觀察獨立練習距離；不呼叫正式 completeLap、成就或排行榜。 */
export class PracticeRun {
  active = false; running = false; result: PracticeResult | null = null;
  private previous = 0; private speed = 0; private distance = 0; private elapsed = 0; private started: number | null = null; private approach = 0; private valid = true;
  config: PracticeConfig | null = null;
  constructor(readonly length: number) {}
  start(config: PracticeConfig, spawn: number, speed: number) {
    this.config = config; this.previous = spawn; this.speed = speed; this.distance = this.elapsed = 0; this.approach = (config.segment.start - spawn + this.length) % this.length;
    this.started = this.approach < .001 ? 0 : null; this.active = this.running = this.valid = true; this.result = null;
  }
  stop() { this.active = this.running = false; }
  update(dt: number, s: number, speed: number, valid: boolean): PracticeResult | null {
    if (!this.running || !this.config) return this.result;
    let delta = (s - this.previous + this.length) % this.length;
    if (!Number.isFinite(dt) || dt <= 0 || ![s, speed].every(Number.isFinite)) return null;
    if (delta > Math.max(50, Math.max(this.speed, speed) * dt * 3)) { this.valid = false; delta = 0; }
    this.valid &&= valid;
    const prior = this.distance, time = this.elapsed; this.distance += delta; this.elapsed += dt;
    if (this.started === null && this.distance >= this.approach) this.started = time + dt * Math.max(0, (this.approach - prior) / Math.max(delta, 1e-9));
    const end = this.approach + this.config.segment.length;
    if (this.started !== null && this.distance >= end) {
      const f = Math.max(0, Math.min(1, (end - prior) / Math.max(delta, 1e-9))), duration = time + dt * f - this.started, exit = (this.speed + (speed - this.speed) * f) * 3.6;
      this.running = false;
      this.result = { time: duration, exitSpeed: exit, valid: this.valid, timeMet: this.config.targetTime === null ? null : this.valid && duration <= this.config.targetTime, exitMet: this.config.targetExit === null ? null : this.valid && exit >= this.config.targetExit };
    }
    this.previous = s; this.speed = speed; return this.result;
  }
  get status() { return { approach: this.started === null, elapsed: this.started === null ? 0 : Math.max(0, this.elapsed - this.started), remaining: Math.max(0, this.approach + (this.config?.segment.length ?? 0) - this.distance) }; }
}

export function mountPracticeUi(host: HTMLElement, segments: PracticeSegment[], actions: { start: (config: PracticeConfig) => void; retry: () => void; exit: () => void }) {
  const panel = document.createElement('details'); panel.className = 'feature-card'; panel.id = 'tt-practice';
  panel.innerHTML = '<summary>彎道／分段練習與飛行圈</summary><p class="sub">獨立練習，不更新 PB、最佳分段、影子、排行榜或成就。先從目標前約 150 m 加速，再以通過區段起點開始計時；目標僅供本次練習。</p>';
  const select = document.createElement('select'); select.id = 'practice-segment'; select.setAttribute('aria-label', '練習區段');
  for (const segment of segments) { const option = document.createElement('option'); option.value = segment.id; option.textContent = segment.label; select.append(option); }
  const flying = document.createElement('input'); flying.type = 'checkbox'; flying.checked = true; flying.id = 'practice-flying';
  const flyingLabel = document.createElement('label'); flyingLabel.append(flying, ' 飛行起跑（按該位置公開建議速度，上限 200 km/h）');
  const time = document.createElement('input'), exit = document.createElement('input');
  for (const [input, id, placeholder, max] of [[time, 'practice-time', '區段目標秒數（選填）', 3600], [exit, 'practice-exit', '出彎目標 km/h（選填）', 400]] as const) { input.type = 'number'; input.id = id; input.min = '1'; input.max = String(max); input.step = '.1'; input.placeholder = placeholder; input.setAttribute('aria-label', placeholder); }
  const launch = document.createElement('button'); launch.type = 'button'; launch.id = 'practice-start'; launch.textContent = '開始獨立練習';
  const status = document.createElement('p'); status.id = 'practice-validation'; status.setAttribute('role', 'status');
  launch.addEventListener('click', () => {
    const target = (input: HTMLInputElement, max: number) => !input.value.trim() ? null : Number.isFinite(+input.value) && +input.value > 0 && +input.value <= max ? +input.value : NaN;
    const targetTime = target(time, 3600), targetExit = target(exit, 400);
    if (Number.isNaN(targetTime) || Number.isNaN(targetExit)) { status.textContent = '請輸入正數目標：秒數最多 3600，出彎速度最多 400 km/h。'; return; }
    status.textContent = ''; actions.start({ segment: segments.find(s => s.id === select.value)!, flying: flying.checked, targetTime, targetExit });
  });
  panel.append(select, flyingLabel, time, exit, launch, status); host.append(panel);
  const hud = document.createElement('div'); hud.id = 'practice-hud'; hud.hidden = true;
  const text = document.createElement('span'); text.id = 'practice-status'; text.setAttribute('role', 'status');
  const retry = document.createElement('button'), quit = document.createElement('button'); retry.id = 'practice-retry'; retry.textContent = '重練此段'; quit.id = 'practice-exit-button'; quit.textContent = '結束練習';
  retry.addEventListener('click', actions.retry); quit.addEventListener('click', actions.exit); hud.append(text, retry, quit); document.body.append(hud);
  return { panel, hud, text };
}
