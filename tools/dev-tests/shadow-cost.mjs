// 陰影那一輪占多少：同一個畫面，開陰影與關陰影各量一次繪製次數與三角形；再分別看 AI 車、城市其他東西在陰影那一輪的貢獻
//   做法：renderer.shadowMap.enabled 切換（第一次切換會重編著色器，所以每種設定先畫兩次再量）
// 用法：GPMODE=gp bash run-node.sh shadow-cost.mjs
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200)); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
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
  const measure = () => { once(); once(); return once(); };
  const sh = r.shadowMap.enabled;
  const withShadow = measure();
  // 這一格有多少網格「會投影」（castShadow）、其中屬於 AI 車的有多少
  let casters = 0, carCasters = 0; const carRoots = new Set(F.racers.filter((x) => x.model).map((x) => x.model.root));
  g.scene.traverse((o) => { if (o.isMesh && o.castShadow && o.visible) { casters++; for (let p = o; p; p = p.parent) if (carRoots.has(p)) { carCasters++; break; } } });
  r.shadowMap.enabled = false; g.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
  const noShadow = measure();
  r.shadowMap.enabled = sh; g.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
  once();
  return JSON.stringify({ 陰影開: { 繪製: withShadow[0], 三角形: withShadow[1] }, 陰影關: { 繪製: noShadow[0], 三角形: noShadow[1] }, 陰影那一輪: { 繪製: withShadow[0] - noShadow[0], 三角形: withShadow[1] - noShadow[1] }, 會投影的網格: casters, 其中AI車的: carCasters, 陰影解析度: g.scene.children.length ? '看 Q.shadowSize' : '' }, null, 1);
})()`));
console.log('例外:', errs.length ? errs.join(' | ') : '無');
process.exit(0);
