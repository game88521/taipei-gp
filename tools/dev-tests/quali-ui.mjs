// 真正非 BOT 頁面：完圈後的進度、取消、超時排序、重跑與接續正賽。
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const port = process.argv[2];
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(), exceptions = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data), job = pending.get(m.id);
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
  if (!job) return;
  pending.delete(m.id); clearTimeout(job.timer);
  m.error ? job.reject(new Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(new Error(`${method} 逾時`)); }, 120000);
  pending.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;
};
const until = async (expression) => {
  const deadline = Date.now() + 120000;
  while (!await ev(expression)) { if (Date.now() > deadline) throw new Error(`等待逾時：${expression}`); await new Promise((r) => setTimeout(r, 100)); }
};
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:4317/?circuit=monaco&q=low' });
  await until('!!window.__gp && __gp.state === "menu" && !document.getElementById("btn-gp").disabled');
  await ev(`(() => {
    const g = __gp;
    g.renderer.setAnimationLoop(null);
    window.__updates = g.field.racers.map((r) => r.car.update);
    window.__asyncQualify = g.field.qualifyAsync.bind(g.field);
    window.__driveLap = () => {
      g.sound.started = false;
      g.input.read = () => {
        const c = g.car, t = g.track, i = c.pos.i;
        const j = (i + Math.round((8 + c.v * 0.45) / t.ds)) % t.N;
        let err = Math.atan2(t.px[j] - c.x, t.pz[j] - c.z) - c.h;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        const ahead = (i + Math.round(c.v * 0.5 / t.ds)) % t.N;
        c.drs = g.field.drsZoneAt(c.pos.s) >= 0;
        return { steer: Math.max(-1, Math.min(1, -err * 2.5)), brake: c.v > t.vTarget[ahead] + 1, throttle: true };
      };
      let steps = 0;
      while (g.qualiRun && steps++ < 120 * 210) g.step(1 / 120);
      if (g.qualiRun) throw new Error('測試駕駛未完成排位圈');
      return { state: g.state, visible: !document.getElementById('quali-res').classList.contains('hidden'), busy: document.getElementById('quali-res').getAttribute('aria-busy'), progress: !document.getElementById('quali-progress').hidden, goHidden: document.getElementById('quali-go').style.display === 'none' };
    };
    window.__startGp = async () => {
      document.getElementById('btn-gp').click();
      const deadline = performance.now() + 15000;
      while (!document.querySelector('.cp-go:not(:disabled)')) {
        if (performance.now() > deadline) throw new Error('選賽道頁未就緒');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      document.querySelector('.cp-go:not(:disabled)').click();
    };
    window.__rows = () => [...document.querySelectorAll('#quali-table tr')].slice(1).map((r) => [...r.cells].map((c) => c.textContent));
    return true;
  })()`);
  // 取消發生在實際計算已有進度之後，使用真正的 Escape 返回操作。
  await ev(`__gp.field.qualifyAsync = (progress, signal) => __asyncQualify((done, total) => { progress?.(done, total); if (done > 0) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); }, signal); __startGp()`);
  await until('__gp.qualiRun');
  const busy = await ev('__driveLap()');
  assert.deepEqual(busy, { state: 'qualifying', visible: true, busy: 'true', progress: true, goHidden: true });
  await until('__gp.state === "menu"');
  const cancelled = await ev(`({ hidden: document.getElementById('quali-res').classList.contains('hidden'), released: !__gp.field.solo })`);
  assert.deepEqual(cancelled, { hidden: true, released: true });
  await ev(`__gp.field.qualifyAsync = __asyncQualify; __gp.field.racers[0].car.update = () => 0; __startGp()`);
  await until('__gp.qualiRun');
  await ev('__driveLap()');
  await until('__gp.state === "results"');
  const oneTimeout = await ev(`({ rows: __rows(), lastName: __gp.field.racers[0].name, progressHidden: document.getElementById('quali-progress').hidden, goVisible: document.getElementById('quali-go').style.display !== 'none', legend: document.getElementById('quali-legend').textContent })`);
  assert.equal(oneTimeout.rows.length, 22);
  assert.equal(oneTimeout.rows.filter((r) => r[3] === '無有效圈').length, 1);
  assert.ok(oneTimeout.rows[21][1].startsWith(oneTimeout.lastName));
  assert.equal(oneTimeout.rows[21][4], '');
  assert.ok(oneTimeout.progressHidden && oneTimeout.goVisible);
  assert.ok(oneTimeout.legend.includes('1 位對手未在 150 秒內完成'));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL('shots-quali-ui-timeout.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  // 重跑，同時涵蓋全部 AI 超時：玩家仍是有效竿位，其他人保留原順序。
  await ev(`__gp.field.racers.forEach((r) => { if (!r.isPlayer) r.car.update = () => 0; }); document.getElementById('quali-again').click()`);
  await until('__gp.qualiRun');
  await ev('__driveLap()');
  await until('__gp.state === "results"');
  const allTimeout = await ev(`({ rows: __rows(), order: __gp.field.racers.filter((r) => !r.isPlayer).map((r) => r.name), title: document.getElementById('quali-title').textContent })`);
  assert.equal(allTimeout.rows[0][1], '你');
  assert.equal(allTimeout.rows.filter((r) => r[3] === '無有效圈').length, 21);
  allTimeout.rows.slice(1).forEach((r, i) => { assert.ok(r[1].startsWith(allTimeout.order[i])); assert.equal(r[4], ''); });
  assert.ok(!JSON.stringify(allTimeout.rows).includes('NaN'));
  assert.equal(allTimeout.title, '🏁 竿位！');
  await ev(`__gp.field.racers.forEach((r, i) => r.car.update = __updates[i]); document.getElementById('quali-go').click()`);
  await until('__gp.state === "countdown"');
  const grid = await ev(`({ tt: __gp.field.ttMode, playerSlot: __gp.field.standings().findIndex((r) => r.isPlayer), solo: __gp.field.solo })`);
  assert.deepEqual(grid, { tt: false, playerSlot: 0, solo: false });
  assert.deepEqual(exceptions, []);
  const result = { busy, cancelled, oneTimeout: { rows: oneTimeout.rows.length, invalid: 1, last: oneTimeout.rows[21] }, allTimeout: { invalid: 21, validPole: true, stableOrder: true }, grid, exceptions };
  writeFileSync(new URL('shots-quali-ui.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { ws.close(); }
