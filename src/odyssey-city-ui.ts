import { DUTY_LOSS_LABELS, type DutyDetailItem } from './odyssey-city-models';
import type { CityDutyRun, DutyRecord } from './summit-city-duty';
import './odyssey-city.css';

export function appendDutyDetails(host: HTMLElement, record: DutyRecord) {
  if (!record.details) { const note = document.createElement('p'); note.textContent = '舊版紀錄未保存逐站明細，原成績保留。'; host.append(note); return; }
  const list = document.createElement('ol');
  for (const item of record.details.items) { const row = document.createElement('li'); row.textContent = detailText(item); list.append(row); }
  const note = document.createElement('p'); note.textContent = record.kind === 'bus' ? '各扣分列出所屬項目；總分＝平順×60%＋準點×40%－道路違規分，最低0分。' : '各扣分列出所屬項目；總分＝平順×35%＋完整度×65%。';
  host.append(list, note);
  if (record.details.winch) { const p = document.createElement('p'); p.textContent = `絞盤操作 ${record.details.winch.seconds.toFixed(1)}秒，方向修正${record.details.winch.corrections}次。`; host.append(p); }
}
function detailText(item: DutyDetailItem) {
  return `${item.name} · ${(item.endedAt - item.startedAt).toFixed(1)}秒${item.arrival ? ` · ${Math.abs(item.arrival.delta) < .5 ? '準時' : `${item.arrival.delta > 0 ? '晚' : '早'}${Math.abs(item.arrival.delta).toFixed(1)}秒`}（目標${Math.round(item.arrival.due)}秒／實到${item.arrival.actual.toFixed(1)}秒）` : ''} · ${item.losses.length ? item.losses.map(loss => `${DUTY_LOSS_LABELS[loss.reason]}扣${loss.points.toFixed(2)}`).join('、') : '無扣分'}${item.integrityLost ? ` · 完整度減少${item.integrityLost.toFixed(2)}%` : ''}`;
}
export function mountDutyInstruments(host: HTMLElement, current: () => CityDutyRun | null) {
  const dock = document.createElement('section'); dock.id = 'odyssey-duty-dock'; dock.hidden = true; dock.setAttribute('aria-label', '精準停靠儀表');
  const heading = document.createElement('b'); heading.textContent = '精準停靠';
  const values = document.createElement('p'); values.id = 'odyssey-duty-dock-values';
  const progress = document.createElement('progress'); progress.id = 'odyssey-duty-dock-progress'; progress.max = 1.5; progress.setAttribute('aria-label', '停穩1.5秒進度');
  dock.append(heading, values, progress);
  const winch = document.createElement('section'); winch.id = 'odyssey-duty-winch'; winch.hidden = true;
  const title = document.createElement('b'); title.textContent = '絞盤遙控｜車輛已鎖定';
  const status = document.createElement('p'); status.id = 'odyssey-winch-status';
  const canvas = document.createElement('canvas'); canvas.id = 'odyssey-winch-platform'; canvas.width = 240; canvas.height = 100; canvas.setAttribute('aria-label', '平台俯視圖；偏移及裝載距離亦有文字');
  const controls = document.createElement('div'); controls.className = 'odyssey-winch-controls';
  const held = new Set<string>(), pointers = new Map<number, string>();
  const clear = () => { held.clear(); pointers.clear(); };
  for (const [command, label] of [['left', '向左修正'], ['in', '收絞盤'], ['out', '放絞盤'], ['right', '向右修正']]) {
    const button = document.createElement('button'); button.type = 'button'; button.id = `odyssey-winch-${command}`; button.textContent = label;
    button.addEventListener('pointerdown', event => { if (current()?.rescueStage !== 'winch') return; event.preventDefault(); held.add(command); pointers.set(event.pointerId, command); button.setPointerCapture(event.pointerId); });
    const release = (event: PointerEvent) => { const active = pointers.get(event.pointerId); if (active) held.delete(active); pointers.delete(event.pointerId); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
    button.addEventListener('keydown', event => { if (['Enter', 'Space'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); held.add(command); } });
    button.addEventListener('keyup', event => { if (['Enter', 'Space'].includes(event.code)) { event.preventDefault(); held.delete(command); } });
    button.addEventListener('blur', () => held.delete(command)); controls.append(button);
  }
  winch.append(title, status, canvas, controls); host.append(dock, winch);
  window.addEventListener('blur', clear); document.addEventListener('visibilitychange', clear);
  return {
    read() { return { pull: (held.has('in') ? 1 : 0) - (held.has('out') ? 1 : 0), side: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0) }; }, clear,
    render() {
      const run = current(); dock.hidden = !run || run.finished || !run.docking.visible; winch.hidden = !run || run.finished || run.rescueStage !== 'winch';
      if (!run) { clear(); return; }
      if (!dock.hidden) { const d = run.docking; values.textContent = `距離 ${d.distance.toFixed(1)}m · 橫向${d.lateral < 0 ? '左' : '右'}${Math.abs(d.lateral).toFixed(2)}m · 縱向${d.longitudinal < 0 ? '後' : '前'}${Math.abs(d.longitudinal).toFixed(2)}m\n角差 ${(d.angle * 180 / Math.PI).toFixed(1)}°／±${(d.angleLimit * 180 / Math.PI).toFixed(1)}° · ${(d.speed * 3.6).toFixed(1)}km/h\n${!d.routeComplete ? '尚有路線檢查點' : !d.level ? '路層不同' : `同層 · 停靠半徑${d.radius}m · 停穩${d.dwell.toFixed(1)}/1.5秒`}`; progress.value = d.dwell; }
      if (winch.hidden) { clear(); return; }
      const w = run.winch!; status.textContent = `橫向${w.lateral < 0 ? '左' : '右'}偏${Math.abs(w.lateral).toFixed(2)}m（需≤0.35m） · 入台${w.along.toFixed(2)}/${w.length.toFixed(1)}m\n${w.ready ? '可確認固定' : w.blocked ? '偏移過大，先修正方向' : '長按按鈕；油門／煞車收放、轉向修正。放開即停止。'}`;
      const ctx = canvas.getContext('2d'); if (ctx) { ctx.clearRect(0, 0, 240, 100); ctx.fillStyle = '#172b3a'; ctx.fillRect(8, 12, 224, 76); ctx.strokeStyle = '#bde5eb'; ctx.strokeRect(108, 30, 116, 40); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(10, 50); ctx.lineTo(228, 50); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = w.aligned ? '#88efb3' : '#ffbd70'; ctx.fillRect(12 + w.along / w.length * 138, 38 + w.lateral * 18, 60, 24); }
    },
    dispose() { clear(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); dock.remove(); winch.remove(); },
  };
}
