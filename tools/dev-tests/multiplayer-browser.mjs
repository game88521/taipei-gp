// 專用 Chrome 內建立兩個獨立 context；不使用單人 wrapper、不關閉外部 Chrome。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(directory, '../..');
const origin = 'http://127.0.0.1:4317', endpoint = 'ws://127.0.0.1:4320/ws';
const cdpPort = Number(process.env.GP_MULTIPLAYER_CDP_PORT ?? '9333');
assert.ok(Number.isInteger(cdpPort) && cdpPort >= 1024 && cdpPort <= 65535, 'GP_MULTIPLAYER_CDP_PORT must be a valid local port');
const cdp = `http://127.0.0.1:${cdpPort}`;
const localSw = await readFile(path.join(project, 'dist/sw.js'), 'utf8');
const expectedBuild = process.env.GP_MULTIPLAYER_EXPECTED_BUILD ?? localSw.match(/const VERSION = '([^']+)'/)?.[1];
assert.ok(typeof expectedBuild === 'string' && /^[a-f0-9]{12}$/.test(expectedBuild), 'expected build must come from local dist/sw.js or GP_MULTIPLAYER_EXPECTED_BUILD');
const pauseADuringSetup = process.env.GP_MULTIPLAYER_PAUSE_A_DURING_SETUP === '1';
const evidence = path.join(directory, `multiplayer-browser-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const summaryPath = path.join(directory, 'multiplayer-browser-summary.json');
try { await rename(summaryPath, path.join(evidence, 'multiplayer-browser-summary.previous.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const report = { startedAt: new Date().toISOString(), build: null, expectedBuild, cdpPort, transport: 'two-browser-contexts', localOnly: true, isolatedContexts: [], contextsDisposed: [], playerStorageTouched: false, localStorageUnchanged: false, cases: [], exceptions: [], blockedExternalRequests: [], externalRequests: [], layouts: [], screenshots: [], limitations: ['兩個隔離 Chrome contexts 的本機 UI／輸入／連線流程，不代表手機 FPS、聲音聽感或公開 WSS 延遲', 'persisted pagehide/pageshow 採合成事件驗證真 disconnect/restore，未宣稱真 BFCache 命中', '瀏覽器只驗駕駛與離房；完整圈、完賽及再戰由真權威物理 WS 測試另行涵蓋'] };
const sourceFiles = ['multiplayer.html', 'src/multiplayer-game.ts', 'src/multiplayer-client.ts', 'src/multiplayer-scene.ts', 'src/multiplayer.css', 'shared/multiplayer-protocol.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(project, file))).digest('hex')])));
const beforeHashes = await sourceHashes();
// 與 multiplayer-checks.mjs 相同範圍、排序及 bytes，包含前後端的傳遞依賴。
async function productHash() {
  const digest = createHash('sha256');
  async function walk(relative) {
    const entries = await readdir(path.join(project, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const file = `${relative}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), `不接受產品來源連結：${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { digest.update(file); digest.update(await readFile(path.join(project, file))); }
    }
  }
  for (const directory of ['src', 'api', 'shared', 'server']) await walk(directory);
  for (const file of ['index.html', 'multiplayer.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tools/build-multiplayer-physics.mjs']) {
    digest.update(file); digest.update(await readFile(path.join(project, file)));
  }
  return digest.digest('hex');
}
const beforeProductHash = await productHash();
let currentCase = '啟動隔離瀏覽器', browser, a, b;
const contexts = [], connections = [];
report.setupRenderIsolation = { requested: pauseADuringSetup, pausedOnlyAWhileBLoads: false, restoredBeforeCases: false };
report.realFocusPrecondition = { required: true, achieved: false, mechanism: 'native same-context about:blank activation', blankTargetId: null, context: null, blankDisposedWithContext: false };
report.diagnostics = [];

class Connection {
  constructor(url, label) {
    this.ws = new WebSocket(url); this.label = label; this.sequence = 0; this.pending = new Map(); this.handlers = new Map(); this.closing = false;
    this.opened = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${label}: ${JSON.stringify(message.error)}`)); else pending.resolve(message.result);
      } else for (const handler of this.handlers.get(message.method) ?? []) Promise.resolve(handler(message.params)).catch(error => { if (!this.closing) report.exceptions.push({ page: label, event: message.method, error: String(error) }); });
    };
    this.ws.onclose = () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`${label}: CDP disconnected`)); }
      this.pending.clear();
    };
  }
  on(name, handler) { const handlers = this.handlers.get(name) ?? []; handlers.push(handler); this.handlers.set(name, handlers); }
  async send(method, params = {}) {
    await this.opened;
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.label}: ${method} timeout`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(`${this.label}: ${JSON.stringify(response.exceptionDetails)}`);
    return response.result.value;
  }
  async until(expression, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await this.evaluate(expression); if (value) return value; await delay(80); }
    throw new Error(`${this.label}: condition timeout: ${expression}`);
  }
  close() { this.closing = true; this.ws.close(); }
}

function instrumentation(wallet) {
  return `(() => {
    if(location.origin!==${JSON.stringify(origin)})return;
    const key='taipei-gp-v2',seed=JSON.stringify({schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{},taxi:{money:${wallet},trips:3}});
    if(!sessionStorage.getItem('__mp-test-seeded')){localStorage.setItem(key,seed);localStorage.setItem('__mp-test-wallet',String(${wallet}));sessionStorage.setItem('__mp-test-seeded','1')}
    window.__mpInitialStorage=Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]));
    window.__mpStorageWrites=[];window.__mpWire=[];window.__mpSockets=[];window.__mpSocketCount=0;
    for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(this===localStorage)window.__mpStorageWrites.push({method,args});return original.apply(this,args)}}
    const Native=window.WebSocket;
    window.WebSocket=class extends Native{constructor(url,protocols){
      if(String(url)!==${JSON.stringify(endpoint)})throw new Error('測試拒絕非本機遊戲WebSocket:'+url);
      super(url,protocols);window.__mpSocketCount++;window.__mpSockets.push(this);
      const nativeSend=this.send.bind(this);this.send=(data)=>{try{const m=JSON.parse(data);if(m.type==='input'){window.__mpWire.push({at:Date.now(),...m});if(window.__mpWire.length>5000)window.__mpWire.shift()}}catch{}return nativeSend(data)};
    }};
  })()`;
}

async function makePage(label, wallet) {
  const context = (await browser.send('Target.createBrowserContext')).browserContextId;
  contexts.push(context); report.isolatedContexts.push({ label, context });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const targets = await (await fetch(cdp + '/json')).json(), target = targets.find(page => page.id === targetId);
  assert.ok(target, `new target ${label}`);
  const connection = new Connection(target.webSocketDebuggerUrl, label); connections.push(connection);
  connection.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.exceptions.push({ page: label, exceptionDetails }));
  connection.on('Inspector.targetCrashed', details => report.diagnostics.push({ page: label, event: 'Inspector.targetCrashed', details }));
  connection.on('Inspector.detached', details => report.diagnostics.push({ page: label, event: 'Inspector.detached', details }));
  connection.on('Network.webSocketCreated', ({ url }) => { if (url !== endpoint) report.externalRequests.push({ page: label, type: 'websocket', url }); });
  connection.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url);
    const allowed = ['data:', 'blob:', 'about:'].includes(url.protocol) || (url.origin === origin);
    if (!allowed) { report.blockedExternalRequests.push({ page: label, url: request.url }); report.externalRequests.push({ page: label, type: 'http', url: request.url }); await connection.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); }
    else await connection.send('Fetch.continueRequest', { requestId });
  });
  await connection.send('Page.enable'); await connection.send('Runtime.enable'); await connection.send('Network.enable');
  await connection.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation(wallet) });
  await connection.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await connection.send('Page.bringToFront');
  await connection.send('Page.navigate', { url: origin + '/multiplayer.html' });
  await connection.until('!!window.__mp?.ready && !document.querySelector("#mp-create").disabled', 120000);
  return connection;
}

async function check(name, exercise) {
  currentCase = name;
  try { const details = await exercise(); report.cases.push({ name, status: 'PASS', details }); console.log(JSON.stringify({ name, status: 'PASS', details })); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
}
async function click(page, id) {
  await page.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center',inline:'nearest'})`);
  const point = await page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();if(e.disabled||e.hidden)throw new Error('button unavailable:'+e.id);const x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)?.closest('button,a')?.id}})()`);
  assert.equal(point.hit, id, `${id} must be reachable`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
async function focus(page) { await page.send('Page.bringToFront'); await page.until('document.hasFocus()', 15000); }
async function key(page, code, down) {
  const codes = { ArrowLeft: 37, ArrowRight: 39, ArrowDown: 40, Space: 32 };
  await page.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key: code === 'Space' ? ' ' : code, code, windowsVirtualKeyCode: codes[code] });
}
async function snapshot(page) {
  return page.evaluate(`(() => {const c=__mp.client,r=c.room,m=r?.players.find(p=>p.id===c.selfId);return {status:c.status,id:c.selfId,code:r?.code,phase:r?.phase,matchId:r?.matchId,startAt:r?.startAt,serverTime:r?.serverTime,me:m,models:__mp.scene.cars.size,focus:document.hasFocus(),active:document.activeElement.id}})()`);
}
async function layout(page, stage, section) {
  for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    const result = await page.evaluate(`(() => {window.scrollTo(0,0);const ids=[...document.querySelectorAll(${JSON.stringify(section + ' button, ' + section + ' input, ' + section + ' select')})].filter(e=>e.getClientRects().length&&!e.hidden).map(e=>e.id);const controls=ids.map(id=>{const e=document.getElementById(id);e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===e||e.contains(hit))}});return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,controls}})()`);
    assert.ok(result.documentWidth <= width + 1, `${stage} overflow ${JSON.stringify(result)}`);
    assert.ok(result.controls.length > 0);
    for (const control of result.controls) {
      assert.ok(control.width >= 44 && control.height >= 44, `${stage} touch target ${JSON.stringify(control)}`);
      assert.ok(control.left >= -1 && control.right <= width + 1 && control.top >= -1 && control.bottom <= height + 1, `${stage} inaccessible ${JSON.stringify(control)}`);
      assert.equal(control.reachable, true, `${stage} covered ${JSON.stringify(control)}`);
    }
    report.layouts.push({ stage, ...result });
    const file = `${stage}-${width}x${height}.png`, shot = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidence, file), Buffer.from(shot.data, 'base64')); report.screenshots.push(file);
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.evaluate('window.scrollTo(0,0)');
}

try {
  const sw = await (await fetch(origin + '/sw.js', { cache: 'no-store' })).text();
  report.build = sw.match(/const VERSION = '([^']+)'/)?.[1]; assert.equal(report.build, expectedBuild);
  const version = await (await fetch(cdp + '/json/version')).json(); report.browser = version.Browser;
  browser = new Connection(version.webSocketDebuggerUrl, 'browser');
  report.browserVersion = await browser.send('Browser.getVersion');
  report.systemInfo = await browser.send('SystemInfo.getInfo');
  report.gpuSummary = {
    devices: report.systemInfo.gpu?.devices ?? [],
    glVendor: report.systemInfo.gpu?.auxAttributes?.glVendor ?? null,
    glRenderer: report.systemInfo.gpu?.auxAttributes?.glRenderer ?? null,
    glImplementationParts: report.systemInfo.gpu?.auxAttributes?.glImplementationParts ?? null,
    featureStatus: report.systemInfo.gpu?.featureStatus ?? {},
  };
  console.log(JSON.stringify({ cdpPort, browser: report.browserVersion, gpu: report.gpuSummary, setupRenderIsolation: report.setupRenderIsolation }));
  a = await makePage('A', 12345);
  if (pauseADuringSetup) {
    // 僅供保留的舊 SwiftShader 對照；正常 GPU 預設不替換任何 renderer。
    await a.evaluate(`window.__mpSetupRender=__mp.scene.renderer.render;__mp.scene.renderer.render=function(){}`);
    report.setupRenderIsolation.pausedOnlyAWhileBLoads = true;
    report.limitations.push('明確啟用舊對照旗標：B場景建置期間暫停A實際render，保留rAF/JS；九項案例前恢復，不代表雙場景並行初始化');
    try { b = await makePage('B', 54321); }
    finally {
      await a.evaluate(`__mp.scene.renderer.render=window.__mpSetupRender;delete window.__mpSetupRender`);
      report.setupRenderIsolation.restoredBeforeCases = true;
    }
  } else b = await makePage('B', 54321);
  assert.notEqual(contexts[0], contexts[1]);

  await check('兩個獨立 context 的初始頁不開 socket，玩家錢包隔離且不改寫單人進度', async () => {
    const values = [];
    for (const page of [a, b]) values.push(await page.evaluate(`({sockets:__mpSocketCount,status:__mp.client.status,room:__mp.client.room,initial:__mpInitialStorage,current:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),writes:__mpStorageWrites})`));
    for (const value of values) { assert.equal(value.sockets, 0); assert.equal(value.status, 'idle'); assert.equal(value.room, null); assert.deepEqual(value.current, value.initial); assert.deepEqual(value.writes, []); }
    assert.equal(JSON.parse(values[0].current['taipei-gp-v2']).taxi.money, 12345);
    assert.equal(JSON.parse(values[1].current['taipei-gp-v2']).taxi.money, 54321);
    return { sockets: values.map(value => value.sockets), wallets: [12345, 54321], separateContexts: true };
  });

  await check('入口三種手機尺寸不橫溢、控制至少 44px，短螢幕能捲到各操作', async () => { await layout(a, 'entry', '#mp-entry'); return { viewports: 3 }; });
  await check('真建立／加入按鈕取得同房，單人不能開始；房間三尺寸可操作且遠端模型建立', async () => {
    await focus(a);
    await a.evaluate(`document.querySelector('#mp-name').value='赤焰';document.querySelector('#mp-laps').value='1'`);
    await click(a, 'mp-create'); await a.until(`__mp.client.room?.phase==='lobby'`);
    assert.equal(await a.evaluate(`document.querySelector('#mp-start').disabled`), true);
    await layout(a, 'lobby', '#mp-room');
    const code = (await snapshot(a)).code;
    await focus(b); await b.evaluate(`document.querySelector('#mp-name').value='藍流';document.querySelector('#mp-code').value=${JSON.stringify(code)}`);
    await click(b, 'mp-join');
    await b.until(`__mp.client.room?.players.length===2 && __mp.scene.cars.size===2`);
    await a.until(`__mp.client.room?.players.length===2 && __mp.scene.cars.size===2`);
    const one = await snapshot(a), two = await snapshot(b);
    assert.equal(one.code, two.code); assert.notEqual(one.id, two.id); assert.equal(one.models, 2); assert.equal(two.models, 2);
    assert.equal(await b.evaluate(`document.querySelector('#mp-start').hidden`), true);
    return { code, distinctPlayers: true, models: [one.models, two.models], hostOnlyStart: true };
  });

  await check('全員真準備與開始按鈕取得同一 matchId／startAt，HUD 名單同步', async () => {
    await focus(a); await click(a, 'mp-ready'); await a.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).ready`);
    assert.equal(await a.evaluate(`document.querySelector('#mp-start').disabled`), true);
    await focus(b); await click(b, 'mp-ready');
    await a.until(`!document.querySelector('#mp-start').disabled`);
    await focus(a); await click(a, 'mp-start');
    const one = await a.until(`__mp.client.room?.phase==='countdown'&&({matchId:__mp.client.room.matchId,startAt:__mp.client.room.startAt})`);
    const two = await b.until(`__mp.client.room?.matchId===${JSON.stringify(one.matchId)}&&({matchId:__mp.client.room.matchId,startAt:__mp.client.room.startAt})`);
    assert.deepEqual(one, two);
    await a.until(`__mp.client.room.phase==='racing'&&!document.querySelector('#mp-hud').hidden`);
    await b.until(`__mp.client.room.phase==='racing'&&!document.querySelector('#mp-hud').hidden`);
    assert.equal(await a.evaluate(`document.querySelectorAll('#mp-board li').length`), 2);
    return { ...one, boardPlayers: 2 };
  });

  await check('真方向／煞車鍵控制伺服器車況，鏡頭與音效點擊後不吞鍵盤', async () => {
    await focus(a); const before = await snapshot(a);
    await a.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v>3`);
    for (const id of ['mp-camera', 'mp-sound']) {
      await click(a, id);
      assert.notEqual(await a.evaluate('document.activeElement.id'), id);
      const mark = Date.now(); await key(a, 'ArrowLeft', true);
      await a.until(`__mpWire.some(m=>m.at>=${mark}&&m.steer<0&&!m.brake)`);
      await key(a, 'ArrowLeft', false);
    }
    const brakingAt = Date.now(); await key(a, 'ArrowDown', true);
    await a.until(`__mpWire.some(m=>m.at>=${brakingAt}&&m.brake)`);
    await key(a, 'ArrowDown', false);
    await a.until(`Math.hypot(__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.x-${before.me.car.x},__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.z-${before.me.car.z})>.5`);
    const after = await snapshot(a); assert.ok(after.me.ackSeq > before.me.ackSeq);
    return { before: { x: before.me.car.x, z: before.me.car.z }, after: { x: after.me.car.x, z: after.me.car.z }, ackSeq: after.me.ackSeq, keyboardAfterButtons: true };
  });

  await check('失焦持續送煞車而非只送一次，另一位車手與全場時間繼續', async () => {
    await focus(a); await a.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v>3`);
    const startA = await snapshot(a), startB = await snapshot(b);
    // 不同 headless contexts 可以同時 hasFocus=true；先在 A 自己的
    // context 啟用原生空白分頁，確保測試真的進入失焦前置條件。
    const aContext = report.isolatedContexts.find(value => value.label === 'A').context;
    const blank = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: aContext });
    report.realFocusPrecondition.blankTargetId = blank.targetId;
    report.realFocusPrecondition.context = aContext;
    await browser.send('Target.activateTarget', { targetId: blank.targetId });
    await a.until('document.hasFocus()===false', 15000);
    const blurredAt = Date.now();
    await focus(b);
    const focusState = { a: await a.evaluate('document.hasFocus()'), b: await b.evaluate('document.hasFocus()') };
    assert.equal(focusState.a, false, 'A must truly lose focus before checking continuous brake');
    assert.equal(focusState.b, true, 'B must remain focused while A brakes');
    report.realFocusPrecondition.achieved = true;
    report.realFocusPrecondition.focusState = focusState;
    report.realFocusPrecondition.checkedAt = new Date().toISOString();
    await a.until(`__mpWire.filter(m=>m.at>${blurredAt + 100}).length>=5&&(__mpWire.filter(m=>m.at>${blurredAt + 100}).at(-1).at-__mpWire.filter(m=>m.at>${blurredAt + 100})[0].at)>800`, 20000);
    const wire = await a.evaluate(`__mpWire.filter(m=>m.at>${blurredAt + 100})`);
    assert.ok(wire.every(message => message.brake && message.steer === 0), 'unfocused input must continuously brake');
    await a.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v<${Math.max(1, startA.me.car.v / 2)}`);
    await b.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).progress>${startB.me.progress + .5}`);
    const afterA = await snapshot(a), afterB = await snapshot(b);
    assert.equal(afterA.phase, 'racing'); assert.equal(afterB.phase, 'racing'); assert.ok(afterB.serverTime > startB.serverTime);
    return { repeatedBrakePackets: wire.length, spanMs: wire.at(-1).at - wire[0].at, focusedOtherProgress: afterB.me.progress - startB.me.progress, staleCarSpeed: afterA.me.car.v };
  });

  await check('暫時離線加切斷真 transport 會自動 resume，保留 playerId／matchId', async () => {
    await focus(b); const before = await snapshot(b);
    await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await b.evaluate(`__mpSockets.at(-1).close()`);
    await b.until(`__mp.client.status==='reconnecting'`, 5000);
    await delay(300);
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await b.until(`__mp.client.status==='connected'&&__mp.client.room?.matchId===${JSON.stringify(before.matchId)}`, 10000);
    const after = await snapshot(b);
    assert.equal(after.id, before.id); assert.equal(after.code, before.code); assert.equal(after.matchId, before.matchId);
    return { playerId: after.id, matchId: after.matchId, fault: 'CDP offline + native socket close', socketCount: await b.evaluate('__mpSocketCount') };
  });

  await check('persisted 離頁／回頁事件使用真 disconnect／restore，恢復同一席位', async () => {
    await focus(a); const before = await snapshot(a);
    await a.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))`);
    await a.until(`__mp.client.status==='disconnected'`);
    await a.evaluate(`dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))`);
    await a.until(`__mp.client.status==='connected'&&__mp.client.room?.matchId===${JSON.stringify(before.matchId)}`, 10000);
    const after = await snapshot(a); assert.equal(after.id, before.id); assert.equal(after.matchId, before.matchId);
    return { playerId: after.id, matchId: after.matchId, syntheticPersistedEvents: true, nativeBFCacheVerified: false };
  });

  await check('比賽三尺寸控制至少 44px 且可點，真離房不停止另一人的比賽', async () => {
    await layout(a, 'race', '#mp-hud');
    await focus(a); const before = await snapshot(b);
    a.on('Page.javascriptDialogOpening', () => a.send('Page.handleJavaScriptDialog', { accept: true }));
    await click(a, 'mp-race-leave'); await a.until(`__mp.client.room===null`);
    await focus(b);
    await b.until(`__mp.client.room?.phase==='racing'&&__mp.client.room.players.filter(p=>p.dnf).length===1`);
    await b.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).progress>${before.me.progress + .5}`);
    const after = await snapshot(b); assert.equal(after.matchId, before.matchId);
    return { remainingPhase: after.phase, remainingProgress: after.me.progress - before.me.progress, departedDnf: true };
  });

  for (const page of [a, b]) {
    const storage = await page.evaluate(`({initial:__mpInitialStorage,current:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),writes:__mpStorageWrites})`);
    assert.deepEqual(storage.current, storage.initial); assert.deepEqual(storage.writes, []);
  }
  report.localStorageUnchanged = true;
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.blockedExternalRequests, []); assert.deepEqual(report.externalRequests, []);
} catch (error) {
  if (!report.cases.some(test => test.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: error.stack ?? String(error) });
  console.error(error.stack ?? String(error));
  for (const page of [a, b].filter(Boolean)) {
    try { const shot = await page.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(evidence, `${page.label}-failure.png`), Buffer.from(shot.data, 'base64')); } catch { /* 原錯誤保留 */ }
    try { report[`${page.label}FailureState`] = await snapshot(page); } catch { /* CDP 可能已斷 */ }
  }
} finally {
  // 先離開本次玩家自己的房間，再只銷毀本次兩個 contexts。
  for (const page of [a, b].filter(Boolean)) { try { await page.evaluate('window.__mp?.client?.leave()'); } catch { /* 原錯誤保留 */ } }
  for (const connection of connections) connection.closing = true;
  for (const context of contexts) { try { await browser.send('Target.disposeBrowserContext', { browserContextId: context }); report.contextsDisposed.push({ context, disposed: true }); } catch (error) { report.contextsDisposed.push({ context, disposed: false }); report.exceptions.push({ cleanup: String(error) }); } }
  report.realFocusPrecondition.blankDisposedWithContext = report.contextsDisposed.some(value => value.context === report.realFocusPrecondition.context && value.disposed);
  for (const connection of connections) connection.close(); browser?.close();
  report.completedAt = new Date().toISOString();
  report.sourceHashes = await sourceHashes(); report.sourceUnchangedDuringTests = JSON.stringify(beforeHashes) === JSON.stringify(report.sourceHashes);
  report.productHashBefore = beforeProductHash; report.productHash = await productHash();
  report.productUnchangedDuringTests = beforeProductHash === report.productHash;
  report.hashIncludes = ['src/', 'api/', 'shared/', 'server/ (excluding node_modules)', 'index.html', 'multiplayer.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tools/build-multiplayer-physics.mjs'];
  report.summary = { passed: report.cases.filter(test => test.status === 'PASS').length, failed: report.cases.filter(test => test.status === 'FAIL').length };
  report.status = report.summary.failed === 0 && report.summary.passed === 9 && report.exceptions.length === 0 && report.blockedExternalRequests.length === 0 && report.externalRequests.length === 0 && report.localStorageUnchanged && contexts.length === 2 && report.contextsDisposed.every(value => value.disposed) && report.sourceUnchangedDuringTests && report.productUnchangedDuringTests ? 'PASS' : 'FAIL';
  await writeFile(path.join(evidence, 'multiplayer-browser-summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(summaryPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, ...report.summary, cdpPort, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests, productHash: report.productHash, productUnchangedDuringTests: report.productUnchangedDuringTests, setupRenderIsolation: report.setupRenderIsolation, evidence: path.relative(project, evidence) }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
