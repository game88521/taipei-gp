// 起跑區每格約 1,084 次繪製、賽道中段只有約 470 次：多出來的 600 多次是什麼？
//   在起跑區（倒數時），把場景裡「可見、會被畫」的網格依類型、材質、父層分組，數各組的繪製次數（一個 Mesh／Sprite 一次；InstancedMesh 一次）
//   另外用 renderer.info 實際量：逐組關掉看繪製次數掉多少
// 用法：bash run-node.sh start-cost.mjs
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
  const g = __gp, r = g.renderer, info = r.info; info.autoReset = false;
  const once = () => { info.reset(); r.render(g.scene, g.camera); return info.render.calls; };
  once(); const base = once();
  // 每個「會畫」的東西歸到一個群組：類型 + 材質種類 + 最上層祖先（scene 的直接子物件）的名稱或類型＋子物件數
  const top = (o) => { let p = o; while (p.parent && p.parent !== g.scene) p = p.parent; return p; };
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const groups = new Map();
  g.scene.traverse((o) => {
    if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine) || !vis(o)) return;
    const t = top(o), m = Array.isArray(o.material) ? o.material[0] : o.material;
    const key = (o.isInstancedMesh ? 'Inst' : o.isSprite ? 'Sprite' : o.isMesh ? 'Mesh' : o.type) + ' | ' + (m ? m.type.replace('Material', '') : '?') + ' | 頂層:' + (t.name || t.type) + '(' + t.children.length + ')';
    if (!groups.has(key)) groups.set(key, { n: 0, objs: [], top: t });
    const e = groups.get(key); e.n++; e.objs.push(o);
  });
  const rows = [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  const out = [];
  for (const [k, e] of rows) {
    for (const o of e.objs) o.visible = false;
    const c = once();
    for (const o of e.objs) o.visible = true;
    // 這一組的物件分佈多遠（離鏡頭）
    const cp = g.camera.position, ds = e.objs.map((o) => { const v = o.getWorldPosition(new cp.constructor()); return Math.hypot(v.x - cp.x, v.z - cp.z); }).sort((a, b) => a - b);
    out.push({ 群組: k, 物件數: e.n, 關掉省繪製: base - c, 距離中位m: Math.round(ds[ds.length >> 1]), 最遠m: Math.round(ds[ds.length - 1]) });
  }
  return JSON.stringify({ 總繪製: base, 各組: out }, null, 1);
})()`));
console.log('例外:', errs.length ? errs.join(' | ') : '無');
process.exit(0);
