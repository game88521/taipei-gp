// 載入畫面：夜空、台北天際線剪影（中間是 101）、進度條、輪播小提示；街景載完淡出接上選單運鏡
// 天際線用固定亂數產生（每次長得一樣），窗戶零星亮燈

const TIPS = [
  '按住 🌀（電腦 Shift）甩尾，連續甩倍率最高 ×5，停下來 2 秒入帳',
  '開計程車載客賺錢，可以幫車子買烤漆',
  '撞到車或行人會被通緝：跑遠一點、躲久一點就能甩掉警察',
  '右上角的地圖可以點目的地，路上會出現導航',
  '「設定」可以切換時段天氣，雨夜最有氣氛',
  '街道賽地上的線：綠色全油門、紅色該煞車',
  '大獎賽在 DRS 區按 DRS，尾翼打開直線更快',
  '開巡邏車追捕嫌犯，逮到有獎金',
  '建築、道路都來自 OpenStreetMap：從信義區一路開到台北車站、西門町',
  '中正紀念堂、總統府、北門、西門紅樓都在地圖上，開過去看看',
  '行道樹、路燈都撞得倒，撞 100 個有成就',
];

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function skyline(): string {
  const r = rng(2026);
  const W = 1200, G = 300; // 地面 y
  let blds = '', wins = '';
  const tower = (x: number, w: number, h: number) => {
    blds += `<rect x="${x}" y="${G - h}" width="${w}" height="${h}"/>`;
    // 窗戶：每 7 px 一格，亮的機率 18%
    for (let yy = G - h + 6; yy < G - 6; yy += 7) for (let xx = x + 3; xx < x + w - 3; xx += 6) if (r() < 0.18) wins += `<rect x="${xx}" y="${yy}" width="2.4" height="3"/>`;
  };
  // 遠景一排矮樓（比較淡）
  let far = '';
  for (let x = -10; x < W; ) { const w = 18 + r() * 34, h = 40 + r() * 70; far += `<rect x="${x.toFixed(0)}" y="${(G - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>`; x += w + 2; }
  // 近景：101 兩側避開中間
  for (let x = -10; x < W; ) {
    const w = 22 + r() * 46, near101 = Math.abs(x + w / 2 - 600) < 70;
    const h = near101 ? 30 + r() * 30 : 50 + r() * (Math.abs(x - 600) < 260 ? 120 : 80);
    tower(Math.round(x), Math.round(w), Math.round(h));
    x += w + 4 + r() * 10;
  }
  // 101：裙樓、八節往外斜的竹節、頂冠、天線
  let t101 = '<rect x="574" y="232" width="52" height="68"/>';
  for (let k = 0; k < 8; k++) { const b = 232 - 20 * k, t = b - 20; t101 += `<polygon points="583,${b} 617,${b} 622,${t} 578,${t}"/>`; }
  t101 += '<polygon points="589,72 611,72 606,56 594,56"/><rect x="598.8" y="18" width="2.4" height="40"/>';
  let rings = '';
  for (let k = 0; k < 8; k++) rings += `<line x1="578" y1="${212 - 20 * k}" x2="622" y2="${212 - 20 * k}"/>`;
  return `<svg class="b-city" viewBox="0 0 ${W} ${G}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="b101" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6f68"/><stop offset="1" stop-color="#0f2c2a"/></linearGradient></defs>
    <g class="b-far">${far}</g><g class="b-near">${blds}</g><g class="b-win">${wins}</g>
    <g fill="url(#b101)">${t101}</g><g class="b-ring">${rings}</g><circle class="b-tip" cx="600" cy="18" r="2.6"/>
  </svg>`;
}

const el = document.getElementById('boot');
let tipT = 0;
if (el) {
  el.insertAdjacentHTML('afterbegin', skyline());
  const tip = document.getElementById('boot-tip')!;
  let k = Math.floor(Math.random() * TIPS.length);
  const next = () => { tip.classList.remove('show'); setTimeout(() => { tip.textContent = '💡 ' + TIPS[k++ % TIPS.length]; tip.classList.add('show'); }, 250); };
  next();
  tipT = window.setInterval(next, 4200);
}

/** 載入進度（label：現在在做什麼、f：0~1） */
export function bootProgress(label: string, f: number) {
  if (!el) return;
  document.getElementById('boot-label')!.textContent = label;
  document.getElementById('boot-pct')!.textContent = `${Math.round(f * 100)}%`;
  document.getElementById('boot-bar')!.style.width = `${Math.round(f * 100)}%`;
}

/** 載完：淡出 */
export function bootDone() {
  if (!el || el.classList.contains('done')) return;
  clearInterval(tipT);
  el.classList.add('done');
  setTimeout(() => el.remove(), 900);
}
