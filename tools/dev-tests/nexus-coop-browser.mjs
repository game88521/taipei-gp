// Root schedules CDP suites sequentially. One real city renderer and a real WS peer, isolated save/context.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { createMultiplayerServer } from '../../server/index.mjs';
import { COOP_VERSION, COOP_CITY_STAMP, COOP_STATIONS } from '../../shared/nexus-coop.ts';
import { WireClient, settle } from './multiplayer-test-helpers.mjs';
import { CdpConnection, click, focus } from './multiplayer-ui-cdp.mjs';
const root = new URL('../../', import.meta.url), port = Number(process.env.GP_NEXUS_COOP_PORT ?? 4399), origin = `http://127.0.0.1:${port}`, cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const sha = b => createHash('sha256').update(b).digest('hex'), evidencePath = `tools/dev-tests/nexus-coop-browser-evidence-${Date.now()}`, evidence = new URL(evidencePath + '/', root); await mkdir(evidence);
const report = { status: 'RUNNING', evidence: evidencePath, cases: [], localOnly: true, realPhoneUsed: false, exceptions: [], externalRequests: [], layouts: [], screenshots: [], sourceHashes: {}, limitations: ['真本機Chrome＋真城市與真WS peer；不是兩台實機或外網真人測試。', '手機尺寸為桌面模擬；取貨在真倉庫停穩，遠車起點採明示server放車，再以v3真input前進，沒有冒稱完整真人送貨。'], scriptSha256: sha(await readFile(new URL(import.meta.url))) };
try { await writeFile(new URL('previous-result.json', evidence), await readFile(new URL('tools/dev-tests/nexus-coop-browser-result.json', root))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const f of ['src/main.ts', 'src/nexus-coop-ui.ts', 'src/nexus-coop-client.ts', 'src/nexus-coop.css', 'src/traffic.ts', 'server/nexus-coop-service.mjs', 'server/index.mjs', 'shared/nexus-coop.ts', 'shared/nexus-coop-city.json']) report.sourceHashes[f] = sha(await readFile(new URL(f, root)));
report.build = (await readFile(new URL('dist/sw.js', root), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let web, app, browser, page, context, peer, wsPort;
const ev = s => page.evaluate(s), wait = async (condition, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await condition()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Browser condition timed out'); };
async function clickId(id) { await ev(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`); await click(page, id); }
async function expandHud() {
  if (await ev(`document.getElementById('coop-hud').open`)) return;
  const point = await ev(`(()=>{const e=document.querySelector('#coop-hud > summary');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,reachable:document.elementFromPoint(x,y)?.closest('summary')===e}})()`);
  assert.equal(point.reachable, true, '合作HUD展開鈕必須可點');
  for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  assert.equal(await ev(`document.getElementById('coop-hud').open`), true);
}
async function check(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: String(e.stack) }); throw e; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
async function shot(name) { const result = await page.send('Page.captureScreenshot', { format: 'png' }); const file = new URL(name + '.png', evidence); await writeFile(file, Buffer.from(result.data, 'base64')); report.screenshots.push(name + '.png'); }
const protectedState = `(()=>{const s=__gp.save;return{wallet:s.taxi.money,best:s.best,sectors:s.sectors,ghost:s.ghost,stats:s.stats,damage:s.damage,visited:s.progress?.visited,season:s.season??null}})()`;
let originalProtected;
try {
  web = await preview({ root: fileURLToPath(root), preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  app = createMultiplayerServer({ allowedOrigins: [origin] }); await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(0, '127.0.0.1', resolve); }); wsPort = app.httpServer.address().port;
  const version = await (await fetch(cdp + '/json/version')).json(); browser = new CdpConnection(version.webSocketDebuggerUrl, 'nexus-coop-browser', report);
  context = (await browser.send('Target.createBrowserContext')).browserContextId; const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const target = (await (await fetch(cdp + '/json')).json()).find(t => t.id === targetId); page = new CdpConnection(target.webSocketDebuggerUrl, 'nexus-coop-city', report);
  page.on('Runtime.exceptionThrown', e => report.exceptions.push(e)); page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: false }));
  page.on('Fetch.requestPaused', async ({ requestId, request }) => { const u = new URL(request.url), ok = u.origin === origin || ['about:', 'data:', 'blob:'].includes(u.protocol); if (!ok) report.externalRequests.push(request.url); await page.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...ok ? {} : { errorReason: 'BlockedByClient' } }); });
  page.on('Network.webSocketCreated', e => { if (new URL(e.url).hostname !== '127.0.0.1') report.externalRequests.push(e.url); });
  for (const method of ['Runtime.enable', 'Page.enable', 'Network.enable']) await page.send(method);
  await page.send('Network.setBypassServiceWorker', { bypass: true }); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const seed = { schema: 3, best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, quali: false }, taxi: { money: 12345, trips: 2 }, quality: 'low', touch: 'off', tutDone: true, car: 'sedan' };
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{if(location.origin!==${JSON.stringify(origin)})return;localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});const Native=WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){const u=new URL(String(url));if(u.protocol==='ws:'&&['localhost','127.0.0.1'].includes(u.hostname)&&u.pathname==='/coop'){u.hostname='127.0.0.1';u.port=${JSON.stringify(String(wsPort))};}super(u.href,protocols);}};})()` });
  await page.send('Page.navigate', { url: origin + '/?q=low&notraffic' }); await wait(async () => await ev(`!!window.__gp?.nexusCoop && !document.getElementById('boot') && document.querySelector('#btn-nexus-coop')?.getClientRects().length>0`), 180000);
  // Keep real RAF/physics/network running; reducing only drawing resolution avoids software-GPU stalls.
  await ev(`__gp.renderer.setPixelRatio(.25);__gp.renderer.setSize(320,200,false)`); await focus(page);
  await check('2主選單入口、可取消表單、真城市合作房建立', async () => {
    await clickId('btn-nexus-coop'); await wait(async () => await ev(`!!document.getElementById('nexus-coop-overlay')&&!document.getElementById('nexus-coop-overlay').classList.contains('hidden')`)); assert.equal(await ev(`document.getElementById('nexus-coop-overlay').classList.contains('hidden')`), false);
    await ev(`document.getElementById('coop-name').value='測試物流員'`); await clickId('coop-create'); await wait(async () => await ev(`__gp.nexusCoop.active && !__gp.nexusCoop.busy`), 90000);
    assert.equal(app.coopService.rooms.size, 1); assert.equal(await ev(`document.getElementById('coop-code').value.length`), 6);
    originalProtected = await ev(protectedState); await shot('01-created');
  });
  await check('2七個真城市地面站能由現有Router雙向抵達且終點高度吻合', async () => {
    const routes = await ev(`(()=>{const stations=${JSON.stringify(COOP_STATIONS)},depot=stations[0];return stations.slice(1).map(s=>{const out=__gp.router.route(depot.x,depot.z,s.x,s.z,depot.y+.25,s.y+.25),back=__gp.router.route(s.x,s.z,depot.x,depot.z,s.y+.25,depot.y+.25);return{id:s.id,out:out?.path.length??0,back:back?.path.length??0,height:out?.ys.at(-1),target:s.y+.25}})})()`);
    for (const r of routes) { assert.ok(r.out > 1 && r.back > 1, JSON.stringify(r)); assert.ok(Math.abs(r.height - r.target) <= 1.6, JSON.stringify(r)); } return routes;
  });
  let code, playerId, peerWelcome, request = 0, poseSeq = 0;
  await check('2真WS朋友加入，全員準備後由UI開始配送', async () => {
    code = await ev(`__gp.nexusCoop.client.room.code`); playerId = await ev(`__gp.nexusCoop.client.selfId`);
    peer = new WireClient(`ws://127.0.0.1:${wsPort}/coop`, origin); await peer.open(); peer.send({ type: 'join', request: ++request, v: COOP_VERSION, cityStamp: COOP_CITY_STAMP, name: '朋友貨運員', vehicle: 'pickup', code }); peerWelcome = await peer.until(m => m.type === 'welcome');
    await wait(async () => await ev(`__gp.nexusCoop.client.room.players.length===2`)); await clickId('coop-ready'); peer.send({ type: 'ready', request: ++request, ready: true }); await peer.until(m => m.type === 'ack' && m.request === request);
    await clickId('coop-start'); await wait(async () => await ev(`__gp.nexusCoop.client.room.phase==='running'`)); assert.equal(app.coopService.rooms.get(code).phase, 'running');
  });
  await check('2倉庫真位置停穩取貨，貨物狀態與獨立分數由server回傳', async () => {
    const room = app.coopService.rooms.get(code), p = room.players.get(playerId), id = room.cargo[0].id;
    await wait(() => p.dwellStation === COOP_STATIONS[0].id && Date.now() - p.dwellAt >= 1300, 12000);
    await clickId(`coop-pickup-${id}`); await wait(() => p.cargo === id); assert.equal(room.cargo[0].state, 'carried'); assert.equal(p.delivered, 0);
    await wait(async () => await ev(`__gp.nexusCoop.client.room.players.find(p=>p.id===__gp.nexusCoop.client.selfId).cargo===${JSON.stringify(id)}`));
    assert.equal(await ev(`__gp.nexusCoop.client.room.players.find(p=>p.id===__gp.nexusCoop.client.selfId).cargo`), id); await shot('02-carrying');
  });
  await check('2手機尺寸表單無水平溢位且觸控動作至少44像素', async () => {
    for (const [width, height] of [[390, 844], [844, 390]]) { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); const r = await ev(`(()=>{const card=document.querySelector('.nexus-coop-card'),r=card.getBoundingClientRect();return{left:r.left,right:r.right,scroll:card.scrollWidth,width:card.clientWidth,controls:[...card.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,h:e.getBoundingClientRect().height}))}})()`); assert.ok(r.left >= -1 && r.right <= width + 1, JSON.stringify(r)); assert.ok(r.scroll <= r.width + 2, JSON.stringify(r)); for (const c of r.controls) assert.ok(c.h >= 44, JSON.stringify(c)); report.layouts.push({ width, height, ...r }); await shot(`03-layout-${width}x${height}`); }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  });
  await check('2貨單導航返回真正城市駕駛，友車位置可見並平滑更新', async () => {
    const id = app.coopService.rooms.get(code).cargo[0].id;
    await ev(`document.querySelector('[data-cargo="${id}"] button').click()`); await wait(async () => await ev(`__gp.state==='free' && !!__gp.nav?.path`));
    const depot = COOP_STATIONS[0],room=app.coopService.rooms.get(code),p=room.players.get(peerWelcome.selfId);app.coopService.place(p,{...depot,x:depot.x+6});
    for(let i=0;i<12;i++){peer.send({type:'input',code,runId:room.runId,seq:++poseSeq,steer:0,throttle:true,brake:false,handbrake:false,active:true});await new Promise(r=>setTimeout(r,35));}
    assert.ok(Math.hypot(p.pose.x-(depot.x+6),p.pose.z-depot.z)>.1);
    await wait(async () => await ev(`(()=>{const g=__gp.scene.getObjectByName('city-coop-only');return g?.children.some(c=>c.type==='Group'&&c.visible&&Math.hypot(c.position.x-${p.pose.x},c.position.z-${p.pose.z})<2)})()`));
    assert.equal(await ev(`document.getElementById('coop-hud').classList.contains('hidden')`), false); await shot('04-world');
  });
  await check('2合作駕駛與喇叭不寫入錢包、正式PB、探索、車損和統計', async () => {
    await ev(`(()=>{for(let i=0;i<240;i++)__gp.freeStep(1/120);__gp.updateFreeHud(2)})()`);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, code: 'KeyH', key: 'h' });
    assert.deepEqual(await ev(protectedState), originalProtected);
  });
  await check('2合作扶正經server返回倉庫退貨，邀請不包含席位憑證', async () => {
    await expandHud(); await clickId('coop-hud-room'); await clickId('coop-return'); await wait(() => app.coopService.rooms.get(code).players.get(playerId).cargo === null);
    const invite = await ev(`document.getElementById('coop-invite').value`); assert.equal(new URL(invite).searchParams.get('coop'), code); assert.equal(invite.includes(peerWelcome.token), false); assert.equal(new URL(invite).searchParams.size, 1);
  });
  await check('2離房清理友車與席位，普通自由駕駛仍可開始', async () => {
    await clickId('coop-leave'); await wait(async () => await ev(`!__gp.nexusCoop.active`)); assert.equal(app.coopService.rooms.get(code).players.has(playerId), false);
    await clickId('coop-close'); await clickId('btn-free'); await wait(async () => await ev(`__gp.state==='free'`)); assert.equal(await ev(`__gp.scene.getObjectByName('city-coop-only').children.filter(c=>c.type==='Group').length`), 0); assert.deepEqual(await ev(`({wallet:__gp.save.taxi.money,best:__gp.save.best})`), { wallet: 12345, best: null });
  });
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); report.status = 'PASS';
} catch (e) { report.status = 'FAIL'; report.error = String(e.stack); console.error(report.error); process.exitCode = 1; }
finally {
  const cleanup = [];
  if (peer) try { await peer.close(); } catch (e) { cleanup.push(String(e)); }
  if (context && browser) try { await browser.send('Target.disposeBrowserContext', { browserContextId: context }); } catch (e) { cleanup.push(String(e)); }
  try { page?.close(); browser?.close(); } catch (e) { cleanup.push(String(e)); }
  if (web) try { await new Promise((resolve, reject) => web.httpServer.close(e => e ? reject(e) : resolve())); } catch (e) { cleanup.push(String(e)); }
  if (app) try { await app.close(); } catch (e) { cleanup.push(String(e)); }
  report.sourceUnchangedDuringTests = (await Promise.all(Object.entries(report.sourceHashes).map(async ([f, hash]) => sha(await readFile(new URL(f, root))) === hash))).every(Boolean);
  report.scriptUnchangedDuringTests = sha(await readFile(new URL(import.meta.url))) === report.scriptSha256;
  if (!report.sourceUnchangedDuringTests || !report.scriptUnchangedDuringTests) { report.status = 'FAIL'; report.error = 'Sources or test script changed during browser verification'; process.exitCode = 1; }
  report.cleanup = { status: cleanup.length ? 'FAIL' : 'PASS', errors: cleanup }; if (cleanup.length) { report.status = 'FAIL'; process.exitCode = 1; }
  report.summary = { PASS: report.cases.filter(c => c.status === 'PASS').length, FAIL: report.cases.filter(c => c.status === 'FAIL').length };
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeFile(new URL('report.json', evidence), json); await writeFile(new URL('tools/dev-tests/nexus-coop-browser-result.json', root), json); console.log(JSON.stringify({ status: report.status, ...report.summary, cleanup: report.cleanup.status }));
}
