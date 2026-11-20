// Four isolated real Chrome contexts + real loopback WS. Finish/lap fixtures
// below are explicitly service-side; complete unmodified Car driving is in
// evolution-multiplayer-server.mjs. Run after build with local Chrome CDP only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { createMultiplayerServer } from '../../server/index.mjs';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { CdpConnection, instrument, click, focus, layout } from './multiplayer-ui-cdp.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.GP_EVOLUTION_BROWSER_PORT ?? 4345), cdpPort = Number(process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334);
assert.ok([port, cdpPort].every(p => Number.isInteger(p) && p > 0 && p < 65536));
const origin = `http://127.0.0.1:${port}`, cdp = `http://127.0.0.1:${cdpPort}`;
const KEY = 'evolution-browser-local-test-key-at-least-thirty-two-bytes';
const evidence = path.join(project, 'tools/dev-tests', `evolution-multiplayer-browser-evidence-${Date.now()}`); await mkdir(evidence);
const report = { status: 'FAIL', localOnly: true, externalRequests: [], exceptions: [], cases: [], layouts: [], screenshots: [], sourceHashes: {}, serviceLapAndResultFixtures: true };
const files = ['multiplayer.html','src/multiplayer-client.ts','src/multiplayer-evolution-ui.ts','src/multiplayer-game.ts','src/multiplayer-scene.ts','src/multiplayer-spectator.ts','src/multiplayer-history.ts','src/multiplayer.css','shared/multiplayer-evolution.ts','shared/multiplayer-protocol.ts','shared/multiplayer-series.ts','server/room-service.mjs','server/series-checkpoint.mjs','server/physics.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.scriptSha256 = hash(await readFile(new URL(import.meta.url)));
for (const file of files) report.sourceHashes[file] = hash(await readFile(path.join(project, file)));
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const cpKey = 'taipei-gp-multiplayer-series-checkpoint-v1', seatsKey = 'taipei-gp-multiplayer-series-seats-v1', historyKey = 'taipei-gp-multiplayer-history-v1';
let app, web, browser, endpoint; const pages = [], contexts = [];
async function check(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); throw e; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
const value = (page, id, next) => page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(next)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`);
const all = expression => Promise.all(pages.map(page => page.until(expression, 150000)));
const wireCount = (page, type) => page.evaluate(`__mpWire.filter(m=>m.type===${JSON.stringify(type)}).length`);
async function openPage(label) {
  const { browserContextId } = await browser.send('Target.createBrowserContext'); contexts.push(browserContextId);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const target = (await (await fetch(cdp + '/json')).json()).find(r => r.id === targetId);
  const page = new CdpConnection(target.webSocketDebuggerUrl, label, report); pages.push(page); const cancellations = new Set();
  page.on('Runtime.exceptionThrown', exception => report.exceptions.push({ label, exception }));
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true }));
  page.on('Network.webSocketCreated', ({ url }) => { if (url !== endpoint) report.externalRequests.push(url); });
  page.on('Network.loadingFailed', e => { if (e.canceled || e.errorText === 'net::ERR_ABORTED') cancellations.add(e.requestId); });
  page.on('Fetch.requestPaused', async ({ requestId, networkId, request }) => {
    const url = new URL(request.url), allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(request.url);
    try { await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...allowed ? {} : { errorReason: 'BlockedByClient' } }); }
    catch (e) { if (!allowed || !networkId || !String(e).includes('Invalid InterceptionId.')) throw e;
      const end = Date.now() + 1500; while (!cancellations.has(networkId) && Date.now() < end) await delay(20); assert.ok(cancellations.has(networkId)); }
  });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker', { bypass: true }); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // Force endpoint to this script's loopback listener. Bearer credentials are
  // deliberately excluded from the test's wire observation buffer and report.
  const source = instrument(origin, endpoint).replace('constructor(url,protocols){', `constructor(url,protocols){url=${JSON.stringify(endpoint)};`)
    .replace("if(m.type==='input')", "if(!['resume-series','resume'].includes(m.type))");
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: origin + '/multiplayer.html' });
  await page.until(`window.__mp && document.getElementById('mp-track').options.length===24`, 150000);
  await value(page, 'mp-quality', 'economy'); await value(page, 'mp-track', 'japan');
  await page.until(`__mp.ready && !document.getElementById('mp-create').disabled`, 150000); return page;
}
async function loaded() { await all(`__mp.ready && __mp.client.room?.players.every(p=>p.loaded&&p.connected)`); }
async function begin(host) {
  await loaded();
  for (const page of pages) { await focus(page); await click(page, 'mp-ready'); }
  await host.until(`!document.getElementById('mp-start').disabled`); await focus(host); await click(host, 'mp-start');
  await all(`__mp.client.room?.phase==='racing'`);
}
async function applyMode(host, mode) {
  await focus(host); await value(host, 'mp-event-mode', mode); await click(host, 'mp-event-apply');
  await all(`__mp.client.room?.evolution.mode===${JSON.stringify(mode)}`); await loaded();
}
function finishFixture(room, mode) {
  let order = 0;
  for (const p of room.players.values()) {
    const net = 2000 + order++ * 100, delay = mode === 'pursuit' ? (room.evolution.releaseDelays[p.id] ?? 0) * 1000 : 0;
    p.completedLaps = room.laps; p.lapTimesMs = Array(room.laps).fill(net / room.laps); p.bestLapMs = p.lapTimesMs[0]; p.finishMs = net + delay; p.car.v = 0;
  }
  app.service.maybeFinish(room, Date.now());
}
try {
  app = createMultiplayerServer({ allowedOrigins: [origin], roomOptions: { seriesResumeSecret: KEY } });
  await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve)); endpoint = `ws://127.0.0.1:${app.httpServer.address().port}/ws`;
  web = await preview({ root: project, preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  const version = await (await fetch(cdp + '/json/version')).json(); browser = new CdpConnection(version.webSocketDebuggerUrl, 'evolution-browser', report);
  const host = await openPage('evolution-host'); for (let n = 1; n < 4; n++) await openPage(`evolution-driver-${n}`);
  let room, ids, originalTeams, checkpointPoints;
  await check('four_isolated_contexts_real_lobby_and_capabilities', async () => {
    await focus(host); await click(host, 'mp-create'); const code = await host.until('__mp.client.room?.code'); room = app.service.rooms.get(code);
    for (const [n, page] of pages.entries()) if (n) { await value(page, 'mp-name', `測試車手${n}`); await value(page, 'mp-code', code); await focus(page); await click(page, 'mp-join'); await page.until('__mp.client.room?.code'); }
    await loaded(); ids = await Promise.all(pages.map(p => p.evaluate('__mp.client.selfId'))); assert.equal(new Set(ids).size, 4);
    await all('__mp.client.room.players.length===4 && __mp.client.room.capabilities.evolution===true && __mp.client.room.capabilities.seriesResume.persistent===true');
    return { isolatedContexts: contexts.length, players: 4, persistentTestKey: true };
  });
  await check('real_vote_ui_tie_catalog_order_and_ready_invalidation', async () => {
    const choices = MULTIPLAYER_TRACKS.filter(t => t.id !== 'taipei').slice(0, 2).map(t => t.id), revision = room.trackRevision;
    for (const [n, page] of pages.entries()) {
      await page.evaluate(`document.getElementById('mp-voting').open=true`); await value(page, 'mp-vote-track', choices[n % 2]);
      await focus(page); await click(page, 'mp-vote-submit'); await page.until(`__mp.client.room.evolution.vote.ballots[__mp.client.selfId]===${JSON.stringify(choices[n % 2])}`);
    }
    await focus(host); await click(host, 'mp-vote-resolve'); await all(`__mp.client.room.trackId===${JSON.stringify(choices[0])} && Object.keys(__mp.client.room.evolution.vote.ballots).length===0`);
    assert.ok(room.trackRevision > revision); assert.ok([...room.players.values()].every(p => !p.ready)); await loaded();
    return { votes: 4, tied: true, catalogFirstWinner: choices[0], oldReadyCleared: true };
  });
  await check('real_random_series_ui_three_four_five_distinct_catalog_tracks', async () => {
    for (const count of [3, 4, 5]) {
      await value(host, 'mp-series-count', String(count)); await focus(host); await click(host, 'mp-series-random');
      await all(`__mp.client.room.series?.trackIds.length===${count}`);
      assert.equal(new Set(room.series.trackIds).size, count); assert.ok(room.series.trackIds.every(id => MULTIPLAYER_TRACKS.some(t => t.id === id)));
    }
    await focus(host); await click(host, 'mp-series-end'); await all('__mp.client.room.series===null');
    await value(host, 'mp-room-track', 'japan'); await all(`__mp.client.room.trackId==='japan'`); await loaded(); return { counts: [3, 4, 5], duplicates: 0 };
  });
  await check('event_and_vote_controls_reachable_at_small_viewports', async () => {
    await focus(host); await host.evaluate(`document.getElementById('mp-voting').open=true`);
    await layout(host, 'evolution-event-controls', '#mp-evolution', report, evidence); return { sizes: 3 };
  });
  await check('time_trial_real_ui_cutoff_grace_done_hud_and_input_freeze', async () => {
    await applyMode(host, 'time-trial'); assert.equal(room.roomRules.collisions, false); await begin(host);
    const now = Date.now(); room.startAt = now - 181000; room.simAt = now;
    for (const p of room.players.values()) { p.completedLaps = 4; p.lapTimesMs = [40000, 41000, 39000, 40000]; p.lastLapElapsedMs = 160000; p.bestLapMs = 39000; p.car.v = 0; }
    const me = room.players.get(ids[0]); me.timeTrialDone = true; app.service.broadcast(room, 'snapshot');
    await all(`__mp.client.room.players.find(p=>p.id===${JSON.stringify(ids[0])}).timeTrialDone===true`);
    await focus(host); await host.until(`document.getElementById('mp-deadline').textContent.includes('寬限') && document.getElementById('mp-race-message').textContent.includes('末圈')`);
    assert.equal(await host.evaluate('__mp.client.sendInput(1,false)'), false);
    const count = await wireCount(host, 'input'); await host.evaluate('__mp.scene.frame(.1,__mp.client.serverNow(),1,false,true,true,.1)');
    assert.equal(await wireCount(host, 'input'), count);
    for (const p of room.players.values()) p.timeTrialDone = true; app.service.maybeFinish(room, Date.now());
    await all(`__mp.client.room.phase==='results' && __mp.client.room.evolution.mode==='time-trial'`);
    await host.until(`JSON.parse(localStorage.getItem('${historyKey}')).entries.some(e=>e.mode==='time-trial')`);
    await focus(host); await click(host, 'mp-rematch'); await all(`__mp.client.room.phase==='lobby'`); await loaded();
    return { modeChangedByUi: true, fixedNoCollision: true, fixture: 'service lap/cutoff/done state', lateInputSent: false, historyClassified: true };
  });
  await check('pursuit_ui_per_driver_release_neutral_before_release_and_common_results', async () => {
    await value(host, 'mp-event-mode', 'pursuit');
    await host.evaluate(`(() => {const s=document.querySelectorAll('#mp-event-delays select');[0,3,5,10].forEach((v,i)=>s[i].value=String(v))})()`);
    await focus(host); await click(host, 'mp-event-apply'); await all(`__mp.client.room.evolution.mode==='pursuit'`); await loaded();
    assert.deepEqual(Object.values(room.evolution.releaseDelays), [0, 3, 5, 10]); await begin(host);
    // Reset only the service start-clock fixture so even a slow headless renderer
    // observes the ten-second hold; this is never a client-supplied race state.
    room.startAt = Date.now(); room.simAt = room.startAt; const held = room.players.get(ids[3]); held.car.v = 0; app.service.broadcast(room, 'snapshot');
    await pages[3].until(`document.getElementById('mp-release').textContent.includes('倒數')`);
    const before = held.car.snapshot(); assert.equal(await pages[3].evaluate('__mp.client.sendInput(1,false)'), false);
    await delay(100); assert.deepEqual(held.car.snapshot(), before);
    finishFixture(room, 'pursuit'); await all(`__mp.client.room.phase==='results'`);
    assert.equal(room.players.get(ids[3]).finishMs - 10000, 2300);
    assert.match(await host.evaluate(`document.getElementById('mp-results-list').textContent`), /淨跑/);
    await focus(host); await click(host, 'mp-rematch'); await all(`__mp.client.room.phase==='lobby'`); await loaded();
    return { delays: [0, 3, 5, 10], inputBeforeRelease: false, heldPoseUnchanged: true, commonAndNetColumns: true, resultsFixture: true };
  });
  await check('four_player_teams_real_ui_exact_two_per_team_and_scoreboard', async () => {
    await applyMode(host, 'teams');
    for (const [n, page] of pages.entries()) { await focus(page); await click(page, n % 2 ? 'mp-team-blue' : 'mp-team-red'); await all(`Object.keys(__mp.client.room.evolution.teams).length===${n + 1}`); }
    await value(host, 'mp-series-count', '3'); for (const [n, id] of ['japan', 'china', 'australia'].entries()) await value(host, `mp-series-track-${n}`, id);
    await focus(host); await click(host, 'mp-series-create'); await all('__mp.client.room.series?.trackIds.length===3'); await loaded(); await begin(host);
    finishFixture(room, 'teams'); await all(`__mp.client.room.phase==='results' && __mp.client.room.series.rounds.length===1`);
    originalTeams = structuredClone(room.evolution.teams); checkpointPoints = room.series.standings.map(p => p.points);
    assert.equal(app.service.snapshot(room).evolution.teamStandings[0].points, 14);
    await host.until(`document.getElementById('mp-series-standings').textContent.includes('紅隊') && document.getElementById('mp-series-standings').textContent.includes('14')`);
    return { teams: { red: 2, blue: 2 }, teammateCollisions: room.roomRules.collisions, teamPoints: [14, 9], resultFixture: true };
  });
  await check('checkpoint_real_save_private_storage_and_blob_without_secret_rendering', async () => {
    await focus(host); await click(host, 'mp-series-checkpoint-save'); await host.until(`!!localStorage.getItem('${cpKey}')`);
    assert.equal(await host.evaluate(`(() => {const cp=JSON.parse(localStorage.getItem('${cpKey}'));return document.body.textContent.includes(cp.token)})()`), false);
    for (const page of pages.slice(1)) assert.equal(await page.evaluate(`localStorage.getItem('${cpKey}')`), null);
    await host.evaluate(`window.__mpCheckpointBlob=null;const original=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(t=>{const v=JSON.parse(t);window.__mpCheckpointBlob={hasToken:typeof v.token==='string',persistent:v.persistent,expiresAt:v.expiresAt}});return original(b)};const nativeClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='taipei-gp-series-checkpoint.json')return;return nativeClick.call(this)}`);
    await click(host, 'mp-series-checkpoint-download'); const blob = await host.until('__mpCheckpointBlob'); assert.equal(blob.hasToken, true); assert.equal(blob.persistent, true);
    assert.equal(await host.evaluate(`localStorage.getItem('${historyKey}').includes('token')`), false);
    await layout(host, 'evolution-checkpoint-controls', '#mp-series-checkpoint', report, evidence);
    return { hostOnly: true, opaqueTokenNotRendered: true, blobBytesParsed: true, anchorSuppressed: true, tokenExcludedFromHistory: true };
  });
  await check('restart_same_key_new_room_then_all_original_seats_rejoin_via_real_ui', async () => {
    // Preserve only the original browsers' independently saved seat credentials.
    for (const page of pages) { assert.ok(await page.evaluate(`JSON.parse(localStorage.getItem('${seatsKey}')).length>0`)); await page.evaluate('__mp.client.leave()'); await page.until('__mp.client.room===null'); }
    const wsPort = app.httpServer.address().port; await app.close();
    app = createMultiplayerServer({ allowedOrigins: [origin], roomOptions: { seriesResumeSecret: KEY } });
    await new Promise(resolve => app.httpServer.listen(wsPort, '127.0.0.1', resolve));
    await host.evaluate(`document.getElementById('mp-series-resume-entry').open=true`); await focus(host); await click(host, 'mp-series-resume-saved');
    const code = await host.until('__mp.client.room?.code'); room = app.service.rooms.get(code);
    assert.equal(room.series.roundIndex, 1); assert.deepEqual(room.evolution.teams, originalTeams); assert.deepEqual(room.series.standings.map(p => p.points), checkpointPoints);
    for (let n = 1; n < pages.length; n++) { const page = pages[n]; await value(page, 'mp-code', code); await page.evaluate(`document.getElementById('mp-series-resume-entry').open=true`);
      const seatKey = await page.evaluate(`__mp.client.savedSeriesSeats.find(s=>s.playerId===${JSON.stringify(ids[n])}).key`);
      await value(page, 'mp-series-seat', seatKey); await focus(page); await click(page, 'mp-series-seat-claim'); await page.until(`__mp.client.selfId===${JSON.stringify(ids[n])} && __mp.client.room.code===${JSON.stringify(code)}`); }
    await loaded(); assert.equal(room.players.size, 4); assert.deepEqual([...room.players.keys()].sort(), [...ids].sort());
    await begin(host); assert.equal(room.series.roundIndex, 1);
    return { actualServiceRecreated: true, sameFixedTestKey: true, newRoom: true, originalIdsRestored: 4, teamAndPointsPreserved: true, nextStationStarted: true };
  });
  for (const page of pages) assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('taipei-gp-v2')).taxi.money`), 12345);
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.exceptions, []); report.status = 'PASS';
} catch (e) { report.error = e.stack; console.error(e.stack); process.exitCode = 1; }
finally {
  for (const page of pages) { await page.evaluate('window.__mp?.client?.leave()').catch(() => {}); page.close(); }
  for (const browserContextId of contexts) try { await browser?.send('Target.disposeBrowserContext', { browserContextId }); } catch (e) { (report.cleanupErrors ??= []).push(String(e)); }
  browser?.close(); await app?.close(); if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.sourceUnchangedDuringTests = true; for (const [file, digest] of Object.entries(report.sourceHashes)) if (hash(await readFile(path.join(project, file))) !== digest) report.sourceUnchangedDuringTests = false;
  report.scriptUnchangedDuringTests = report.scriptSha256 === hash(await readFile(new URL(import.meta.url)));
  report.cleanupComplete = !report.cleanupErrors?.length && !app?.httpServer.listening && !web?.httpServer.listening;
  if (!report.sourceUnchangedDuringTests || !report.scriptUnchangedDuringTests || !report.cleanupComplete) { report.status = 'FAIL'; process.exitCode = 1; }
  report.limitations = ['Four isolated real desktop Chrome contexts and real loopback WebSockets; no external network or physical phone.', 'Lap times, TT cutoff/done state and finishes are isolated service fixtures; the separate server test drives a complete three-minute race with unmodified Car physics.', 'Download validation parses real Blob bytes and suppresses the anchor; no operating-system download-folder claim.', 'Small viewport checks establish target size/occlusion, not phone FPS, thermals or comfort.', 'Service restart recreates HTTP/WS listener, RoomService and signer with a fixed test key; no deployment settings or secret files changed.'];
  report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length };
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n'); await writeFile(new URL('evolution-multiplayer-browser-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, build: report.build, ...report.summary, evidence }));
}
