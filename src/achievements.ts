// 成就與統計：統計數字記在存檔（save.stats），達成條件就解鎖成就（save.ach），選單有一頁可以看

export interface Stats {
  dist: number; // 開了幾公尺
  nightDist: number; // 晚上開了幾公尺
  topSpeed: number; // km/h
  trips: number;
  earned: number; // 累積賺了多少錢
  knocked: number; // 撞倒的行道樹、路燈、號誌…
  escapes: number; // 甩掉警察幾次
  maxEscaped: number; // 甩掉過的最高星數
  busted: number;
  arrests: number; // 開巡邏車逮捕嫌犯
  gpWins: number;
  streetWins: number;
  honks: number;
  playTime: number; // 秒
}
export const emptyStats = (): Stats => ({ dist: 0, nightDist: 0, topSpeed: 0, trips: 0, earned: 0, knocked: 0, escapes: 0, maxEscaped: 0, busted: 0, arrests: 0, gpWins: 0, streetWins: 0, honks: 0, playTime: 0 });

interface Ach { id: string; icon: string; name: string; desc: string; value: (s: Stats) => number; goal: number }
export const ACHIEVEMENTS: Ach[] = [
  { id: 'trip1', icon: '🚕', name: '第一趟', desc: '完成一趟計程車載客', value: (s) => s.trips, goal: 1 },
  { id: 'trip50', icon: '🚖', name: '小黃達人', desc: '累積載客 50 趟', value: (s) => s.trips, goal: 50 },
  { id: 'rich', icon: '💰', name: '小有積蓄', desc: '累積賺到 NT$ 10,000', value: (s) => s.earned, goal: 10000 },
  { id: 'v200', icon: '⚡', name: '時速 200', desc: '開到時速 200 km', value: (s) => s.topSpeed, goal: 200 },
  { id: 'v300', icon: '🏎️', name: '時速 300', desc: '開到時速 300 km（F1 才辦得到）', value: (s) => s.topSpeed, goal: 300 },
  { id: 'km100', icon: '🛣️', name: '開了一百公里', desc: '累積駕駛 100 公里', value: (s) => s.dist / 1000, goal: 100 },
  { id: 'night', icon: '🌙', name: '夜貓子', desc: '晚上累積開 10 公里', value: (s) => s.nightDist / 1000, goal: 10 },
  { id: 'wreck', icon: '🌳', name: '拆遷大隊', desc: '撞倒 100 個行道樹、路燈或號誌', value: (s) => s.knocked, goal: 100 },
  { id: 'escape', icon: '😎', name: '甩掉警察', desc: '被通緝後成功甩掉警車', value: (s) => s.escapes, goal: 1 },
  { id: 'escape5', icon: '🔥', name: '亡命之徒', desc: '甩掉 5 星通緝', value: (s) => s.maxEscaped, goal: 5 },
  { id: 'cop', icon: '🚔', name: '正義使者', desc: '開巡邏車逮捕 10 個嫌犯', value: (s) => s.arrests, goal: 10 },
  { id: 'gp', icon: '🏆', name: '冠軍', desc: '贏得一場 F1 正賽', value: (s) => s.gpWins, goal: 1 },
  { id: 'street5', icon: '👑', name: '街頭之王', desc: '贏 5 場街頭比賽', value: (s) => s.streetWins, goal: 5 },
  { id: 'honk', icon: '📯', name: '喇叭狂', desc: '按喇叭 100 次', value: (s) => s.honks, goal: 100 },
];

/** 新達成的成就（還沒在 got 裡的） */
export function newlyUnlocked(s: Stats, got: string[]): Ach[] {
  return ACHIEVEMENTS.filter((a) => !got.includes(a.id) && a.value(s) >= a.goal);
}

/** 成就頁的 HTML：統計＋每個成就（沒達成的顯示進度） */
export function renderAchPage(s: Stats, got: string[]): string {
  const t = Math.round(s.playTime / 60);
  const rows: [string, string][] = [
    ['駕駛距離', `${(s.dist / 1000).toFixed(1)} km`], ['最高時速', `${Math.round(s.topSpeed)} km/h`], ['遊玩時間', `${t >= 60 ? `${Math.floor(t / 60)} 小時 ` : ''}${t % 60} 分`],
    ['載客趟數', `${s.trips}`], ['累積收入', `NT$ ${Math.round(s.earned).toLocaleString()}`], ['撞倒路邊物', `${s.knocked}`],
    ['甩掉警察', `${s.escapes} 次（最高 ${s.maxEscaped} 星）`], ['被逮捕', `${s.busted} 次`], ['逮捕嫌犯', `${s.arrests}`],
    ['正賽冠軍', `${s.gpWins}`], ['街頭比賽獲勝', `${s.streetWins}`], ['按喇叭', `${s.honks}`],
  ];
  const stat = rows.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  const ach = ACHIEVEMENTS.map((a) => {
    const done = got.includes(a.id), f = Math.min(1, a.value(s) / a.goal);
    return `<div class="ach${done ? ' done' : ''}"><i>${a.icon}</i><span><b>${a.name}</b><small>${a.desc}</small>${done ? '' : `<em style="--f:${(f * 100).toFixed(0)}%"></em>`}</span></div>`;
  }).join('');
  return `<div class="stats">${stat}</div><h3>成就 ${got.length} / ${ACHIEVEMENTS.length}</h3><div class="achs">${ach}</div>`;
}
