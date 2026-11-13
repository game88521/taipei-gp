// node tools/dev-tests/external-browser.mjs 9333 abcd-ui-browser.mjs
// 只使用 external-browser 建立的隔離 context；真 Web Locks／雙遊戲分頁／本機正式 dist。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = process.argv[2], origin = 'http://127.0.0.1:4317';
const KEY = 'taipei-gp-v2', GOOD = KEY + '-last-good', LOCK = KEY + '-writer';
const gameUrl = origin + '/?circuit=australia&q=low&notraffic';
const downloadDir = path.join(project, 'tools/dev-tests/shots', 'abcd-ui-downloads-' + Date.now());
const report = {
  origin, build: (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1],
  externalChrome: true, isolatedContext: true, playerStorageTouched: false, realPhone: false,
  cases: [], layouts: [], downloads: [], exceptions: [], dialogs: [], blockedExternalRequests: [],
  limitations: ['本機桌面 Chrome 模擬手機 viewport，尚未驗證手機實機', '只驗 UI、真跨分頁鎖定與停止流程，沒有測量硬體 FPS、耗電或音質'],
};
const connections = [], createdTargets = [];
let context, browserHttp, control, a, b, currentCase = '啟動';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(target, name) {
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let seq = 0;
  const client = { name, targetId: target.id, ws };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`${name} ${method} 逾時`)); }, 90000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ page: name, case: currentCase, text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
    if (m.method === 'Page.javascriptDialogOpening') {
      report.dialogs.push({ page: name, case: currentCase, message: m.params.message, accepted: false });
      void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    }
    if (m.method === 'Fetch.requestPaused') {
      const u = new URL(m.params.request.url), local = u.origin === origin || ['data:', 'blob:', 'about:'].includes(u.protocol);
      // 控制頁保有真 origin/storage，但不載遊戲、也不競爭 writer lock。
      if (name === 'control' && u.href === origin + '/__abcd_storage_control__') {
        void send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from('<!doctype html><title>隔離存檔控制頁</title>').toString('base64') }).catch(() => {});
      } else {
        if (!local) report.blockedExternalRequests.push({ page: name, url: m.params.request.url });
        void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
      }
    }
    const job = pending.get(m.id); if (!job) return;
    pending.delete(m.id); clearTimeout(job.timer); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
  };
  ws.onclose = () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error(`${name} CDP 已斷線`)); } pending.clear(); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  client.send = send;
  client.ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  connections.push(client);
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return client;
}
async function until(page, expression, ms = 120000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await page.ev(expression)) return; await delay(250); }
  throw Error(`${page.name} 等待逾時：${expression}`);
}
async function check(name, fn) {
  currentCase = name;
  try { const details = await fn(); report.cases.push({ name, status: 'PASS', ...(details ? { details } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
async function makePage(name) {
  const { targetId } = await control.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  createdTargets.push(targetId);
  // 只挑選本 runner 剛建立的 target，不連到玩家分頁。
  const targets = await (await fetch(browserHttp + '/json')).json();
  const target = targets.find((p) => p.id === targetId); assert.ok(target, '找不到本 runner 新建分頁');
  const page = await connect(target, name);
  const actual = (await page.send('Target.getTargetInfo')).targetInfo;
  assert.equal(actual.browserContextId, context, '分頁必須屬於 wrapper 的隔離 context');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__abcdToken=crypto.randomUUID();window.__abcdWebgl=0;window.__abcdWrites=[];window.__abcdFrames=0;window.__abcdStorageEvents=[];
    addEventListener('storage',event=>window.__abcdStorageEvents.push({key:event.key,url:event.url}));
    const protectedKeys=new Set(${JSON.stringify([KEY, GOOD])});
    for(const method of ['setItem','removeItem','clear']){const native=Storage.prototype[method];Storage.prototype[method]=function(...args){if(this===localStorage&&(method==='clear'||protectedKeys.has(String(args[0]))))window.__abcdWrites.push({method,key:args[0]??null});return native.apply(this,args)}}
    const nativeContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){if(String(kind).startsWith('webgl'))window.__abcdWebgl++;return nativeContext.call(this,kind,...args)};
    const nativeRaf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=(callback)=>nativeRaf((time)=>{window.__abcdFrames++;callback(time)});
    window.__abcdDownloads=[];const blobs=new Map(),nativeUrl=URL.createObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{const url=nativeUrl(blob);blobs.set(url,blob);return url};
    const nativeClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(...args){if(this.download.startsWith('taipei-gp-this-tab-')){const entry={name:this.download,text:null};window.__abcdDownloads.push(entry);void blobs.get(this.href)?.text().then(text=>entry.text=text)}return nativeClick.apply(this,args)};
  ` });
  return page;
}
const storage = () => control.ev(`({raw:localStorage.getItem('${KEY}'),good:localStorage.getItem('${GOOD}')})`);
const locks = () => control.ev('navigator.locks.query()');
async function conflictReady(page, ms = 120000) {
  await until(page, `!!document.getElementById('save-conflict')&&!document.getElementById('save-conflict').classList.contains('hidden')`, ms);
}
async function gameReady(page) {
  await until(page, `!!window.__gp&&!document.querySelector('#btn-start').disabled`, 240000);
  await page.ev(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)`);
}
async function reloadFromConflict(page, expectGame) {
  const token = await page.ev('window.__abcdToken');
  // location.reload 可先銷毀 evaluate 的 execution context；不把正常導航當失敗。
  await page.ev(`document.getElementById('save-conflict-reload').click()`).catch((error) => {
    if (!/context|navigation|Cannot find/i.test(error.message)) throw error;
  });
  await until(page, `!!window.__abcdToken&&window.__abcdToken!==${JSON.stringify(token)}`);
  if (expectGame) await gameReady(page); else await conflictReady(page);
}
async function downloadAndCheck(page, expectedMoney) {
  const before = await storage(), caseDownloadDir = path.join(downloadDir, String(report.downloads.length + 1));
  await mkdir(caseDownloadDir, { recursive: true });
  // 兩次備份的產品檔名相同；CDP allow 模式可能直接覆寫，因此各次用自己的目錄。
  await control.send('Browser.setDownloadBehavior', { behavior: 'allow', browserContextId: context, downloadPath: caseDownloadDir, eventsEnabled: true });
  await page.ev(`document.querySelector('#save-conflict-export').click()`);
  await until(page, `window.__abcdDownloads.length>0&&window.__abcdDownloads.at(-1).text!==null&&document.querySelector('#save-conflict-status').textContent.includes('已請瀏覽器下載')`);
  const captured = await page.ev('window.__abcdDownloads.at(-1)');
  assert.equal(JSON.parse(captured.text).save.taxi.money, expectedMoney);
  const deadline = Date.now() + 15000; let file;
  while (Date.now() < deadline) {
    file = (await readdir(caseDownloadDir)).find((name) => name.endsWith('.json'));
    if (file) break; await delay(100);
  }
  assert.ok(file, '必須取得瀏覽器實際下載的 JSON 檔');
  const downloaded = await readFile(path.join(caseDownloadDir, file), 'utf8'); assert.equal(downloaded, captured.text);
  assert.deepEqual(await storage(), before, '下載不可改主檔或 last-good');
  const details = { path: path.relative(project, path.join(caseDownloadDir, file)), money: JSON.parse(downloaded).save.taxi.money, bytes: Buffer.byteLength(downloaded) };
  report.downloads.push(details); return details;
}

try {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  assert.equal(pages.length, 1, '需透過 external-browser 的單一隔離分頁入口執行');
  const target = pages.find((p) => p.type === 'page'); assert.ok(target);
  control = await connect(target, 'control');
  const info = (await control.send('Target.getTargetInfo')).targetInfo; context = info.browserContextId;
  assert.ok(context, '拒絕在預設／玩家 browser context 執行');
  const url = new URL(target.webSocketDebuggerUrl); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  browserHttp = `http://${url.host}`;
  await mkdir(downloadDir, { recursive: true });
  await control.send('Browser.setDownloadBehavior', { behavior: 'allow', browserContextId: context, downloadPath: downloadDir, eventsEnabled: true });
  await control.send('Page.navigate', { url: origin + '/__abcd_storage_control__' });
  await until(control, `location.origin===${JSON.stringify(origin)}&&document.title==='隔離存檔控制頁'`);
  const seed = { schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, fps: true, 'opt-frame-cap': '60' }, taxi: { money: 12345, trips: 7 }, tutDone: true, quality: 'low', touch: 'on' };
  await control.ev(`localStorage.clear();localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(seed))})`);
  a = await makePage('A'); b = await makePage('B');

  await check('A 正常啟動取得真 Web Lock，B 同 origin 被攔截且未建 WebGL／寫主檔或快照', async () => {
    assert.equal(await control.ev('!!navigator.locks'), true, '此測試需要真 Web Locks');
    await a.send('Page.navigate', { url: gameUrl }); await a.send('Page.bringToFront'); await gameReady(a);
    const held = await locks(); assert.equal(held.held.filter((l) => l.name === LOCK && l.mode === 'exclusive').length, 1);
    const before = await storage();
    await b.send('Page.navigate', { url: gameUrl }); await b.send('Page.bringToFront'); await conflictReady(b);
    const blocked = await b.ev(`({webgl:window.__abcdWebgl,gp:!!window.__gp,writes:window.__abcdWrites,message:document.querySelector('#save-conflict-message').textContent})`);
    assert.equal(blocked.webgl, 0); assert.equal(blocked.gp, false); assert.deepEqual(blocked.writes, []); assert.match(blocked.message, /另一個遊戲分頁/);
    assert.deepEqual(await storage(), before); report.realWebLocks = true; return { held, blocked };
  });
  await check('B 在 A 仍持鎖時重讀仍被擋住，Escape／背景控制不會取消衝突或寫入', async () => {
    const before = await storage(); await reloadFromConflict(b, false);
    const token = await b.ev('window.__abcdToken');
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const result = await b.ev(`({token:window.__abcdToken,blocked:!document.querySelector('#save-conflict').classList.contains('hidden'),webgl:window.__abcdWebgl,writes:window.__abcdWrites,backgroundInert:[...document.body.children].filter(el=>el instanceof HTMLElement&&el.id!=='save-conflict').every(el=>el.inert),focus:document.activeElement.id})`);
    assert.equal(result.token, token); assert.equal(result.blocked, true); assert.equal(result.webgl, 0); assert.deepEqual(result.writes, []); assert.equal(result.backgroundInert, true); assert.deepEqual(await storage(), before);
    return result;
  });
  await check('衝突頁 390×844／844×390 不橫向溢出，兩按鈕至少 48px、短螢幕可捲可達', async () => {
    for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      const layout = await b.ev(`(() => {const c=document.querySelector('#save-conflict .card');c.scrollTop=0;const r=c.getBoundingClientRect();const buttons=[...c.querySelectorAll('button')].map(el=>{el.scrollIntoView({block:'nearest'});const q=el.getBoundingClientRect();return {id:el.id,width:q.width,height:q.height,top:q.top,bottom:q.bottom}});return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,card:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,clientWidth:c.clientWidth,scrollWidth:c.scrollWidth,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight,overflow:getComputedStyle(c).overflowY},buttons}})()`);
      report.layouts.push(layout); assert.ok(layout.documentWidth <= width + 1); assert.ok(layout.card.left >= -1 && layout.card.right <= width + 1); assert.ok(layout.card.scrollWidth <= layout.card.clientWidth + 1); assert.equal(layout.card.overflow, 'auto');
      for (const button of layout.buttons) { assert.ok(button.width >= 48 && button.height >= 48, JSON.stringify(button)); assert.ok(button.top >= -1 && button.bottom <= height + 1, JSON.stringify(button)); }
      // 390px 高時文字實際放得下；另以 220px 高驗證需要捲動的邊界。
      if (height === 220) {
        assert.ok(layout.card.scrollHeight > layout.card.clientHeight, '極矮螢幕卡片應能捲動');
        assert.ok(await b.ev(`document.querySelector('#save-conflict .card').scrollTop>0`), '末端按鈕必須能捲到');
      } else assert.ok(layout.card.top >= -1 && layout.card.bottom <= height + 1, '放得下時卡片應完整可見');
      const shot = await b.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(project, `tools/dev-tests/shots/abcd-ui-conflict-${width}x${height}.png`), Buffer.from(shot.data, 'base64'));
    }
  });
  await check('尚未啟動遊戲的 B 能下載本頁真 JSON 備份，原主檔／快照不變', () => downloadAndCheck(b, 12345));
  await check('關閉 A 等待鎖釋放，B 按重讀後可取得鎖正常啟動並保留錢包', async () => {
    await control.send('Target.closeTarget', { targetId: a.targetId });
    const deadline = Date.now() + 10000;
    while ((await locks()).held.some((l) => l.name === LOCK) && Date.now() < deadline) await delay(100);
    assert.equal((await locks()).held.some((l) => l.name === LOCK), false, 'A 關閉後必須釋放鎖');
    await reloadFromConflict(b, true);
    const result = await b.ev(`({webgl:window.__abcdWebgl,gp:!!window.__gp,hidden:document.querySelector('#save-conflict').classList.contains('hidden'),money:JSON.parse(localStorage.getItem('${KEY}')).taxi.money})`);
    assert.ok(result.webgl > 0); assert.equal(result.gp, true); assert.equal(result.hidden, true); assert.equal(result.money, 12345);
    const acquired = await locks(); assert.equal(acquired.held.filter((l) => l.name === LOCK).length, 1); return { ...result, locks: acquired };
  });
  let externalRaw;
  await check('舊客戶端變更主檔會停止已開賽遊戲物理／渲染，衝突頁不覆蓋外部進度或快照', async () => {
    await b.send('Page.bringToFront');
    await b.ev(`window.__abcdRenders=0;window.__abcdLoopStops=0;const nativeRender=__gp.renderer.render.bind(__gp.renderer);__gp.renderer.render=(...args)=>{window.__abcdRenders++;return nativeRender(...args)};const nativeLoop=__gp.renderer.setAnimationLoop.bind(__gp.renderer);__gp.renderer.setAnimationLoop=(callback)=>{if(callback===null)window.__abcdLoopStops++;return nativeLoop(callback)};document.querySelector('#btn-start').click();document.querySelector('.cp-go:not(:disabled)').click()`);
    await until(b, `__gp.state==='race'`, 45000);
    await until(b, `!document.getElementById('boot')`, 15000);
    report.runtimeConflictBootWasRemoved = true;
    await b.ev('__gp.car.v=18');
    const movingStart = await b.ev('({x:__gp.car.x,z:__gp.car.z,renders:window.__abcdRenders})');
    await until(b, `Math.hypot(__gp.car.x-${movingStart.x},__gp.car.z-${movingStart.z})>.01&&window.__abcdRenders>${movingStart.renders}`, 30000);
    const before = await storage(), external = JSON.parse(before.raw); external.taxi = { money: 54321, trips: 9 }; externalRaw = JSON.stringify(external);
    const beforeWrites = await b.ev('window.__abcdWrites.length');
    await control.ev(`localStorage.setItem('${KEY}',${JSON.stringify(externalRaw)})`); await conflictReady(b, 10000);
    // 允許已在途 rAF 結束，再看位置及 render 呼叫是否保持不變。
    await delay(350);
    const stopped = await b.ev('({state:__gp.state,x:__gp.car.x,z:__gp.car.z,v:__gp.car.v,renders:window.__abcdRenders,frames:window.__abcdFrames,loopStops:window.__abcdLoopStops,writes:window.__abcdWrites.length,message:document.querySelector("#save-conflict-message").textContent})');
    await delay(1250);
    const later = await b.ev('({state:__gp.state,x:__gp.car.x,z:__gp.car.z,v:__gp.car.v,renders:window.__abcdRenders,frames:window.__abcdFrames,loopStops:window.__abcdLoopStops,writes:window.__abcdWrites.length,message:document.querySelector("#save-conflict-message").textContent})');
    assert.equal(stopped.state, 'paused'); assert.ok(stopped.loopStops >= 1); assert.match(stopped.message, /其他頁面變更/); assert.deepEqual(later, stopped); assert.equal(stopped.writes, beforeWrites);
    assert.deepEqual(await storage(), { raw: externalRaw, good: before.good }); return { movingStart, stopped, unchangedForMs: 1250 };
  });
  await check('執行中衝突可下載本頁舊錢包 12345，外部已儲存 54321 與 last-good 不變', () => downloadAndCheck(b, 12345));
  await check('執行中衝突按重讀會釋放舊頁鎖並取得新鎖，沿用外部新進度 54321', async () => {
    await reloadFromConflict(b, true);
    const value = await b.ev(`({money:JSON.parse(localStorage.getItem('${KEY}')).taxi.money,trips:JSON.parse(localStorage.getItem('${KEY}')).taxi.trips,blocked:!document.querySelector('#save-conflict').classList.contains('hidden'),webgl:window.__abcdWebgl})`);
    assert.equal(value.money, 54321); assert.equal(value.trips, 9); assert.equal(value.blocked, false); assert.ok(value.webgl > 0);
    const acquired = await locks(); assert.equal(acquired.held.filter((l) => l.name === LOCK).length, 1); assert.equal(acquired.pending.filter((l) => l.name === LOCK).length, 0); return { ...value, locks: acquired };
  });
} catch (error) {
  if (!report.cases.some((c) => c.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: error.stack });
} finally {
  if (report.cases.some((c) => c.status === 'FAIL') && b) {
    try {
      report.failureDiagnostics = await b.ev(`({state:window.__gp?.state,webgl:window.__abcdWebgl,renders:window.__abcdRenders,frames:window.__abcdFrames,loopStops:window.__abcdLoopStops,writes:window.__abcdWrites,storageEvents:window.__abcdStorageEvents,bootPresent:!!document.querySelector('#boot'),conflictHidden:document.querySelector('#save-conflict')?.classList.contains('hidden'),storedMoney:JSON.parse(localStorage.getItem('${KEY}'))?.taxi?.money})`);
    } catch { /* 原始錯誤保留在 case */ }
    try { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); await mkdir(path.join(project, 'tools/dev-tests/shots'), { recursive: true }); await writeFile(path.join(project, 'tools/dev-tests/shots/abcd-ui-browser-failure.png'), Buffer.from(shot.data, 'base64')); } catch { /* 盡力留證 */ }
  }
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
  await writeFile(path.join(project, 'tools/dev-tests/shots-abcd-ui-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  // 分頁由 wrapper dispose 此 context；本 runner 不關閉專用外部 Chrome。
  for (const connection of connections) connection.ws.close();
  if (report.summary.failed || report.exceptions.length || report.blockedExternalRequests.length) process.exitCode = 1;
}
