// Two real local browser contexts, real WS, controlled server-side crash fixture.
// Position setup is only in this test's private RoomService; no game/network cheat API.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { createMultiplayerServer } from '../../server/index.mjs';
import { multiplayerCarsOverlap, MULTIPLAYER_COLLISION_SHAPE } from '../../server/physics.mjs';
import { CdpConnection, instrument, click, focus } from './multiplayer-ui-cdp.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../..');
const origin = 'http://127.0.0.1:4319', endpoint = 'ws://127.0.0.1:4322/ws';
const cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const evidence = path.join(directory, `multiplayer-collision-browser-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const report = { startedAt: new Date().toISOString(), cases: [], exceptions: [], externalRequests: [], isolatedContexts: [], contextsDisposed: [], screenshots: [], localOnly: true, status: 'FAIL', limitations: ['同一台電腦的兩個真瀏覽器context；非手機或外網。', '碰撞姿態由測試持有的本機伺服器安排以重現追撞；沒有修改產品網路協定。', '驗證起跑、碰撞權威結果及畫面修正，不代表全圖完賽或真實網路延遲。'] };
const sw = await readFile(path.join(project, 'dist/sw.js'), 'utf8');
report.build = sw.match(/const VERSION = '([^']+)'/)?.[1];
assert.match(report.build ?? '', /^[a-f0-9]{12}$/);
const pages = [];
let app, web, browser, timer, paused = false;
async function check(name, exercise) {
  try { const details = await exercise(); report.cases.push({ name, status: 'PASS', details }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error) }); throw error; }
}
async function shot(page, file) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, file), Buffer.from(data, 'base64')); report.screenshots.push(file);
}
try {
  app = createMultiplayerServer({ allowedOrigins: [origin], autoTick: false });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(4322, '127.0.0.1', resolve); });
  timer = setInterval(() => { if (!paused) app.service.tick(); }, 1000 / 60);
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4319, strictPort: true }, logLevel: 'error' });
  assert.equal(await (await fetch(origin + '/sw.js')).text(), sw);
  const version = await (await fetch(cdp + '/json/version')).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  report.browser = version.Browser;
  for (const label of ['host', 'guest']) {
    const context = (await browser.send('Target.createBrowserContext')).browserContextId;
    report.isolatedContexts.push(context);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const target = (await (await fetch(cdp + '/json')).json()).find(value => value.id === targetId); assert.ok(target);
    const page = new CdpConnection(target.webSocketDebuggerUrl, label, report); pages.push(page);
    page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.exceptions.push({ label, exceptionDetails }));
    page.on('Fetch.requestPaused', async ({ requestId, request }) => {
      const url = new URL(request.url);
      if (['data:', 'blob:', 'about:'].includes(url.protocol) || url.origin === origin) await page.send('Fetch.continueRequest', { requestId });
      else { report.externalRequests.push(request.url); await page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); }
    });
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const source = instrument(origin, endpoint).replace('constructor(url,protocols){', `constructor(url,protocols){if(String(url)==='ws://127.0.0.1:4320/ws')url=${JSON.stringify(endpoint)};`);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: origin + '/multiplayer.html' });
    await page.until(`window.__mp?.ready&&!document.getElementById('mp-create').disabled`, 150000);
  }
  const [host, guest] = pages;
  let room, me, other;
  await check('碰撞版本入口保留24圖，兩個真瀏覽器載入同一GP房', async () => {
    assert.equal(await host.evaluate(`document.getElementById('mp-track').options.length`), 24);
    const note = await host.evaluate(`document.querySelector('#mp-entry .mp-note').textContent`);
    assert.ok(!note.includes('互不碰撞') && note.includes('碰撞'));
    await focus(host);
    await host.evaluate(`document.getElementById('mp-track').value='austria';document.getElementById('mp-track').dispatchEvent(new Event('change',{bubbles:true}))`);
    await host.until(`__mp.ready&&!document.getElementById('mp-create').disabled`, 150000);
    await click(host, 'mp-create');
    const code = await host.until(`__mp.client.room?.trackId==='austria'&&__mp.client.room.code`);
    await guest.evaluate(`document.getElementById('mp-code').value=${JSON.stringify(code)}`);
    await focus(guest); await click(guest, 'mp-join');
    for (const page of pages) await page.until(`__mp.client.room?.players.length===2&&__mp.ready&&__mp.client.room.players.every(p=>p.loaded)`, 150000);
    room = app.service.rooms.get(code); assert.ok(room);
    me = room.players.get(await host.evaluate('__mp.client.selfId'));
    other = room.players.get(await guest.evaluate('__mp.client.selfId'));
    assert.ok(me && other);
    return { map: room.trackId, players: room.players.size, physics: (await host.evaluate('__mp.client.room.physics')), options: 24 };
  });
  await check('正常起跑仍可前進，起跑排位不會先重疊', async () => {
    assert.equal(multiplayerCarsOverlap(room.track, me.car, other.car), false);
    await focus(host); await click(host, 'mp-ready'); await focus(guest); await click(guest, 'mp-ready');
    await host.until(`!document.getElementById('mp-start').disabled`);
    await focus(host); await click(host, 'mp-start');
    await host.until(`__mp.client.room.phase==='racing'&&__mp.client.room.players.some(p=>p.car.v>2)`, 20000);
    await guest.until(`__mp.client.room.phase==='racing'`);
    paused = true;
    for (const page of pages) await page.evaluate(`__mp.scene.renderer.setAnimationLoop(null)`);
    return { sharedMatch: room.matchId, phase: room.phase };
  });
  await check('追撞會傳回雙車掉速／推進結果，兩端直接採用碰撞姿態', async () => {
    const track = room.track;
    let index = 20;
    for (let i = 20; i < track.N - 20; i++) if (Math.abs(track.curv[i]) < Math.abs(track.curv[index]) && Math.abs(track.grade[i]) < .08) index = i;
    const h = Math.atan2(track.tx[index], track.tz[index]);
    const gap = MULTIPLAYER_COLLISION_SHAPE.halfLength * 2 + .2;
    for (const [player, offset, speed] of [[me, -gap / 2, 70], [other, gap / 2, 20]]) {
      player.car.placeAt(track, index); player.car.h = h;
      player.car.x += Math.sin(h) * offset; player.car.z += Math.cos(h) * offset;
      player.car.update(0, track, 0, false); player.car.v = speed;
      player.input = { steer: 0, brake: false }; player.lastInputAt = Date.now();
    }
    const initial = [me.car.v, other.car.v];
    const beforeAt = Date.now(); app.service.broadcast(room, 'snapshot', beforeAt);
    for (const page of pages) await page.until(`__mp.client.snapshot?.serverTime>=${beforeAt}`);
    // Input transport still runs; establish controls immediately before one real authority step.
    for (const player of [me, other]) { player.input = { steer: 0, brake: false }; player.lastInputAt = Date.now(); }
    const afterAt = Date.now() + 1000 / 60;
    app.service.simulate(room, afterAt); room.simAt = afterAt;
    assert.ok(me.car.v < initial[0] - 5, 'rear car must lose speed');
    assert.ok(other.car.v > initial[1] + 5, 'front car must receive the bump');
    assert.equal(multiplayerCarsOverlap(track, me.car, other.car), false, 'final authority boxes must be separated');
    app.service.broadcast(room, 'snapshot', afterAt);
    const details = [];
    for (const [page, player] of [[host, me], [guest, other]]) {
      await page.until(`__mp.client.snapshot?.serverTime>=${afterAt}`);
      const state = await page.evaluate(`(() => {const s=__mp.scene;s.frame(0,__mp.client.serverNow(),0,true,false);return {x:s.car.x,z:s.car.z,v:s.car.v,correction:s.correction.length(),models:s.cars.size,positions:[...s.cars.values()].map(v=>({x:v.model.root.position.x,z:v.model.root.position.z}))}})()`);
      assert.ok([state.x, state.z, state.v, state.correction].every(Number.isFinite));
      assert.ok(Math.hypot(state.x - player.car.x, state.z - player.car.z) < .05, 'collision correction must not replay through the other car');
      assert.ok(state.correction < .01, 'collision correction must not smooth back into the old position');
      assert.equal(state.models, 2); details.push(state);
    }
    await shot(host, 'rear-impact-host.png'); await shot(guest, 'rear-impact-guest.png');
    return { initial, authority: [me.car.snapshot(), other.car.snapshot()], clients: details };
  });
  await check('20Hz權威快照之間持續60Hz預測與渲染，雙端碰撞模型不穿車', async () => {
    const initial = [me.car.snapshot(), other.car.snapshot()];
    const samples = [];
    let modelChecks = 0;
    // The animation scheduler is paused for deterministic capture; the real production
    // frame runs with nonzero dt and canDrive=true on every simulated rendering frame.
    // The server advances at 60Hz and publishes one authority snapshot per three frames.
    for (let frame = 1; frame <= 90; frame++) {
      const at = room.simAt + 1000 / 60;
      for (const player of [me, other]) { player.input = { steer: 0, brake: false }; player.lastInputAt = at; }
      app.service.simulate(room, at); room.simAt = at;
      assert.equal(multiplayerCarsOverlap(room.track, me.car, other.car), false, `authority overlap at frame ${frame}`);
      if (frame % 3 === 0) {
        app.service.broadcast(room, 'snapshot', at);
        for (const page of pages) await page.until(`__mp.client.snapshot?.serverTime>=${at}`);
      }
      for (const [page, player] of [[host, me], [guest, other]]) {
        const state = await page.evaluate(`(() => {const s=__mp.scene;s.frame(1/60,${at},0,false,true);return {self:__mp.client.selfId,car:s.car.snapshot(),correction:s.correction.length(),models:[...s.cars].map(([id,v])=>({id,x:v.model.root.position.x,z:v.model.root.position.z,h:v.model.root.rotation.y}))}})()`);
        assert.equal(state.models.length, 2);
        const models = state.models.map(model => ({ ...room.players.get(model.id).car.snapshot(), x: model.x, z: model.z, h: model.h }));
        assert.ok(models.every(model => [model.x, model.z, model.h, model.v].every(Number.isFinite)));
        assert.equal(multiplayerCarsOverlap(room.track, models[0], models[1]), false, `${state.self} model overlap at frame ${frame}`);
        modelChecks++;
        if ([1, 3, 6, 30, 60, 90].includes(frame)) samples.push({ frame, owner: player.id, state });
      }
    }
    assert.ok(Math.hypot(me.car.x - initial[0].x, me.car.z - initial[0].z) > 10, 'cars must continue driving after contact');
    await shot(host, 'continuous-contact-host.png'); await shot(guest, 'continuous-contact-guest.png');
    return { frames: 90, simulatedSeconds: 1.5, authorityHz: 20, physicsHz: 60, modelChecks, samples };
  });
  await check('碰撞與真瀏覽器渲染不寫單人存檔，無外部請求或JS例外', async () => {
    for (const page of pages) {
      const state = await page.evaluate(`({writes:__mpStorageWrites,unchanged:JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))===JSON.stringify(__mpInitialStorage)})`);
      assert.deepEqual(state.writes, []); assert.equal(state.unchanged, true);
    }
    assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []);
    return { localStorageUnchanged: true, isolatedContexts: 2 };
  });
  report.status = 'PASS';
} catch (error) { report.error = String(error.stack ?? error); console.error(report.error); }
finally {
  clearInterval(timer);
  for (const page of pages) page.close();
  if (browser) {
    for (const browserContextId of report.isolatedContexts) try { await browser.send('Target.disposeBrowserContext', { browserContextId }); report.contextsDisposed.push(browserContextId); } catch (error) { report.exceptions.push(String(error)); report.status = 'FAIL'; }
    browser.close();
  }
  await app?.close();
  if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.completedAt = new Date().toISOString(); report.evidence = path.relative(project, evidence).split(path.sep).join('/');
  report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(directory, 'multiplayer-collision-browser-summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, build: report.build, ...report.summary, evidence: report.evidence }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
