import { MULTIPLAYER_TRACKS, CATALOG_STAMP } from '../shared/multiplayer-tracks.ts';
import type { GpChallenge, ChallengeResult } from './evolution-challenges';
export const DAILY_KEY = 'taipei-gp-expedition-daily-v1';
export const taipeiDay = (at = Date.now()) => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
export function dailyDefinition(day = taipeiDay()) {
  if (!/^20\d\d-\d\d-\d\d$/.test(day) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) throw Error('每日挑戰日期無效');
  let seed = 17; for (const ch of day + ':expedition-daily-v1') seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const map = MULTIPLAYER_TRACKS[seed % MULTIPLAYER_TRACKS.length], wet = seed % 3 === 0 ? .6 : 0;
  const def: GpChallenge = { id: `daily-${day}-${map.id}`, seed, title: `${day} 每日挑戰`, description: '固定經典方程式車／簡單AI／安全並排，P8滾動起跑，一圈守住前8且重撞最多2次。', grid: 8, goal: 8, remaining: 1, wear: .12, wet, hits: 2 };
  return { day, map, def, key: `${day}:${map.trackStamp}:classic:safe-v1:${seed}`, weather: wet ? '固定濕地60%／雨胎' : '固定乾地／軟胎' };
}
type DailyRow = { key: string; day: string; map: string; time: number; rank: number; hits: number; attempts: number; wins: number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
export class DailyRecords {
  private rows: DailyRow[] = []; private raw: string | null = null; private blocked = false; error = '';
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
    if(!storage)this.error='瀏覽器無法保存每日紀錄，本頁仍可挑戰。';
    try { this.raw = storage?.getItem(DAILY_KEY) ?? null; if (this.raw === null) return;
      const value: unknown = JSON.parse(this.raw);
      if (this.raw.length > 40000 || !object(value) || value.v !== 1 || Object.keys(value).length !== 2 || !Array.isArray(value.rows) || value.rows.length > 31 || new Set(value.rows.map(v => v?.key)).size !== value.rows.length) throw Error('invalid');
      for (const r of value.rows) { if (!object(r) || Object.keys(r).length !== 8 || typeof r.day !== 'string') throw Error('invalid'); const d = dailyDefinition(r.day);
        if (r.key !== d.key || r.map !== d.map.id || typeof r.time !== 'number' || !Number.isFinite(r.time) || r.time <= 0 || r.time > 1800 || !integer(r.rank, 1, 22) || !integer(r.hits, 0, 99) || !integer(r.attempts, 1, 1e6) || !integer(r.wins, 0, Number(r.attempts)) || Number(r.wins)>0&&(Number(r.rank)>d.def.goal||Number(r.hits)>d.def.hits)) throw Error('invalid'); }
      this.rows = value.rows as DailyRow[];
    } catch { this.blocked = true; this.error = '每日紀錄無法讀取，原資料未覆寫；本頁仍可挑戰。'; }
  }
  get(key: string) { const row = this.rows.find(r => r.key === key); return row ? { ...row } : null; }
  record(d: ReturnType<typeof dailyDefinition>, result: ChallengeResult) {
    if (!Number.isFinite(result.elapsed) || result.elapsed <= 0 || result.elapsed > 1800 || !integer(result.rank, 1, 22) || !integer(result.hits, 0, 99) || typeof result.success!=='boolean') return false;
    try{if(JSON.stringify(d)!==JSON.stringify(dailyDefinition(d.day)))return false;}catch{return false;}
    const success=result.success&&result.rank<=d.def.goal&&result.hits<=d.def.hits;
    const old = this.get(d.key), best = success && (!old || old.wins === 0 || result.elapsed < old.time);
    const row: DailyRow = { key: d.key, day: d.day, map: d.map.id, time: best || !old ? result.elapsed : old.time, rank: best || !old ? result.rank : old.rank, hits: best || !old ? result.hits : old.hits, attempts: Math.min(1e6, (old?.attempts ?? 0) + 1), wins: Math.min(1e6, (old?.wins ?? 0) + Number(success)) };
    this.rows = [row, ...this.rows.filter(r => r.key !== d.key)].slice(0, 31);
    if (this.blocked || !this.storage) return true;
    try { if (this.storage.getItem(DAILY_KEY) !== this.raw) { this.blocked = true; this.error = '每日紀錄已被其他頁變更，本頁暫停寫回以保留原資料。'; return true; }
      const next = JSON.stringify({ v: 1, rows: this.rows }); this.storage.setItem(DAILY_KEY, next); this.raw = next;
    } catch { this.error = '每日紀錄儲存失敗，成績只保留在本頁。'; }
    return true;
  }
}
export function validDailyStoreRaw(raw:string|null){return raw===null||!new DailyRecords({getItem:()=>raw,setItem:()=>{}}).error;}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
export function mountExpeditionDaily(host: HTMLElement, options: { trackId: string; start(def: GpChallenge): void; storage?: Storage | null }) {
  let storage = options.storage; if (storage === undefined) { try { storage = localStorage; } catch { storage = null; } }
  const records = new DailyRecords(storage ?? null), panel = el('details'); panel.id = 'expedition-daily'; panel.className = 'feature-card'; panel.append(el('summary', '每日固定條件挑戰 · 台北時間輪替'));
  const description = el('p'), status = el('p'), begin = el('button', '開始今日挑戰'), share = el('button', '複製挑戰與本機成績'), output = el('textarea');
  begin.type = share.type = 'button'; begin.id = 'expedition-daily-start'; share.id = 'expedition-daily-share'; status.id = 'expedition-daily-status'; status.setAttribute('role', 'status'); output.readOnly = true; output.rows = 4; output.hidden = true; output.setAttribute('aria-label', '每日挑戰分享文字'); output.style.width = '100%';
  const note = el('p', '每日UTC+8零時換題，24圖輪替。獨立最近31日紀錄，不更新正式PB／金錢／賽季；分享是本機成績，不是雲端認證排行榜。'); note.className = 'sub';
  panel.append(description, begin, share, status, output, note); host.append(panel);
  let selected = dailyDefinition(), launched: ReturnType<typeof dailyDefinition> | null = null;
  function refresh() {
    selected = dailyDefinition(); const row = records.get(selected.key); description.textContent = `${selected.day}｜${selected.map.name}｜${selected.weather}｜固定種子 ${selected.def.seed}｜${selected.def.description}`;
    begin.textContent = selected.map.id === options.trackId ? '開始今日挑戰' : `前往 ${selected.map.name} 挑戰`;
    status.textContent = records.error || (row ? `今日嘗試${row.attempts}次／通關${row.wins}次${row.wins ? `，最佳 ${row.time.toFixed(3)}秒／P${row.rank}／重撞${row.hits}` : '，尚未通關。'}` : '尚無今日紀錄。');
  }
  const invite = () => { const url = new URL(location.href); url.search = selected.map.id === 'taipei' ? '?daily=1' : `?circuit=${encodeURIComponent(selected.map.id)}&daily=1`; url.hash = ''; return url; };
  begin.onclick = () => { refresh(); if (selected.map.id !== options.trackId) { location.assign(invite()); return; } launched = selected; options.start(selected.def); };
  share.onclick = () => {
    refresh(); const row = records.get(selected.key);
    const text = `${selected.day} 台北街道賽每日挑戰\n${selected.map.name}｜${selected.weather}｜種子 ${selected.def.seed}\n${row?.wins ? `本機通關 ${row.time.toFixed(3)}秒／P${row.rank}／重撞${row.hits}` : '一起挑戰相同條件！'}\n${invite().href}\n版本 ${CATALOG_STAMP}`;
    output.hidden = false; output.value = text;
    if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => { status.textContent = '分享文字已複製。'; }, () => { output.focus(); output.select(); status.textContent = '可手動複製分享文字。'; });
    else { output.focus(); output.select(); status.textContent = '可手動複製分享文字。'; }
  };
  panel.addEventListener('toggle', refresh); refresh();
  let midnightTimer:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{clearTimeout(midnightTimer);midnightTimer=setTimeout(()=>{refresh();schedule();},86400000-(Date.now()+8*3600000)%86400000+20);};schedule();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();schedule();}});
  addEventListener('pageshow',()=>{refresh();schedule();});
  addEventListener('pagehide',()=>{clearTimeout(midnightTimer);midnightTimer=undefined;});
  if (new URLSearchParams(location.search).has('daily')) panel.open = true;
  return { panel, refresh, result(def: GpChallenge, value: ChallengeResult) { if (!launched || def.id !== launched.def.id || def.seed !== launched.def.seed) return; records.record(launched, value); refresh(); } };
}
