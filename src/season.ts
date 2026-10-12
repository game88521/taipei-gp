// 賽季模式：照 2026 賽曆 23 站一站一站比，名次照 F1 的計分（前十名 25-18-15-12-10-8-6-4-2-1）累積車手與車隊積分。
// 進度存在 save.season；每一站是帶 ?circuit=…&season=1 重新載入（賽道模式）

import { CIRCUITS } from './circuits';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export interface SeasonSave { round: number; results: { id: string; order: string[] }[] }
export interface DriverRow { name: string; team: string; pts: number; wins: number; podiums: number; best: number }

/** 車手積分榜（team：車手 → 車隊） */
export function driverStandings(s: SeasonSave, team: (name: string) => string): DriverRow[] {
  const m = new Map<string, DriverRow>();
  for (const r of s.results) r.order.forEach((name, k) => {
    let d = m.get(name);
    if (!d) m.set(name, (d = { name, team: team(name), pts: 0, wins: 0, podiums: 0, best: 99 }));
    d.pts += POINTS[k] ?? 0;
    if (k === 0) d.wins++;
    if (k < 3) d.podiums++;
    d.best = Math.min(d.best, k + 1);
  });
  // 同分：勝場多的在前，再比最好名次
  return [...m.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.best - b.best);
}

export function teamStandings(rows: DriverRow[]): { team: string; pts: number }[] {
  const m = new Map<string, number>();
  for (const d of rows) m.set(d.team, (m.get(d.team) ?? 0) + d.pts);
  return [...m].map(([team, pts]) => ({ team, pts })).sort((a, b) => b.pts - a.pts);
}

export const roundName = (k: number) => { const c = CIRCUITS[k]; return c ? `第 ${k + 1} 站 ${c.flag} ${c.gp}` : ''; };

/** 積分榜的表格 HTML（me：玩家的名字，會標紅）；limit：只列前幾名（玩家不在裡面就補在最後） */
export function standingsHtml(rows: DriverRow[], me: string, limit = 99): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const shown = rows.slice(0, limit);
  const mi = rows.findIndex((r) => r.name === me);
  if (mi >= limit) shown.push(rows[mi]);
  return '<tr><th>名次</th><th>車手</th><th>車隊</th><th>積分</th><th>勝場</th></tr>' + shown.map((r) => {
    const k = rows.indexOf(r);
    return `<tr class="${r.name === me ? 'me' : ''}"><td>${k + 1}</td><td>${esc(r.name)}</td><td>${esc(r.team)}</td><td>${r.pts}</td><td>${r.wins}</td></tr>`;
  }).join('');
}
