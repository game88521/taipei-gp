// 由 tools/icon-art.svg（圖案）組出三種圖示 SVG：
//   public/icon.svg            分頁小圖示（圓角底板＋細金邊）
//   tools/icon-full.svg        App 圖示（滿版方形，iOS／Android 自己裁圓角）→ icon-180／192／512.png
//   tools/icon-maskable.svg    Android 可裁切圖示（圖案縮在中間 80% 安全區內）→ icon-maskable-512.png
// PNG 用無頭 Chrome 輸出：node tools/build-icons.mjs 之後跑 Temp 裡的 gp-icon2.mjs（見下方說明）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const art = readFileSync(here('./icon-art.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const bg = `
<defs>
  <radialGradient id="bg" cx="0.32" cy="0.18" r="1.05">
    <stop offset="0" stop-color="#232a3e"/>
    <stop offset="0.55" stop-color="#10131d"/>
    <stop offset="1" stop-color="#05060a"/>
  </radialGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.07"/>
    <stop offset="0.45" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
</defs>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${body}</svg>\n`;
const scaled = (k) => `<g transform="translate(${256 - 256 * k} ${256 - 256 * k}) scale(${k})">${art}</g>`;

// 分頁小圖示：圓角底板、內側一圈很細的香檳金邊
writeFileSync(here('../public/icon.svg'), svg(`
<rect width="512" height="512" rx="112" fill="url(#bg)"/>
<rect width="512" height="512" rx="112" fill="url(#sheen)"/>
${scaled(0.96)}
<rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#e8cf94" stroke-opacity="0.28" stroke-width="3"/>`));
// App 圖示：滿版方形（系統自己裁圓角）
writeFileSync(here('./icon-full.svg'), svg(`
<rect width="512" height="512" fill="url(#bg)"/>
<rect width="512" height="512" fill="url(#sheen)"/>
${scaled(0.92)}`));
// Android 可裁切：圖案縮到 72%，裁成圓形也不會切到塔尖和弧線
writeFileSync(here('./icon-maskable.svg'), svg(`
<rect width="512" height="512" fill="url(#bg)"/>
<rect width="512" height="512" fill="url(#sheen)"/>
${scaled(0.72)}`));
console.log('icon.svg、icon-full.svg、icon-maskable.svg 已更新');
