// AI 賽車遠近細節：起跑區同一畫面，量「全部完整」與「自動（遠的簡化）」的繪製次數／三角形／陰影，並檢查近車仍完整、換回來能還原
// 用法：bash run-node.sh lod-check.mjs
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
for (let k = 0; k < 400; k++) { if ((await ev('__gp.state')) === 'race') break; await ev('(() => { for (let i = 0; i < 100; i++) __gp.step(0.02); return 1; })()'); }
await ev('(() => { for (let i = 0; i < 600; i++) __gp.step(0.02); __gp.field.render(0.02); return 1; })()');
const out = await ev(`(() => {
  const g = __gp, F = g.field, r = g.renderer, info = r.info; info.autoReset = false;
  const once = () => { info.reset(); r.render(g.scene, g.camera); return [info.render.calls, info.render.triangles]; };
  const cars = F.racers.filter((x) => x.model);
  const near = [], far = [];
  for (const x of cars) { const d = Math.hypot(x.car.x - g.car.x, x.car.z - g.car.z); (x.model.root.userData.far ? far : near).push(Math.round(d)); }
  const shadows = () => { let n = 0; cars.forEach((x) => x.model.root.traverse((o) => { if (o.isMesh && o.castShadow) n++; })); return n; };
  const fineVis = () => { let v = 0, t = 0; cars.forEach((x) => (x.model.root.userData.fine || []).forEach((o) => { t++; if (o.visible) v++; })); return [v, t]; };
  once(); const auto = once(), sAuto = shadows(), fAuto = fineVis();
  // 全部強制完整
    return JSON.stringify({ auto, sAuto, fAuto, nearD: near.sort((a,b)=>a-b), farD: far.sort((a,b)=>a-b), 車數: cars.length });
})()`);
console.log('自動（render 後）：', out);
// 強制全部完整：用模組內的 setLod 沒暴露，改直接還原 visible／castShadow 再量
const full = await ev(`(() => {
  const g = __gp, F = g.field, r = g.renderer, info = r.info; info.autoReset = false;
  const once = () => { info.reset(); r.render(g.scene, g.camera); return [info.render.calls, info.render.triangles]; };
  const cars = F.racers.filter((x) => x.model);
  cars.forEach((x) => { (x.model.root.userData.fine || []).forEach((o) => { o.visible = true; }); x.model.root.traverse((o) => { if (o.isMesh && o.userData.cast !== undefined) o.castShadow = o.userData.cast; }); });
  once(); return JSON.stringify(once());
})()`);
console.log('全部完整：', full);
process.exit(0);
