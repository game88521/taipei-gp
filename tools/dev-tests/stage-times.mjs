// 載入畫面各階段（標籤＋百分比）出現的時間，從導覽起算；模擬約 10 Mbps／40 ms 的手機網路
// 用法：bash run-node.sh stage-times.mjs
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: 1e6 });
await send('Network.setCacheDisabled', { cacheDisabled: true });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
await send('Page.navigate', { url: 'http://localhost:4317/?notraffic' });
const seen = []; let last = '';
const probe = `(() => { const l = document.getElementById('boot-label'), p = document.getElementById('boot-pct'); return (l ? l.textContent : '-') + ' ' + (p ? p.textContent : '-'); })()`;
for (let k = 0; k < 600; k++) {
  await sleep(100);
  const lab = String(await ev(probe)).replace(/\d+(\.\d+)? MB/, 'n MB');
  if (lab !== last) { last = lab; seen.push(`${Math.round(performance.now() - t0)} ms  ${lab}`); }
  if ((await ev('window.__gp?.state')) === 'menu') { seen.push(`${Math.round(performance.now() - t0)} ms  [選單]`); break; }
}
console.log(seen.join('\n'));
process.exit(0);
