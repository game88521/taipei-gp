// 由 main.ts 拆出來（行為不變）：線上排行榜的畫面（計時賽最快圈，api/leaderboard.js）
// 排行榜只收台北信義街道賽：各國賽道頁（?circuit=）的 save.best 已經換成那條賽道的成績，所以一律用 bestLapOf('')
import { save, writeSave, bestLapOf } from './save';

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
    const best = bestLapOf(''); // 台北的最快圈（在各國賽道頁 save.best 是那條賽道的）
    if (best == null) { $('lb-status').textContent = '先在台北信義街道賽跑一圈計時賽'; return; }
    const why = await submitLap(best, true);
    if (why) { $('lb-status').textContent = why; return; } // 上傳失敗：留著原因，不要被重新整理的列表蓋掉
    void showLeaderboard();
  });
}

/**
 * 上傳一圈；成功回傳 null，失敗回傳給玩家看的原因。
 * loud = false（破紀錄時的自動上傳）：失敗不打擾玩家，只有成功才跳提示
 */
export async function submitLap(t: number, loud = false): Promise<string | null> {
  let why: string;
  try {
    const r = await fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: save.name, time: t }) });
    if (r.ok) { const j = await r.json(); toast(`🌐 排行榜第 ${j.rank} 名`, 'purple'); return null; }
    why = r.status === 503 ? '排行榜尚未開放' : r.status === 429 ? '上傳太頻繁了，10 秒後再試' : r.status === 400 ? '這一圈的成績不在排行榜收的範圍內' : `上傳失敗（伺服器 ${r.status}），請稍後再試`;
  } catch { why = '沒有網路，連線後再上傳'; }
  if (loud) toast(`🌐 ${why}`, 'bad');
  return why;
}
async function showLeaderboard() {
  const box = $('lb-list'), st = $('lb-status');
  $<HTMLInputElement>('lb-name').value = save.name ?? '';
  $('lb-page').classList.remove('hidden');
  box.innerHTML = '';
  st.textContent = '讀取中…';
  const submit = $('lb-submit'), nameRow = $<HTMLInputElement>('lb-name').closest('label') as HTMLElement | null;
  const showUpload = (on: boolean) => { submit.style.display = on ? '' : 'none'; if (nameRow) nameRow.style.display = on ? '' : 'none'; };
  showUpload(true);
  const best = bestLapOf(''); // 排行榜只收台北信義街道賽
  try {
    const r = await fetch(`/api/leaderboard?name=${encodeURIComponent(save.name ?? '')}`);
    if (r.status === 503) { st.textContent = '排行榜尚未開放'; showUpload(false); return; } // 伺服器還沒接上儲存空間：上傳也不會成功，按鈕先藏起來
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { top: { name: string; time: number }[]; me?: { rank: number; time: number } };
    // 本機的最快圈比榜上自己的快（例如離線時破的紀錄、或自動上傳失敗）：補傳一次
    if (best != null && (!j.me || best < j.me.time - 0.0005) && !(await submitLap(best))) { void showLeaderboard(); return; }
    st.textContent = j.top.length ? (j.me ? `你是第 ${j.me.rank} 名（${fmt(j.me.time)}）` : best != null ? '你還沒上榜：按「上傳我的最快圈」' : '先在台北信義街道賽跑一圈計時賽再來上榜') : '還沒有人上榜，搶頭香！';
    j.top.forEach((e, i) => {
      const row = document.createElement('li');
      if (e.name === save.name) row.className = 'me';
      row.innerHTML = `<b>${i + 1}</b><span></span><em>${fmt(e.time)}</em>`;
      row.querySelector('span')!.textContent = e.name; // 名字當純文字放，不解析 HTML
      box.appendChild(row);
    });
  } catch { st.textContent = '目前連不到排行榜（離線或本機測試）'; }
}
