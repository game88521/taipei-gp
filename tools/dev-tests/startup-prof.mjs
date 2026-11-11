// 首屏 CPU 取樣：先 npx vite build --minify false，核對函式原名。
// 用法：node external-browser.mjs 9333 startup-prof.mjs
// Network.timestamp 與 Profiler.startTime 用同一單調時鐘，不混用相對起點。
import { writeFileSync } from 'node:fs';
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let seq = 0, navAt = 0, cityAt = 0;
const pending = new Map(), errors = [];
ws.onmessage = ({ data }) => {
  const d = JSON.parse(data);
  if (d.method === 'Network.requestWillBeSent') {
    const p = d.params;
    if (!navAt && p.type === 'Document') navAt = p.timestamp * 1e6;
    if (new URL(p.request.url).pathname === '/data/city.json') cityAt = p.timestamp * 1e6;
  }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails);
  const job = pending.get(d.id);
  if (!job) return;
  clearTimeout(job.timer); pending.delete(d.id);
  if (d.error) job.reject(new Error(JSON.stringify(d.error))); else job.resolve(d.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 逾時`)); }, 120000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};
try {
  await send('Runtime.enable'); await send('Network.enable'); await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 500 });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 1e6 });
  await send('Profiler.start');
  await send('Page.navigate', { url: 'http://127.0.0.1:4317/?notraffic&prof' });
  const deadline = Date.now() + 180000;
  let nextReport = Date.now() + 10000;
  // state 初始化就可能是 menu；等 PROF 標題，才是城市與著色器準備完成。
  while (!await ev('window.__gp?.state === "menu" && document.title.startsWith("PROF ")')) {
    if (Date.now() > nextReport) {
      const state = await ev('({ state: window.__gp?.state, title: document.title, boot: document.getElementById("boot-label")?.textContent, pct: document.getElementById("boot-pct")?.textContent })');
      console.log('載入診斷', JSON.stringify(state));
      if (state.boot?.includes('失敗') || errors.length) throw new Error(JSON.stringify({ state, errors }));
      nextReport = Date.now() + 10000;
    }
    if (Date.now() > deadline) throw new Error('進選單逾時');
    await new Promise((r) => setTimeout(r, 100));
  }
  const { profile } = await send('Profiler.stop');
  const timing = await ev(`({ menuObservedMs: performance.now(), title: document.title, scripts: Array.from(document.scripts, (s) => s.src), city: performance.getEntriesByType('resource').find((r) => r.name.endsWith('/data/city.json'))?.toJSON() })`);
  await ev('__gp.renderer.setAnimationLoop(null)');
  if (!navAt || !cityAt) throw new Error('缺少導覽／city.json 時間戳');
  if (errors.length) throw new Error(JSON.stringify(errors));
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
  const summarize = (end) => {
    const self = new Map(), inclusive = new Map(); let clock = profile.startTime;
    const key = (n) => `${n.callFrame.functionName || '(匿名)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    profile.samples.forEach((id, i) => {
      const prev = clock; clock += profile.timeDeltas[i];
      const dt = Math.max(0, Math.min(clock, end) - Math.max(prev, navAt)) / 1000;
      if (!dt) return;
      const leaf = nodes.get(id), k = key(leaf); self.set(k, (self.get(k) ?? 0) + dt);
      const seen = new Set();
      for (let cur = id; cur != null; cur = parent.get(cur)) {
        const k = key(nodes.get(cur));
        if (!seen.has(k)) { inclusive.set(k, (inclusive.get(k) ?? 0) + dt); seen.add(k); }
      }
    });
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, ms]) => ({ name, ms: Math.round(ms) }));
    return { self: top(self), inclusive: top(inclusive) };
  };
  const result = { cityRequestMs: Math.round((cityAt - navAt) / 1000), timing, beforeCity: summarize(cityAt), fullStartup: summarize(profile.endTime) };
  writeFileSync(new URL('shots-load-profile.cpuprofile', import.meta.url), JSON.stringify(profile));
  writeFileSync(new URL('shots-load-profile.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { ws.close(); }
