// 由 main.ts 拆出來（行為不變）：線上排行榜的畫面（計時賽最快圈，api/leaderboard.js）
import { save, writeSave } from './save';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let toast: (text: string, cls: string) => void = () => {};
let fmt: (t: number | null) => string = String;

/** main 給：顯示提示、格式化圈速；並綁好按鈕 */
export function initLeaderboard(t: typeof toast, f: typeof fmt) {
  toast = t; fmt = f;
  save.name ??= `車手${Math.floor(100 + Math.random() * 900)}`;
  $('btn-lb').addEventListener('click', () => void showLeaderboard());
  $('lb-close').addEventListener('click', () => $('lb-page').classList.add('hidden'));
  $('lb-name').addEventListener('change', () => {
    const v = $<HTMLInputElement>('lb-name').value.replace(/[<>"'`\\]/g, '').trim().slice(0, 12);
    if (v) { save.name = v; writeSave(); }
  });
  $('lb-submit').addEventListener('click', async () => {
    if (save.best == null) { $('lb-status').textContent = '先跑一圈計時賽'; return; }
    await submitLap(save.best);
    void showLeaderboard();
  });
}

export async function submitLap(t: number) {
  try {
    const r = await fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: save.name, time: t }) });
    if (r.ok) { const j = await r.json(); toast(`🌐 排行榜第 ${j.rank} 名`, 'purple'); }
  } catch { /* 沒網路、排行榜沒開：不影響遊戲 */ }
}
async function showLeaderboard() {
  const box = $('lb-list'), st = $('lb-status');
  $<HTMLInputElement>('lb-name').value = save.name ?? '';
  $('lb-page').classList.remove('hidden');
  box.innerHTML = '';
  st.textContent = '讀取中…';
  try {
    const r = await fetch(`/api/leaderboard?name=${encodeURIComponent(save.name ?? '')}`);
    if (r.status === 503) { st.textContent = '排行榜尚未啟用（需要在 Vercel 後台開啟儲存空間）'; return; }
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { top: { name: string; time: number }[]; me?: { rank: number; time: number } };
    st.textContent = j.top.length ? (j.me ? `你是第 ${j.me.rank} 名（${fmt(j.me.time)}）` : save.best != null ? '你還沒上榜：按「上傳我的最快圈」' : '先跑一圈計時賽再來上榜') : '還沒有人上榜，搶頭香！';
    j.top.forEach((e, i) => {
      const row = document.createElement('li');
      if (e.name === save.name) row.className = 'me';
      row.innerHTML = `<b>${i + 1}</b><span></span><em>${fmt(e.time)}</em>`;
      row.querySelector('span')!.textContent = e.name; // 名字當純文字放，不解析 HTML
      box.appendChild(row);
    });
  } catch { st.textContent = '目前連不到排行榜（離線或本機測試）'; }
}
