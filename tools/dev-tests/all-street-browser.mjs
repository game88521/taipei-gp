// node tools/dev-tests/external-browser.mjs 9333 all-street-browser.mjs [expected-build]
// 僅連wrapper新建的隔離context；本機dist真UI/城市/任務，禁止非本機請求。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [port, expectedBuild] = process.argv.slice(2), origin = 'http://127.0.0.1:4317', KEY = 'taipei-gp-v2';
const build = (await readFile(path.join(root, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
if (expectedBuild) assert.equal(build, expectedBuild, '拒絕測試不同build');
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
assert.equal(pages.length, 1, '必須由external-browser提供單一隔離分頁');
const target = pages.find((p) => p.type === 'page'); assert.ok(target);
const debuggerUrl = new URL(target.webSocketDebuggerUrl); assert.ok(['127.0.0.1', 'localhost'].includes(debuggerUrl.hostname));
const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0, currentCase = '啟動';
const report = { origin, build, externalChrome: true, isolatedContext: true, playerStorageTouched: false,
  realPhone: false, cases: [], layouts: [], screenshots: [], exceptions: [], dialogs: [], blockedExternalRequests: [],
  limitations: ['桌面Chrome模擬390×844/844×390/844×220，尚未驗證手機實機。',
    '保留真城市/路由/任務/UI；renderer降解析度並停止自動loop，以真freeStep固定小步進驗證時間，不量測FPS/耗電。',
    '接客/續接與街賽檢查點由測試準備合法座標；未驗證完整真人駕駛、對手難度平衡或實際逃逸路線。'] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method}逾時`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ case: currentCase, text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
  if (m.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ case: currentCase, text: m.params.message }); void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); }
  if (m.method === 'Fetch.requestPaused') {
    const u = new URL(m.params.request.url), allowed = u.origin === origin || ['data:', 'blob:', 'about:'].includes(u.protocol);
    if (!allowed) report.blockedExternalRequests.push(m.params.request.url);
    void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
  }
  const job = pending.get(m.id); if (!job) return; pending.delete(m.id); clearTimeout(job.timer);
  m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
ws.onclose = () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('隔離分頁CDP斷線')); } pending.clear(); };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression, ms = 240000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await ev(expression)) return; await delay(200); }
  throw Error(`等待逾時：${expression}`);
}
async function check(name, fn) {
  currentCase = name;
  try { const details = await fn(); report.cases.push({ name, status: 'PASS', ...(details ? { details } : {}) }); }
  catch (e) { report.cases.push({ name, status: 'FAIL', error: String(e.stack ?? e) }); throw e; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
const metrics = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const visible = (selector) => `!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).classList.contains('hidden')`;
async function trustedClick(selector) {
  const rect = await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('缺少按鈕');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e}})()`);
  assert.ok(rect.width >= 44 && rect.height >= 44 && rect.hit, `按鈕無法操作 ${selector} ${JSON.stringify(rect)}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
}
async function trustedLabelToggle(selector) {
  const rect = await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('缺少checkbox標籤');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+12,y=r.y+r.height/2;return {x,y,width:r.width,height:r.height,before:e.querySelector('input').checked,hit:document.elementFromPoint(x,y)?.closest('label')===e}})()`);
  assert.ok(rect.width >= 44 && rect.height >= 44 && rect.hit, `標籤無法操作 ${selector} ${JSON.stringify(rect)}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  assert.equal(await ev(`document.querySelector(${JSON.stringify(selector)}).querySelector('input').checked`), !rect.before, '點擊標籤文字區必須切換checkbox');
}
async function escape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}
async function screenshot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(root, `tools/dev-tests/shots/all-street-${name}.png`); await writeFile(file, Buffer.from(image.data, 'base64')); report.screenshots.push(path.relative(root, file));
}
async function stopAutomaticLoop() {
  await ev(`__gp.renderer.setAnimationLoop(null);__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)`);
}
async function ready() {
  await until(`!!window.__gp&&!document.querySelector('#btn-free').disabled&&!!document.querySelector('#car-list button')`);
  await stopAutomaticLoop();
}
async function layout(overlay, selectors, sizes = [[390, 844], [844, 390], [844, 220]]) {
  for (const [width, height] of sizes) {
    await metrics(width, height);
    const result = await ev(`(() => {const overlay=document.querySelector(${JSON.stringify(overlay)}),c=overlay.querySelector('.card');overlay.scrollTop=0;c.scrollTop=0;const r=c.getBoundingClientRect();const buttons=[...overlay.querySelectorAll(${JSON.stringify(selectors)})].filter(e=>e.getBoundingClientRect().height>0).map(e=>{e.scrollIntoView({block:'center'});const q=e.getBoundingClientRect(),x=q.x+q.width/2,y=q.y+q.height/2;return {id:e.id||e.textContent.slice(0,30),width:q.width,height:q.height,top:q.top,bottom:q.bottom,hit:document.elementFromPoint(x,y)?.closest('button,select,label')===e}});return {overlay:${JSON.stringify(overlay)},width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,card:{left:r.left,right:r.right,clientWidth:c.clientWidth,scrollWidth:c.scrollWidth,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight,overflow:getComputedStyle(c).overflowY},buttons}})()`);
    report.layouts.push(result); assert.ok(result.documentWidth <= width + 1, JSON.stringify(result));
    assert.ok(result.card.left >= -1 && result.card.right <= width + 1, JSON.stringify(result));
    assert.ok(result.card.scrollWidth <= result.card.clientWidth + 1, JSON.stringify(result));
    for (const b of result.buttons) { assert.ok(b.width >= 44 && b.height >= 44, JSON.stringify(b)); assert.ok(b.top >= -1 && b.bottom <= height + 1 && b.hit, JSON.stringify(b)); }
    await screenshot(`${overlay.slice(1)}-${width}x${height}`);
  }
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const info = (await send('Target.getTargetInfo')).targetInfo; assert.ok(info.browserContextId, '拒絕操作玩家預設context'); report.context = info.browserContextId;
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await metrics(844, 390);
  await mkdir(path.join(root, 'tools/dev-tests/shots'), { recursive: true });
  const seed = { schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: null, sectors: [null, null, null], ghost: null,
    opts: { sound: false, quali: false }, taxi: { money: 10000, trips: 2 }, tutDone: true, quality: 'low', touch: 'on', car: 'sedan' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__allStreetToken=crypto.randomUUID();if(!sessionStorage.getItem('all-street-seed-v1')){localStorage.clear();localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('all-street-seed-v1','1')}` });
  await send('Page.navigate', { url: origin + '/?q=low&notraffic' }); await ready();
  await check('本機新dist真debug入口就緒，普通開場尚未建立城市任務', async () => {
    const r = await ev(`({token:window.__allStreetToken,freeStep:typeof __gp.freeStep,updateFreeHud:typeof __gp.updateFreeHud,streetVehicle:typeof __gp.streetVehicle,taxi:!!__gp.taxi,systems:__gp.streetSystemsReady,money:__gp.save.taxi.money,query:location.search})`);
    assert.equal(r.freeStep, 'function'); assert.equal(r.updateFreeHud, 'function'); assert.equal(r.streetVehicle, 'function'); assert.equal(r.taxi, false); assert.equal(r.systems, false); assert.equal(r.money, 10000); assert.ok(!r.query.includes('bot')); return r;
  });
  await check('K真訂單先顯示目的地/里程/限時/收益，尚未接單不開始載客', async () => {
    await click('#btn-taxi'); await until(`${visible('#taxi-order-page')}&&!!__gp.taxi&&document.querySelectorAll('#taxi-orders button').length>=2`);
    const r = await ev(`({phase:__gp.taxi.phase,state:__gp.state,systems:__gp.streetSystemsReady,orders:[...__gp.taxi.offers.values()].map(o=>({id:o.id,from:o.from,to:o.to,distance:o.distance,timeLimit:o.timeLimit,estimatedFare:o.estimatedFare})),texts:[...document.querySelectorAll('#taxi-orders button')].map(e=>e.textContent),money:__gp.taxi.money})`);
    assert.equal(r.phase, 'off'); assert.notEqual(r.state, 'free'); assert.equal(r.systems, true); assert.ok(r.orders.length >= 2 && r.orders.length <= 3); assert.equal(r.money, 10000);
    for (let i = 0; i < r.orders.length; i++) { const o = r.orders[i]; assert.notEqual(o.from, o.to); assert.ok(o.distance > 0 && o.timeLimit > 0); assert.ok(r.texts[i].includes(o.from) && r.texts[i].includes(o.to)); assert.match(r.texts[i], /km.*限時.*預估車資/); } return r;
  });
  await check('K接單頁手機三種尺寸無水平溢出，訂單/更新/返回按鈕可捲到且命中', async () => {
    await layout('#taxi-order-page', '#taxi-orders button,#taxi-refresh-orders,#taxi-order-back,label.sw');
    const before = await ev('[...__gp.taxi.offers.keys()][0]'); await trustedClick('#taxi-refresh-orders');
    const after = await ev('[...__gp.taxi.offers.keys()][0]'); assert.notEqual(after, before);
    await trustedLabelToggle('#taxi-order-page label.sw'); await trustedLabelToggle('#taxi-order-page label.sw');
    await metrics(844, 390); return { refreshed: before !== after, labelTextAreaTogglesCheckbox: true };
  });
  await check('K真點選訂單後才開始，合法同層上車後保留預知目的地', async () => {
    await ev('window.__allStreetOrder=[...__gp.taxi.offers.values()][0]'); await trustedClick('#taxi-orders button');
    await until(`__gp.state==='free'&&__gp.taxi.phase==='seek'`); await stopAutomaticLoop();
    const r = await ev(`(() => {const g=__gp,t=g.taxi,o=window.__allStreetOrder;const before={state:g.state,phase:t.phase,money:t.money,trips:t.trips,from:t.from,target:t.target.nm};for(let i=0;i<45&&t.phase==='seek';i++){g.fcar.place(t.target.x,t.target.z,0,t.target.y);g.freeStep(.02)}g.updateFreeHud(.26);return {before,phase:t.phase,target:t.target.nm,expected:o.to,timeLeft:t.timeLeft,timeLimit:t.timeLimit,detail:document.querySelector('#taxi-trip-text').textContent,money:t.money,trips:t.trips}})()`);
    assert.equal(r.before.money, 10000); assert.equal(r.before.trips, 2); assert.equal(r.phase, 'ride'); assert.equal(r.target, r.expected); assert.ok(r.timeLeft > 0); assert.ok(r.detail.includes(r.expected)); assert.equal(r.money, 10000); assert.equal(r.trips, 2); return r;
  });
  let savedTrip;
  await check('M真暫停原生保存，reload後顯示未完成行程且離線不扣時', async () => {
    await ev(`__gp.freeStep(.02);document.querySelector('#btn-pause').click()`);
    savedTrip = await ev(`JSON.parse(localStorage.getItem('${KEY}')).taxiJob`); assert.ok(savedTrip?.id); assert.equal(savedTrip.phase, 'ride');
    const token = await ev('window.__allStreetToken'); await send('Page.reload'); await until(`window.__allStreetToken&&window.__allStreetToken!==${JSON.stringify(token)}`); await ready();
    await until(`!document.querySelector('#taxi-resume-panel').hidden`);
    const before = await ev(`({state:__gp.state,money:__gp.save.taxi.money,timeLeft:__gp.save.taxiJob.timeLeft,id:__gp.save.taxiJob.id,description:document.querySelector('#taxi-resume-description').textContent})`);
    assert.equal(before.id, savedTrip.id); assert.equal(before.timeLeft, savedTrip.timeLeft); assert.equal(before.money, 10000); assert.match(before.description, /離線.*暫停/);
    await click('#taxi-resume-continue'); await until(`__gp.state==='free'&&__gp.taxi?.phase==='ride'`); await stopAutomaticLoop();
    const resumed = await ev(`({id:__gp.taxi.checkpoint(__gp.fcar).id,timeLeft:__gp.taxi.timeLeft,money:__gp.taxi.money,trips:__gp.taxi.trips,route:__gp.taxi.route.length,position:{x:__gp.fcar.x,z:__gp.fcar.z,y:__gp.fcar.y}})`);
    assert.equal(resumed.id, savedTrip.id); assert.equal(resumed.timeLeft, savedTrip.timeLeft); assert.equal(resumed.money, 10000); assert.equal(resumed.trips, 2); assert.ok(resumed.route > 1);
    assert.ok(Math.hypot(resumed.position.x - savedTrip.position.x, resumed.position.z - savedTrip.position.z) < .01); return { before, resumed };
  });
  await check('M真放棄清除checkpoint，不發車資或罰款；重新選單Escape回選單', async () => {
    await click('#btn-pause'); await click('#taxi-resume-abandon');
    const r = await ev(`({phase:__gp.taxi.phase,checkpoint:__gp.save.taxiJob??null,stored:JSON.parse(localStorage.getItem('${KEY}')).taxiJob??null,money:__gp.taxi.money,trips:__gp.taxi.trips,panelHidden:document.querySelector('#taxi-resume-panel').hidden})`);
    assert.equal(r.phase, 'off'); assert.equal(r.checkpoint, null); assert.equal(r.stored, null); assert.equal(r.money, 10000); assert.equal(r.trips, 2); assert.equal(r.panelHidden, true);
    const token = await ev('window.__allStreetToken'); await click('#btn-taxi'); await until(visible('#taxi-order-page')); await escape();
    assert.equal(await ev(`document.querySelector('#taxi-order-page').classList.contains('hidden')`), true); assert.equal(await ev('window.__allStreetToken'), token); return r;
  });
  await check('I60秒真開始/暫停/恢復/取消，暫停不扣時且未完成不寫PB', async () => {
    await ev(`document.querySelector('#drift-duration').value='60';document.querySelector('#btn-drift-challenge').click()`); await until(`__gp.state==='free'&&__gp.driftChallenge.active`); await stopAutomaticLoop();
    await ev(`for(let i=0;i<10;i++)__gp.freeStep(.02);__gp.updateFreeHud(.26);document.querySelector('#btn-pause').click()`);
    const before = await ev('__gp.driftChallenge.remaining'); await delay(300); assert.equal(await ev('__gp.driftChallenge.remaining'), before);
    assert.equal(await ev('__gp.state'), 'paused'); await click('#btn-resume'); await until(`__gp.state==='free'`);
    await ev(`__gp.freeStep(.02);__gp.updateFreeHud(.26)`); const resumed = await ev('__gp.driftChallenge.remaining'); assert.ok(Math.abs(resumed - (before - .02)) < 1e-7);
    await click('#drift-challenge-cancel');
    const r = await ev(`({active:__gp.driftChallenge.active,result:__gp.driftChallenge.result,records:__gp.save.driftChallenge,state:__gp.state,money:__gp.taxi.money})`);
    assert.equal(r.active, false); assert.equal(r.result, null); assert.deepEqual(r.records, {}); assert.equal(r.money, 10000); return { before, resumed, ...r };
  });
  await check('I90秒真小步進完整到時顯示結算；三種手機尺寸按鈕可達，Escape返回自由駕駛', async () => {
    await click('#btn-pause'); await ev(`document.querySelector('#drift-duration').value='90';document.querySelector('#btn-drift-challenge').click()`); await until('__gp.driftChallenge.active'); await stopAutomaticLoop();
    const r = await ev(`(() => {const g=__gp,start=g.driftChallenge.remaining;let steps=0;while(g.driftChallenge.active&&steps++<4502)g.freeStep(.02);return {start,steps,active:g.driftChallenge.active,remaining:g.driftChallenge.remaining,result:g.driftChallenge.result,state:g.state,visible:!document.querySelector('#drift-challenge-result').classList.contains('hidden'),detail:document.querySelector('#drift-result-detail').textContent,money:g.taxi.money}})()`);
    assert.equal(r.start, 90); assert.ok(r.steps >= 4499 && r.steps <= 4501); assert.equal(r.active, false); assert.equal(r.remaining, 0); assert.equal(r.result.duration, 90); assert.equal(r.state, 'paused'); assert.equal(r.visible, true); assert.match(r.detail, /90 秒/); assert.equal(r.money, 10000);
    await layout('#drift-challenge-result', '#drift-result-again,#drift-result-close'); await escape(); assert.equal(await ev('__gp.state'), 'free'); assert.equal(await ev(`document.querySelector('#drift-challenge-result').classList.contains('hidden')`), true); await metrics(844, 390); return r;
  });
  await check('I60秒完整到時走同一結算入口，不重發分數/獎金', async () => {
    await click('#btn-pause'); await ev(`document.querySelector('#drift-duration').value='60';document.querySelector('#btn-drift-challenge').click()`); await until('__gp.driftChallenge.active');
    const r = await ev(`(() => {const g=__gp;let steps=0;while(g.driftChallenge.active&&steps++<3002)g.freeStep(.02);const first={score:g.driftChallenge.result.score,money:g.taxi.money,state:g.state};g.updateFreeHud(.26);return {steps,first,result:g.driftChallenge.result,money:g.taxi.money,visible:!document.querySelector('#drift-challenge-result').classList.contains('hidden')}})()`);
    assert.ok(r.steps >= 2999 && r.steps <= 3001); assert.equal(r.result.duration, 60); assert.equal(r.visible, true); assert.equal(r.money, r.first.money); assert.equal(r.money, 10000); await click('#drift-result-close'); return r;
  });
  await check('J難度/選車/三站系列真選單，手機尺寸不溢出且按鈕可達', async () => {
    await click('#btn-pause'); await click('[data-tab="garage"]'); await click('#car-list button[data-id="super"]'); await click('#car-use'); await click('[data-tab="play"]');
    await ev(`document.querySelector('#duel-difficulty').value='hard';document.querySelector('#duel-car-mode').value='selected';document.querySelector('#duel-series').checked=true;document.querySelector('#btn-duel').click()`);
    await until(`${visible('#duel-pick')}&&document.querySelectorAll('#duel-list button').length>=3`);
    await layout('#duel-pick', '#duel-difficulty,#duel-car-mode,#duel-list button,label.sw');
    await trustedLabelToggle('#duel-pick label.sw'); await trustedLabelToggle('#duel-pick label.sw'); await metrics(844, 390);
    const r = await ev(`({routes:document.querySelectorAll('#duel-list button').length,car:__gp.save.car,difficulty:document.querySelector('#duel-difficulty').value,mode:document.querySelector('#duel-car-mode').value,series:document.querySelector('#duel-series').checked})`);
    assert.equal(r.car, 'super'); assert.equal(r.difficulty, 'hard'); assert.equal(r.mode, 'selected'); assert.equal(r.series, true); return r;
  });
  await check('Jselected使用真車款性能；真檢查點完成一站只發一次獎金/分類PB/系列進度', async () => {
    await click('#duel-list button'); await until(`__gp.state==='free'&&__gp.sr?.phase==='count'`);
    const r = await ev(`(() => {const g=__gp,s=g.sr;g.freeStep(0);const start={options:{...s.options},top:s.rivals[0].top,vehicle:g.streetVehicle().id,f1:g.streetUsesF1(),spec:{...g.fcar.spec},series:g.streetSeries.checkpoint};s.update(4,g.fcar,null);for(const i of s.active.checkpoints){const p=s.active.path[i];g.fcar.place(p[0],p[1],0);s.update(.02,g.fcar,null)}s.update(.7,g.fcar,null);g.freeStep(0);const first={money:g.taxi.money,trips:g.taxi.trips,series:g.streetSeries.checkpoint,record:g.save.streetChallenge[s.scopedRecordKey],key:s.scopedRecordKey,prizes:(g.save.ledger??[]).filter(x=>x.reason==='街頭對決第 1 名').length};g.freeStep(0);return {start,phase:s.phase,result:s.result,first,secondMoney:g.taxi.money,secondSeries:g.streetSeries.checkpoint,secondPrizes:(g.save.ledger??[]).filter(x=>x.reason==='街頭對決第 1 名').length,resultVisible:!document.querySelector('#sr-result').classList.contains('hidden')}})()`);
    assert.equal(r.start.options.carId, 'super'); assert.equal(r.start.options.difficulty, 'hard'); assert.equal(r.start.vehicle, 'super'); assert.equal(r.start.f1, false); assert.equal(r.start.spec.vmax, 80); assert.ok(Math.abs(r.start.top - 37 * 1.12) < 1e-8);
    assert.deepEqual(Object.keys(r.start.options).sort(), ['carId', 'difficulty', 'rules']); assert.equal('results' in r.result, false); assert.equal('routeIds' in r.result, false);
    assert.equal(r.phase, 'done'); assert.equal(r.result.finished, true); assert.equal(r.first.series.next, 1); assert.equal(r.first.record.best, r.result.time); assert.equal(r.first.prizes, 1); assert.equal(r.secondPrizes, 1); assert.equal(r.secondMoney, r.first.money); assert.equal(r.secondSeries.next, 1); assert.equal(r.resultVisible, true); return r;
  });
  await check('J下一站鎖系列車款，換車庫車不改分榜/實際性能；退出保留已完成站次', async () => {
    await click('#sr-series-next'); await until('__gp.sr.phase===\'count\''); await click('#btn-pause');
    await click('[data-tab="garage"]'); await click('#car-list button[data-id="pickup"]'); await click('#car-use'); await click('#btn-resume'); await until('__gp.state===\'free\'');
    const locked = await ev(`(() => {__gp.freeStep(0);return {chosen:__gp.save.car,actual:__gp.streetVehicle().id,options:{...__gp.sr.options},spec:{...__gp.fcar.spec},series:__gp.streetSeries.checkpoint}})()`);
    assert.equal(locked.chosen, 'pickup'); assert.equal(locked.actual, 'super'); assert.equal(locked.options.carId, 'super'); assert.equal(locked.spec.vmax, 80); assert.equal(locked.series.next, 1);
    assert.deepEqual(Object.keys(locked.options).sort(), ['carId', 'difficulty', 'rules']);
    const second = await ev(`(() => {const g=__gp,s=g.sr;s.update(4,g.fcar,null);for(const i of s.active.checkpoints){const p=s.active.path[i];g.fcar.place(p[0],p[1],0);s.update(.02,g.fcar,null)}s.update(.7,g.fcar,null);g.freeStep(0);return {result:s.result,series:g.streetSeries.checkpoint}})()`);
    assert.equal(second.result.finished, true); assert.equal(second.series.next, 2); assert.equal('results' in second.result, false); assert.equal('routeIds' in second.result, false);
    await click('#sr-series-next'); await until('__gp.sr.phase===\'count\'');
    await ev(`document.querySelector('#sr-quit').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))`);
    const left = await ev(`({active:!!__gp.sr.active,series:__gp.streetSeries.checkpoint,stored:__gp.save.streetSeries,money:__gp.taxi.money,actual:__gp.streetVehicle().id})`);
    assert.equal(left.active, false); assert.equal(left.series.next, 2); assert.equal(left.stored.next, 2); assert.equal(left.actual, 'pickup'); return { locked, second, left };
  });
  await check('J預設統一街賽車保留舊46m/s物理與新手難度；明確放棄系列清保存', async () => {
    await click('#btn-pause'); await click('#btn-duel'); await until(visible('#duel-pick')); await click('#street-series-abandon');
    await ev(`document.querySelector('#duel-series').checked=false;document.querySelector('#duel-difficulty').value='easy';document.querySelector('#duel-difficulty').dispatchEvent(new Event('change'));document.querySelector('#duel-car-mode').value='unified';document.querySelector('#duel-car-mode').dispatchEvent(new Event('change'));document.querySelector('#duel-list button').click()`);
    await until('__gp.sr.phase===\'count\'');
    const r = await ev(`(() => {__gp.freeStep(0);return {options:{...__gp.sr.options},f1:__gp.streetUsesF1(),spec:{...__gp.fcar.spec},top:__gp.sr.rivals[0].top,series:__gp.save.streetSeries??null}})()`);
    assert.equal(r.options.carId, 'street-f1'); assert.equal(r.options.difficulty, 'easy'); assert.equal(r.f1, true); assert.equal(r.spec.vmax, 46); assert.ok(Math.abs(r.top - 37 * .82) < 1e-8); assert.equal(r.series, null);
    await ev(`document.querySelector('#sr-quit').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))`); return r;
  });
  assert.deepEqual(report.exceptions, [], '瀏覽器出現未處理例外');
} catch (error) {
  report.failure = String(error.stack ?? error);
  if (!report.cases.some((c) => c.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: report.failure });
  await screenshot('failure').catch(() => {});
} finally {
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
  await writeFile(path.join(root, 'tools/dev-tests/all-street-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ build, summary: report.summary, exceptions: report.exceptions, failure: report.failure })); ws.close();
  if (report.summary.failed || report.exceptions.length) process.exitCode = 1;
}
