// 玩家實際會遇到的成本：不帶 ?sim（那會一次載入全部 184 個城市區塊），用正常的串流載入
//   GPMODE=gp   大獎賽台北（?gp&bot，倒數時）；GPMODE=free 自由駕駛；GPMODE=italy 大獎賽義大利
//   量三個時間點：剛進場、跑了一段、不同位置（鏡頭移到賽道不同處），每個點：繪製次數、三角形、已載入區塊數、記憶體
//   逐一關掉最大的 InstancedMesh 看各占多少（跟 render-cost.mjs 同一種做法）
//   用 composer 的真實畫面（含 bloom）量不到三角形，所以量 scene 本身的 renderer.render，另外記錄 composer 多出的 pass 數
// 用法：GPMODE=gp bash run-node.sh stream-cost.mjs
const port = process.argv[2], MODE = process.env.GPMODE || 'gp';
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200)); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('HeapProfiler.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const ev = async (e, aw = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) => ev(`(async () => { for (let k = 0; k < ${n}; k++) await new Promise((r) => requestAnimationFrame(() => r())); return 1; })()`, true);
const url = MODE === 'gp' ? 'http://localhost:4317/?gp&bot' : MODE === 'italy' ? 'http://localhost:4317/?circuit=italy&gp&bot' : 'http://localhost:4317/?free';
await send('Page.navigate', { url });
const want = MODE === 'free' ? ['free'] : ['race', 'countdown'];
let st = '';
for (let k = 0; k < 400; k++) { await sleep(1000); st = await ev('window.__gp?.state'); if (want.includes(st)) break; }
console.log('模式', MODE, 'state', st);
const probe = `(() => {
  const r = __gp.renderer, i = r.info; i.autoReset = false;
  const once = () => { i.reset(); r.render(__gp.scene, __gp.camera); return [i.render.calls, i.render.triangles]; };
  once(); const [c0, t0] = once();
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const rows = [];
  __gp.scene.traverse((o) => { if (!o.isInstancedMesh || !vis(o)) return; const g = o.geometry, per = (g.index ? g.index.count : g.attributes.position.count) / 3; rows.push({ o, n: o.count, per, tot: o.count * per }); });
  rows.sort((a, b) => b.tot - a.tot);
  const top = [];
  for (const row of rows.slice(0, 6)) { row.o.visible = false; const [c1, t1] = once(); row.o.visible = true; top.push(row.n + '×' + row.per + ' → ' + (t0 - t1) + ' 三角形 / ' + (c0 - c1) + ' 次'); }
  const mem = i.memory;
  const st = __gp.stream;
  const hp = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return JSON.stringify({ 繪製次數: c0, 三角形: t0, 幾何體: mem.geometries, 貼圖: mem.textures, 已載入區塊: st ? st.loaded : null, 等待中: st ? st.pending : null, 區塊總數: st ? st.total : null, JS堆積MB: hp, 前六大: top });
})()`;
const at = async (label) => { await frames(6); console.log(label, await ev(probe)); };
await at('① 剛進場      ');
await sleep(4000); await at('② 4 秒後      ');
// 玩家車移到賽道上不同的位置，等串流載入
if (MODE !== 'free') {
  for (const frac of [0.25, 0.5, 0.75]) {
    await ev(`(() => { const t = __gp.track, i = Math.floor(t.N * ${frac}), c = __gp.car; c.x = t.px[i]; c.z = t.pz[i]; c.h = Math.atan2(t.tx[i], t.tz[i]); c.pos.i = i; const g = __gp, fx = Math.sin(c.h), fz = Math.cos(c.h); g.camera.position.set(c.x - fx * 8, t.py[i] + 2.9, c.z - fz * 8); g.camera.lookAt(c.x + fx * 6, t.py[i] + 1.2, c.z + fz * 6); return 1; })()`);
    await sleep(5000);
    await at(`③ 賽道 ${Math.round(frac * 100)}% 處`);
  }
}
console.log('例外:', errs.length ? errs.join(' | ') : '無');
process.exit(0);
