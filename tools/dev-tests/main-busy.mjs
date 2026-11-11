// 導覽到進選單之間：主執行緒忙碌的區段（>50 ms 的長任務），以及 city.json 請求開始／結束時間，判斷下載有沒有被 CPU 工作擋住
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); let t0 = 0; const ev2 = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.method === 'Network.requestWillBeSent') { if (!t0) t0 = d.params.timestamp; if (d.params.request.url.includes('city.json')) ev2.reqAt = Math.round((d.params.timestamp - t0) * 1000); }
  if (d.method === 'Network.responseReceived' && d.params.response.url.includes('city.json')) ev2.respAt = Math.round((d.params.timestamp - t0) * 1000);
  if (d.method === 'Network.loadingFinished' && d.params.requestId && ev2.reqAt != null && ev2.doneAt == null && d.params.encodedDataLength > 1e6) ev2.doneAt = Math.round((d.params.timestamp - t0) * 1000);
  if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: 1e6 });
await send('Network.setCacheDisabled', { cacheDisabled: true });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const navAt = performance.now();
await send('Page.navigate', { url: 'http://localhost:4317/?notraffic' });
let menuAt = 0;
for (let k = 0; k < 600; k++) { await sleep(100); if ((await ev('window.__gp?.state')) === 'menu') { menuAt = Math.round(performance.now() - navAt); break; } }
console.log(JSON.stringify({ city請求: ev2.reqAt, 開始收到: ev2.respAt, 下載完: ev2.doneAt, 進選單: menuAt }));
process.exit(0);
