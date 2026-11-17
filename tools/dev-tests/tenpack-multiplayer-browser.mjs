// Two real isolated Chrome contexts + loopback authority. Full three-round UI
// lifecycle; finishes/DNF are explicitly labelled service-side result fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { createMultiplayerServer } from '../../server/index.mjs';
import { CdpConnection, instrument, click, focus, layout } from './multiplayer-ui-cdp.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:4337';
const cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const evidence = path.join(project, 'tools/dev-tests', `tenpack-multiplayer-browser-evidence-${Date.now()}`); await mkdir(evidence);
const report = { status: 'FAIL', localOnly: true, externalRequests: [], exceptions: [], cases: [], layouts: [], screenshots: [], sourceHashes: {}, resultFixtures: true };
const files = ['multiplayer.html', 'src/multiplayer-game.ts', 'src/multiplayer-client.ts', 'src/multiplayer-scene.ts', 'src/multiplayer-quality.ts', 'src/multiplayer-spectator.ts', 'src/multiplayer-series-ui.ts', 'src/multiplayer.css', 'shared/multiplayer-series.ts', 'shared/multiplayer-protocol.ts', 'server/room-service.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.scriptSha256 = hash(await readFile(new URL(import.meta.url)));
for (const file of files) report.sourceHashes[file] = hash(await readFile(path.join(project, file)));
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let app, web, browser, endpoint; const pages = [], contexts = [];
async function check(name, fn) { try { const details = await fn(); report.cases.push({ name, status: 'PASS', details }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); throw error; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
const value = (page, id, next) => page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(next)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`);
const commands = (page, type) => page.evaluate(`__mpWire.filter(m=>m.type===${JSON.stringify(type)}).length`);
async function openPage(label) {
  const { browserContextId } = await browser.send('Target.createBrowserContext'); contexts.push(browserContextId);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const target = (await (await fetch(cdp + '/json')).json()).find(row => row.id === targetId);
  const page = new CdpConnection(target.webSocketDebuggerUrl, label, report); pages.push(page); const cancellations = new Set();
  page.on('Runtime.exceptionThrown', exception => report.exceptions.push({ label, exception }));
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true }));
  page.on('Network.webSocketCreated', ({ url }) => { if (url !== endpoint) report.externalRequests.push(url); });
  page.on('Network.loadingFailed', event => { if (event.canceled || event.errorText === 'net::ERR_ABORTED') cancellations.add(event.requestId); });
  page.on('Fetch.requestPaused', async ({ requestId, networkId, request }) => {
    const url = new URL(request.url), allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(request.url);
    try { await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...allowed ? {} : { errorReason: 'BlockedByClient' } }); }
    catch (error) {
      if (!allowed || !networkId || !String(error).includes('Invalid InterceptionId.')) throw error;
      const end = Date.now() + 1500; while (!cancellations.has(networkId) && Date.now() < end) await delay(20);
      assert.ok(cancellations.has(networkId)); (report.cancelledInterceptions ??= []).push({ label, networkId });
    }
  });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable'); await page.send('Network.setBypassServiceWorker', { bypass: true }); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const source = instrument(origin, endpoint).replace('constructor(url,protocols){', `constructor(url,protocols){url=${JSON.stringify(endpoint)};`).replace("if(m.type==='input')", 'if(true)');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: origin + '/multiplayer.html' });
  await page.until(`window.__mp && document.getElementById('mp-track').options.length===24`, 150000);
  await value(page, 'mp-quality', 'economy'); await value(page, 'mp-track', 'japan');
  await page.until(`__mp.ready && !document.getElementById('mp-create').disabled`, 150000); return page;
}
async function bothReady(pages) { for (const page of pages) await page.until(`__mp.ready && __mp.client.room?.players.every(p=>p.loaded&&p.connected)`, 150000); }
async function begin(host, guest) {
  await bothReady([host, guest]);
  for (const page of [host, guest]) { await focus(page); await click(page, 'mp-ready'); }
  await host.until(`!document.getElementById('mp-start').disabled`); await focus(host); await click(host, 'mp-start');
  for (const page of [host, guest]) await page.until(`__mp.client.room?.phase==='racing'`, 20000);
}
function resultFixture(room, id, dnf, time = 2000) {
  const player = room.players.get(id);
  if (dnf) { player.dnf = true; player.dnfReason = 'left'; player.finishMs = null; }
  else { player.finishMs = time; player.completedLaps = room.laps; player.lapTimesMs = Array(room.laps).fill(time / room.laps); player.bestLapMs = player.lapTimesMs[0]; player.car.v = 0; room.firstFinishAt ??= Date.now(); }
}
try {
  app = createMultiplayerServer({ allowedOrigins: [origin] }); await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve)); endpoint = `ws://127.0.0.1:${app.httpServer.address().port}/ws`;
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4337, strictPort: true }, logLevel: 'error' });
  const version = await (await fetch(cdp + '/json/version')).json(); browser = new CdpConnection(version.webSocketDebuggerUrl, 'tenpack-browser', report);
  const host = await openPage('tenpack-host'), guest = await openPage('tenpack-guest');
  let room, code, hostId, guestId;
  await check('real_two_player_room_and_in_room_laps_invalidate_old_readiness', async () => {
    await focus(host); await click(host, 'mp-create'); code = await host.until('__mp.client.room?.code'); hostId = await host.evaluate('__mp.client.selfId'); room = app.service.rooms.get(code);
    await value(guest, 'mp-code', code); await focus(guest); await click(guest, 'mp-join'); await guest.until('__mp.client.room?.code'); guestId = await guest.evaluate('__mp.client.selfId');
    await bothReady([host, guest]); await focus(guest); await click(guest, 'mp-ready');
    const revision = room.trackRevision; await value(host, 'mp-room-laps', '5');
    for (const page of [host, guest]) await page.until(`__mp.client.room?.laps===5 && __mp.client.room.trackRevision===${revision + 1}`);
    await bothReady([host, guest]); assert.ok([...room.players.values()].every(player => !player.ready));
    assert.equal(await guest.evaluate(`document.getElementById('mp-room-laps').disabled`), true);
    await value(host, 'mp-room-laps', '1'); for (const page of [host, guest]) await page.until('__mp.client.room.laps===1'); await bothReady([host, guest]); return { realPlayers: 2, laps: room.laps, readinessCleared: true };
  });
  await check('quality_fixed_economy_standard_auto_restore_without_changing_fps_or_car', async () => {
    const before = await host.evaluate(`({car:__mp.scene.car.snapshot(),fps:document.getElementById('mp-fps').value})`);
    await value(host, 'mp-quality', 'standard'); assert.equal(await host.evaluate('__mp.scene.renderer.getPixelRatio()'), 1);
    await value(host, 'mp-quality', 'economy'); assert.equal(await host.evaluate('__mp.scene.renderer.getPixelRatio()'), .85);
    await value(host, 'mp-quality', 'auto'); assert.equal(await host.evaluate('__mp.scene.renderer.getPixelRatio()'), 1);
    const after = await host.evaluate(`({car:__mp.scene.car.snapshot(),fps:document.getElementById('mp-fps').value})`); assert.deepEqual(after, before);
    await value(host, 'mp-quality', 'economy'); return { fixedAndAutoRestored: true, fpsSettingUnchanged: true };
  });
  await check('series_route_and_quality_controls_reachable_at_three_sizes', async () => {
    await focus(host); await layout(host, 'tenpack-series-setup', '#mp-series-setup', report, evidence); await layout(host, 'tenpack-quality', '.mp-quality-settings', report, evidence); return { viewports: 3 };
  });
  const route = ['japan', 'china', 'australia'];
  await check('real_series_configure_synced_to_both_clients_and_single_map_locked', async () => {
    for (const [index, id] of route.entries()) await value(host, `mp-series-track-${index}`, id);
    await focus(host); await click(host, 'mp-series-create');
    for (const page of [host, guest]) await page.until(`__mp.client.room.series?.trackIds.join(',')===${JSON.stringify(route.join(','))}`);
    await bothReady([host, guest]); assert.equal(await host.evaluate(`document.getElementById('mp-room-track').disabled`), true); return { route };
  });
  for (let index = 0; index < route.length; index++) {
    await check(`round_${index + 1}_real_countdown_and_result_fixture_accounting`, async () => {
      await begin(host, guest); assert.equal(room.series.roundIndex, index); assert.equal(room.trackId, route[index]);
      if (index < 2) {
        resultFixture(room, hostId, index === 0, 2000); app.service.broadcast(room, 'snapshot');
        await host.until(`!document.getElementById('mp-spectator-field').hidden && __mp.scene.spectatorId===${JSON.stringify(guestId)}`);
        const inputs = await commands(host, 'input'); assert.equal(await host.evaluate('__mp.client.sendInput(1,false)'), false);
        await focus(host); await layout(host, `tenpack-spectator-${index}`, '#mp-spectator-field', report, evidence);
        assert.equal(await commands(host, 'input'), inputs); assert.equal(await host.evaluate(`document.getElementById('mp-controls').hidden`), true);
      } else resultFixture(room, hostId, false, 2000);
      resultFixture(room, guestId, false, 2100); app.service.maybeFinish(room, Date.now());
      for (const page of [host, guest]) await page.until(`__mp.client.room.phase==='results' && __mp.client.room.series.rounds.length===${index + 1}`);
      const revision = room.series.revision; app.service.recordSeriesRound(room); assert.equal(room.series.revision, revision);
      assert.equal(await host.evaluate(`document.querySelectorAll('#mp-series-history>section').length`), index + 1);
      if (index < 2) { await focus(host); await click(host, 'mp-rematch'); for (const page of [host, guest]) await page.until(`__mp.client.room.phase==='lobby' && __mp.client.room.trackId===${JSON.stringify(route[index + 1])}`); await bothReady([host, guest]); assert.ok([...room.players.values()].every(player => !player.ready && player.lapTimesMs.length === 0)); }
      return { round: index + 1, map: route[index], resultSource: 'isolated service fixture', realCountdownAndNextStation: true, hostObserver: index === 0 ? 'DNF' : index === 1 ? 'finished' : false };
    });
  }
  await check('series_final_totals_history_and_explicit_end', async () => {
    assert.equal(room.series.complete, true); const scores = Object.fromEntries(room.series.standings.map(row => [row.playerId, row.points])); assert.equal(scores[hostId], 20); assert.equal(scores[guestId], 22);
    assert.equal(await host.evaluate(`document.getElementById('mp-rematch').disabled`), true); await focus(host); await layout(host, 'tenpack-series-results', '#mp-series-summary', report, evidence);
    await click(host, 'mp-series-end'); for (const page of [host, guest]) await page.until('__mp.client.room.series===null'); assert.equal(await host.evaluate(`document.getElementById('mp-series-summary').hidden`), true); return { scores, rounds: 3, explicitlyEnded: true };
  });
  await check('legacy_metadata_omission_hides_new_server_controls_and_preserves_room_play', async () => {
    for (const page of [host, guest]) { await page.evaluate('__mp.client.leave()'); await page.until('__mp.client.room===null'); await page.until('__mp.ready', 150000); }
    const snapshot = app.service.snapshot.bind(app.service); app.service.snapshot = (...args) => { const room = snapshot(...args); delete room.capabilities; delete room.series; delete room.roomRules; return room; };
    await focus(host); await host.until(`!document.getElementById('mp-create').disabled`, 150000); await click(host, 'mp-create'); const legacyCode = await host.until('__mp.client.room?.code');
    await value(guest, 'mp-code', legacyCode); await focus(guest); await click(guest, 'mp-join'); await guest.until('__mp.client.room?.code'); await bothReady([host, guest]);
    for (const page of [host, guest]) assert.equal(await page.evaluate(`document.getElementById('mp-room-laps-field').hidden && document.getElementById('mp-series-setup').hidden && document.getElementById('mp-series-summary').hidden`), true);
    await begin(host, guest); return { contract: 'real service omitting additive metadata', originalRoomReadyAndStart: true };
  });
  await check('quality_readback_after_reload_preserves_separate_fps_and_single_save', async () => {
    await host.evaluate('__mp.client.leave()'); await host.until('__mp.client.room===null'); await value(host, 'mp-quality', 'economy'); await value(host, 'mp-fps', '30');
    await host.send('Page.reload', { ignoreCache: true }); await host.until(`window.__mp && document.getElementById('mp-quality').value==='economy'`, 150000);
    assert.equal(await host.evaluate(`document.getElementById('mp-fps').value`), '30'); assert.equal(await host.evaluate(`JSON.parse(localStorage.getItem('taipei-gp-v2')).taxi.money`), 12345);
    for (const page of pages) assert.deepEqual(await page.evaluate(`__mpStorageWrites.filter(row=>!['taipei-gp-multiplayer-quality-v1','taipei-gp-multiplayer-fps-v1','taipei-gp-multiplayer-history-v1'].includes(row.args[0]))`), []); return { reloadReadback: true, singleSaveUnchanged: true };
  });
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); report.status = 'PASS';
} catch (error) { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
finally {
  for (const page of pages) { await page.evaluate('__mp?.client?.leave()').catch(() => {}); page.close(); }
  for (const browserContextId of contexts) try { await browser?.send('Target.disposeBrowserContext', { browserContextId }); } catch (error) { (report.cleanupErrors ??= []).push(String(error)); }
  browser?.close(); await app?.close(); if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.sourceUnchangedDuringTests = true;
  for (const [file, digest] of Object.entries(report.sourceHashes)) if (hash(await readFile(path.join(project, file))) !== digest) report.sourceUnchangedDuringTests = false;
  report.cleanupComplete = !report.cleanupErrors?.length && !app?.httpServer.listening && !web?.httpServer.listening;
  report.scriptUnchangedDuringTests = report.scriptSha256 === hash(await readFile(new URL(import.meta.url)));
  if (!report.cleanupComplete || !report.sourceUnchangedDuringTests || !report.scriptUnchangedDuringTests) { report.status = 'FAIL'; process.exitCode = 1; }
  report.limitations = ['Two isolated desktop Chrome contexts and loopback WebSockets; not external networks or physical phones.', 'All three countdown/load/ready/next-station/result UI paths use the real service. Finish and DNF events are seeded inside that isolated service, not fully driven laps.', 'Legacy browser compatibility uses the current local service with optional metadata omitted; no deployed old service is contacted.', 'Viewport checks do not establish actual device FPS, battery savings, heat or touch usability.'];
  report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n'); await writeFile(new URL('tenpack-multiplayer-browser-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, build: report.build, ...report.summary, evidence }));
}
