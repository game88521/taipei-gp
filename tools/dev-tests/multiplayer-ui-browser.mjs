// 一個真瀏覽器玩家 + 一個真 WS 玩家；不是雙瀏覽器驗證。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, open, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CdpConnection, instrument, snapshot, focus, click, key, layout } from './multiplayer-ui-cdp.mjs';
import { WireClient, drivingInput, ORIGIN, settle } from './multiplayer-test-helpers.mjs';
import { buildTrack } from '../../server/physics.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, TRACK_STAMP } from '../../shared/multiplayer-protocol.ts';

const directory = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(directory, '../..');
const cdpPort = Number(process.env.GP_MULTIPLAYER_CDP_PORT ?? '9333');
assert.ok(Number.isInteger(cdpPort) && cdpPort >= 1024 && cdpPort <= 65535, 'GP_MULTIPLAYER_CDP_PORT must be a valid local port');
const origin = ORIGIN, endpoint = 'ws://127.0.0.1:4320/ws', cdp = `http://127.0.0.1:${cdpPort}`;
const expectedBuild = process.env.GP_MULTIPLAYER_EXPECTED_BUILD ?? 'c27a6eb50a74';
const expectedCases = 11;
const compatibility = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, trackStamp: TRACK_STAMP };
const evidence = path.join(directory, `multiplayer-ui-browser-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const summaryPath = path.join(directory, 'multiplayer-ui-browser-summary.json');
try { await rename(summaryPath, path.join(evidence, 'multiplayer-ui-browser-summary.previous.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const report = {
  startedAt: new Date().toISOString(), build: null, expectedBuild, expectedCases, cdpPort,
  transport: 'single-browser-plus-real-websocket-peer', isolatedContexts: [], contextsDisposed: [],
  localOnly: true, playerStorageTouched: false, localStorageUnchanged: false,
  cases: [], steps: [], exceptions: [], externalRequests: [], blockedExternalRequests: [], layouts: [], screenshots: [],
  limitations: ['一個真瀏覽器玩家＋一個真WS玩家，不是雙瀏覽器通過證據；原雙場景測試保持FAIL', 'persisted pagehide/pageshow採合成事件驗真disconnect/restore，未宣稱真BFCache命中', '自動駕駛只觀察快照產生方向／煞車，以真伺服器wall clock跑圈，不改車況、進度、終點或伺服器時間', '未驗手機FPS／耗電、音訊聽感、兩台實機或公開WSS延遲'],
};
const sourceFiles = ['multiplayer.html', 'src/multiplayer-game.ts', 'src/multiplayer-client.ts', 'src/multiplayer-scene.ts', 'src/multiplayer.css', 'shared/multiplayer-protocol.ts'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(project, file))).digest('hex')])));
// 與 multiplayer-checks.mjs 使用相同檔案順序及 bytes，包含 UI 的傳遞依賴。
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
const beforeHashes = await hashes();
const beforeProductHash = await productHash();
const track = buildTrack();
let browser, page, context, blankTarget, peer, credentials, peerRoom = null, driverTimer, drivePeer = false, currentCase = '建立單UI隔離頁', sequence = 0, previousMatch = null, tracing = false, traceComplete;

function step(label) { const value = { case: currentCase, label, at: new Date().toISOString() }; report.steps.push(value); console.log(JSON.stringify({ step: value })); }
async function startTrace() {
  step('browser tracing start before first start button');
  traceComplete = new Promise(resolve => browser.on('Tracing.tracingComplete', resolve));
  const categories = ['devtools.timeline', 'v8', 'toplevel', 'gpu', 'blink.user_timing', 'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-devtools.timeline'];
  await browser.send('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', includedCategories: categories }, transferMode: 'ReturnAsStream', streamFormat: 'json' });
  tracing = true; report.trace = { startedAt: new Date().toISOString(), file: 'browser-race-trace.json', categories };
}
async function stopTrace() {
  if (!tracing) return;
  tracing = false;
  try {
    await browser.send('Tracing.end');
    let eventTimer;
    const completed = await Promise.race([traceComplete, new Promise((_, reject) => { eventTimer = setTimeout(() => reject(new Error('browser Tracing.tracingComplete timeout')), 30000); })]).finally(() => clearTimeout(eventTimer));
    const file = await open(path.join(evidence, report.trace.file), 'w');
    try {
      let eof = false, bytes = 0;
      while (!eof) { const chunk = await browser.send('IO.read', { handle: completed.stream, size: 1048576 }); const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'); await file.write(data); bytes += data.length; eof = chunk.eof; }
      report.trace.bytes = bytes; report.trace.completedAt = new Date().toISOString(); report.trace.status = 'SAVED';
    } finally { await file.close(); await browser.send('IO.close', { handle: completed.stream }); }
  } catch (error) { report.trace.status = 'FAIL'; report.trace.error = error.stack ?? String(error); }
  console.log(JSON.stringify({ trace: report.trace }));
}

async function check(name, exercise) {
  currentCase = name;
  try { const details = await exercise(); report.cases.push({ name, status: 'PASS', details }); console.log(JSON.stringify({ name, status: 'PASS', details })); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
}
function latestPeerRoom() { return [...(peer?.messages ?? [])].reverse().find(message => message.room)?.room ?? peerRoom; }
async function enterPeer(message) {
  const client = new WireClient(endpoint, origin);
  let welcome;
  try {
    await client.open();
    const mark = client.mark();
    client.send({ ...compatibility, ...message });
    welcome = await client.until(value => value.type === 'welcome' || value.type === 'error', mark);
    assert.equal(welcome.type, 'welcome', `real WS peer entry rejected: ${JSON.stringify(welcome)}`);
  } catch (error) { await client.close(); throw error; }
  peer = client; peerRoom = welcome.room; credentials = { code: welcome.room.code, playerId: welcome.playerId, token: welcome.resumeToken };
  return welcome;
}
async function waitPeer(predicate, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const room = latestPeerRoom(); if (room && predicate(room)) return room; await delay(50); }
  throw new Error('real WS peer room condition timeout');
}
async function returnHostToUi() {
  const current = await snapshot(page);
  if (await page.evaluate('__mp.client.room.hostId===__mp.client.selfId')) return;
  drivePeer = false; const saved = { ...credentials };
  await peer.close(); await page.until('__mp.client.room.hostId===__mp.client.selfId');
  await enterPeer({ type: 'resume', ...saved });
  assert.equal((await snapshot(page)).id, current.id);
}

try {
  const sw = await (await fetch(origin + '/sw.js', { cache: 'no-store' })).text(); report.build = sw.match(/const VERSION = '([^']+)'/)?.[1]; assert.equal(report.build, expectedBuild);
  const version = await (await fetch(cdp + '/json/version')).json(); report.browser = version.Browser;
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  report.browserVersion = await browser.send('Browser.getVersion');
  report.systemInfo = await browser.send('SystemInfo.getInfo');
  console.log(JSON.stringify({ browser: report.browserVersion, gpu: report.systemInfo.gpu }));
  context = (await browser.send('Target.createBrowserContext')).browserContextId; report.isolatedContexts.push({ label: 'UI', context });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  blankTarget = (await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context })).targetId;
  const target = (await (await fetch(cdp + '/json')).json()).find(value => value.id === targetId); assert.ok(target);
  page = new CdpConnection(target.webSocketDebuggerUrl, 'UI', report);
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.exceptions.push({ page: 'UI', exceptionDetails }));
  page.on('Network.webSocketCreated', ({ url }) => { if (url !== endpoint) report.externalRequests.push({ type: 'websocket', url }); });
  page.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url), allowed = ['data:', 'blob:', 'about:'].includes(url.protocol) || url.origin === origin;
    if (!allowed) { report.externalRequests.push({ type: 'http', url: request.url }); report.blockedExternalRequests.push(request.url); await page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); }
    else await page.send('Fetch.continueRequest', { requestId });
  });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable'); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: instrument(origin, endpoint) });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.bringToFront'); await page.send('Page.navigate', { url: origin + '/multiplayer.html' });
  await page.until('!!window.__mp?.ready&&!document.querySelector("#mp-create").disabled', 120000);

  await check('單瀏覽器隔離玩家初始不開socket，錢包12345保持原樣', async () => {
    const value = await page.evaluate(`({sockets:__mpSocketCount,status:__mp.client.status,room:__mp.client.room,raw:localStorage.getItem('taipei-gp-v2'),writes:__mpStorageWrites})`);
    assert.equal(value.sockets, 0); assert.equal(value.status, 'idle'); assert.equal(value.room, null); assert.equal(JSON.parse(value.raw).taxi.money, 12345); assert.deepEqual(value.writes, []);
    return { sockets: 0, wallet: 12345, contexts: 1, nodePeer: true };
  });
  await check('入口390×844／844×390／844×220不橫溢，控制至少44px且可捲可點', async () => { await layout(page, 'entry', '#mp-entry', report, evidence); return { viewports: 3 }; });
  await check('真加入及建立按鈕共房，只有一人時禁止起跑，遠端模型可見', async () => {
    const hosted = await enterPeer({ type: 'create', name: '藍流', laps: 1 });
    await focus(page); await page.evaluate(`document.querySelector('#mp-name').value='赤焰';document.querySelector('#mp-code').value=${JSON.stringify(hosted.room.code)}`);
    await click(page, 'mp-join'); await page.until(`__mp.client.room?.code===${JSON.stringify(hosted.room.code)}&&__mp.client.room.players.length===2`);
    await click(page, 'mp-leave'); await page.until('__mp.client.room===null');
    const leaveMark = peer.mark(); peer.send({ type: 'leave' }); await peer.until(message => message.type === 'left', leaveMark); await peer.close(); peer = null; peerRoom = null; credentials = null;
    await page.evaluate(`document.querySelector('#mp-laps').value='1'`);
    await click(page, 'mp-create'); await page.until(`__mp.client.room?.phase==='lobby'`);
    assert.equal(await page.evaluate(`document.querySelector('#mp-start').disabled`), true);
    const code = (await snapshot(page)).code; await enterPeer({ type: 'join', code, name: '藍流' });
    await page.until(`__mp.client.room?.players.length===2&&__mp.scene.cars.size===2`);
    const count = await page.evaluate(`({models:__mp.scene.cars.size,remote:[...__mp.scene.cars.entries()].filter(([id])=>id!==__mp.client.selfId).map(([id,c])=>({id,visible:c.model.root.visible,name:c.name.visible}))})`);
    assert.equal(count.models, 2); assert.equal(count.remote.length, 1); assert.equal(count.remote[0].visible, true);
    driverTimer = setInterval(() => {
      const room = latestPeerRoom(); if (!room || room.phase !== 'racing' || !peer || peer.ws.readyState !== 1) return;
      if (room.matchId !== previousMatch) { previousMatch = room.matchId; sequence = -1; }
      const me = room.players.find(player => player.id === credentials.playerId); if (!me || me.finishMs !== null || me.dnf) return;
      const input = drivePeer ? drivingInput(me.car, track) : { steer: 0, brake: true };
      peer.send({ type: 'input', matchId: room.matchId, seq: ++sequence, ...input });
    }, 50);
    return { room: code, players: 2, remoteModels: count.remote.length, uiJoinAndCreateButtons: true, transport: report.transport };
  });
  await check('大廳三尺寸可達操作，全員準備後同步matchId／startAt與HUD名單', async () => {
    await layout(page, 'lobby', '#mp-room', report, evidence);
    await click(page, 'mp-ready'); await page.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).ready`);
    assert.equal(await page.evaluate(`document.querySelector('#mp-start').disabled`), true);
    peer.send({ type: 'ready', ready: true }); await page.until(`!document.querySelector('#mp-start').disabled`);
    await startTrace();
    await click(page, 'mp-start');
    const ui = await page.until(`__mp.client.room?.phase==='countdown'&&({matchId:__mp.client.room.matchId,startAt:__mp.client.room.startAt})`);
    const node = await waitPeer(room => room.phase === 'countdown' && room.matchId === ui.matchId);
    assert.equal(node.startAt, ui.startAt);
    await page.until(`__mp.client.room.phase==='racing'&&!document.querySelector('#mp-hud').hidden`);
    assert.equal(await page.evaluate(`document.querySelectorAll('#mp-board li').length`), 2);
    return { ...ui, uiPlayers: 2, realNodePeer: true };
  });
  await check('真方向／煞車鍵改變權威快照；鏡頭及音效點擊後不吞鍵盤', async () => {
    step('focus page'); await focus(page);
    step('initial authority snapshot'); const before = await snapshot(page);
    step('wait authority speed >3');
    await page.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v>3`);
    for (const id of ['mp-camera', 'mp-sound']) {
      step(`click ${id}`); await click(page, id);
      step(`${id} button released focus`); assert.notEqual(await page.evaluate('document.activeElement.id'), id);
      const mark = Date.now(); step(`${id} ArrowLeft keyDown`); await key(page, 'ArrowLeft', true);
      step(`${id} wait real steer packet`); await page.until(`__mpWire.some(m=>m.at>=${mark}&&m.steer<0&&!m.brake)`);
      step(`${id} ArrowLeft keyUp`); await key(page, 'ArrowLeft', false);
    }
    const mark = Date.now(); step('ArrowDown keyDown'); await key(page, 'ArrowDown', true);
    step('wait real brake packet'); await page.until(`__mpWire.some(m=>m.at>=${mark}&&m.brake)`);
    step('ArrowDown keyUp'); await key(page, 'ArrowDown', false);
    step('wait authority position moved >.5m');
    await page.until(`Math.hypot(__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.x-${before.me.car.x},__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.z-${before.me.car.z})>.5`);
    step('final authority snapshot'); const after = await snapshot(page); assert.ok(after.me.ackSeq > before.me.ackSeq);
    return { movedMetres: Math.hypot(after.me.car.x - before.me.car.x, after.me.car.z - before.me.car.z), ackSeq: after.me.ackSeq, keyboardAfterButtons: true };
  });
  await check('切往無3D空白頁真失焦後持續煞車，真WS對手仍前進', async () => {
    await focus(page); await page.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v>3`);
    const before = await snapshot(page), peerBefore = latestPeerRoom().players.find(player => player.id === credentials.playerId).progress, mark = Date.now(); drivePeer = true;
    await browser.send('Target.activateTarget', { targetId: blankTarget }); await page.until('!document.hasFocus()');
    await page.until(`__mpWire.filter(m=>m.at>${mark + 100}).length>=5&&(__mpWire.filter(m=>m.at>${mark + 100}).at(-1).at-__mpWire.filter(m=>m.at>${mark + 100})[0].at)>800`);
    const wire = await page.evaluate(`__mpWire.filter(m=>m.at>${mark + 100})`); assert.ok(wire.every(message => message.brake && message.steer === 0));
    await page.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v<${Math.max(1, before.me.car.v / 2)}`);
    await waitPeer(room => room.players.find(player => player.id === credentials.playerId).progress > peerBefore + .5);
    drivePeer = false; await focus(page);
    return { repeatedBrakePackets: wire.length, spanMs: wire.at(-1).at - wire[0].at, peerProgress: latestPeerRoom().players.find(player => player.id === credentials.playerId).progress - peerBefore };
  });
  await check('CDP暫時離線加切斷真socket後自動resume，保留身分及match', async () => {
    const before = await snapshot(page);
    await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await page.evaluate('__mpSockets.at(-1).close()');
    await page.until(`__mp.client.status==='reconnecting'`, 5000); await delay(300);
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.until(`__mp.client.status==='connected'&&__mp.client.room?.matchId===${JSON.stringify(before.matchId)}`, 10000);
    const after = await snapshot(page); assert.equal(after.id, before.id); assert.equal(after.matchId, before.matchId);
    return { playerId: after.id, matchId: after.matchId, fault: 'CDP offline + native socket close' };
  });
  await check('persisted離頁／回頁事件經真disconnect及restore回到原席位', async () => {
    const before = await snapshot(page); await page.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))`); await page.until(`__mp.client.status==='disconnected'`);
    await page.evaluate(`dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))`); await page.until(`__mp.client.status==='connected'&&__mp.client.room?.matchId===${JSON.stringify(before.matchId)}`, 10000);
    const after = await snapshot(page); assert.equal(after.id, before.id); assert.equal(after.matchId, before.matchId);
    return { playerId: after.id, matchId: after.matchId, syntheticPersistedEvents: true, nativeBFCacheVerified: false };
  });
  await check('真比賽HUD三尺寸操作至少44px且不被覆蓋', async () => { await layout(page, 'race', '#mp-hud', report, evidence); return { viewports: 3, renderedCars: (await snapshot(page)).models }; });
  await check('兩玩家正常方向／煞車以真walltime完賽，成績頁與再戰按鈕同步回大廳', async () => {
    await focus(page); await returnHostToUi(); drivePeer = true;
    const started = Date.now();
    await page.evaluate(`window.__mpRealInputRead=__mp.input.read;__mp.input.read=function(){const c=__mp.client,r=c.room,p=r?.players.find(p=>p.id===c.selfId);if(!p||p.finishMs!==null||p.dnf)return{steer:0,brake:true};const car=p.car,t=__mp.scene.track,i=car.pos.i,j=(i+Math.round((8+car.v*.45)/t.ds))%t.N;let e=Math.atan2(t.px[j]-car.x,t.pz[j]-car.z)-car.h;e=Math.atan2(Math.sin(e),Math.cos(e));const ahead=(i+Math.round((car.v*.5)/t.ds))%t.N;return{steer:Math.max(-1,Math.min(1,-e*2.5)),brake:car.v>t.vTarget[ahead]+1}}`);
    await page.until(`__mp.client.room?.phase==='results'`, 180000);
    await page.evaluate(`__mp.input.read=window.__mpRealInputRead;delete window.__mpRealInputRead`); drivePeer = false;
    const result = await page.evaluate(`({players:__mp.client.room.players,shown:!document.querySelector('#mp-results').hidden,rows:document.querySelectorAll('#mp-results-list li').length,matchId:__mp.client.room.matchId})`);
    assert.equal(result.shown, true); assert.equal(result.rows, 2); assert.ok(result.players.every(player => player.finishMs !== null && !player.dnf && player.completedLaps === 1), 'both real players must complete the lap');
    await click(page, 'mp-rematch'); await page.until(`__mp.client.room?.phase==='lobby'&&__mp.client.room.players.every(p=>!p.ready&&p.completedLaps===0&&p.finishMs===null)`);
    await waitPeer(room => room.phase === 'lobby' && room.players.every(player => !player.ready));
    return { wallTimeMs: Date.now() - started, finishMs: result.players.map(player => player.finishMs), ranks: result.players.map(player => player.rank), automatedControlsOnly: true, rematchViaRealButton: true };
  });
  await check('第二場真開始取得新match，離開比賽後真WS對手仍前進', async () => {
    const oldMatch = previousMatch; await click(page, 'mp-ready'); peer.send({ type: 'ready', ready: true }); await page.until(`!document.querySelector('#mp-start').disabled`); await click(page, 'mp-start'); await page.until(`__mp.client.room?.phase==='racing'`);
    const current = await snapshot(page); assert.notEqual(current.matchId, oldMatch); drivePeer = true;
    page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true }));
    await click(page, 'mp-race-leave'); await page.until('__mp.client.room===null');
    const remaining = await waitPeer(room => room.phase === 'racing' && room.players.some(player => player.dnf));
    const before = remaining.players.find(player => player.id === credentials.playerId).progress;
    await waitPeer(room => room.phase === 'racing' && room.players.find(player => player.id === credentials.playerId).progress > before + .5);
    drivePeer = false;
    return { newMatchId: current.matchId, previousMatchId: oldMatch, departedDnf: true, remainingPeerContinued: true };
  });
  const storage = await page.evaluate(`({initial:__mpInitialStorage,current:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),writes:__mpStorageWrites})`);
  assert.deepEqual(storage.current, storage.initial); assert.deepEqual(storage.writes, []); report.localStorageUnchanged = true;
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.blockedExternalRequests, []);
} catch (error) {
  if (!report.cases.some(test => test.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: error.stack ?? String(error) });
  console.error(error.stack ?? String(error));
  await stopTrace();
  try { report.failureState = await snapshot(page); } catch { /* 原錯誤保留 */ }
  try { const shot = await page.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(evidence, 'failure.png'), Buffer.from(shot.data, 'base64')); } catch { /* 原錯誤保留 */ }
} finally {
  clearInterval(driverTimer);
  await stopTrace();
  try { if (page) await page.evaluate('window.__mp?.client?.leave()'); } catch { /* 原錯誤保留 */ }
  if (peer) { try { if (peer.ws.readyState === 1) peer.send({ type: 'leave' }); await peer.close(); } catch { /* 原錯誤保留 */ } }
  if (page) page.closing = true;
  if (context && browser) { try { await browser.send('Target.disposeBrowserContext', { browserContextId: context }); report.contextsDisposed.push({ context, disposed: true }); } catch (error) { report.contextsDisposed.push({ context, disposed: false }); report.exceptions.push({ cleanup: String(error) }); } }
  page?.close(); browser?.close();
  report.completedAt = new Date().toISOString(); report.sourceHashes = await hashes(); report.sourceUnchangedDuringTests = JSON.stringify(beforeHashes) === JSON.stringify(report.sourceHashes);
  report.productHash = await productHash(); report.productUnchangedDuringTests = beforeProductHash === report.productHash;
  report.summary = { passed: report.cases.filter(test => test.status === 'PASS').length, failed: report.cases.filter(test => test.status === 'FAIL').length };
  report.status = report.summary.passed === expectedCases && report.summary.failed === 0 && report.localStorageUnchanged && report.exceptions.length === 0 && report.externalRequests.length === 0 && report.blockedExternalRequests.length === 0 && report.contextsDisposed.length === 1 && report.contextsDisposed[0].disposed && report.sourceUnchangedDuringTests && report.productUnchangedDuringTests ? 'PASS' : 'FAIL';
  await writeFile(path.join(evidence, 'multiplayer-ui-browser-summary.json'), JSON.stringify(report, null, 2) + '\n'); await writeFile(summaryPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, ...report.summary, transport: report.transport, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests, productHash: report.productHash, productUnchangedDuringTests: report.productUnchangedDuringTests, evidence: path.relative(project, evidence) }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
