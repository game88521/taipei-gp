// 手機橫向小螢幕的 HUD：667×375（iPhone SE）、844×390（iPhone 14）、740×360（Android 常見），觸控模式
//   大獎賽倒數＋自由駕駛各拍一張；同時列出所有可見的 HUD 元素的位置，算哪些互相重疊、哪些按鈕小於 44 px、哪些超出畫面
// 用法：bash run-node.sh hud-overlap.mjs
import fs from 'node:fs';
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200)); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable');
const ev = async (e, aw = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (f) => fs.writeFileSync(f, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
// 檢查：HUD 裡所有可見元素（有大小、不是透明）兩兩是否重疊；按鈕小於 44 px；超出畫面
const scan = `(() => {
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  // 只看 HUD 的「頂層區塊」：#hud 底下的直接子元素、加上一些已知會浮動的元件
  const hud = document.getElementById('hud'); if (!hud) return '{"err":"no hud"}';
  const items = [...hud.children].filter((el) => el.id && vis(el)).map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w > 2 && b.h > 2);
  const W = innerWidth, H = innerHeight, ov = [], small = [], out = [];
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const p = items[a], q = items[b];
    const ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x), iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    if (ix > 4 && iy > 4) ov.push(p.id + ' × ' + q.id + '（' + ix + '×' + iy + ' px）');
  }
  for (const el of hud.querySelectorAll('button')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.width > 2 && (r.width < 44 || r.height < 44)) small.push((el.id || el.textContent.trim().slice(0, 6)) + ' ' + Math.round(r.width) + '×' + Math.round(r.height)); }
  for (const b of items) if (b.x < 0 || b.y < 0 || b.x + b.w > W + 1 || b.y + b.h > H + 1) out.push(b.id + ' (' + b.x + ',' + b.y + ',' + b.w + '×' + b.h + ')');
  return JSON.stringify({ 畫面: W + '×' + H, 可見區塊數: items.length, 重疊: ov, 小於44px的按鈕: small, 超出畫面: out });
})()`;
for (const [w, h] of [[667, 375], [740, 360], [844, 390]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const [label, q, want] of [['大獎賽', '?gp&bot&notraffic', ['countdown', 'race']], ['自由駕駛', '?free&notraffic', ['free']], ['自由駕駛+時鐘', '?free&notraffic&time=auto', ['free']]]) {
    await send('Page.navigate', { url: 'http://localhost:4317/' + q });
    for (let k = 0; k < 250; k++) { await sleep(1000); if (want.includes(await ev('window.__gp?.state'))) break; }
    await sleep(2500);
    const r = await ev(scan);
    console.log(`${w}×${h} ${label}：${r}`);
    await shot(`./shots-hud-${w}x${h}-${label === '大獎賽' ? 'gp' : label === '自由駕駛' ? 'free' : 'freeclock'}.png`);
  }
}
console.log('例外:', errs.length ? errs.join(' | ') : '無');
process.exit(0);
