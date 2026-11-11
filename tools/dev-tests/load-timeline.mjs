// 首頁載入時間線：各資源的請求開始時間（相對導覽起點），看 city.json 比主程式晚多少才發出
// 用法：bash run-node.sh load-timeline.mjs
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map();
const reqs = new Map(); let t0 = 0;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Network.requestWillBeSent') { if (!t0) t0 = d.params.timestamp; reqs.set(d.params.requestId, { n: new URL(d.params.request.url).pathname, start: Math.round((d.params.timestamp - t0) * 1000) }); } if (d.method === 'Network.loadingFinished' && reqs.has(d.params.requestId)) { const r = reqs.get(d.params.requestId); r.end = Math.round((d.params.timestamp - t0) * 1000); r.kb = Math.round(d.params.encodedDataLength / 1024); } if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: 1e6 }); // 約 10 Mbps、40 ms：一般手機 4G
await send('Emulation.setCPUThrottlingRate', { rate: 1 }); await send('Network.setCacheDisabled', { cacheDisabled: true });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const navAt = performance.now(); let menuAt = 0;
await send('Page.navigate', { url: 'http://localhost:4317/?notraffic&prof' });
for (let k = 0; k < 300; k++) { await sleep(1000); if ((await ev('window.__gp?.state')) === 'menu') { menuAt = Math.round(performance.now() - navAt); break; } }
const rows = [...reqs.values()].filter((r) => !r.n.startsWith('/data/tiles/'));
for (const r of rows) console.log(String(r.start).padStart(6), String(r.end).padStart(6), String(r.kb).padStart(6) + 'KB', r.n);
console.log('進選單（從導覽起算）ms ≈', menuAt);
process.exit(0);
