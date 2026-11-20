// Four isolated desktop Chrome contexts and real loopback WS.
// Ghost timing, poses, finishes and elimination clocks are explicit service fixtures.
// Write and syntax-check here; root schedules the actual CDP run after integration.
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
const port = Number(process.env.GP_HORIZON_BROWSER_PORT ?? 4347), cdpPort = Number(process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334);
assert.ok([port, cdpPort].every(p => Number.isInteger(p) && p > 0 && p < 65536));
const origin = `http://127.0.0.1:${port}`, cdp = `http://127.0.0.1:${cdpPort}`;
const KEY = 'horizon-browser-local-test-key-at-least-thirty-two-bytes';
const evidence = path.join(project, 'tools/dev-tests', `horizon-multiplayer-browser-evidence-${Date.now()}`); await mkdir(evidence);
const report = { status: 'FAIL', localOnly: true, evidence: path.relative(project, evidence).replaceAll('\\', '/'), externalRequests: [], exceptions: [], cases: [], layouts: [], screenshots: [], sourceHashes: {}, serviceLapAndResultFixtures: true };
const files = ['server/horizon-service.mjs','shared/multiplayer-horizon.ts','src/multiplayer-horizon-ui.ts','src/multiplayer-horizon.css','src/multiplayer-presets.ts','multiplayer.html','src/multiplayer-client.ts','src/multiplayer-evolution-ui.ts','src/multiplayer-game.ts','src/multiplayer-scene.ts','src/multiplayer-spectator.ts','src/multiplayer-history.ts','src/multiplayer.css','shared/multiplayer-evolution.ts','shared/multiplayer-protocol.ts','shared/multiplayer-series.ts','server/room-service.mjs','server/series-checkpoint.mjs','server/physics.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.scriptSha256 = hash(await readFile(new URL(import.meta.url)));
for (const file of files) report.sourceHashes[file] = hash(await readFile(path.join(project, file)));
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const cpKey = 'taipei-gp-multiplayer-series-checkpoint-v1', seatsKey = 'taipei-gp-multiplayer-series-seats-v1', historyKey = 'taipei-gp-multiplayer-history-v1';
let app, web, browser, endpoint; const pages = [], contexts = [];
async function check(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); throw e; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
const value = (page, id, next) => page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(next)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`);
const all = (expression, targetPages = pages) => Promise.all(targetPages.map(page => page.until(expression, 150000)));
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
async function loaded(targetPages = pages) { await all(`__mp.ready && __mp.client.room?.players.every(p=>p.loaded&&p.connected)`, targetPages); }
async function begin(host, driverPages = pages) {
  await loaded(driverPages);
  for (const page of driverPages) { await focus(page); await click(page, 'mp-ready'); }
  await host.until(`!document.getElementById('mp-start').disabled`); await focus(host); await click(host, 'mp-start');
  await all(`__mp.client.room?.phase==='racing'`, driverPages);
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
async function settings(host, next) {
  await host.evaluate(`(() => {const h=${JSON.stringify(next)};for(const [key,id] of [['antiBlock','mp-anti-block'],['reverseGrid','mp-reverse-grid'],['elimination','mp-elimination']])document.getElementById(id).checked=!!h[key]})()`);
  await focus(host); await click(host, 'mp-horizon-apply');
  await all(`JSON.stringify(__mp.client.room?.horizon)===${JSON.stringify(JSON.stringify(next))}`, pages.filter(p=>p!==pages[3]||p.joinedRoom));
  await loaded(pages.filter(p=>p!==pages[3]||p.joinedRoom));
}
// Native checkbox inputs use their containing label as the touch target.
async function horizonLayout(page, stage, selector) {
  for (const [width,height] of [[1280,800],[390,844],[844,390],[844,220]]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width!==1280});
    const result=await page.evaluate(`(() => {window.scrollTo(0,0);const es=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length&&!e.hidden);const controls=es.map(e=>{const t=e.matches('input[type="checkbox"]')?e.closest('label'):e;t.scrollIntoView({block:'center',inline:'nearest'});const r=t.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id:e.id,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===t||t.contains(hit))}});return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,controls}})()`);
    assert.ok(result.documentWidth<=width+1,`${stage} horizontal overflow ${JSON.stringify(result)}`);assert.ok(result.controls.length);
    for(const c of result.controls){assert.ok(c.width>=44&&c.height>=44,`${stage} touch target ${JSON.stringify(c)}`);assert.ok(c.left>=-1&&c.right<=width+1&&c.top>=-1&&c.bottom<=height+1,`${stage} inaccessible ${JSON.stringify(c)}`);assert.equal(c.reachable,true,`${stage} covered ${JSON.stringify(c)}`);}
    report.layouts.push({stage,...result});const file=`${stage}-${width}x${height}.png`,shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,file),Buffer.from(shot.data,'base64'));report.screenshots.push(file);
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await page.evaluate('window.scrollTo(0,0)');
}
try {
  app=createMultiplayerServer({allowedOrigins:[origin],roomOptions:{seriesResumeSecret:KEY}});
  await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));endpoint=`ws://127.0.0.1:${app.httpServer.address().port}/ws`;
  web=await preview({root:project,preview:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
  const version=await(await fetch(cdp+'/json/version')).json();browser=new CdpConnection(version.webSocketDebuggerUrl,'horizon-browser',report);
  const host=await openPage('horizon-host');for(let n=1;n<4;n++)await openPage(`horizon-${n===3?'viewer':'driver-'+n}`);
  const viewer=pages[3],drivers=pages.slice(0,3),presetKey='taipei-gp-multiplayer-presets-v1',sessionKey='taipei-gp-multiplayer-session-v2';
  let room,ids,viewerId,firstCode;
  await check('four_isolated_contexts_three_real_drivers_and_capability_discovery',async()=>{
    await focus(host);await click(host,'mp-create');firstCode=await host.until('__mp.client.room?.code');room=app.service.rooms.get(firstCode);
    for(const [n,page]of drivers.entries())if(n){await value(page,'mp-name',`測試車手${n}`);await value(page,'mp-code',firstCode);await focus(page);await click(page,'mp-join');await page.until('__mp.client.room?.code');}
    await loaded(drivers);ids=await Promise.all(drivers.map(p=>p.evaluate('__mp.client.selfId')));
    await viewer.evaluate(`sessionStorage.setItem('${sessionKey}','original-driver-bytes')`);await focus(viewer);await click(viewer,'mp-horizon-connect');await viewer.until('__mp.client.horizonAvailable===true && !document.getElementById("mp-horizon-entry").hidden');
    assert.equal(room.players.size,3);assert.equal(room.spectators.size,0);return{isolatedContexts:contexts.length,drivers:3,pongCapability:true};
  });
  await check('real_anti_block_settings_and_pure_local_preset_ui_reachable_in_four_viewports',async()=>{
    await settings(host,{antiBlock:true,reverseGrid:false,elimination:false});await value(host,'mp-preset-name','週末公平短賽');await focus(host);await click(host,'mp-preset-save');
    const raw=await host.until(`localStorage.getItem('${presetKey}')`);for(const word of ['token','endpoint','playerId','roomCode','session'])assert.equal(raw.includes(word),false);
    await horizonLayout(host,'horizon-room-settings','#mp-horizon-settings button, #mp-horizon-settings input');return{savedViaUi:true,secretFields:0,viewportSizes:4};
  });
  await check('mid_race_pure_viewer_tracks_without_ready_input_or_driver_storage',async()=>{
    await begin(host,drivers);await value(viewer,'mp-name','看台觀眾');await value(viewer,'mp-code',firstCode);await focus(viewer);await click(viewer,'mp-watch');
    await viewer.until('__mp.client.isSpectator && __mp.ready && __mp.client.room?.spectators.some(v=>v.id===__mp.client.selfId&&v.loaded)');viewer.joinedRoom=true;viewerId=await viewer.evaluate('__mp.client.selfId');
    assert.equal(room.players.size,3);assert.equal(room.spectators.size,1);assert.equal(await viewer.evaluate(`sessionStorage.getItem('${sessionKey}')`),'original-driver-bytes');
    await viewer.until(`document.getElementById('mp-controls').hidden && document.getElementById('mp-ready').hidden && !document.getElementById('mp-spectator-field').hidden && !!__mp.scene.spectatorId`);
    assert.equal(await viewer.evaluate('__mp.client.ready(true)'),false);assert.equal(await viewer.evaluate('__mp.client.sendInput(1,false)'),false);assert.equal(await wireCount(viewer,'input'),0);
    await horizonLayout(viewer,'horizon-viewer-race','#mp-spectator-field select, .mp-race-actions button');return{midRaceJoin:true,driverSeats:3,spectatorSeats:1,driverSessionUnchanged:true,inputSent:0};
  });
  await check('service_warning_ghost_fixture_true_client_scene_freeze_and_explicit_safe_recovery',async()=>{
    await focus(host);
    const now=Date.now();room.startAt=now-30000;room.simAt=now;const p=room.players.get(ids[0]);
    [...room.players.values()].forEach((q,i)=>{q.car.placeAt(room.track,100+i*100);q.car.v=0;q.blockProtectedUntil=0;});
    p.blockSince=now-8000;p.blockReason='idle';p.block.warningAt=now;p.block.reason='idle';app.service.simulate(room,now);app.service.broadcast(room,'snapshot');
    await host.until(`document.getElementById('mp-horizon-race').textContent.includes('堵路警告')`);
    p.block.warningAt=Date.now()-3001;app.service.simulate(room,Date.now());app.service.broadcast(room,'snapshot');
    await host.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).block.ghost && document.getElementById('mp-controls').hidden && __mp.scene.cars.get(__mp.client.selfId)?.model.root.userData.horizonGhost===true`);
    assert.equal(await host.evaluate('__mp.client.sendInput(1,false)'),false);const distance=p.distance;await horizonLayout(host,'horizon-ghost-recovery','.mp-race-actions button');
    await focus(host);await click(host,'mp-block-recover');await host.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).block.recoveryAt!==null`);
    await host.until(`!__mp.client.room.players.find(p=>p.id===__mp.client.selfId).block.ghost && !document.getElementById('mp-controls').hidden`,20000);
    assert.ok(p.distance>=distance);return{fixture:'service poses and warning clock only',ghostScene:true,ghostInput:false,recoveryClicked:true,safeDelayMs:2000};
  });
  await check('viewer_claim_ui_creates_new_fourth_driver_identity_only_after_lobby',async()=>{
    finishFixture(room,'race');await all(`__mp.client.room.phase==='results'`);assert.equal(await viewer.evaluate(`localStorage.getItem('${historyKey}')`),null);
    await focus(host);await click(host,'mp-rematch');await all(`__mp.client.room.phase==='lobby'`);await loaded();
    await focus(viewer);await click(viewer,'mp-claim-seat');await viewer.until(`!__mp.client.isSpectator && __mp.client.room.players.length===4`);await loaded();
    const newId=await viewer.evaluate('__mp.client.selfId');assert.notEqual(newId,viewerId);assert.equal(room.spectators.size,0);assert.equal(room.players.size,4);
    assert.equal(await viewer.evaluate(`JSON.parse(sessionStorage.getItem('${sessionKey}')).playerId===__mp.client.selfId`),true);ids.push(newId);
    return{beforeIdentity:'spectator',newDriverIdentity:true,drivers:4,driverCredentialCreatedAfterClaim:true};
  });
  await check('reverse_grid_real_series_ui_and_checkpoint_preserves_mode_without_token_rendering',async()=>{
    await settings(host,{antiBlock:false,reverseGrid:true,elimination:false});await value(host,'mp-series-count','3');
    for(const [n,id]of ['japan','china','australia'].entries())await value(host,`mp-series-track-${n}`,id);
    await focus(host);await click(host,'mp-series-create');await all(`__mp.client.room.series?.trackIds.length===3`);await loaded();await begin(host);
    assert.deepEqual([...room.players.values()].sort((a,b)=>a.gridIndex-b.gridIndex).map(p=>p.id),ids);finishFixture(room,'race');await all(`__mp.client.room.phase==='results' && __mp.client.room.series.rounds.length===1`);
    await focus(host);await click(host,'mp-series-checkpoint-save');await host.until(`!!localStorage.getItem('${cpKey}')`);
    assert.equal(await host.evaluate(`document.body.textContent.includes(JSON.parse(localStorage.getItem('${cpKey}')).token)`),false);
    await click(host,'mp-rematch');await all(`__mp.client.room.phase==='lobby' && __mp.client.room.series.roundIndex===1`);await loaded();
    const order=[...room.players.values()].sort((a,b)=>a.gridIndex-b.gridIndex);assert.deepEqual(order.map(p=>p.id),[...ids].reverse());assert.ok(order.slice(1).every(p=>p.distance<0));
    await host.until(`document.getElementById('mp-grid-order').textContent.includes('發車格序：')`);return{seriesConfiguredByUi:true,checkpointSavedByUi:true,tokenRendered:false,nextRound:2,reversedDrivers:4,negativeRearDistances:true,resultsFixture:true};
  });
  await check('four_driver_elimination_real_ui_immediate_follow_and_distinct_results_history',async()=>{
    await focus(host);await click(host,'mp-series-end');await all('__mp.client.room.series===null');await settings(host,{antiBlock:false,reverseGrid:false,elimination:true});await begin(host);
    const ordered=[...room.players.values()].sort((a,b)=>a.slot-b.slot);ordered.forEach((p,i)=>p.distance=(4-i)*100);
    room.elimination.nextAt=Date.now()-1;app.service.maybeFinish(room,Date.now());app.service.broadcast(room,'snapshot');
    await viewer.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).eliminated && document.getElementById('mp-controls').hidden && !document.getElementById('mp-spectator-field').hidden && !!__mp.scene.spectatorId`);
    assert.equal(await viewer.evaluate('__mp.client.sendInput(1,false)'),false);await horizonLayout(viewer,'horizon-eliminated-follow','#mp-spectator-field select, .mp-race-actions button');
    for(let n=0;n<2;n++){room.elimination.nextAt=Date.now()-1;app.service.maybeFinish(room,Date.now());app.service.broadcast(room,'snapshot');await all(`__mp.client.room.players.filter(p=>p.eliminated).length===${n+2}`);}
    await all(`__mp.client.room.phase==='results'`);assert.ok([...room.players.values()].every(p=>!p.dnf&&p.finishMs===null));
    await host.until(`JSON.parse(localStorage.getItem('${historyKey}')).entries.some(e=>e.mode==='elimination')`);assert.match(await host.evaluate(`document.getElementById('mp-results-list').textContent`),/勝出/);
    assert.match(await host.evaluate(`document.getElementById('mp-history-list').textContent`),/淘汰賽勝出/);return{drivers:4,eliminations:3,clockFixture:true,eliminatedCanFollow:true,fakeFinishTimes:0,dnf:0,historyMode:'elimination'};
  });
  await check('saved_preset_atomic_creation_sends_once_and_builds_fresh_room',async()=>{
    for(const page of pages){await page.evaluate('__mp.client.leave()');await page.until('__mp.client.room===null');}viewer.joinedRoom=false;
    await host.until(`!document.getElementById('mp-horizon-entry').hidden`);await host.evaluate(`document.querySelector('#mp-horizon-entry details').open=true`);await value(host,'mp-presets','週末公平短賽');
    await horizonLayout(host,'horizon-preset-entry','#mp-horizon-entry button, #mp-horizon-entry select');const beforeCount=await wireCount(host,'create-configured');await focus(host);await click(host,'mp-preset-create');
    const code=await host.until('__mp.client.room?.code');assert.notEqual(code,firstCode);assert.equal(await wireCount(host,'create-configured'),beforeCount+1);
    const next=app.service.rooms.get(code);assert.deepEqual(next.horizon,{antiBlock:true,reverseGrid:false,elimination:false});assert.equal(next.trackId,'japan');assert.equal(next.players.size,1);assert.notEqual(await host.evaluate('__mp.client.selfId'),ids[0]);
    return{atomicSubmissions:1,freshRoom:true,freshPlayer:true,pureSettingsRestored:true};
  });
  for(const page of pages)assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('taipei-gp-v2')).taxi.money`),12345);
  assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.exceptions,[]);report.status='PASS';
} catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;report.failureStates=await Promise.all(pages.map(page=>page.evaluate(`(()=>{const m=window.__mp,p=m?.client.room?.players.find(p=>p.id===m.client.selfId);return{phase:m?.client.room?.phase,hidden:document.hidden,focus:document.hasFocus(),block:p?.block,controlsHidden:document.getElementById('mp-controls')?.hidden,sceneGhost:m?.scene.cars.get(m.client.selfId)?.model.root.userData.horizonGhost}})()`).catch(()=>null)));}
finally{
  for(const page of pages){await page.evaluate('window.__mp?.client?.leave()').catch(()=>{});page.close();}
  for(const browserContextId of contexts)try{await browser?.send('Target.disposeBrowserContext',{browserContextId});}catch(e){(report.cleanupErrors??=[]).push(String(e));}
  browser?.close();await app?.close();if(web)await new Promise(resolve=>web.httpServer.close(resolve));
  report.sourceUnchangedDuringTests=true;for(const[file,digest]of Object.entries(report.sourceHashes))if(hash(await readFile(path.join(project,file)))!==digest)report.sourceUnchangedDuringTests=false;
  report.scriptUnchangedDuringTests=report.scriptSha256===hash(await readFile(new URL(import.meta.url)));report.cleanupComplete=!report.cleanupErrors?.length&&!app?.httpServer.listening&&!web?.httpServer.listening;
  if(!report.sourceUnchangedDuringTests||!report.scriptUnchangedDuringTests||!report.cleanupComplete){report.status='FAIL';process.exitCode=1;}
  report.limitations=['Four isolated real desktop Chrome contexts and loopback WS; no external network or physical phone.','Ghost warning clock, car poses, finishes and elimination schedule are explicit service fixtures. The server suite separately proves a complete rear-grid lap with unmodified Car and real WS inputs.','Checkbox reachability uses the associated label target. Small viewports establish layout and reachability, not phone FPS, thermals or comfort.','Checkpoint validation confirms a real signed save and no rendered token; restart/claim integrity is covered separately by server tests.'];
  report.summary={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length};
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify(report,null,2)+'\n');await writeFile(new URL('horizon-multiplayer-browser-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,build:report.build,...report.summary,evidence}));
}
