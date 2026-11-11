import { save, writeSave, bestLapOf, ghostOf, stampOf, playerIdentity, selectedRecordRules, RECORD_VERSION, type RaceRules } from './save';
import { requestJson, DownloadError } from './network';
import { createLapProof } from './lap-proof';
import { randomUuid } from './identity';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type View = RaceRules | 'legacy';
interface Reply { top: { playerId?: string; name: string; time: number }[]; me?: { rank: number; time: number }; rank?: number }
let toast: (text: string, cls: string) => void = () => {};
let fmt: (t: number | null) => string = String;
let generation = 0, loadCancel: (() => void) | null = null;
const pending = new Map<string, { promise: Promise<string | null>; cancel: () => void }>();
const attempts = new Map<string, string>();
let boardSelect: HTMLSelectElement;

export function cancelLeaderboardRequests() {
  generation++; loadCancel?.(); loadCancel = null;
  for (const p of pending.values()) p.cancel();
}
const current = (id: number) => id === generation && !$('lb-page').classList.contains('hidden');
const boardLabel = (view: View) => view === 'legacy' ? '舊榜（規則未知，唯讀）' : `${view === 'classic' ? '經典' : '2026'}・紀錄 v${RECORD_VERSION}`;
const bestFor = (rules: RaceRules) => rules === selectedRecordRules() ? bestLapOf('') : ghostOf('', rules)?.t.at(-1) ?? null;
function failure(error: unknown) {
  if (error instanceof DownloadError) {
    if (error.code === 'cancelled') return '已取消排行榜請求';
    if (error.code === 'timeout' || error.code === 'idle' || error.status === 504) return '排行榜連線逾時，稍後可重試';
    if (error.status === 503) return '排行榜暫時無法使用，請稍後重試';
    if (error.status === 429) return '上傳太頻繁了，10 秒後再試';
    if (error.status === 400) return '這圈軌跡未通過檢查，請重新完成一圈計時賽';
    if (error.status === 409) return '上傳內容已變更，請重新開啟排行榜';
  }
  return '目前連不到排行榜，連線後可重試';
}

export function initLeaderboard(t: typeof toast, f: typeof fmt) {
  toast = t; fmt = f;
  save.name ??= `車手${Math.floor(100 + Math.random() * 900)}`;
  const label = document.createElement('label'); label.className = 'lb-name'; label.textContent = '榜單 ';
  boardSelect = document.createElement('select'); boardSelect.id = 'lb-board'; boardSelect.setAttribute('aria-label', '排行榜規則與版本');
  for (const view of ['classic', '2026', 'legacy'] as const) {
    const opt = document.createElement('option'); opt.value = view; opt.textContent = boardLabel(view); boardSelect.appendChild(opt);
  }
  boardSelect.value = selectedRecordRules(); label.appendChild(boardSelect);
  $('lb-list').before(label);
  const note = document.createElement('p'); note.className = 'sub'; note.textContent = '新榜檢查軌跡合理性；尚非權威防作弊排名。'; label.after(note);
  boardSelect.addEventListener('change', () => { cancelLeaderboardRequests(); void showLeaderboard(); });
  $('btn-lb').addEventListener('click', () => void showLeaderboard());
  $('lb-close').addEventListener('click', () => { cancelLeaderboardRequests(); $('lb-page').classList.add('hidden'); });
  addEventListener('pagehide', cancelLeaderboardRequests);
  $('lb-name').addEventListener('change', () => {
    const v = $<HTMLInputElement>('lb-name').value.replace(/[\u0000-\u001f<>"'`\\]/g, '').trim().slice(0, 12);
    if (v) { save.name = v; writeSave(); }
  });
  $('lb-submit').addEventListener('click', async () => {
    const view = boardSelect.value as View;
    if (view === 'legacy') return;
    const best = bestFor(view), id = generation;
    if (best == null) { $('lb-status').textContent = `先以${boardLabel(view)}完成台北計時賽`; return; }
    const why = await submitFor(best, view, true);
    if (!current(id)) return;
    if (why) $('lb-status').textContent = why; else void showLeaderboard(false);
  });
}

/** 舊 main 呼叫保持相容；先同步擷取該圈規則／影子，避免等候期間切換模式而送錯榜。 */
export function submitLap(t: number, loud = false): Promise<string | null> { return submitFor(t, selectedRecordRules(), loud); }
function submitFor(t: number, rules: RaceRules, loud: boolean): Promise<string | null> {
  const proof = createLapProof(ghostOf('', rules), stampOf('', rules), t);
  if (!proof) {
    const why = '這筆舊紀錄缺少完整軌跡，請重新完成一圈台北計時賽再上傳';
    if (loud) toast(`🌐 ${why}`, 'bad');
    return Promise.resolve(why);
  }
  const playerId = playerIdentity().toLowerCase(), name = save.name ?? '車手';
  const requestGeneration = generation;
  const fingerprint = `${playerId}:${rules}:${RECORD_VERSION}:${t}:${proof.trackStamp}:${name}`;
  const existing = pending.get(fingerprint); if (existing) return existing.promise;
  let idem = attempts.get(fingerprint); if (!idem) { idem = randomUuid(); attempts.set(fingerprint, idem); }
  const request = requestJson<Reply>('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem },
    body: JSON.stringify({ playerId, name, time: t, board: { track: 'taipei', rules, version: RECORD_VERSION }, proof }),
    timeoutMs: 10000, idleTimeoutMs: 6000, retries: 0, label: '排行榜' });
  $('lb-submit').setAttribute('aria-busy', 'true'); $<HTMLButtonElement>('lb-submit').disabled = true;
  const promise = (async () => {
    try {
      const reply = await request.promise;
      if (!Number.isInteger(reply.rank) || reply.rank! < 1) throw new Error('invalid');
      if (requestGeneration === generation && selectedRecordRules() === rules) toast(`🌐 ${boardLabel(rules)}排行榜第 ${reply.rank} 名`, 'purple');
      return null;
    } catch (error) {
      const why = failure(error);
      if (loud && requestGeneration === generation && !(error instanceof DownloadError && error.code === 'cancelled')) toast(`🌐 ${why}`, 'bad');
      return why;
    } finally {
      pending.delete(fingerprint);
      if (!pending.size) { $('lb-submit').removeAttribute('aria-busy'); $<HTMLButtonElement>('lb-submit').disabled = false; }
    }
  })();
  pending.set(fingerprint, { promise, cancel: request.cancel });
  return promise;
}

async function showLeaderboard(syncBest = true) {
  loadCancel?.();
  const id = ++generation, view = boardSelect.value as View, box = $('lb-list'), status = $('lb-status');
  $<HTMLInputElement>('lb-name').value = save.name ?? '';
  $('lb-page').classList.remove('hidden'); box.replaceChildren(); status.textContent = `${boardLabel(view)}，讀取中…`;
  const submit = $('lb-submit'), nameRow = $<HTMLInputElement>('lb-name').closest('label');
  submit.style.display = view === 'legacy' ? 'none' : ''; if (nameRow) nameRow.style.display = view === 'legacy' ? 'none' : '';
  const query = view === 'legacy' ? `board=legacy&name=${encodeURIComponent(save.name ?? '')}` : `rules=${view}&version=${RECORD_VERSION}&playerId=${encodeURIComponent(playerIdentity())}`;
  const request = requestJson<Reply>(`/api/leaderboard?${query}`, { timeoutMs: 8000, idleTimeoutMs: 5000, retries: 1, label: '排行榜' });
  loadCancel = request.cancel;
  try {
    const reply = await request.promise;
    if (!current(id)) return;
    if (!Array.isArray(reply.top)) throw new Error('invalid');
    const best = view === 'legacy' ? null : bestFor(view);
    if (syncBest && view !== 'legacy' && best != null && (!reply.me || best < reply.me.time - 0.0005) && createLapProof(ghostOf('', view), stampOf('', view), best)) {
      const why = await submitFor(best, view, false);
      if (!current(id)) return;
      if (!why) { void showLeaderboard(false); return; }
    }
    status.textContent = `${boardLabel(view)}：` + (reply.me ? `你是第 ${reply.me.rank} 名（${fmt(reply.me.time)}）` : reply.top.length ? '尚未上榜' : '還沒有人上榜');
    reply.top.forEach((entry, i) => {
      const row = document.createElement('li');
      if (view !== 'legacy' && entry.playerId?.toLowerCase() === playerIdentity().toLowerCase()) row.className = 'me';
      const rank = document.createElement('b'), name = document.createElement('span'), time = document.createElement('em');
      rank.textContent = String(i + 1); name.textContent = entry.name; time.textContent = fmt(entry.time);
      row.append(rank, name, time); box.appendChild(row);
    });
  } catch (error) { if (current(id)) status.textContent = failure(error); }
  finally { if (id === generation) loadCancel = null; }
}
