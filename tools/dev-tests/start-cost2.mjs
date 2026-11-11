// 起跑區 378 個 MeshStandard 網格（540 次繪製）是什麼：看它們的上層結構
//   如果是 22 台 F1：每台幾個網格、幾次繪製（材質數）、每台的三角形；遠處的車還要畫這麼細嗎
// 用法：bash run-node.sh start-cost2.mjs
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const ev = async (e, aw = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.navigate', { url: 'http://localhost:4317/?gp&bot' });
for (let k = 0; k < 400; k++) { await sleep(1000); const s = await ev('window.__gp?.state'); if (s === 'race' || s === 'countdown') break; }
await ev(`(async () => { for (let k = 0; k < 6; k++) await new Promise((r) => requestAnimationFrame(() => r())); return 1; })()`, true);
await ev('__gp.renderer.setAnimationLoop(null)');
console.log(await ev(`(() => {
  const g = __gp, F = g.field, r = g.renderer, info = r.info; info.autoReset = false;
  const once = () => { info.reset(); r.render(g.scene, g.camera); return [info.render.calls, info.render.triangles]; };
  once(); const [c0, t0] = once();
  // 每台 AI 車的模型：網格數、材質數、三角形
  const cars = F.racers.filter((x) => x.model).map((x) => x.model);
  const per = (root) => { let meshes = 0, tris = 0; const mats = new Set(); root.traverse((o) => { if (!o.isMesh || !o.visible) return; meshes++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m.uuid)); }); return { meshes, tris, mats: mats.size }; };
  const p0 = per(cars[0].root);
  // 全部 AI 車藏起來：省多少
  for (const m of cars) m.root.visible = false;
  const [c1, t1] = once();
  for (const m of cars) m.root.visible = true;
  // 只留最近 6 台：省多少（模擬「遠處的車用簡化模型」的上限）
  const cp = g.camera.position, byD = cars.map((m) => [m, Math.hypot(m.root.position.x - cp.x, m.root.position.z - cp.z)]).sort((a, b) => a[1] - b[1]);
  for (const [m] of byD.slice(6)) m.root.visible = false;
  const [c2, t2] = once();
  for (const [m] of byD) m.root.visible = true;
  // 每台車的子網格名稱／材質種類（看是哪些部位最多）
  const parts = new Map(); cars[0].root.traverse((o) => { if (!o.isMesh) return; const k = (Array.isArray(o.material) ? o.material[0] : o.material).type + (o.parent && o.parent.type === 'Group' ? ' (在 Group 裡)' : ''); parts.set(k, (parts.get(k) || 0) + 1); });
  return JSON.stringify({ 總繪製: c0, 總三角形: t0, AI車數: cars.length, 每台: p0, 每台的網格種類: Object.fromEntries(parts), 全部AI車藏起來省: { 繪製: c0 - c1, 三角形: t0 - t1 }, 只留最近6台省: { 繪製: c0 - c2, 三角形: t0 - t2 }, 最近6台距離m: byD.slice(0, 6).map((x) => Math.round(x[1])), 最遠m: Math.round(byD[byD.length - 1][1]) }, null, 1);
})()`));
process.exit(0);
