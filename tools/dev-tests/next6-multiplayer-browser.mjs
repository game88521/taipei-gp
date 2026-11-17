import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'vite';
import { CdpConnection, instrument, click, focus } from './multiplayer-ui-cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), ownProject = path.resolve(here, '../..');
const project = path.resolve(process.env.NEXT6_BROWSER_PROJECT ?? ownProject), before = process.env.NEXT6_EXPECT_BEFORE === '1';
const { createMultiplayerServer } = await import(pathToFileURL(path.join(project, 'server/index.mjs')).href);
const origin = 'http://127.0.0.1:4319', endpoint = 'ws://127.0.0.1:4322/ws';
const cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const evidence = path.join(here, `next6-multiplayer-browser-evidence-${Date.now()}`); await mkdir(evidence);
const report = { startedAt: new Date().toISOString(), before, project, cases: [], exceptions: [], externalRequests: [], layouts: [], localOnly: true, status: 'FAIL' };
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let app, web, browser, timer, paused = false, clockOffset = 0; const pages = [], contexts = [];
async function check(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
try {
  app = createMultiplayerServer({ allowedOrigins: [origin], autoTick: false, now: () => Date.now() + clockOffset });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(4322, '127.0.0.1', resolve); });
  timer = setInterval(() => { if (!paused) app.service.tick(); }, 1000 / 60);
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4319, strictPort: true }, logLevel: 'error' });
  const version = await (await fetch(cdp + '/json/version')).json(); browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  for (const label of ['host', 'guest']) {
    const context = (await browser.send('Target.createBrowserContext')).browserContextId; contexts.push(context);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const target = (await (await fetch(cdp + '/json')).json()).find(t => t.id === targetId); assert.ok(target);
    const page = new CdpConnection(target.webSocketDebuggerUrl, label, report); pages.push(page);
    page.on('Runtime.exceptionThrown', e => report.exceptions.push({ label, ...e }));
    page.on('Fetch.requestPaused', async ({ requestId, request }) => {
      const url = new URL(request.url), allowed = url.origin === origin || ['about:', 'data:', 'blob:'].includes(url.protocol);
      if (!allowed) report.externalRequests.push(request.url);
      await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...allowed ? {} : { errorReason: 'BlockedByClient' } });
    });
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await page.send('Network.setBypassServiceWorker', { bypass: true }); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const source = instrument(origin, endpoint).replace('constructor(url,protocols){', `constructor(url,protocols){if(String(url)==='ws://127.0.0.1:4320/ws')url=${JSON.stringify(endpoint)};`);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: origin + '/multiplayer.html' });
    await page.until(`window.__mp?.ready&&!document.getElementById('mp-create').disabled`, 150000);
  }
  const [host, guest] = pages;
  await host.evaluate(`document.getElementById('mp-track').value='austria';document.getElementById('mp-track').dispatchEvent(new Event('change',{bubbles:true}))`);
  await host.until(`__mp.ready&&!document.getElementById('mp-create').disabled`, 150000);
  await focus(host); await click(host, 'mp-create');
  const code = await host.until(`__mp.client.room?.trackId==='austria'&&__mp.client.room.code`);
  await guest.evaluate(`document.getElementById('mp-code').value=${JSON.stringify(code)}`); await focus(guest); await click(guest, 'mp-join');
  for (const page of pages) await page.until(`__mp.client.room?.players.length===2&&__mp.ready&&__mp.client.room.players.every(p=>p.loaded)`, 150000);
  const room = app.service.rooms.get(code); assert.ok(room);
  await check('stable_snapshots_reuse_lobby_rows_and_skip_hidden_lists', async () => {
    paused = true;
    await host.evaluate(`window.__next6Row=document.querySelector('#mp-players li');window.__next6Creates=0;window.__next6NativeCreate=document.createElement.bind(document);document.createElement=(...args)=>{__next6Creates++;return __next6NativeCreate(...args)};window.__next6Mutations=[];window.__next6Observer=new MutationObserver(entries=>__next6Mutations.push(...entries.map(e=>e.target.id)));for(const id of ['mp-players','mp-results-list','mp-board'])__next6Observer.observe(document.getElementById(id),{childList:true})`);
    const marker = Date.now() + 40;
    for (let i = 0; i < 20; i++) app.service.broadcast(room, 'snapshot', marker - 19 + i);
    await host.until(`__mp.client.room.serverTime>=${marker}`); await delay(100);
    const details = await host.evaluate(`({sameRow:__next6Row===document.querySelector('#mp-players li'),creates:__next6Creates,mutations:__next6Mutations.length,hiddenResults:document.getElementById('mp-results-list').children.length,hiddenBoard:document.getElementById('mp-board').children.length})`);
    if (before) { assert.equal(details.sameRow, false); assert.ok(details.creates > 0); }
    else { assert.equal(details.sameRow, true); assert.equal(details.creates, 0); assert.equal(details.mutations, 0); assert.equal(details.hiddenResults, 0); assert.equal(details.hiddenBoard, 0); }
    await host.evaluate(`document.createElement=window.__next6NativeCreate;__next6Observer.disconnect()`);
    paused = false; return details;
  });
  await focus(host); await click(host, 'mp-ready'); await focus(guest); await click(guest, 'mp-ready');
  await host.until(`!document.getElementById('mp-start').disabled`); await focus(host); await click(host, 'mp-start');
  await host.until(`__mp.client.room.phase==='racing'`, 20000); await guest.until(`__mp.client.room.phase==='racing'`);
  await check('server_deadline_reaches_real_browser_and_uses_finish_grace', async () => {
    if (before) { assert.equal(await host.evaluate(`__mp.client.room.deadlineAt===undefined&&!document.getElementById('mp-deadline')`), true); return { deadlineMetadataAbsent: true }; }
    assert.equal(await host.evaluate(`__mp.client.room.deadlineAt-__mp.client.room.startAt`), 600000);
    paused = true;
    const leader = room.players.get(await host.evaluate('__mp.client.selfId')); assert.ok(leader);
    leader.finishMs = 1000; leader.completedLaps = room.laps;
    if ('lapTimesMs' in leader) { leader.lapTimesMs = Array(room.laps).fill(1000 / room.laps); leader.bestLapMs = 1000 / room.laps; leader.lastLapElapsedMs = 1000; }
    room.firstFinishAt = Date.now(); app.service.broadcast(room, 'snapshot', Date.now());
    await focus(guest);
    await guest.until(`__mp.client.room.deadlineReason==='finish-timeout'&&document.getElementById('mp-deadline').textContent.includes('最後完賽')`);
    assert.equal(await guest.evaluate('__mp.client.room.deadlineAt'), room.firstFinishAt + 60000);
    return { text: await guest.evaluate(`document.getElementById('mp-deadline').textContent`), deadlineDelta: await guest.evaluate(`__mp.client.room.deadlineAt-__mp.client.serverNow()`) };
  });
  if (!before) {
    await check('fps_preference_is_saved_and_new_control_is_reachable', async () => {
      await focus(host);
      await host.evaluate(`document.getElementById('mp-fps').value='30';document.getElementById('mp-fps').dispatchEvent(new Event('change',{bubbles:true}))`);
      assert.equal(await host.evaluate(`localStorage.getItem('taipei-gp-multiplayer-fps-v1')`), '30');
      for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
        await host.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        const value = await host.evaluate(`(() => {const e=document.getElementById('mp-fps'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,control:{width:r.width,height:r.height,top:r.top,bottom:r.bottom,hit:document.elementFromPoint(x,y)===e},deadline:document.getElementById('mp-deadline').textContent}})()`);
        assert.ok(value.scrollWidth <= width + 1); assert.ok(value.control.width >= 44 && value.control.height >= 44 && value.control.top >= -1 && value.control.bottom <= height + 1 && value.control.hit, JSON.stringify(value));
        report.layouts.push(value);
      }
      return report.layouts;
    });
    await check('finish_timeout_reason_is_rendered_then_rematch_clears_deadline', async () => {
      clockOffset += 60001; // 測試私有伺服器時鐘前進，後續reset使用同一時鐘。
      app.service.maybeFinish(room, Date.now() + clockOffset);
      await focus(guest);
      await guest.until(`__mp.client.room.phase==='results'&&document.getElementById('mp-results-list').textContent.includes('超過完賽期限')`);
      const text = await guest.evaluate(`document.getElementById('mp-results-list').textContent`);
      await host.evaluate(`document.getElementById('mp-rematch').click()`);
      await host.until(`__mp.client.room.phase==='lobby'&&__mp.client.room.deadlineAt===null`);
      await guest.until(`__mp.client.room.phase==='lobby'&&__mp.client.room.players.every(p=>!p.dnf&&p.dnfReason===null)`);
      return { text, resetDeadline: await guest.evaluate('__mp.client.room.deadlineAt') };
    });
    await check('fps_preference_is_restored_after_reload', async () => {
      await host.evaluate('__mp.client.leave()');
      await focus(host); await host.send('Page.reload', { ignoreCache: true });
      await host.until(`window.__mp?.ready&&!document.getElementById('mp-create').disabled`, 150000);
      const value = await host.evaluate(`document.getElementById('mp-fps').value`);
      assert.equal(value, '30'); return { restoredValue: value };
    });
  }
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); report.status = 'PASS';
} catch (error) { report.error = error.stack ?? String(error); console.error(report.error); process.exitCode = 1; }
finally {
  if (timer) clearInterval(timer);
  for (const page of pages) { await page.evaluate(`__mp.client?.leave()`).catch(() => {}); page.close(); }
  for (const context of contexts) await browser?.send('Target.disposeBrowserContext', { browserContextId: context }).catch(e => { report.cleanupError = String(e); report.status = 'FAIL'; process.exitCode = 1; });
  browser?.close(); await app?.close(); if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.completedAt = new Date().toISOString(); report.limitations = ['本機同機兩個獨立Chrome contexts，非外網或手機實機。', '以私有測試RoomService安排已完賽狀態及期限，不增加產品作弊介面。', '量測DOM重建次數，不代表FPS、耗電已量測改善。'];
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(here, before ? 'next6-multiplayer-browser-before.json' : 'next6-multiplayer-browser-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, before, cases: report.cases.length, build: report.build, evidence }));
}
