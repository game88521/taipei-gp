// Rex <game88521@gmail.com>. Local real four-context GP UI. End-match fixtures are explicit, not a driving claim.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {FrontierBrowserHarness,ORIGIN,click,focus,set,layout} from './frontier-browser-harness.mjs';
import {cupActiveIds,cupStandings,FRONTIER_CUP_VERSION} from '../../shared/frontier-cup.ts';
const files=['multiplayer.html','shared/frontier-cup.ts','server/frontier-cup-service.mjs','server/room-service.mjs','shared/multiplayer-protocol.ts','shared/multiplayer-horizon.ts','shared/summit-racing.ts','src/multiplayer-client.ts','src/frontier-cup-ui.ts','src/frontier-cup.css','src/multiplayer-game.ts','src/multiplayer-horizon-ui.ts','src/multiplayer-scene.ts','src/multiplayer-spectator.ts','src/multiplayer-ui.ts','src/multiplayer-awareness.ts','src/multiplayer-history.ts','src/voyager-result-data.ts','server/nexus-replay-service.mjs','tools/dev-tests/frontier-browser-harness.mjs'];
const h=new FrontierBrowserHarness('frontier-cup-browser',new URL(import.meta.url),files);let error,room;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readRoom='__mp.client.room';
let acceptDialogs=false;const dialogs=[];let previousReadyPacket=null;
try{
 await h.start(4);
 const pages=h.pages,[host]=pages;
 h.report.limitations.push('完整四場真Car.update／圈線／WebSocket輸入由 frontier-cup-node 另行驗證。本browser四小場使用明示server finish/lap結果fixture，驗證實際四個瀏覽器的同步、換場、候場隱車／觀戰、UI與原生下載，不宣稱四場真人駕駛。');
 await h.test('四個獨立瀏覽器由本機multiplayer.html真UI建房／加入、地圖載入與新版能力',async()=>{
  for(const [index,p]of pages.entries()){
   await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(ORIGIN)})return;window.__cupProtectedSave=localStorage.getItem('taipei-gp-v2');window.__cupHistoryBefore=localStorage.getItem('taipei-gp-multiplayer-history-v1');window.__cupNativeBlob=null;const create=URL.createObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);if(value instanceof Blob&&value.type==='application/json')value.text().then(text=>window.__cupNativeBlob={type:value.type,size:value.size,text});return url;};})()`});
   await p.send('Page.navigate',{url:ORIGIN+'/multiplayer.html'});
   await p.until('!!window.__mp?.client&&__mp.ready&&!document.getElementById("mp-create").disabled',180000);
   await p.evaluate('__mp.scene.renderer.setPixelRatio(.3);__mp.scene.renderer.setSize(320,180,false)');
   await focus(p);await set(p,'mp-name','好友盃'+(index+1));
   if(index===0){await set(p,'mp-laps','1');await click(p,'mp-create');await p.until('__mp.client.room?.players.length===1',180000);const code=await p.evaluate('__mp.client.room.code');room=h.app.service.rooms.get(code);assert.ok(room);}
   else{await set(p,'mp-code',room.code);await click(p,'mp-join');await p.until(`__mp.client.room?.players.length===${index+1}`,180000);}
  }
  for(const p of pages)await p.until('__mp.ready&&__mp.client.room?.players.length===4&&__mp.client.room.players.every(p=>p.loaded)',180000);
  assert.ok([...room.players.values()].every(p=>p.supportsCup));
  assert.ok(pages.every((_,i)=>h.contexts[i]));return{contexts:pages.length,players:room.players.size,version:FRONTIER_CUP_VERSION};
 });
 await h.test('真UI鎖定四原席與1v4／2v3，賽道／房規／其他玩法唯讀，取消確認可拒絕',async()=>{
  await focus(host);await host.until('!document.getElementById("mp-cup-create").disabled');await click(host,'mp-cup-create');
  for(const p of pages)await p.until('__mp.client.room?.cup?.status==="ready"');
  assert.deepEqual(room.cup.matches.slice(0,2).map(m=>m.pair.map(id=>room.cup.entrants.find(e=>e.playerId===id).seed)),[[1,4],[2,3]]);
  assert.equal(await host.evaluate('document.getElementById("mp-room-track").disabled&&document.getElementById("mp-room-laps").disabled&&document.getElementById("mp-collisions").disabled'),true);
  assert.equal(await host.evaluate('document.getElementById("mp-series-setup").inert&&document.getElementById("mp-summit-settings").inert&&document.getElementById("mp-horizon-settings").inert'),true);
  assert.equal(await host.evaluate('document.getElementById("mp-start").hidden'),true);
  host.on('Page.javascriptDialogOpening',async info=>{dialogs.push({type:info.type,message:info.message,accepted:acceptDialogs});await host.send('Page.handleJavaScriptDialog',{accept:acceptDialogs});});
  await click(host,'mp-cup-cancel');await host.until('__mp.client.room?.cup?.status==="ready"');assert.ok(dialogs.some(d=>d.type==='confirm'&&!d.accepted));assert.ok(room.cup);
  await layout(host,'cup-lobby','#mp-frontier-cup',h.report,h.evidence);
 });
 const start=async()=>{
  for(const p of [...pages].reverse()){await focus(p);await p.until('!document.getElementById("mp-ready").disabled');await click(p,'mp-ready');}
  await focus(host);await host.until('!document.getElementById("mp-cup-start").disabled');if(!previousReadyPacket){previousReadyPacket=await host.evaluate('__frontierWire.filter(m=>m.type==="ready"&&m.ready).at(-1)');assert.equal(previousReadyPacket.cupReady.cupId,room.cup.id);assert.equal(previousReadyPacket.cupReady.cupRevision,room.cup.revision);assert.equal(previousReadyPacket.cupReady.lobbyRevision,room.lobbyRevision);}await click(host,'mp-cup-start');
  for(const p of pages)await p.until('__mp.client.room?.phase==="racing"',20000);
 };
 const checkWaiting=async()=>{
  const active=[...cupActiveIds(room.cup)],waiting=[];
  for(const p of pages){
   const selfId=await p.evaluate('__mp.client.selfId');await focus(p);
   if(active.includes(selfId))continue;
   await p.until('__mp.scene.cars.get(__mp.client.selfId)?.model.root.visible===false');
   const before=await p.evaluate('({car:__mp.scene.car.snapshot(),inputCount:__frontierWire.filter(m=>m.type==="input").length})');
   const state=await p.evaluate(`(()=>{const r=__mp.client.room,s=r.players.find(p=>p.id===__mp.client.selfId),visible=r.players.filter(p=>__mp.scene.cars.get(p.id)?.model.root.visible).map(p=>p.id);return{self:s,canDrive:__mp.input.isDriving(),sent:__mp.client.sendInput(1,false),controlsHidden:document.getElementById('mp-controls').hidden,targets:[...document.getElementById('mp-spectator').options].map(o=>o.value),visible,position:document.getElementById('mp-position').textContent,lastLap:document.getElementById('mp-last-lap').textContent,note:document.getElementById('mp-race-message').textContent};})()`);
   (h.report.waitingStates??=[]).push({roundIndex:room.cup.index,selfId,cup:state.self.cup,canDrive:state.canDrive,sent:state.sent,controlsHidden:state.controlsHidden,position:state.position,lastLap:state.lastLap,note:state.note,targets:state.targets,visible:state.visible});
   assert.equal(state.self.dnf,false);assert.equal(state.self.completedLaps,0);assert.equal(state.canDrive,false);assert.equal(state.sent,false);assert.equal(state.controlsHidden,true);assert.equal(state.position,'觀戰');assert.match(state.lastLap,/原席觀戰/);assert.match(state.note,/原席觀戰/);assert.deepEqual([...state.targets].sort(),[...active].sort());assert.deepEqual([...state.visible].sort(),[...active].sort());
   await set(p,'mp-spectator',active[1]);await p.until(`__mp.scene.spectatorId===${JSON.stringify(active[1])}`);assert.equal(await p.evaluate('__frontierWire.filter(m=>m.type==="input").length'),before.inputCount);
   const authoritative=room.players.get(selfId);assert.equal(authoritative.distance,0);assert.equal(authoritative.finishMs,null);assert.equal(authoritative.dnf,false);waiting.push({id:selfId,targets:state.targets.length,hidden:true,dnf:false});
  }
  return waiting;
 };
 const finishFixture=async(index)=>{
  const pair=cupActiveIds(room.cup).map(id=>room.players.get(id));
  // Explicit results fixture only. Do not claim these assigned lap/finish values establish driving.
  for(const [i,p]of pair.entries()){const elapsed=60000+index*1000+i*250;p.finishMs=elapsed;p.completedLaps=room.laps;p.lapTimesMs=Array.from({length:room.laps},()=>elapsed/room.laps);p.bestLapMs=elapsed/room.laps;p.lastLapElapsedMs=elapsed;p.distance=room.track.length*room.laps;p.car.v=0;}
  room.firstFinishAt=Date.now();h.app.service.maybeFinish(room,Date.now());
  for(const p of pages)await p.until('__mp.client.room?.phase==="results"');
  assert.ok(['decided','complete'].includes(room.cup.status));
 };
 await h.test('準決賽A真倒數，兩原席無輸入／無自車／可切換追看，活動席只有兩車',async()=>{await start();const waiting=await checkWaiting();assert.equal(waiting.length,2);assert.equal(await host.evaluate('document.getElementById("mp-cup-cancel-race").hidden'),false);await h.shot(pages[1],'cup-waiting-observer.png');await finishFixture(0);return{waiting,endMatchFixture:true};});
 await h.test('準決賽B → 季軍 → 冠軍真UI逐場切換，全員重備、候場無DNF且不進通用歷史',async()=>{
  const rounds=[{key:room.cup.matches[0].key,status:room.cup.matches[0].status}];
  for(let index=1;index<4;index++){
   await focus(host);await click(host,'mp-cup-next');for(const p of pages)await p.until(`__mp.client.room?.phase==='lobby'&&__mp.client.room.cup.index===${index}`);
   assert.ok([...room.players.values()].every(p=>!p.ready&&!p.dnf));if(index===1){const id=await host.evaluate('__mp.client.selfId');await host.evaluate('__frontierSockets.find(s=>s.readyState===WebSocket.OPEN).send('+JSON.stringify(JSON.stringify(previousReadyPacket))+')');await host.until('__mp.client.error?.includes(String.fromCodePoint(0x5c0f,0x5834))');assert.equal(room.players.get(id).ready,false);h.report.previousRoundReadyRejected=true;}await start();const waiting=await checkWaiting();assert.equal(waiting.length,2);await finishFixture(index);rounds.push({key:room.cup.matches[index].key,status:room.cup.matches[index].status,waiting});
   for(const p of pages){assert.equal(await p.evaluate('__mp.client.room.players.filter(p=>!p.cup.active).every(p=>!p.dnf&&p.finishMs===null&&p.completedLaps===0)'),true);assert.equal(await p.evaluate('__mp.client.room.replay'),null);assert.equal(await p.evaluate('document.getElementById("mp-lap-driver").options.length'),2);assert.equal(await p.evaluate('__mp.client.room.players.find(p=>p.id===document.getElementById("mp-lap-driver").value)?.cup?.active'),true);assert.equal(await p.evaluate("localStorage.getItem('taipei-gp-multiplayer-history-v1')===__cupHistoryBefore"),true);}
  }
  assert.equal(room.cup.status,'complete');assert.deepEqual(cupStandings(room.cup).map(e=>e.rank),[1,2,3,4]);
  for(const p of pages){assert.equal(await p.evaluate('document.getElementById("mp-rematch").hidden'),true);assert.equal(await p.evaluate('document.getElementById("mp-frontier-cup-results").textContent.includes("第 4 名")'),true);assert.equal(await p.evaluate('localStorage.getItem("taipei-gp-v2")===__cupProtectedSave'),true);}
  return{rounds,resultsAreExplicitFixtures:true,historySkipped:true};
 });
 await h.test('最終結果三手機尺寸44px與可捲動、原生下載公開JSON且不含房碼／續接token',async()=>{
  await focus(host);await layout(host,'cup-results','#mp-frontier-cup-results',h.report,h.evidence);
  const downloads=path.join(h.evidence,'downloads');await mkdir(downloads);const downloadEvents=[];h.browser.on('Browser.downloadWillBegin',e=>downloadEvents.push({event:'begin',...e}));h.browser.on('Browser.downloadProgress',e=>downloadEvents.push({event:'progress',...e}));
  await h.browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,browserContextId:h.contexts[0],eventsEnabled:true});await click(host,'mp-cup-download');await host.until('!!__cupNativeBlob?.text');
  const captured=await host.evaluate('__cupNativeBlob'),data=JSON.parse(captured.text);assert.equal(data.schema,FRONTIER_CUP_VERSION);assert.equal(data.standings.length,4);assert.equal(data.matches.length,4);assert.ok(!captured.text.includes(room.code));for(const p of room.players.values())assert.ok(!captured.text.includes(p.token));
  const end=Date.now()+15000;let saved;
  while(Date.now()<end){try{saved=await readFile(path.join(downloads,'taipei-friends-cup.json'),'utf8');break;}catch{await delay(100);}}
  assert.equal(saved,captured.text);assert.ok(downloadEvents.some(e=>e.event==='begin'));h.report.nativeDownload={filename:'taipei-friends-cup.json',bytes:captured.size,events:downloadEvents.map(e=>({event:e.event,state:e.state,suggestedFilename:e.suggestedFilename}))};return{nativeFile:true,publicOnly:true,standings:data.standings.map(e=>({seed:e.seed,rank:e.rank}))};
 });
 await h.test('明確結束好友盃解鎖設定、四席離房與模型清理、原單人存檔不變',async()=>{
  await focus(host);acceptDialogs=true;await click(host,'mp-cup-finish');for(const p of pages)await p.until('__mp.client.room?.phase==="lobby"&&__mp.client.room.cup===null');
  assert.equal(await host.evaluate('document.getElementById("mp-series-setup").inert'),false);assert.equal(await host.evaluate('document.getElementById("mp-room-track").disabled'),false);
  for(const p of [...pages].reverse()){await focus(p);await click(p,'mp-leave');await p.until('!__mp.client.room');assert.equal(await p.evaluate('__mp.scene.cars.size'),0);assert.equal(await p.evaluate('localStorage.getItem("taipei-gp-v2")===__cupProtectedSave'),true);}
  assert.equal(room.players.size,0);assert.ok(dialogs.some(d=>d.accepted));return{leftSeats:4,dialogs};
 });
}catch(e){error=e;h.report.failureState=await h.pages[0]?.evaluate('({client:window.__mp?.client?.status,error:window.__mp?.client?.error,room:window.__mp?.client?.room,message:document.getElementById("mp-message")?.textContent,wire:window.__frontierWire?.slice(-8)})').catch(()=>null);}finally{await h.finish(error);}
