// 全部流量限本機；兩個獨立 Chrome context，使用實際 UI 與權威 WS。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { preview } from 'vite';
import { createMultiplayerServer } from '../../server/index.mjs';
import { CdpConnection, instrument, click, focus, layout } from './multiplayer-ui-cdp.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(directory, '../..');
const origin = 'http://127.0.0.1:4318', endpoint = 'ws://127.0.0.1:4321/ws';
const cdpPort = Number(process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334);
const cdp = `http://127.0.0.1:${cdpPort}`;
const evidence = path.join(directory, `multiplayer-maps-browser-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const sw = await readFile(path.join(project, 'dist/sw.js'), 'utf8');
const expectedBuild = sw.match(/const VERSION = '([^']+)'/)?.[1];
assert.match(expectedBuild ?? '', /^[a-f0-9]{12}$/);
const report = { startedAt: new Date().toISOString(), expectedBuild, cases: [], exceptions: [], externalRequests: [], screenshots: [], layouts: [], isolatedContexts: [], contextsDisposed: [], maps: [], localOnly: true, socketRemap: { from: 'ws://127.0.0.1:4320/ws', to: endpoint }, limitations: ['兩個瀏覽器 context 在同一台電腦；未驗不同網路、公開 WSS 或手機實機', '短時起跑驗證，未宣稱每張地圖完整比賽或長時間手機 FPS'], status: 'FAIL' };
const catalog = JSON.parse(await readFile(path.join(project, 'shared/multiplayer-catalog.json'), 'utf8'));
let web, app, browser;
const pages = [];
const check = async (name, exercise) => {
  const started = Date.now();
  try { const details = await exercise(); report.cases.push({ name, status: 'PASS', ms: Date.now() - started, details }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
};
const roomState = page => page.evaluate(`(() => {const c=__mp.client,r=c.room;return {code:r?.code,id:c.selfId,trackId:r?.trackId,revision:r?.trackRevision,stamp:r?.trackStamp,phase:r?.phase,match:r?.matchId,startAt:r?.startAt,ready:__mp.ready,sceneReady:__mp.scene.ready,sceneKey:__mp.scene.activeMapKey,players:r?.players.map(p=>({id:p.id,loaded:p.loaded,ready:p.ready,v:p.car.v,progress:p.progress})),description:document.getElementById('mp-room-description').textContent}})()`);
const waitLoaded = page => page.until(`__mp.ready&&__mp.scene.matchesMap(__mp.client.room)&&__mp.client.room.players.every(p=>p.loaded)&&({trackId:__mp.client.room.trackId,revision:__mp.client.room.trackRevision})`, 150000);
async function select(page, id, value) {
  await focus(page);
  await page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});if(e.disabled)throw new Error('disabled selector');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
}
async function shot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${name}.png`; await writeFile(path.join(evidence, file), Buffer.from(result.data, 'base64')); report.screenshots.push(file);
}
try {
  app = createMultiplayerServer({ allowedOrigins: [origin] });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(4321, '127.0.0.1', resolve); });
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4318, strictPort: true }, logLevel: 'error' });
  const served = await (await fetch(origin + '/sw.js', { cache: 'no-store' })).text();
  assert.equal(served, sw, 'preview must serve this work copy dist');
  const version = await (await fetch(cdp + '/json/version')).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  report.browser = version.Browser;
  for (const label of ['host', 'guest']) {
    const context = (await browser.send('Target.createBrowserContext')).browserContextId;
    report.isolatedContexts.push(context);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const target = (await (await fetch(cdp + '/json')).json()).find(t => t.id === targetId); assert.ok(target);
    const page = new CdpConnection(target.webSocketDebuggerUrl, label, report); pages.push(page);
    page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.exceptions.push({ label, exceptionDetails }));
    page.on('Fetch.requestPaused', async ({ requestId, request }) => {
      const url = new URL(request.url), allowed = ['data:', 'blob:', 'about:'].includes(url.protocol) || url.origin === origin;
      if (allowed) await page.send('Fetch.continueRequest', { requestId });
      else { report.externalRequests.push(request.url); await page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); }
    });
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    // 只把產品的本機預設4320轉到本次專用4321；拒絕其他WS與外部HTTP。
    const source = instrument(origin, endpoint).replace('constructor(url,protocols){', `constructor(url,protocols){if(String(url)==='ws://127.0.0.1:4320/ws')url=${JSON.stringify(endpoint)};`);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: origin + '/multiplayer.html' });
    await page.until(`window.__mp?.ready&&!document.getElementById('mp-create').disabled`, 150000);
  }
  const [host, guest] = pages;
  await check('入口包含台北與全部23條大獎賽賽道', async () => {
    const menu = await host.evaluate(`[...document.querySelector('#mp-track').options].map(o=>({id:o.value,label:o.textContent}))`);
    assert.equal(menu.length, 24); assert.deepEqual(menu.map(o => o.id), catalog.tracks.map(t => t.id));
    assert.ok(menu.every(o => o.label.trim()));
    await layout(host, 'maps-entry', '#mp-entry', report, evidence);
    return { count: menu.length, ids: menu.map(o => o.id) };
  });
  await check('房主建立荷蘭房間，朋友加入後各自載入同一張圖', async () => {
    await host.evaluate(`document.getElementById('mp-name').value='赤焰';document.getElementById('mp-laps').value='1'`);
    await select(host, 'mp-track', 'netherlands');
    await host.until(`__mp.ready&&!document.getElementById('mp-create').disabled`, 150000);
    await click(host, 'mp-create');
    await host.until(`__mp.client.room?.trackId==='netherlands'`);
    const code = (await roomState(host)).code;
    await guest.evaluate(`document.getElementById('mp-name').value='藍流';document.getElementById('mp-code').value=${JSON.stringify(code)}`);
    await focus(guest); await click(guest, 'mp-join');
    await host.until(`__mp.client.room?.players.length===2`); await guest.until(`__mp.client.room?.players.length===2`);
    await waitLoaded(host); await waitLoaded(guest);
    const a = await roomState(host), b = await roomState(guest);
    assert.equal(a.trackId, 'netherlands'); assert.equal(b.trackId, a.trackId); assert.equal(b.revision, a.revision);
    assert.equal(a.sceneKey, b.sceneKey); assert.equal(a.players.every(p => !p.ready), true);
    assert.equal(await guest.evaluate(`document.getElementById('mp-room-track').disabled`), true);
    report.initialMapMemory = await host.evaluate(`({...__mp.scene.renderer.info.memory})`);
    await shot(host, 'netherlands'); await layout(host, 'maps-lobby', '#mp-room', report, evidence);
    return { host: a, guest: b };
  });
  await check('全員準備後換圖會清除準備，夜景與高低差等場景可重複切換', async () => {
    const ids = ['japan', 'singapore', 'abudhabi', 'malaysia', 'china', 'taipei', 'netherlands'];
    let revision = (await roomState(host)).revision;
    for (const id of ids) {
      await focus(host); await click(host, 'mp-ready'); await focus(guest); await click(guest, 'mp-ready');
      await host.until(`__mp.client.room.players.every(p=>p.ready)`);
      await select(host, 'mp-room-track', id);
      await host.until(`__mp.client.room.trackId===${JSON.stringify(id)}&&__mp.client.room.trackRevision===${revision + 1}`);
      const changed = await roomState(host); assert.ok(changed.players.every(p => !p.ready));
      assert.equal(await host.evaluate(`document.getElementById('mp-start').disabled`), true);
      await waitLoaded(host); await waitLoaded(guest);
      const a = await roomState(host), b = await roomState(guest);
      assert.equal(a.sceneKey, b.sceneKey); assert.equal(a.trackId, id); assert.equal(b.trackId, id);
      assert.ok(a.players.every(p => !p.ready)); assert.ok(b.players.every(p => !p.ready));
      const visual = await host.evaluate(`({N:__mp.scene.track.N,length:__mp.scene.track.length,elevation:Math.max(...__mp.scene.track.py)-Math.min(...__mp.scene.track.py),cameraY:__mp.scene.camera.position.y,geometries:__mp.scene.renderer.info.memory.geometries,textures:__mp.scene.renderer.info.memory.textures,models:__mp.scene.cars.size})`);
      assert.ok(visual.N > 100 && Number.isFinite(visual.cameraY)); assert.equal(visual.models, 2);
      report.maps.push({ id, revision: a.revision, ...visual });
      if (id === 'netherlands') {
        assert.ok(visual.geometries <= report.initialMapMemory.geometries + 2, 'repeated map switch must release GPU geometries');
        assert.ok(visual.textures <= report.initialMapMemory.textures + 2, 'repeated map switch must release GPU textures');
      }
      if (['japan', 'singapore', 'abudhabi', 'taipei'].includes(id)) await shot(host, id);
      revision = a.revision;
    }
    return { transitions: ids.length, finalRevision: revision };
  });
  await check('快速連換地圖只接受最後一次載入及準備回覆', async () => {
    await select(host, 'mp-room-track', 'australia');
    await host.until(`__mp.client.room.trackId==='australia'`);
    await host.evaluate(`__mp.client.selectTrack('belgium')`);
    await host.until(`__mp.client.room.trackId==='belgium'`);
    await waitLoaded(host); await waitLoaded(guest);
    const a = await roomState(host), b = await roomState(guest); assert.equal(a.trackId, 'belgium'); assert.equal(b.sceneKey, a.sceneKey);
    assert.ok(a.players.every(p => !p.ready));
    return { host: a, guest: b };
  });
  await check('兩個瀏覽器同步倒數起跑，賽中禁止換圖且權威車輛前進', async () => {
    await focus(host); await click(host, 'mp-ready'); await focus(guest); await click(guest, 'mp-ready');
    await host.until(`!document.getElementById('mp-start').disabled`);
    await focus(host); await click(host, 'mp-start');
    const a = await host.until(`__mp.client.room.phase==='countdown'&&({match:__mp.client.room.matchId,startAt:__mp.client.room.startAt})`);
    const b = await guest.until(`__mp.client.room.phase==='countdown'&&({match:__mp.client.room.matchId,startAt:__mp.client.room.startAt})`);
    assert.deepEqual(a, b);
    await host.until(`__mp.client.room.phase==='racing'`);
    await host.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).car.v>2`);
    await guest.until(`__mp.client.room.phase==='racing'`);
    assert.equal(await host.evaluate(`document.getElementById('mp-room-track').disabled`), true);
    const final = await roomState(host); assert.equal(final.trackId, 'belgium');
    await shot(host, 'belgium-racing');
    return { synchronized: a, final };
  });
  await check('隔離玩家單人存檔完全不變且無外部流量或JS例外', async () => {
    for (const page of pages) {
      const state = await page.evaluate(`({writes:__mpStorageWrites,unchanged:JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))===JSON.stringify(__mpInitialStorage)})`);
      assert.deepEqual(state.writes, []); assert.equal(state.unchanged, true);
    }
    assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []);
    return { contexts: 2, localStorageUnchanged: true };
  });
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack ?? String(error); console.error(report.error);
} finally {
  for (const page of pages) page.close();
  if (browser) {
    for (const browserContextId of report.isolatedContexts) try { await browser.send('Target.disposeBrowserContext', { browserContextId }); report.contextsDisposed.push(browserContextId); } catch (error) { report.exceptions.push(String(error)); report.status = 'FAIL'; }
    browser.close();
  }
  await app?.close();
  if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.completedAt = new Date().toISOString(); report.evidence = path.relative(project, evidence).split(path.sep).join('/');
  report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length };
  report.catalogSha256 = createHash('sha256').update(await readFile(path.join(project, 'shared/multiplayer-catalog.json'))).digest('hex');
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(directory, 'multiplayer-maps-browser-summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, build: expectedBuild, ...report.summary, evidence: report.evidence }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
