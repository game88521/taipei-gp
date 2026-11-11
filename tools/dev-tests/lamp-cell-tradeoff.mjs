// 離線：路燈格子大小的取捨。讀 city.json 的路燈座標（跟 decodeCity 一樣是差值整數格式，這裡改成直接進瀏覽器取 __gp.cityData.lamps 最準）
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.navigate', { url: 'http://localhost:4317/?bot&gp&sim=6' });
for (let k = 0; k < 250; k++) { await sleep(1000); if ((await ev('window.__gp?.state')) === 'race') break; }
await sleep(1500);
console.log(await ev(`(() => {
  const g = __gp, L = g.cityData.lamps || [], n = L.length / 3, t = g.track;
  const pts = []; for (let i = 0; i < t.N; i += Math.max(1, Math.round(100 / t.ds))) pts.push([t.px[i], t.pz[i]]);
  const rows = [];
  for (const CELL of [150, 200, 300, 450, 600]) {
    const cells = new Map();
    for (let i = 0; i < n; i++) { const k = Math.floor(L[i * 3] / CELL) + ',' + Math.floor(L[i * 3 + 1] / CELL); cells.set(k, (cells.get(k) || 0) + 1); }
    const list = [...cells.entries()].map(([k, c]) => { const [a, b] = k.split(',').map(Number); return { cx: (a + 0.5) * CELL, cz: (b + 0.5) * CELL, n: c }; });
    const out = {};
    for (const [lv, R] of Object.entries({ high: 1900, medium: 1450, low: 1000 })) {
      let inst = 0, cellsIn = 0;
      for (const [px, pz] of pts) for (const c of list) if (Math.hypot(c.cx - px, c.cz - pz) < R + CELL * 0.71) { inst += c.n; cellsIn++; }
      out[lv] = { 平均格子數: Math.round(cellsIn / pts.length), 平均實例: Math.round(inst / pts.length), 繪製次數: Math.round(cellsIn / pts.length) * 3, 夜間繪製次數: Math.round(cellsIn / pts.length) * 4 };
    }
    rows.push({ 格子邊長m: CELL, 總格子數: list.length, 各畫質: out });
  }
  return JSON.stringify({ 現在: '3 次繪製（夜間 4 次）、18761 個實例', 各格子大小: rows }, null, 1);
})()`));
process.exit(0);
