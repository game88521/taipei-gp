// 維修人員實際幾何、實例矩陣及同一鏡位截圖。先跑舊版，再跑新版做對照。
// 用法：node external-browser.mjs 9333 pit-geometry.mjs before
import { writeFileSync } from 'node:fs';
const [port, label = 'check'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('無效的輸出名稱');
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
const pending = new Map(), errors = [];
let nextId = 0;
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  const job = pending.get(m.id);
  if (!job) return;
  pending.delete(m.id); clearTimeout(job.timer);
  if (m.error) job.reject(new Error(JSON.stringify(m.error))); else job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 逾時`)); }, 120000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:4317/?gp&bot&notraffic' });
  const deadline = Date.now() + 400000;
  while (!await ev('!!window.__gp && ["countdown", "race"].includes(__gp.state)')) {
    if (Date.now() > deadline) throw new Error('等待維修區載入逾時');
    await new Promise((r) => setTimeout(r, 500));
  }
  const result = await ev(`(() => {
    const g = __gp, p = g.field.pitlane;
    g.renderer.setAnimationLoop(null);
    // 固定時間與 idle 姿勢，讓兩版的動畫矩陣及截圖可以比較。
    p.pose.fill(0); p.spd.fill(0); p.gait.fill(0);
    for (let k = 0; k < p.frames.length; k++) {
      for (let m = 0; m < 15; m++) { p.idlePose(k, m); p.yaw[k * 15 + m] = p.frames[k].h + Math.PI / 2; }
      p.place(k);
    }
    const rows = ['body', 'head', 'bone', 'tyre', 'band', 'sign'].map((key) => {
      const mesh = p[key], geo = mesh.geometry;
      geo.computeBoundingBox();
      return { key, instances: mesh.count, triangles: (geo.index?.count ?? geo.attributes.position.count) / 3 * mesh.count,
        positions: geo.attributes.position.count, bounds: geo.boundingBox.toArray ? geo.boundingBox.toArray() : [geo.boundingBox.min.toArray(), geo.boundingBox.max.toArray()],
        finite: Object.values(geo.attributes).every((a) => Array.from(a.array).every(Number.isFinite)),
        matrix: Array.from(mesh.instanceMatrix.array) };
    });
    const f = p.frames[0], c = g.camera;
    c.position.set(f.x + Math.cos(f.h) * 8 - Math.sin(f.h) * 5, f.y + 3.2, f.z - Math.sin(f.h) * 8 - Math.cos(f.h) * 5);
    c.lookAt(f.x, f.y + 1, f.z);
    c.updateProjectionMatrix();
    g.renderer.info.autoReset = false;
    const draw = () => { g.renderer.info.reset(); if (g.composer) g.composer.render(); else g.renderer.render(g.scene, c); return { ...g.renderer.info.render }; };
    draw(); const rendered = draw();
    return { rows, totalTriangles: rows.reduce((n, r) => n + r.triangles, 0), rendered };
  })()`);
  if (!result.rows.every((r) => r.finite)) throw new Error('幾何含有非有限數值');
  if (errors.length) throw new Error(JSON.stringify(errors));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(`shots-pit-${label}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
  writeFileSync(new URL(`shots-pit-${label}.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, totalTriangles: result.totalTriangles, rows: result.rows.map(({ matrix, ...r }) => r), rendered: result.rendered }, null, 2));
} finally { ws.close(); }
