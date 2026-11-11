// 真實 AI 物理計算的主執行緒佔用對照；不載入城市、不連線外部服務。
import { readFileSync, writeFileSync } from 'node:fs';
const [port, label] = process.argv.slice(2);
if (!['before', 'after'].includes(label)) throw new Error('請指定 before 或 after');
writeFileSync(`dist/shots-quali-${label}.js`, readFileSync(new URL(`shots-quali-model-${label}.mjs`, import.meta.url)));
writeFileSync(`dist/shots-quali-${label}.html`, `<!doctype html><meta charset="utf-8"><title>排位量測</title><script type="module">import * as q from '/shots-quali-${label}.js'; window.__quali=q;</script>`);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data), job = pending.get(m.id); if (!job) return; pending.delete(m.id); clearTimeout(job.timer); m.error ? job.reject(new Error(JSON.stringify(m.error))) : job.resolve(m.result); };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(new Error(`${method} 逾時`)); }, 120000); pending.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; };
try {
  await send('Page.navigate', { url: `http://127.0.0.1:4317/shots-quali-${label}.html` });
  const deadline = Date.now() + 60000;
  while (!await ev('!!window.__quali')) { if (Date.now() > deadline) throw new Error('模組載入逾時'); await new Promise((r) => setTimeout(r, 100)); }
  const result = await ev(`(async () => {
    const { RaceField, buildTrack, Car, THREE } = __quali;
    const field = new RaceField(new THREE.Scene(), buildTrack(), new Car());
    window.__qfield = field;
    const originalRandom = Math.random;
    const run = async (asyncMode, stalled = false) => {
      let seed = 123, draws = 0;
      Math.random = () => { draws++; seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
      const first = field.racers[0], update = first.car.update;
      if (stalled) first.car.update = () => 0;
      let beats = 0, last = performance.now(), maxGap = 0;
      const interval = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; beats++; }, 4);
      const start = performance.now();
      try {
        const times = asyncMode ? await field.qualifyAsync() : field.qualify();
        const elapsed = performance.now() - start;
        maxGap = Math.max(maxGap, performance.now() - last);
        return { elapsed, beats, maxGap, draws, times: [...times].map(([r, t]) => [r.name, t]), stalledTime: times.get(first), solo: field.solo };
      } finally { clearInterval(interval); first.car.update = update; Math.random = originalRandom; }
    };
    // 首輪暖機另外報告；正式對照使用暖機後第二次。
    const warm = await run(false), sync = await run(false), stalled = await run(false, true);
    const asyncWarm = field.qualifyAsync ? await run(true) : null;
    const asyncResult = field.qualifyAsync ? await run(true) : null;
    const asyncStalled = field.qualifyAsync ? await run(true, true) : null;
    field.rules = '2026';
    const r26sync = await run(false), r26async = field.qualifyAsync ? await run(true) : null;
    field.rules = 'classic';
    let cancellation = null;
    if (field.qualifyAsync) {
      const aborter = new AbortController();
      let reached = 0, rejected = false;
      try { await field.qualifyAsync((done) => { if (done > 0) { reached = done; aborter.abort(); } }, aborter.signal); }
      catch (error) { rejected = error.name === 'AbortError'; }
      const released = field.solo === false;
      const restarted = (await field.qualifyAsync()).size === 21;
      cancellation = { reached, rejected, released, restarted };
    }
    return { warm, sync, stalled, asyncWarm, asyncResult, asyncStalled, r26sync, r26async, cancellation };
  })()`);
  writeFileSync(new URL(`shots-quali-${label}.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, ...Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v?.times ? { ...v, times: `${v.times.length} 位 AI（完整數值見 JSON）` } : v])) }, null, 2));
} finally { ws.close(); }
