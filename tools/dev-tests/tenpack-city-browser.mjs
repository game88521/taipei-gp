// external-browser.mjs <CDP> tenpack-city-browser.mjs <expected-build> [http://127.0.0.1:<preview>]
// 必須由wrapper建立隔離context；只在root排定的CDP時段執行。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [port, expectedBuild, originArg] = process.argv.slice(2), origin = originArg ?? process.env.GP_TENPACK_ORIGIN ?? 'http://127.0.0.1:4318';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const sw = await readFile(path.join(root, 'dist/sw.js'), 'utf8'), build = sw.match(/const VERSION = '([^']+)'/)?.[1];
assert.ok(expectedBuild, '必須指定本輪build'); assert.equal(build, expectedBuild);
assert.equal(await (await fetch(origin + '/sw.js')).text(), sw, 'preview必須提供本工作副本的正式dist');
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
assert.equal(pages.length, 1, '必須使用external-browser單一隔離頁');
const target = pages.find((p) => p.type === 'page'); assert.ok(target);
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(target.webSocketDebuggerUrl).hostname));
const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0, currentCase = '啟動';
const report = { origin, build, isolatedContext: true, playerStorageTouched: false, realPhone: false,
  cases: [], layouts: [], screenshots: [], exceptions: [], externalRequests: [], dialogs: [],
  limitations: ['真城市/Router/Taxi/Police/UI；以合法道路座標準備停靠與已攔停狀態，並非完整實際駕駛/追緝或難度平衡驗證。',
    'renderer停自動loop及降解析度，僅固定freeStep小步進；手機尺寸為桌面Chrome模擬，不量測手機FPS/耗電。'] };
const sourceFiles = ['src/main.ts', 'src/save.ts', 'src/police.ts', 'src/taxi.ts', 'src/street-taxi-state.ts', 'src/city-jobs-state.ts',
  'src/city-jobs-ui.ts', 'src/freecar.ts', 'src/router.ts', 'src/mission.ts', 'index.html', 'src/style.css', 'dist/sw.js'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
}
report.sourceHashes = await sourceHashes();
report.buildSW = report.sourceHashes['dist/sw.js'];
report.script = { path: path.relative(root, fileURLToPath(import.meta.url)), sha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex') };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method}逾時`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ case: currentCase, text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
  if (m.method === 'Page.javascriptDialogOpening') { report.dialogs.push(m.params.message); void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); }
  if (m.method === 'Fetch.requestPaused') {
    const url = new URL(m.params.request.url), allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(m.params.request.url);
    void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
  }
  const job = pending.get(m.id); if (!job) return; pending.delete(m.id); clearTimeout(job.timer);
  m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
ws.onclose = () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('CDP已斷線')); } pending.clear(); };
// Hashing above can finish after the socket has already opened.
report.cdpConnection = { readyStateAtWait: ws.readyState };
await new Promise((resolve, reject) => {
  if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
  if (ws.readyState !== WebSocket.CONNECTING) { reject(Error('CDP在開始測試前已關閉')); return; }
  const timer = setTimeout(() => reject(Error('CDP連線開啟逾時')), 20000);
  ws.onopen = () => { clearTimeout(timer); resolve(); };
  ws.onerror = (error) => { clearTimeout(timer); reject(error); };
  ws.addEventListener('close', () => { clearTimeout(timer); reject(Error('CDP在開始測試前已關閉')); }, { once: true });
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value;
}
async function until(expression, timeout = 240000) {
  const end = Date.now() + timeout; while (Date.now() < end) { if (await ev(expression)) return; await delay(180); }
  throw Error('等待逾時：' + expression);
}
async function check(name, fn) {
  currentCase = name;
  try { report.cases.push({ name, status: 'PASS', details: await fn() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
const metrics = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function hit(selector) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('缺少控制');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,width:r.width,height:r.height,disabled:e.disabled,hit:document.elementFromPoint(x,y)?.closest('button,select')===e}})()`);
  assert.ok(!r.disabled && r.width >= 44 && r.height >= 44 && r.hit, `${selector}: ${JSON.stringify(r)}`); return r;
}
async function trustedClick(selector) {
  const r = await hit(selector);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
}
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' }), file = path.join(root, `tools/dev-tests/shots/tenpack-city-${name}.png`);
  await writeFile(file, Buffer.from(r.data, 'base64')); report.screenshots.push(path.relative(root, file));
}
async function ready() {
  await until(`!!window.__gp&&!document.querySelector('#btn-free').disabled&&!!document.querySelector('#car-list button')`);
  await ev(`__gp.renderer.setAnimationLoop(null);__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)`);
}
async function reload() {
  const token = await ev('window.__tenpackCityToken'); await send('Page.reload');
  await until(`window.__tenpackCityToken&&window.__tenpackCityToken!==${JSON.stringify(token)}`); await ready();
}
const stored = () => ev(`JSON.parse(localStorage.getItem('taipei-gp-v2'))`);
async function prepareTour(count) {
  if (await ev(`document.querySelector('#taxi-order-page').classList.contains('hidden')`)) {
    if (await ev(`__gp.state==='free'`)) await click('#btn-pause');
    await click('#btn-taxi');
  }
  await until(`!document.querySelector('#taxi-order-page').classList.contains('hidden')&&!!__gp.taxi`);
  await ev(`(()=>{const e=document.querySelector('#taxi-tour-count');e.value='${count}';e.dispatchEvent(new Event('change'))})()`);
  await trustedClick('#taxi-tour-preview');
  await until(`document.querySelectorAll('#taxi-tour-orders button').length===1`);
  return ev(`(()=>{window.__tenpackTour=[...__gp.taxi.tourOffers.values()][0];return {order:window.__tenpackTour,text:document.querySelector('#taxi-tour-orders').textContent,phase:__gp.taxi.phase,money:__gp.taxi.money,trips:__gp.taxi.trips}})()`);
}
async function acceptTour() {
  await trustedClick('#taxi-tour-orders button'); await until(`__gp.state==='free'&&__gp.taxi.phase==='seek'`);
  return ev(`(()=>{const g=__gp,t=g.taxi;for(let i=0;i<40&&t.phase==='seek';i++){g.fcar.place(t.target.x,t.target.z,0,t.target.y);g.freeStep(.02)}g.updateFreeHud(.26);return {phase:t.phase,tour:t.tourProgress,money:t.money,trips:t.trips,text:document.querySelector('#taxi-trip-text').textContent}})()`);
}
async function visitCurrent() {
  return ev(`(()=>{const g=__gp,t=g.taxi,start=t.tourProgress?.completed;let steps=0;while(t.phase==='ride'&&t.tourProgress.completed===start&&steps++<40){const p=t.target;g.fcar.place(p.x,p.z,0,p.y);g.freeStep(.02)}g.updateFreeHud(.26);return {steps,phase:t.phase,tour:t.tourProgress,money:t.money,trips:t.trips,last:t.lastTrip,state:g.state}})()`);
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const info = (await send('Target.getTargetInfo')).targetInfo; assert.ok(info.browserContextId, '拒絕玩家預設context'); report.context = info.browserContextId;
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await metrics(844, 390);
  await mkdir(path.join(root, 'tools/dev-tests/shots'), { recursive: true });
  const seed = { schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: null, sectors: [null, null, null], ghost: null,
    opts: { sound: false, quali: false }, taxi: { money: 10000, trips: 2 }, tutDone: true, quality: 'low', touch: 'on', car: 'police' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__tenpackCityToken=crypto.randomUUID();if(!sessionStorage.getItem('tenpack-city-seed')){localStorage.clear();localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('tenpack-city-seed','1')}` });
  await send('Page.navigate', { url: origin + '/?q=low&notraffic' }); await ready();
  await check('9城市未建構前真UI選新手勤務並保存，reload保留選擇', async () => {
    assert.equal(await ev('!!__gp.police'), false); await hit('#police-duty-difficulty');
    await ev(`(()=>{const e=document.querySelector('#police-duty-difficulty');e.value='easy';e.dispatchEvent(new Event('change'))})()`);
    const saved = (await stored()).policeCareer; assert.equal(saved.difficulty, 'easy'); await reload();
    assert.equal(await ev(`document.querySelector('#police-duty-difficulty').value`), 'easy'); return saved;
  });
  await check('9巡邏車真開始新手追緝，已攔停狀態經main結算與職涯/獎金保存一次', async () => {
    await click('#btn-free'); await until(`__gp.state==='free'&&!!__gp.police`);
    await ev('__gp.updateFreeHud(.26)'); await trustedClick('#btn-pursuit'); await until('!!__gp.police.suspect');
    const started = await ev('({profile:__gp.police.dutySummary,time:__gp.police.pursuitT,hp:__gp.police.suspectHp})');
    assert.equal(started.profile.difficulty, 'easy'); assert.equal(started.time, 240); assert.equal(started.hp, 80);
    const r = await ev(`(()=>{const g=__gp,p=g.police,s=p.suspect.car,h=s.h;p.suspectHp=0;s.v=0;p.arrestT=1.01;g.fcar.place(s.x-Math.sin(h)*8,s.z-Math.cos(h)*8,h,s.y);const before=g.taxi.money;g.freeStep(.02);g.updateFreeHud(.26);const after=g.taxi.money;g.freeStep(.02);return {before,after,again:g.taxi.money,active:!!p.suspect,career:p.dutyCareer,result:p.lastDutyResult,stored:JSON.parse(localStorage.getItem('taipei-gp-v2')).policeCareer}})()`);
    assert.equal(r.active, false); assert.ok(r.after > r.before); assert.equal(r.again, r.after); assert.equal(r.career.completed, 1);
    assert.equal(r.stored.completed, 1); assert.equal(r.stored.consecutive, 1); assert.equal(r.result.status, 'arrested'); return { started, ...r };
  });
  await check('9更換高手/標準勤務，主動切換模式會取消任務並保存連勝中斷', async () => {
    await click('#btn-pause');
    await ev(`(()=>{const e=document.querySelector('#police-duty-difficulty');e.value='hard';e.dispatchEvent(new Event('change'))})()`);
    await click('#btn-resume'); await until(`__gp.state==='free'`); await ev('__gp.updateFreeHud(.26)'); await trustedClick('#btn-pursuit'); await until('!!__gp.police.suspect');
    assert.equal(await ev('__gp.police.pursuitT'), 150); assert.equal(await ev('__gp.police.suspectHp'), 120);
    await click('#btn-pause'); await click('#btn-taxi'); await until(`!document.querySelector('#taxi-order-page').classList.contains('hidden')`);
    // 接取觀光單時由main共同互斥流程結束勤務，不能只在模組裡取消。
    const planned = await prepareTour(3); await trustedClick('#taxi-tour-orders button'); await until(`__gp.state==='free'&&__gp.taxi.phase==='seek'`);
    const r = await ev(`({active:!!__gp.police.suspect,career:__gp.police.dutyCareer,stored:JSON.parse(localStorage.getItem('taipei-gp-v2')).policeCareer})`);
    assert.equal(r.active, false); assert.equal(r.career.consecutive, 0); assert.equal(r.career.completed, 1); assert.equal(r.stored.consecutive, 0);
    await click('#btn-pause'); await click('#taxi-resume-abandon'); return { order: planned.order.id, ...r };
  });
  await check('9勤務/10觀光控制三種手機尺寸可捲到且44px命中，頁面無水平溢出', async () => {
    // 此時在暫停選單；先檢查勤務選擇，再打開載客頁檢查觀光操作。
    for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
      await metrics(width, height); const duty = await hit('#police-duty-difficulty');
      assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth+1')); report.layouts.push({ width, height, duty });
    }
    await click('#btn-taxi'); await until(`!document.querySelector('#taxi-order-page').classList.contains('hidden')`);
    for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
      await metrics(width, height); const count = await hit('#taxi-tour-count'), preview = await hit('#taxi-tour-preview');
      assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth+1')); report.layouts.push({ width, height, count, preview });
      await screenshot(`controls-${width}x${height}`);
    }
    await metrics(844, 390); return { layouts: report.layouts.length };
  });
  let mid;
  await check('10三站真UI預覽/接取，同層停穩上客；跳過站序不推進、首站零入帳', async () => {
    const plan = await prepareTour(3); assert.equal(plan.order.tourStops.length, 3); assert.equal(plan.order.timeLimit, 0);
    for (const stop of plan.order.tourStops) assert.ok(plan.text.includes(stop.nm));
    const boarded = await acceptTour(); assert.equal(boarded.phase, 'ride'); assert.equal(boarded.tour.total, 3); assert.match(boarded.text, /全部完成/);
    const skipped = await ev(`(()=>{const g=__gp,p=g.taxi.tour.stops[2];for(let i=0;i<40;i++){g.fcar.place(p.x,p.z,0,p.y);g.freeStep(.02)}return g.taxi.tourProgress.completed})()`); assert.equal(skipped, 0);
    const first = await visitCurrent(); assert.equal(first.tour.completed, 1); assert.equal(first.money, plan.money); assert.equal(first.trips, plan.trips);
    await click('#btn-pause'); mid = (await stored()).taxiJob; assert.equal(mid.tour.next, 1); assert.equal(mid.timeLeft, 0); return { plan, boarded, first, checkpoint: mid };
  });
  await check('10原生reload顯示觀光續接站次，真按續接保留下一站/里程/零倒數', async () => {
    await reload(); await until(`!document.querySelector('#taxi-resume-panel').hidden`);
    assert.match(await ev(`document.querySelector('#taxi-resume-description').textContent`), /觀光.*1\/3/);
    await click('#taxi-resume-continue'); await until(`__gp.state==='free'&&__gp.taxi?.phase==='ride'`);
    const r = await ev(`({progress:__gp.taxi.tourProgress,checkpoint:__gp.taxi.checkpoint(__gp.fcar),money:__gp.taxi.money,trips:__gp.taxi.trips})`);
    assert.equal(r.progress.completed, 1); assert.equal(r.checkpoint.id, mid.id); assert.equal(r.checkpoint.odo, mid.odo);
    assert.equal(r.checkpoint.timeLeft, 0); assert.equal(r.progress.stop, mid.tour.stops[1].nm); return r;
  });
  await check('10三站最後一站只入帳一次，保存完成ID/清checkpoint/返回接單頁', async () => {
    const before = await ev('({money:__gp.taxi.money,trips:__gp.taxi.trips,total:__gp.taxi.tripSummary.total})');
    const second = await visitCurrent(); assert.equal(second.tour.completed, 2); assert.equal(second.money, before.money);
    const final = await visitCurrent(); assert.equal(final.phase, 'off'); assert.equal(final.money, before.money + before.total); assert.equal(final.trips, before.trips + 1);
    assert.equal(final.last.tour.completed, 3); const saved = await stored(); assert.ok(saved.taxiSettled.includes(mid.id)); assert.ok(!saved.taxiJob);
    assert.equal(await ev(`document.querySelector('#taxi-order-page').classList.contains('hidden')`), false);
    await ev('__gp.freeStep(.02)'); assert.equal(await ev('__gp.taxi.money'), final.money); return { before, second, final, settled: mid.id };
  });
  for (const count of [4, 5]) await check(`10${count}站真UI順序停靠及一次總報酬，沒有途中小費或連單獎金`, async () => {
    const plan = await prepareTour(count); assert.equal(plan.order.tourStops.length, count); const boarded = await acceptTour(); assert.equal(boarded.tour.total, count);
    const stages = [];
    for (let i = 0; i < count; i++) {
      const stage = await visitCurrent(); stages.push(stage);
      if (i < count - 1) { assert.equal(stage.money, plan.money); assert.equal(stage.tour.completed, i + 1); }
    }
    const final = stages.at(-1); assert.equal(final.money, plan.money + plan.order.estimatedTotal); assert.equal(final.trips, plan.trips + 1);
    assert.equal(final.last.bonus, count * 80); assert.equal(final.last.tipBeforeDeduction, 0); assert.equal(final.last.tour.completed, count);
    return { plan: plan.order, beforeMoney: plan.money, final };
  });
  await check('10途中放棄觀光單清進度且零獎金，重新接普通單不殘留觀光狀態', async () => {
    const plan = await prepareTour(3); await acceptTour(); await visitCurrent(); await click('#btn-pause'); await click('#taxi-resume-abandon');
    const r = await ev(`({money:__gp.taxi.money,trips:__gp.taxi.trips,phase:__gp.taxi.phase,progress:__gp.taxi.tourProgress,checkpoint:__gp.save.taxiJob??null})`);
    assert.equal(r.money, plan.money); assert.equal(r.trips, plan.trips); assert.equal(r.phase, 'off'); assert.equal(r.progress, null); assert.equal(r.checkpoint, null);
    await click('#btn-taxi'); await until(`!!document.querySelector('#taxi-orders button')`); await trustedClick('#taxi-orders button');
    await until(`__gp.state==='free'&&__gp.taxi.phase==='seek'`); assert.equal(await ev('__gp.taxi.tourProgress'), null); return r;
  });
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.dialogs, []);
} catch (error) {
  report.failure = String(error.stack ?? error);
  if (!report.cases.some((c) => c.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: report.failure });
  await screenshot('failure').catch(() => {});
} finally {
  report.sourceHashesAfter = await sourceHashes();
  const scriptAfter = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  const unchanged = JSON.stringify(report.sourceHashes) === JSON.stringify(report.sourceHashesAfter) && report.script.sha256 === scriptAfter;
  report.cases.push({ name: '正式build與腳本/產品來源測試期間不變', status: unchanged ? 'PASS' : 'FAIL' });
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
  await writeFile(path.join(root, 'tools/dev-tests/tenpack-city-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ build, summary: report.summary, exceptions: report.exceptions, failure: report.failure })); ws.close();
  if (report.summary.failed || report.exceptions.length || report.externalRequests.length || report.dialogs.length) process.exitCode = 1;
}
