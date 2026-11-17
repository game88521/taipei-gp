// Two real isolated Chrome contexts and loopback authority. Overlap/results are
// explicitly service-side fixtures, not human driving or external-network tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { createMultiplayerServer } from '../../server/index.mjs';
import { multiplayerCarsOverlap } from '../../server/physics.mjs';
import { CdpConnection, instrument, click, focus, layout } from './multiplayer-ui-cdp.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.GP_TWELVE_BROWSER_PORT ?? 4343), origin = `http://127.0.0.1:${port}`;
const cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const evidence = path.join(project, 'tools/dev-tests', `twelve-multiplayer-browser-evidence-${Date.now()}`); await mkdir(evidence);
const report = { status: 'FAIL', localOnly: true, externalRequests: [], exceptions: [], cases: [], layouts: [], screenshots: [], sourceHashes: {}, servicePositionAndResultFixtures: true };
const files = ['multiplayer.html','src/multiplayer-game.ts','src/multiplayer-client.ts','src/multiplayer-scene.ts','src/multiplayer-network.ts','src/multiplayer-awareness.ts','src/multiplayer-history.ts','src/multiplayer-history-ui.ts','src/multiplayer-collision-feedback.ts','src/multiplayer.css','shared/multiplayer-room-rules.ts','shared/multiplayer-protocol.ts','server/room-service.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.scriptSha256 = hash(await readFile(new URL(import.meta.url)));
for (const file of files) report.sourceHashes[file] = hash(await readFile(path.join(project,file)));
report.build = (await readFile(path.join(project,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const historyKey = 'taipei-gp-multiplayer-history-v1';
let app, web, browser, endpoint; const pages = [], contexts = [];
async function check(name, fn) { try { report.cases.push({name,status:'PASS',details:await fn()}); } catch(error) { report.cases.push({name,status:'FAIL',error:error.stack}); throw error; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
const value = (page,id,next) => page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(next)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`);
async function openPage(label) {
  const {browserContextId} = await browser.send('Target.createBrowserContext'); contexts.push(browserContextId);
  const {targetId} = await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
  const target = (await(await fetch(cdp+'/json')).json()).find(row=>row.id===targetId);
  const page = new CdpConnection(target.webSocketDebuggerUrl,label,report); pages.push(page); const cancellations = new Set();
  page.on('Runtime.exceptionThrown',exception=>report.exceptions.push({label,exception}));
  page.on('Page.javascriptDialogOpening',()=>page.send('Page.handleJavaScriptDialog',{accept:true}));
  page.on('Network.webSocketCreated',({url})=>{if(url!==endpoint)report.externalRequests.push(url);});
  page.on('Network.loadingFailed',event=>{if(event.canceled||event.errorText==='net::ERR_ABORTED')cancellations.add(event.requestId);});
  page.on('Fetch.requestPaused',async({requestId,networkId,request})=>{
    const url=new URL(request.url),allowed=url.origin===origin||['data:','blob:','about:'].includes(url.protocol);
    if(!allowed)report.externalRequests.push(request.url);
    try {await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...allowed?{}:{errorReason:'BlockedByClient'}});}
    catch(error) {if(!allowed||!networkId||!String(error).includes('Invalid InterceptionId.'))throw error;const end=Date.now()+1500;while(!cancellations.has(networkId)&&Date.now()<end)await delay(20);assert.ok(cancellations.has(networkId));}
  });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable'); await page.send('Network.setBypassServiceWorker',{bypass:true}); await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const source=instrument(origin,endpoint).replace('constructor(url,protocols){',`constructor(url,protocols){url=${JSON.stringify(endpoint)};`).replace("if(m.type==='input')",'if(true)');
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source}); await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await page.send('Page.navigate',{url:origin+'/multiplayer.html'}); await page.until(`window.__mp && document.getElementById('mp-track').options.length===24`,150000);
  await value(page,'mp-quality','economy'); await value(page,'mp-track','japan'); await page.until(`__mp.ready && !document.getElementById('mp-create').disabled`,150000); return page;
}
async function bothReady(players) {for(const page of players)await page.until(`__mp.ready && __mp.client.room?.players.every(p=>p.loaded&&p.connected)`,150000);}
try {
  app=createMultiplayerServer({allowedOrigins:[origin]});await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));endpoint=`ws://127.0.0.1:${app.httpServer.address().port}/ws`;
  web=await preview({root:project,preview:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
  const version=await(await fetch(cdp+'/json/version')).json();browser=new CdpConnection(version.webSocketDebuggerUrl,'twelve-browser',report);
  const host=await openPage('twelve-host'),guest=await openPage('twelve-guest');let room,hostId,guestId;
  await check('real_room_rule_change_clears_ready_and_loaded_then_two_players_reload',async()=>{
    await focus(host);await click(host,'mp-create');const code=await host.until('__mp.client.room?.code');room=app.service.rooms.get(code);hostId=await host.evaluate('__mp.client.selfId');
    await value(guest,'mp-code',code);await focus(guest);await click(guest,'mp-join');await guest.until('__mp.client.room?.code');guestId=await guest.evaluate('__mp.client.selfId');await bothReady([host,guest]);
    await focus(guest);await click(guest,'mp-ready');const revision=room.trackRevision;
    await value(host,'mp-collisions','off');for(const page of[host,guest])await page.until('__mp.client.room.roomRules.collisions===false');await bothReady([host,guest]);
    assert.equal(room.trackRevision,revision+1);assert.ok([...room.players.values()].every(p=>!p.ready));
    await value(host,'mp-finish-grace','30');for(const page of[host,guest])await page.until('__mp.client.room.roomRules.finishGraceSeconds===30');await bothReady([host,guest]);
    assert.equal(await guest.evaluate(`document.getElementById('mp-collisions').disabled && document.getElementById('mp-finish-grace').disabled`),true);
    return{players:2,rules:room.roomRules,trackRevision:room.trackRevision,realClientReacknowledgement:true};
  });
  await check('room_rules_controls_reachable_at_three_sizes',async()=>{await focus(host);await layout(host,'twelve-rules','#mp-room-rules',report,evidence);return{viewports:3};});
  await check('real_two_player_countdown_and_ghost_overlap_in_authority_and_both_scene_frames',async()=>{
    await bothReady([host,guest]);for(const page of[host,guest]){await focus(page);await click(page,'mp-ready');}
    await host.until(`!document.getElementById('mp-start').disabled`);await focus(host);await click(host,'mp-start');for(const page of[host,guest])await page.until(`__mp.client.room?.phase==='racing'`);
    for(const p of room.players.values()){p.car.placeAt(room.track,0);p.car.v=0;p.input={steer:0,brake:true};p.lastInputAt=Date.now();}
    const snapshot=app.service.snapshot(room);assert.equal(multiplayerCarsOverlap(room.track,...snapshot.players.map(p=>p.car)),true);app.service.broadcast(room,'snapshot');
    const models=[];
    // A service teleport is a fixture, not normal reconciliation. Reset its
    // accumulated visual offset/history so old grid positions cannot leak in.
    for(const page of[host,guest])models.push(await page.evaluate(`(() => {const r=${JSON.stringify(snapshot)},s=__mp.scene;for(const v of s.cars.values())v.samples=[];s.correction.set(0,0,0);s.inputHistory=[];s.accumulator=0;s.collisionVisualUntil.clear();s.visualTargets.clear();s.lastSteer=0;s.lastBrake=true;s.car.restore(r.players.find(p=>p.id===__mp.client.selfId).car);s.accept(r,__mp.client.selfId,r.serverTime);s.frame(1/60,r.serverTime+16.7,0,false,true,true,1/60);return r.players.map(p=>{const v=s.cars.get(p.id).model.root;return{...p.car,x:v.position.x,z:v.position.z,h:v.rotation.y}})})()`));
    report.overlapFixture={authority:snapshot.players.map(p=>p.car),models,rules:snapshot.roomRules};
    for(const[index,states]of models.entries())assert.equal(multiplayerCarsOverlap(room.track,...states),true,`client ${index} fixture models: ${JSON.stringify(states)}`);
    return{resultSource:'isolated service position fixture + real accept/frame',dt:1/60,authorityAndBothClientsOverlap:true};
  });
  await check('true_svg_map_authoritative_car_markers_gaps_and_radar',async()=>{
    await host.evaluate(`document.getElementById('mp-awareness').open=true`);
    const state=await host.until(`(() => {const p=document.querySelector('#mp-track-mini polyline');if(!p?.getAttribute('points')||document.querySelectorAll('#mp-track-mini circle').length!==2)return null;return{points:p.getAttribute('points').split(' ').length,viewBox:document.querySelector('#mp-track-mini svg').getAttribute('viewBox'),gaps:document.getElementById('mp-car-gaps').textContent,radar:document.getElementById('mp-nearby').textContent}})()`);
    assert.ok(state.points>20&&state.points<=513);assert.equal(state.viewBox,'0 0 160 110');assert.match(state.gaps,/m/);assert.ok(state.radar.length>0);return state;
  });
  await check('expanded_awareness_keeps_race_controls_reachable_at_three_sizes',async()=>{
    await focus(host);await layout(host,'twelve-awareness-controls','#mp-controls',report,evidence);await layout(host,'twelve-awareness-actions','.mp-race-actions',report,evidence);
    const r=await host.evaluate(`(() => {const e=document.querySelector('#mp-awareness summary'),r=e.getBoundingClientRect();return{width:r.width,height:r.height}})()`);assert.ok(r.height>=44&&r.width>=44);return{viewports:3,summary:r};
  });
  await check('results_save_once_leave_and_reload_preserve_only_history_then_blob_export_and_clear',async()=>{
    for(const[id,p]of room.players){p.finishMs=id===hostId?2000:2100;p.completedLaps=room.laps;p.lapTimesMs=Array(room.laps).fill(p.finishMs/room.laps);p.bestLapMs=p.lapTimesMs[0];p.car.v=0;}
    room.firstFinishAt=Date.now();app.service.maybeFinish(room,Date.now());for(const page of[host,guest])await page.until(`__mp.client.room.phase==='results' && JSON.parse(localStorage.getItem('${historyKey}')).entries.length===1`);
    for(let i=0;i<3;i++)app.service.broadcast(room,'snapshot');await host.evaluate('__mp.client.leave()');await host.until('__mp.client.room===null');
    assert.equal(await host.evaluate(`JSON.parse(localStorage.getItem('${historyKey}')).entries.length`),1);await host.send('Page.reload',{ignoreCache:true});await host.until(`window.__mp && document.querySelectorAll('#mp-history-list>details').length===1`,150000);
    await host.evaluate(`document.getElementById('mp-history').open=true;window.__mpExportText=null;const native=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(t=>window.__mpExportText=t);return native(b)};const anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='taipei-gp-multiplayer-history.json')return;return anchorClick.call(this)}`);
    await focus(host);await click(host,'mp-history-export');const exported=JSON.parse(await host.until('__mpExportText'));
    assert.equal(exported.entries.length,1);const entry=exported.entries[0];assert.deepEqual(Object.keys(entry).sort(),['at','id','kind','players','rounds','rules']);
    for(const p of [...entry.players,...entry.rounds.flatMap(r=>r.players)])assert.deepEqual(Object.keys(p).sort(),['bestLapMs','dnf','dnfReason','finishMs','lapTimesMs','name','points','rank']);
    assert.equal(entry.rules.collisions,false);assert.equal(entry.rules.finishGraceSeconds,30);assert.equal(JSON.stringify(exported).includes(room.code),false);
    await layout(host,'twelve-history','#mp-history',report,evidence);await focus(host);await click(host,'mp-history-clear');assert.equal(await host.evaluate(`localStorage.getItem('${historyKey}')`),null);
    assert.equal(await host.evaluate(`JSON.parse(localStorage.getItem('taipei-gp-v2')).taxi.money`),12345);
    for(const page of pages)assert.deepEqual(await page.evaluate(`__mpStorageWrites.filter(row=>!['${historyKey}','taipei-gp-multiplayer-quality-v1','taipei-gp-multiplayer-fps-v1'].includes(row.args[0])||row.method==='clear')`),[]);
    return{deduplicated:true,persistedAfterReload:true,blobContentVerified:true,downloadClickIntercepted:true,privateFieldsExcluded:true,protectedStorageUnchanged:true,clearKeyOnly:true};
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(error){report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
  for(const page of pages){await page.evaluate('window.__mp?.client?.leave()').catch(()=>{});page.close();}
  for(const browserContextId of contexts)try{await browser?.send('Target.disposeBrowserContext',{browserContextId});}catch(error){(report.cleanupErrors??=[]).push(String(error));}
  browser?.close();await app?.close();if(web)await new Promise(resolve=>web.httpServer.close(resolve));
  report.sourceUnchangedDuringTests=true;for(const[file,digest]of Object.entries(report.sourceHashes))if(hash(await readFile(path.join(project,file)))!==digest)report.sourceUnchangedDuringTests=false;
  report.cleanupComplete=!report.cleanupErrors?.length&&!app?.httpServer.listening&&!web?.httpServer.listening;report.scriptUnchangedDuringTests=report.scriptSha256===hash(await readFile(new URL(import.meta.url)));
  if(!report.cleanupComplete||!report.sourceUnchangedDuringTests||!report.scriptUnchangedDuringTests){report.status='FAIL';process.exitCode=1;}
  report.limitations=['Two isolated desktop Chrome contexts, loopback WS only; no external networks or physical phones.','Real ready/load/countdown is exercised; overlapping positions and finishes are service-side fixtures, not human driving.','History export verifies real Blob bytes and suppresses the download anchor click; it does not verify the operating-system download folder.','Viewport checks establish target size and occlusion only, not actual phone FPS, heat or touch comfort.','Adaptive network behavior is measured separately by virtual arrival schedules; this browser script does not inject external latency.'];
  report.summary={passed:report.cases.filter(r=>r.status==='PASS').length,failed:report.cases.filter(r=>r.status==='FAIL').length};
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify(report,null,2)+'\n');await writeFile(new URL('twelve-multiplayer-browser-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,build:report.build,...report.summary,evidence}));
}
