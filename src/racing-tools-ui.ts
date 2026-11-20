import { RaceAnalysis, type AnalysisField } from './race-analysis';
import { TtCoach, interpolateCoach, type CoachSample, type CoachTrace, type CoachReference } from './tt-coach';
import { coachAdvice } from './expedition-coach';

const tyre = (i: number) => ['軟胎', '中胎', '硬胎', '雨胎'][i] ?? '未知胎';
const seconds = (n: number | null) => n === null ? '資料不足' : `${n.toFixed(3)} 秒`;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e;
};
function table(headings: string[], rows: string[][]) {
  const wrap = element('div'), t = element('table'), head = element('tr'); wrap.className = 'table-scroll';
  for (const name of headings) head.append(element('th', name)); t.append(head);
  for (const row of rows) { const tr = element('tr'); for (const value of row) tr.append(element('td', value)); t.append(tr); }
  wrap.append(t); return wrap;
}
function graph(current: CoachTrace | null, reference: CoachTrace | null, length: number) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 600 210'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '同距離速度比較：藍色為比較圈，橘色為參考圈；下方紅點為比較圈煞車，紫點為參考圈煞車。');
  svg.style.cssText = 'width:100%;max-width:800px;display:block;background:#101826;border-radius:8px';
  for (const [trace, color, brakeColor, brakeY] of [[current, '#61c7ff', '#ff6666', 184], [reference, '#ffbb66', '#d9a2ff', 198]] as const) {
    if (!trace || !trace.points.length) continue;
    const line = document.createElementNS(ns, 'polyline'); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2');
    const stride = Math.max(1, Math.ceil(trace.points.length / 500));
    const points = trace.points.filter((_, i) => i % stride === 0 || i === trace.points.length - 1);
    line.setAttribute('points', points.map(p => `${Math.min(590, 10 + p.s / length * 580)},${170 - Math.min(160, p.v * 3.6 / 360 * 160)}`).join(' ')); svg.append(line);
    const brakes = document.createElementNS(ns, 'path'); brakes.setAttribute('stroke', brakeColor); brakes.setAttribute('stroke-width', '3');
    brakes.setAttribute('d', points.filter(p => p.brake).map(p => `M${Math.min(590, 10 + p.s / length * 580)} ${brakeY}h2`).join(' ')); svg.append(brakes);
  }
  return svg;
}
export interface RacingToolsOptions {
  raceHost: HTMLElement; ttHost: HTMLElement; trackLength: number; trackKey: string; rules: () => string;
}
/** 由 main 注入完成步驟的數據，DOM 僅在展開面板時更新，與核心物理分離。 */
export class RacingToolsUi {
  readonly race: RaceAnalysis;
  readonly coach: TtCoach;
  private racePanel = element('details');
  private raceSelect = element('select');
  private raceBody = element('div');
  private ttPanel = element('details');
  private ttBody = element('div');
  private ttReference = element('select');
  private ttFocus = element('select');
  private lastRaceRender = -1;
  private lastTtRender = -1;
  constructor(private options: RacingToolsOptions) {
    this.race = new RaceAnalysis(options.trackLength); this.coach = new TtCoach(options.trackLength);
    this.racePanel.id = 'gp-race-analysis'; this.racePanel.className = 'feature-card';
    this.racePanel.append(element('summary', '全車逐圈與胎段分析（本場）'));
    this.raceSelect.id = 'gp-analysis-driver'; this.raceSelect.setAttribute('aria-label', '分析車手'); this.raceSelect.style.minHeight = '44px';
    this.racePanel.append(this.raceSelect, this.raceBody); options.raceHost.append(this.racePanel);
    this.racePanel.addEventListener('toggle', () => this.renderRace()); this.raceSelect.addEventListener('change', () => this.renderRace());
    this.ttPanel.id = 'tt-lap-coach'; this.ttPanel.className = 'feature-card'; this.ttPanel.append(element('summary', '計時賽圈速教練：同距離速度、煞車與失時'));
    for (const [select, id, label, choices] of [
      [this.ttFocus, 'tt-coach-focus', '比較圈', [['current', '目前圈'], ['last', '上個有效圈']]],
      [this.ttReference, 'tt-coach-reference', '參考圈', [['pb', '同規則個人最佳'], ['last', '上個有效圈']]],
    ] as const) {
      select.id = id; select.setAttribute('aria-label', label); select.style.cssText = 'min-height:44px;max-width:100%;margin:4px';
      for (const [value, text] of choices) { const option = element('option', text); option.value = value; select.append(option); }
      select.addEventListener('change', () => this.renderTt()); this.ttPanel.append(select);
    }
    this.ttPanel.append(this.ttBody); options.ttHost.append(this.ttPanel); this.ttPanel.addEventListener('toggle', () => this.renderTt());
    this.renderRace(); this.renderTt();
  }
  resetRace({ resumed = false }: { resumed?: boolean } = {}) { this.race.reset(resumed); this.lastRaceRender = -1; this.renderRace(); }
  observeRace(field: AnalysisField, playerValid = true) {
    this.race.observe(field, playerValid);
    if (this.racePanel.open && this.racePanel.getClientRects().length && (this.lastRaceRender < 0 || field.raceTime - this.lastRaceRender >= .5)) { this.lastRaceRender = field.raceTime; this.renderRace(); }
  }
  renderRace() {
    const all = this.race.all(), selected = this.raceSelect.value;
    if (all.map(d => d.name).join('|') !== [...this.raceSelect.options].map(o => o.value).join('|')) {
      this.raceSelect.replaceChildren(); for (const d of all) { const option = element('option', d.name); option.value = d.name; this.raceSelect.append(option); }
      if (all.some(d => d.name === selected)) this.raceSelect.value = selected;
    }
    const driver = all.find(d => d.name === this.raceSelect.value); this.raceBody.replaceChildren();
    const note = element('p'); note.className = 'sub';
    note.textContent = !driver ? '開始 GP 後逐步記錄全車；尚無採樣。' : `僅本分頁採樣，最多保留最近 100 圈與 100 次停站。${driver.incomplete ? '本場含續賽／中途採樣；缺少的圈速不補造。' : ''}${driver.truncated ? '較早資料已超出保留上限。' : ''}平均僅納入完整、有效、乾地、非安全車且非進出站圈；濕度超過 5% 標示濕地。`;
    this.raceBody.append(note); if (!driver) return;
    if (!driver.laps.length) { this.raceBody.append(element('p', '尚未觀察到完整過線；續賽當圈將標示資料不足。')); return; }
    this.raceBody.append(table(['圈', '圈速', '起圈→結束胎', '標示'], driver.laps.map(l => [String(l.lap), seconds(l.time), `${tyre(l.compound)}→${tyre(l.endCompound)}`,
      [l.partial ? '資料不足' : '', l.conditionsUnknown ? '環境採樣有缺口' : '', l.invalid ? '重置／無效' : '', l.pit ? '進出站／換胎' : '', l.wet ? '濕地' : '', l.safetyCar ? '安全車' : ''].filter(Boolean).join('、') || '完整乾地圈'])));
    this.raceBody.append(element('h3', '胎段可比平均'), table(['胎段', '胎種', '圈數範圍', '採用／觀察圈', '平均圈速', '平均時速'], this.race.stints(driver).map(s => [String(s.stint), tyre(s.compound), `${s.first}～${s.last}`, `${s.comparable}/${s.observed}`, seconds(s.average), s.averageSpeed === null ? '資料不足' : `${s.averageSpeed.toFixed(1)} km/h`])));
    this.raceBody.append(element('p', driver.stops.length ? `觀察到換胎：${driver.stops.map(s => s.uncertain
      ? `截至第 ${s.lap} 圈觀察到 ${s.count} 次停站、末胎為${tyre(s.compound)}；確切換胎圈／時間資料不足`
      : `第 ${s.lap} 圈 ${tyre(s.compound)}（比賽 ${s.time.toFixed(1)} 秒）`).join('；')}` : '尚未觀察到完成換胎；不推測採樣前停站。'));
  }
  startTtSession(pb: number | null) { this.coach.startSession(`${this.options.trackKey}:${this.options.rules()}`, pb); this.lastTtRender = -1; this.renderTt(); }
  sampleTt(sample: CoachSample) { this.coach.sample(sample); if (this.ttPanel.open && this.ttPanel.getClientRects().length && sample.time - this.lastTtRender >= .25) { this.lastTtRender = sample.time; this.renderTt(); } }
  finishTtLap({ time, valid, newBest }: { time: number; valid: boolean; newBest: boolean }) { const result = this.coach.finish(time, valid, newBest); this.renderTt(); return result; }
  resetTtLap() { this.coach.resetLap(); this.lastTtRender = -1; }
  renderTt() {
    const reference = this.coach.reference(this.ttReference.value as CoachReference), last = this.coach.reference('last');
    const focus = this.ttFocus.value === 'last' ? last : this.coach.current(); this.ttBody.replaceChildren();
    const note = element('p', '藍線：比較圈速度；橘線：參考圈速度。下方紅色／紫色：煞車。依相同距離對齊；正差表示較慢。完整有效 PB 遙測依賽道版本／規則保存，最多10份，每份4096點；目前圈與上圈只留本頁。'); note.className = 'sub'; this.ttBody.append(note);
    if (this.coach.store.error) this.ttBody.append(element('p', this.coach.store.error));
    if (!reference) this.ttBody.append(element('p', this.ttReference.value === 'pb'
      ? this.coach.historicalPb === null ? '目前尚無個人最佳圈。完整完成第一個有效圈後，會建立本分頁的 PB 遙測參考。'
        : `目前 PB ${seconds(this.coach.historicalPb)}；舊紀錄沒有煞車遙測。需在本分頁完成新的有效 PB，或改選上個有效圈。`
      : '尚無可比較的上個有效圈；先完整跑完一圈。'));
    if (!focus) this.ttBody.append(element('p', '目前圈尚無採樣，可選「上個有效圈」檢視已完成記錄。'));
    if (focus || reference) this.ttBody.append(graph(focus, reference, this.options.trackLength));
    if (focus && reference) {
      const advice = element('section'); advice.id = 'expedition-coach-advice'; advice.append(element('h3', '優先改善的三個路段'));
      const tips = coachAdvice(focus, reference, this.options.trackLength);
      if (tips.length) for (const tip of tips) advice.append(element('p', tip.text));
      else advice.append(element('p', '目前完整採樣的路段與參考接近，或資料還不足以列出失時；繼續完成有效圈。'));
      this.ttBody.append(advice);
      if (this.ttFocus.value === 'last' && this.ttReference.value === 'last') this.ttBody.append(element('p', '比較圈與參考圈同為上個有效圈，差值為 0；可切換個人最佳參考，或等待目前圈採樣。'));
      const points = focus.points, rows: string[][] = [];
      for (const part of [.25, .5, .75, 1]) {
        const s = this.options.trackLength * part, a = interpolateCoach(focus, s), b = interpolateCoach(reference, s);
        rows.push([`${Math.round(part * 100)}%`, a && b ? `${a.t - b.t >= 0 ? '+' : ''}${(a.t - b.t).toFixed(3)} 秒` : '資料不足', a ? `${(a.v * 3.6).toFixed(1)}` : '—', b ? `${(b.v * 3.6).toFixed(1)}` : '—', a && b ? `${a.brake ? '煞車' : '未煞車'}／${b.brake ? '煞車' : '未煞車'}` : '資料不足']);
      }
      this.ttBody.append(table(['賽道距離', '累積失時', '比較 km/h', '參考 km/h', '煞車比較／參考'], rows));
      if (points.length) {
        const s = Math.min(this.options.trackLength, points.at(-1)!.s), a = interpolateCoach(focus, s), b = interpolateCoach(reference, s);
        if (a && b) this.ttBody.append(element('p', `目前對齊 ${s.toFixed(0)} m：失時 ${(a.t - b.t).toFixed(3)} 秒，速度差 ${((a.v - b.v) * 3.6).toFixed(1)} km/h。`));
      }
    }
  }
}
