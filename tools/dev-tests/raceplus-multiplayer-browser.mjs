// 真本機雙context與WebSocket；圈表畫面由私有server安排一致的權威成績。
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { preview } from 'vite';
import { CdpConnection,instrument,click,focus,layout } from './multiplayer-ui-cdp.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),own=path.resolve(here,'../..');
const project=path.resolve(process.env.RACEPLUS_BROWSER_PROJECT??own),before=process.env.RACEPLUS_EXPECT_BEFORE==='1';
const {createMultiplayerServer}=await import(pathToFileURL(path.join(project,'server/index.mjs')).href);
const origin='http://127.0.0.1:4325',endpoint='ws://127.0.0.1:4326/ws',cdp=`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT??9334}`;
const evidence=path.join(here,`raceplus-browser-evidence-${Date.now()}`);await mkdir(evidence);
const report={startedAt:new Date().toISOString(),before,project,localOnly:true,status:'FAIL',cases:[],exceptions:[],externalRequests:[],layouts:[],screenshots:[]};
report.build=(await readFile(path.join(project,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let app,web,browser,timer,paused=false;const pages=[],contexts=[];
async function check(name,action){try{report.cases.push({name,status:'PASS',details:await action()})}catch(e){report.cases.push({name,status:'FAIL',error:e.stack??String(e)});throw e}finally{console.log(JSON.stringify(report.cases.at(-1)))}}
try{
 app=createMultiplayerServer({allowedOrigins:[origin],autoTick:false});await new Promise((yes,no)=>{app.httpServer.once('error',no);app.httpServer.listen(4326,'127.0.0.1',yes)});
 timer=setInterval(()=>{if(!paused)app.service.tick()},1000/60);
 web=await preview({root:project,preview:{host:'127.0.0.1',port:4325,strictPort:true},logLevel:'error'});
 const v=await(await fetch(cdp+'/json/version')).json();browser=new CdpConnection(v.webSocketDebuggerUrl,'browser',report);
 for(const label of['host','guest']){
  const context=(await browser.send('Target.createBrowserContext')).browserContextId;contexts.push(context);
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});
  const target=(await(await fetch(cdp+'/json')).json()).find(t=>t.id===targetId);assert.ok(target);
  const page=new CdpConnection(target.webSocketDebuggerUrl,label,report);pages.push(page);
  page.on('Runtime.exceptionThrown',e=>report.exceptions.push({label,...e}));
  page.on('Fetch.requestPaused',async({requestId,request})=>{const u=new URL(request.url),allowed=u.origin===origin||['about:','data:','blob:'].includes(u.protocol);if(!allowed)report.externalRequests.push(request.url);await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...allowed?{}:{errorReason:'BlockedByClient'}})});
  await page.send('Page.enable');await page.send('Runtime.enable');await page.send('Network.enable');await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  let source=instrument(origin,endpoint).replace('constructor(url,protocols){',`constructor(url,protocols){if(String(url)==='ws://127.0.0.1:4320/ws')url=${JSON.stringify(endpoint)};`);
  source+=`;window.__raceplusNav=crypto.randomUUID();window.__raceplusCopied=[];window.__raceplusShared=[];window.__raceplusCopyFail=false;window.__raceplusShareCancel=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(__raceplusCopyFail)throw new Error('test denied');__raceplusCopied.push(text)}}});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{if(__raceplusShareCancel){const e=new Error('test cancelled');e.name='AbortError';throw e}__raceplusShared.push(data)}});`;
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source});await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await page.send('Page.navigate',{url:origin+'/multiplayer.html?room=ABC234&__vercel_toolbar_code=test-only#discard'});
  await page.until(`window.__mp?.ready&&!document.getElementById('mp-create').disabled`,150000);
 }
 const[host,guest]=pages;
 await check('invite_prefills_without_connecting_or_joining',async()=>{
  const value=await guest.evaluate(`({code:document.getElementById('mp-code').value,sockets:__mpSocketCount,room:__mp.client.room,hint:document.getElementById('mp-invite-hint')?.textContent??null})`);
  assert.equal(value.sockets,0);assert.equal(value.room,null);assert.equal(value.code,before?'':'ABC234');
  if(!before)assert.ok(value.hint.includes('確認車手暱稱'));return value;
 });
 await focus(host);await click(host,'mp-create');const code=await host.until(`__mp.client.room?.code`);
 const invite=origin+'/multiplayer.html?room='+code;
 if(!before){
  await check('invite_copy_share_and_manual_fallback_use_clean_url',async()=>{
   await click(host,'mp-copy-link');await host.until(`__raceplusCopied.length===1`);assert.equal(await host.evaluate('__raceplusCopied[0]'),invite);
   assert.equal(await host.evaluate(`document.getElementById('mp-invite-url').value`),invite);
   await click(host,'mp-copy');await host.until(`__raceplusCopied.length===2`);assert.equal(await host.evaluate('__raceplusCopied[1]'),code);
   await host.evaluate('__raceplusCopyFail=true');await click(host,'mp-copy-link');await host.until(`document.getElementById('mp-message').textContent.includes('無法自動複製')`);
   await host.evaluate(`document.getElementById('mp-invite-url').click()`);assert.equal(await host.evaluate(`document.getElementById('mp-invite-url').selectionEnd-document.getElementById('mp-invite-url').selectionStart`),invite.length);
   await click(host,'mp-share-link');await host.until(`__raceplusShared.length===1`);assert.equal(await host.evaluate('__raceplusShared[0].url'),invite);
   await host.evaluate('__raceplusShareCancel=true');await click(host,'mp-share-link');await host.until(`document.getElementById('mp-message').textContent.includes('已取消分享')`);
   assert.equal(await host.evaluate('__raceplusCopied.length'),2);return{invite,legacyCode:code,copyFailureFallback:true,shareCancelledWithoutCopy:true};
  });
  await check('lobby_invite_controls_reachable_in_three_viewports',async()=>{await layout(host,'raceplus-lobby','#mp-room',report,evidence);return{viewports:3}});
  const token=await guest.evaluate('__raceplusNav');await guest.send('Page.navigate',{url:invite});await guest.until(`window.__raceplusNav&&__raceplusNav!==${JSON.stringify(token)}`);await guest.until(`window.__mp?.ready&&!document.getElementById('mp-create').disabled`,150000);
  assert.equal(await guest.evaluate(`document.getElementById('mp-code').value`),code);assert.equal(await guest.evaluate('__mpSocketCount'),0);
 }else await guest.evaluate(`document.getElementById('mp-code').value=${JSON.stringify(code)}`);
 await focus(guest);await click(guest,'mp-join');for(const p of pages)await p.until(`__mp.client.room?.players.length===2&&__mp.ready&&__mp.client.room.players.every(p=>p.loaded)`,150000);
 await focus(host);await click(host,'mp-ready');await focus(guest);await click(guest,'mp-ready');await host.until(`!document.getElementById('mp-start').disabled`);await focus(host);await click(host,'mp-start');for(const p of pages)await p.until(`__mp.client.room.phase==='racing'`,20000);
 const room=app.service.rooms.get(code);assert.ok(room);paused=true;
 await check('real_ws_carries_lap_metadata_and_hud_best_lap',async()=>{
  const player=room.players.get(await host.evaluate('__mp.client.selfId'));assert.ok(player);
  player.completedLaps=1;player.distance=room.track.length;player.lapTimesMs=[45000];player.bestLapMs=45000;player.lastLapElapsedMs=45000;
  app.service.broadcast(room,'snapshot',Date.now());await host.until(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).completedLaps===1`);
  if(before){assert.equal(await host.evaluate(`__mp.client.room.players.find(p=>p.id===__mp.client.selfId).lapTimesMs`),undefined);return{metadataAbsent:true};}
  await host.until(`document.getElementById('mp-last-lap').textContent.includes('0:45.000')`);return{best:await host.evaluate(`document.getElementById('mp-last-lap').textContent`)};
 });
 const hostId=await host.evaluate('__mp.client.selfId'),guestId=await guest.evaluate('__mp.client.selfId');
 for(const[id,times]of[[hostId,[45000,46000,44000]],[guestId,[47000,45000,45500]]]){const p=room.players.get(id);p.lapTimesMs=times;p.bestLapMs=Math.min(...times);p.lastLapElapsedMs=times.reduce((a,b)=>a+b,0);p.finishMs=p.lastLapElapsedMs;p.completedLaps=3;p.distance=3*room.track.length;p.car.v=0;}
 room.firstFinishAt=Date.now();app.service.maybeFinish(room,Date.now());await host.until(`__mp.client.room.phase==='results'`);
 await check('results_show_total_best_gap_and_selectable_lap_rows',async()=>{
  const results=await host.evaluate(`document.getElementById('mp-results-list').textContent`);assert.ok(results.includes('2:15.000')&&results.includes('2:17.500'));
  if(before){assert.ok(!results.includes('最快'));assert.equal(await host.evaluate(`document.getElementById('mp-laps-list')===null`),true);return{results};}
  assert.ok(results.includes('最快 0:44.000')&&results.includes('落後冠軍 +2.500 秒'));
  assert.equal(await host.evaluate(`document.querySelectorAll('#mp-laps-list li').length`),3);
  const own=await host.evaluate(`document.getElementById('mp-laps-list').textContent`);assert.ok(own.includes('0:44.000'));
  await host.evaluate(`document.getElementById('mp-lap-driver').value=${JSON.stringify(guestId)};document.getElementById('mp-lap-driver').dispatchEvent(new Event('change',{bubbles:true}))`);
  const other=await host.evaluate(`document.getElementById('mp-laps-list').textContent`);assert.ok(other.includes('0:47.000')&&other.includes('0:45.500'));return{results,own,other};
 });
 if(!before){
  await check('results_controls_and_laps_reachable_in_three_viewports',async()=>{await layout(host,'raceplus-results','#mp-results',report,evidence);return{viewports:3}});
  await check('rematch_clears_laps_and_reuses_correct_room_invite',async()=>{await host.evaluate(`document.getElementById('mp-rematch').click()`);await host.until(`__mp.client.room.phase==='lobby'&&__mp.client.room.players.every(p=>p.lapTimesMs.length===0&&p.bestLapMs===null)`);assert.equal(await host.evaluate(`document.getElementById('mp-laps-list').children.length`),0);assert.equal(await host.evaluate(`document.getElementById('mp-invite-url').value`),invite);return{cleared:true}});
 }
 assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(e){report.error=e.stack??String(e);console.error(report.error);process.exitCode=1}
finally{
 if(timer)clearInterval(timer);for(const p of pages){await p.evaluate('__mp.client?.leave()').catch(()=>{});p.close()}
 for(const browserContextId of contexts)await browser?.send('Target.disposeBrowserContext',{browserContextId}).catch(e=>{report.cleanupError=String(e);report.status='FAIL';process.exitCode=1});
 browser?.close();await app?.close();if(web)await new Promise(yes=>web.httpServer.close(yes));
 report.completedAt=new Date().toISOString();report.limitations=['本機兩個隔離Chrome contexts與真WebSocket，非外網或手機實機。','圈速資料由私有測試server安排一致狀態，未在browser完整駕駛三圈；真Car/過線計時另由raceplus-laps-regression驗證。','剪貼簿與系統分享使用替身，未呼叫系統分享或發送訊息。'];
 await writeFile(path.join(evidence,'summary.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(here,before?'raceplus-browser-before.json':'raceplus-browser-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,before,cases:report.cases.length,build:report.build,evidence}));
}
