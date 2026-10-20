// 賽季模式：照 2026 賽曆 23 站一站一站比，名次照 F1 的計分（前十名 25-18-15-12-10-8-6-4-2-1）累積車手與車隊積分。
// 進度存在 save.season；每一站是帶 ?circuit=…&season=1 重新載入（賽道模式）。
// 這個檔案只放資料與算法（不碰畫面、不碰 DOM），scripts 可以直接 import 來驗證。

import { CIRCUITS } from './circuits';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
/** 最快圈加 1 分的條件：必須完賽名次進前十（F1 規則） */
export const FASTEST_LAP_POINT = 1;

/** 一站的結果（舊存檔只有 id 與 order；其餘都是後來加的，可以沒有） */
export interface RoundResult {
  id: string;
  order: string[]; // 名次（第一名在前）
  fl?: string; // 最快圈的車手
  grid?: string[]; // 發車順序（排位賽結果）
  dnf?: string[]; // 棄賽（拿 0 分、排在最後）
  you?: { grid: number; finish: number; pts: number }; // 你的發車位置、名次、這站得分
}
export interface SeasonSave {
  round: number;
  results: RoundResult[];
  laps?: number; // 整季固定的圈數（3 或 6）
  diff?: string; // 整季固定的 AI 難度
  rules?: string; // 整季固定的規則（classic／2026）
  seed?: number; // 車手狀態的亂數種子
  form?: Record<string, number>; // 每位 AI 車手目前的狀態 -1 … +1
  no?: number; // 這是第幾季（歷屆紀錄用）
  pending?: { id: string; grid: string[]; at: number }; // 正在比的那一站（開跑時寫入、正常結束時清掉；下次載入還在 = 中途離開 → 棄賽）
  paid?: boolean; // 賽季結束的獎金領過了
}
/** 歷屆賽季（賽季完成時寫入） */
export interface SeasonRecord { no: number; rank: number; pts: number; wins: number; champion: string; team: string; teamRank: number; laps: number }
export interface DriverRow { name: string; team: string; pts: number; wins: number; podiums: number; best: number; fls: number }

export const SEASON_LAPS = [3, 6];
export const defaultSeason = (laps = 3, diff = 'normal', rules = 'classic', no = 1): SeasonSave => ({
  round: 0, results: [], laps, diff, rules, seed: (Date.now() ^ Math.imul(no, 2654435761)) >>> 0, form: {}, no,
});

/** 簡單可重現的亂數（同一個種子永遠同一串） */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gauss = (r: () => number) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7071; }; // 近似標準常態

/** 這一站該給誰多少分：名次前十、棄賽 0 分；最快圈的人如果名次在前十多 1 分 */
export function roundPoints(r: RoundResult): Map<string, number> {
  const m = new Map<string, number>();
  const dnf = new Set(r.dnf ?? []);
  r.order.forEach((name, k) => m.set(name, dnf.has(name) ? 0 : POINTS[k] ?? 0));
  if (r.fl && !dnf.has(r.fl)) { const k = r.order.indexOf(r.fl); if (k >= 0 && k < POINTS.length) m.set(r.fl, (m.get(r.fl) ?? 0) + FASTEST_LAP_POINT); }
  return m;
}

/** 車手積分榜（team：車手 → 車隊） */
export function driverStandings(s: SeasonSave, team: (name: string) => string): DriverRow[] {
  const m = new Map<string, DriverRow>();
  for (const r of s.results) {
    const pts = roundPoints(r), dnf = new Set(r.dnf ?? []);
    r.order.forEach((name, k) => {
      let d = m.get(name);
      if (!d) m.set(name, (d = { name, team: team(name), pts: 0, wins: 0, podiums: 0, best: 99, fls: 0 }));
      d.pts += pts.get(name) ?? 0;
      if (dnf.has(name)) return; // 棄賽不算勝場、頒獎台、最好名次
      if (k === 0) d.wins++;
      if (k < 3) d.podiums++;
      d.best = Math.min(d.best, k + 1);
    });
    if (r.fl) { const d = m.get(r.fl); if (d) d.fls++; }
  }
  // 同分：勝場多的在前，再比最好名次
  return [...m.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.best - b.best);
}

export function teamStandings(rows: DriverRow[]): { team: string; pts: number }[] {
  const m = new Map<string, number>();
  for (const d of rows) m.set(d.team, (m.get(d.team) ?? 0) + d.pts);
  return [...m].map(([team, pts]) => ({ team, pts })).sort((a, b) => b.pts - a.pts);
}

export const roundName = (k: number) => { const c = CIRCUITS[k]; return c ? `第 ${k + 1} 站 ${c.flag} ${c.gp}` : ''; };

/** 每一站結束後累積到這一站為止的車手積分（走勢圖用）：回傳 name → [第 1 站後, 第 2 站後, …] */
export function pointsAfterEachRound(s: SeasonSave): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const total = new Map<string, number>();
  s.results.forEach((r, i) => {
    const pts = roundPoints(r);
    for (const name of r.order) total.set(name, (total.get(name) ?? 0) + (pts.get(name) ?? 0));
    for (const name of total.keys()) {
      let a = out.get(name);
      if (!a) out.set(name, (a = []));
      while (a.length < i) a.push(a.length ? a[a.length - 1] : 0);
      a[i] = total.get(name)!;
    }
  });
  return out;
}

/**
 * 冠軍爭奪：還剩 left 站，每站最多拿 25+1 分。回傳你與領先者的差距、
 * 你最多還能拿到的分數、你還有沒有機會、是不是已經確定冠軍。
 */
export function titleFight(rows: DriverRow[], me: string, left: number, played = 0) {
  const k = rows.findIndex((r) => r.name === me);
  if (k < 0 || !rows.length) return null;
  const max = (POINTS[0] + FASTEST_LAP_POINT) * left;
  const lead = rows[0], you = rows[k];
  // 「實際上有可能」的爭冠者：照每個人到目前為止的平均得分速度再放寬 1.6 倍（給翻身空間）往後推，追得上領先者才算；
  // 還沒比過就用理論上限（全部人都算）
  const pace = (r: DriverRow) => (played > 0 ? Math.min(POINTS[0] + FASTEST_LAP_POINT, (r.pts / played) * 1.6) : POINTS[0] + FASTEST_LAP_POINT);
  return {
    rank: k + 1, pts: you.pts, gap: lead.pts - you.pts, max, leader: lead.name,
    canWin: k === 0 || you.pts + max >= lead.pts, // 數學上還有可能（每站都拿滿）
    clinched: rows.length > 1 && k === 0 && you.pts - rows[1].pts > max, // 你已經確定冠軍
    contenders: rows.filter((r) => r.pts + pace(r) * left >= lead.pts).length, // 實際上還在爭冠的車手數
  };
}

/** 一站結束後更新每位車手的狀態：原本的狀態往 0 拉回 40%，再加一個隨機漫步（標準差 0.45） */
export function nextForm(prev: Record<string, number>, names: string[], seed: number, round: number): Record<string, number> {
  const r = rng((seed ^ Math.imul(round + 1, 40503)) >>> 0);
  const out: Record<string, number> = {};
  for (const n of names) out[n] = Math.max(-1, Math.min(1, (prev[n] ?? 0) * 0.6 + gauss(r) * 0.45));
  return out;
}
/** 狀態 → 性能倍率（±1.2%；很小，只是要讓冠軍不再永遠同一人） */
export const formFactor = (form: number) => 1 + form * 0.012;
/** 狀態標籤（排位成績表的小箭頭） */
export const formTag = (form: number) => (form > 0.4 ? '↑' : form < -0.4 ? '↓' : '');

/** 賽季結束時的獎金：完成賽季 1 萬；年度冠軍再 4 萬、前三再 1 萬；車隊冠軍另加 1 萬 */
export function seasonPrize(rank: number, teamRank: number): { cash: number; parts: string[] } {
  const parts: string[] = ['完成賽季 +NT$ 10,000'];
  let cash = 10000;
  if (rank === 1) { cash += 40000; parts.push('年度車手冠軍 +NT$ 40,000'); }
  else if (rank <= 3) { cash += 10000; parts.push('年度前三名 +NT$ 10,000'); }
  if (teamRank === 1) { cash += 10000; parts.push('車隊冠軍 +NT$ 10,000'); }
  return { cash, parts };
}

/** 積分榜的表格 HTML（me：玩家的名字，會標紅）；limit：只列前幾名（玩家不在裡面就補在最後）；form：車手狀態（顯示 ↑↓） */
export function standingsHtml(rows: DriverRow[], me: string, limit = 99, form?: Record<string, number>): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const shown = rows.slice(0, limit);
  const mi = rows.findIndex((r) => r.name === me);
  if (mi >= limit) shown.push(rows[mi]);
  return '<tr><th>名次</th><th>車手</th><th>車隊</th><th>積分</th><th>勝場</th></tr>' + shown.map((r) => {
    const k = rows.indexOf(r), tag = form ? formTag(form[r.name] ?? 0) : '';
    return `<tr class="${r.name === me ? 'me' : ''}"><td>${k + 1}</td><td>${esc(r.name)}${tag ? ` <small class="form ${tag === '↑' ? 'up' : 'down'}">${tag}</small>` : ''}</td><td>${esc(r.team)}</td><td>${r.pts}</td><td>${r.wins}</td></tr>`;
  }).join('');
}
