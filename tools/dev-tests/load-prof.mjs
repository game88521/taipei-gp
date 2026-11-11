// 頁面啟動 → city.json 請求發出之間，主執行緒在做什麼：用 CPU profile 取樣，列出這段時間最耗的函式
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); let cityAt = 0, t0 = 0;
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.method === 'Network.requestWillBeSent') { if (!t0) t0 = d.params.timestamp; if (d.params.request.url.includes('/data/city.json')) cityAt = Math.round((d.params.timestamp - t0) * 1000); }
  if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Network.enable'); await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Profiler.start');
await send('Page.navigate', { url: 'http://localhost:4317/?notraffic' });
for (let k = 0; k < 100 && !cityAt; k++) await sleep(100);
const { result } = await send('Profiler.stop');
const prof = result.profile, nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map(); let total = 0, clock = 0; const startTs = prof.startTime;
prof.samples.forEach((id, i) => { const dt = prof.timeDeltas[i] / 1000; clock += dt; if (clock > cityAt) return; const n = nodes.get(id); const key = `${n.callFrame.functionName || '(匿名)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(key, (self.get(key) ?? 0) + dt); total += dt; });
console.log('city.json 請求發出時間 ms =', cityAt, '；取樣總時間 ms =', Math.round(total));
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(String(Math.round(v)).padStart(6), k));
process.exit(0);
