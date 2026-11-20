import { weekendStandings, type HorizonRacingSave, type WeekendConfig, type WeekendSave, type WeekendStage } from './horizon-racing';
import './horizon-racing.css';
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const stageName = (stage: WeekendStage | 'complete') => ({ qualifying: '排位賽', sprint: '短衝刺', race: '正賽', complete: '週末完成' })[stage];
export function mountHorizonWeekend(options: {
  currentTrack: string; tracks: { id: string; name: string }[]; read: () => HorizonRacingSave | undefined;
  create: (config: Pick<WeekendConfig, 'sprintLaps' | 'raceLaps' | 'difficulty' | 'rules' | 'weather' | 'tyre'>) => void;
  resume: () => void; retry: () => void; close: () => void; navigate: (track: string) => void; abandon: () => void;
}) {
  const overlay = element('div'); overlay.id = 'horizon-weekend-overlay'; overlay.className = 'overlay hidden';
  const card = element('div'); card.className = 'card horizon-weekend-card';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'horizon-weekend-title');
  const title = element('h2', 'GP 衝刺週末'); title.id = 'horizon-weekend-title';
  const description = element('p', '獨立週末：一圈排位 → 短衝刺 → 正賽。兩場均依排位發車；衝刺前八名 8～1 分，正賽前十名 25／18／15／12／10／8／6／4／2／1 分，DNF 零分，不另給最快圈分。同分依正賽、衝刺、排位與原車手順序。只記本週末，不更新一般 GP／TT、賽季、錢包或成就。');
  const track = element('select'); track.id = 'horizon-weekend-track'; track.setAttribute('aria-label', '週末賽道');
  for (const entry of options.tracks) { const o = element('option', entry.name); o.value = entry.id; track.append(o); }
  track.value = options.currentTrack;
  const button = (id: string, label: string, action: () => void) => { const b = element('button', label); b.id = id; b.type = 'button'; b.className = 'ghost-btn'; b.addEventListener('click', action); return b; };
  const choose = button('horizon-weekend-change-track', '切換至所選賽道', () => options.navigate(track.value));
  const settings = element('div'); settings.className = 'horizon-weekend-settings';
  function select(id: string, label: string, values: [string, string][]) {
    const row = element('label', label), input = element('select'); input.id = id;
    for (const [value, text] of values) { const option = element('option', text); option.value = value; input.append(option); }
    row.append(input); settings.append(row); return input;
  }
  const sprint = select('horizon-weekend-sprint-laps', '衝刺圈數', [['1', '1 圈'], ['2', '2 圈']]);
  const race = select('horizon-weekend-race-laps', '正賽圈數', [['3', '3 圈'], ['6', '6 圈']]);
  const difficulty = select('horizon-weekend-difficulty', 'AI 難度', [['normal', '普通'], ['easy', '簡單'], ['hard', '困難']]);
  const rules = select('horizon-weekend-rules', '規則', [['classic', '經典'], ['2026', '2026']]);
  const weather = select('horizon-weekend-weather', '兩場天氣（排位乾地）', [['dry', '乾地'], ['wet', '濕地']]);
  const tyre = select('horizon-weekend-tyre', '乾地起跑胎', [['1', '中性'], ['0', '軟'], ['2', '硬']]);
  const status = element('p'); status.id = 'horizon-weekend-status'; status.setAttribute('role', 'status');
  const table = element('table'); table.id = 'horizon-weekend-table'; const scroll = element('div'); scroll.className = 'table-scroll'; scroll.append(table);
  const create = button('horizon-weekend-create', '建立新週末並開始排位', () => options.create({ sprintLaps: +sprint.value as 1 | 2, raceLaps: +race.value as 3 | 6,
    difficulty: difficulty.value as WeekendConfig['difficulty'], rules: rules.value as WeekendConfig['rules'], weather: weather.value as WeekendConfig['weather'], tyre: +tyre.value }));
  const resume = button('horizon-weekend-continue', '繼續週末', options.resume), retry = button('horizon-weekend-retry', '重跑未結算的本節', options.retry);
  const abandon = button('horizon-weekend-abandon', '放棄目前週末', options.abandon), close = button('horizon-weekend-close', '回選單', options.close);
  const actions = element('div'); actions.className = 'horizon-weekend-actions'; actions.append(resume, retry, create, abandon, close);
  const note = element('p', '排位一圈、150 秒上限，無有效圈排後；可重跑尚未結算的節次。兩場每圈及暫停保存檢查點，重載可續賽；未完成排位重載後重跑。每節結算先保存，已結算節次不重複計分。歷史最多保留十個完整週末；回選單保留進度，建立新週末會要求確認。');
  const history = element('p'); history.id = 'horizon-weekend-history';
  card.append(title, description, track, choose, settings, status, scroll, actions, note, history); overlay.append(card); document.body.append(overlay);
  const hud = element('div'); hud.id = 'horizon-weekend-hud'; hud.hidden = true; const hudText = element('span'); hudText.id = 'horizon-weekend-progress';
  hud.append(hudText); document.body.append(hud);
  const row = (values: string[], header = false) => { const tr = element('tr'); for (const value of values) tr.append(element(header ? 'th' : 'td', value)); return tr; };
  function render() {
    const save = options.read(), w = save?.weekend;
    status.textContent = !w ? '尚未建立週末；目前賽道：' + options.tracks.find(t => t.id === options.currentTrack)?.name
      : `${options.tracks.find(t => t.id === w.config.trackId)?.name ?? w.config.trackId} · ${stageName(w.stage)} · 衝刺 ${w.config.sprintLaps} 圈／正賽 ${w.config.raceLaps} 圈${w.checkpoint ? ` · 已保存 ${w.checkpoint.race.raceTime.toFixed(1)} 秒檢查點` : ''}`;
    resume.hidden = !w || w.stage === 'complete'; retry.hidden = !w || w.stage === 'complete' || !w.checkpoint;
    abandon.hidden = !w || w.stage === 'complete';
    resume.textContent = w ? `${w.checkpoint ? '從檢查點繼續' : '開始'}${stageName(w.stage)}` : '繼續週末';
    table.replaceChildren();
    if (w) {
      table.append(row(['名次', '車手', '排位', '衝刺（分／時間）', '正賽（分／時間）', '總分'], true));
      for (const r of weekendStandings(w)) {
        const q = w.qualifying?.find(x => x.name === r.name), sprintResult = w.sprint?.find(x => x.name === r.name), raceResult = w.race?.find(x => x.name === r.name);
        const resultText = (v: typeof sprintResult, points: number) => !v ? '—' : `${points}分／${v.dnf ? 'DNF' : `${v.finish!.toFixed(3)}s`}`;
        const result = row([String(r.rank), r.name, q ? q.time === null ? '無有效圈' : q.time.toFixed(3) : '—', resultText(sprintResult, r.sprint), resultText(raceResult, r.gp), String(r.points)]);
        if (r.name === '你') result.className = 'me'; table.append(result);
      }
    }
    history.textContent = save?.history.length ? `最近 ${save.history.length} 個完整週末：` + save.history.map(h => `${options.tracks.find(t => t.id === h.trackId)?.name ?? h.trackId} 你 P${h.rows.find(r => r.name === '你')?.rank}／${h.rows.find(r => r.name === '你')?.points}分`).join('；') : '尚無完整週末紀錄。';
  }
  return { overlay, hud, render, show() { render(); overlay.classList.remove('hidden'); hud.hidden = true; }, hide() { overlay.classList.add('hidden'); },
    progress(w: WeekendSave, session: WeekendStage, elapsed: number) { hud.hidden = false; hudText.textContent = `GP 衝刺週末 · ${stageName(session)} · ${elapsed.toFixed(1)} 秒 · ${session === 'qualifying' ? '一圈排位（150 秒）' : `${session === 'sprint' ? w.config.sprintLaps : w.config.raceLaps} 圈`} · 獨立積分`; },
    setBusy(busy: boolean) { for (const control of [create, resume, retry, abandon, choose, track, sprint, race, difficulty, rules, weather, tyre]) control.disabled = busy; overlay.setAttribute('aria-busy', String(busy)); },
    message(text: string) { status.textContent = text; }, get visible() { return !overlay.classList.contains('hidden'); } };
}
