import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { environment,room,Storage } from './lobbybrake-client.mjs';
import { defaultEvolution } from '../../shared/multiplayer-evolution.ts';
import { defaultHorizon,parseRoomPreset,validateHorizonSnapshot,horizonCollisionEligible } from '../../shared/multiplayer-horizon.ts';
import { MultiplayerPresets,MULTIPLAYER_PRESETS_KEY } from '../../src/multiplayer-presets.ts';
import { MultiplayerHistory,parseHistory } from '../../src/multiplayer-history.ts';
import { spectatorTargets } from '../../src/multiplayer-spectator.ts';
import { sceneFixture } from './twelve-multiplayer-fixtures.mjs';
const report={localOnly:true,externalRequests:0,realClientAndPanelSource:true,cases:[],sourceHashes:{},limitations:['隔離DOM/socket/clock與真client/panel/scene，不代表真瀏覽器或外網。']};
const plain=v=>JSON.parse(JSON.stringify(v));
const cap={lobbyOptions:true,championship:true,roomRules:true,evolution:true,horizon:true};
const hroom=(extra={})=>room({capabilities:{...cap},roomRules:{collisions:true,finishGraceSeconds:60},evolution:defaultEvolution(),horizon:defaultHorizon(),spectators:[],...extra});
const preset=(extra={})=>({schema:1,name:'好友短賽',trackId:'taipei',laps:3,mode:'race',durationSeconds:180,roomRules:{collisions:true,finishGraceSeconds:60},trackIds:[],horizon:defaultHorizon(),...extra});
const emptyBlock=()=>({ghost:false,reason:null,warningAt:null,recoveryAt:null});
async function test(name,fn){try{await fn();report.cases.push({name,status:'PASS'});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack});}console.log(JSON.stringify(report.cases.at(-1)));}
await test('舊服務隱藏能力且client不送新房規；新設定命令綁房碼世代',async()=>{
 const old=await environment().create();const count=old.socket.sent.length;assert.equal(old.client.setHorizon(defaultHorizon()),false);assert.equal(old.socket.sent.length,count);
 await assert.rejects(old.client.watch('ABC234','觀眾'),/先連線/);
 const e=await environment().create(hroom());assert.equal(e.client.horizonAvailable,true);assert.equal(e.client.setHorizon({antiBlock:true,reverseGrid:false,elimination:false}),true);
 assert.deepEqual(plain(e.socket.sent.at(-1)),{type:'set-horizon',horizon:{antiBlock:true,reverseGrid:false,elimination:false},roomCode:'ABC234',expectedLobbyRevision:1});
});
await test('Horizon資料嚴格驗證：能力配對、觀眾上限/重複/混身分',()=>{
 const c=environment().client();assert.doesNotThrow(()=>c.validateRoom(hroom()));
 for(const change of [r=>delete r.horizon,r=>r.horizon.antiBlock='yes',r=>r.spectators=Array(9).fill({id:'s',name:'看台',loaded:true}),r=>r.spectators=[{id:'p1',name:'看台',loaded:true}],r=>delete r.capabilities.horizon]){
  const r=hroom();change(r);assert.throws(()=>c.validateRoom(r));
 }
});
await test('真client原子範本只提交一次，取消傳輸後晚到welcome不建本機身分',async()=>{
 const e=environment(),c=e.client(),connection=c.connect();const s=e.latest();s.open();await connection;
 const ping=s.sent.find(m=>m.type==='ping');s.receive({type:'pong',sentAt:ping.sentAt,serverTime:1700000000000,capabilities:{horizon:true}});
 const pending=c.createConfigured('甲',preset());await e.flush();assert.equal(s.sent.filter(m=>m.type==='create-configured').length,1);
 const request=s.sent.find(m=>m.type==='create-configured');const rejection=assert.rejects(pending);c.disconnect();await rejection;
 s.receive({type:'welcome',requestId:request.requestId,playerId:'p1',resumeToken:'unused-token-123456',room:hroom()});assert.equal(c.room,null);assert.equal(e.storage.writes.length,0);
});
await test('純觀眾welcome無driver憑證、不覆寫原session、ready/input被擋',async()=>{
 const storage=new Storage();storage.setItem('taipei-gp-multiplayer-session-v2','original-driver-bytes');storage.writes=[];
 const e=environment({storage}),c=e.client(),transport=c.connect(),s=e.latest();s.open();await transport;
 const ping=s.sent.find(m=>m.type==='ping');s.receive({type:'pong',sentAt:ping.sentAt,serverTime:1700000000000,capabilities:{horizon:true}});
 const pending=c.watch('ABC234','看台');await e.flush();const req=s.sent.find(m=>m.type==='watch');
 s.receive({type:'watching',requestId:req.requestId,spectatorId:'viewer1',room:hroom({spectators:[{id:'viewer1',name:'看台',loaded:false}]})});await pending;
 assert.equal(c.isSpectator,true);assert.equal(c.selfId,'viewer1');assert.equal(c.ready(true),false);assert.equal(c.sendInput(0,false),false);assert.equal(storage.writes.length,0);
 c.leave();assert.equal(storage.getItem('taipei-gp-multiplayer-session-v2'),'original-driver-bytes');assert.equal(c.isSpectator,false);
});
await test('觀眾明確claim後才取得driver身分及保存新憑證',async()=>{
 const e=environment(),c=e.client();c._horizonAvailable=true;const pending=c.watch('ABC234','看台'),s=e.latest();s.autoPong=true;s.open();await e.flush();const req=s.sent.find(m=>m.type==='watch');
 s.receive({type:'watching',requestId:req.requestId,spectatorId:'v1',room:hroom({spectators:[{id:'v1',name:'看台',loaded:true}]})});await pending;
 const claim=c.claimSpectatorSeat();await e.flush();const r=s.sent.find(m=>m.type==='claim-seat');assert.equal(c.isSpectator,true);
 s.receive({type:'welcome',requestId:r.requestId,playerId:'p1',resumeToken:'new-seat-token-1234567890',room:hroom()});await claim;assert.equal(c.isSpectator,false);assert.equal(c.selfId,'p1');assert.equal(e.storage.writes.length,1);
});
await test('觀眾收到損壞快照停止連線但保留原driver session',async()=>{
 const storage=new Storage();storage.setItem('taipei-gp-multiplayer-session-v2','original-driver-bytes');
 const e=environment({storage}),c=e.client();c._horizonAvailable=true;const pending=c.watch('ABC234','看台'),s=e.latest();s.autoPong=true;s.open();await e.flush();const req=s.sent.find(m=>m.type==='watch');
 s.receive({type:'watching',requestId:req.requestId,spectatorId:'v1',room:hroom({spectators:[{id:'v1',name:'看台',loaded:true}]})});await pending;
 s.receive({type:'snapshot',room:{broken:true}});assert.equal(c.room,null);assert.equal(c.status,'disconnected');assert.equal(storage.getItem('taipei-gp-multiplayer-session-v2'),'original-driver-bytes');
});
await test('範本十份上限、純設定拒身份欄、重讀與明確刪除',()=>{
 const storage=new Storage(),p=new MultiplayerPresets(storage);for(let i=0;i<10;i++)assert.equal(p.save(preset({name:`短賽${i}`})),true);
 assert.equal(p.save(preset({name:'第十一份'})),false);assert.equal(p.entries.length,10);assert.equal(p.save(preset({playerId:'secret'})),false);assert.equal(p.save(preset({roomCode:'ABC234'})),false);
 assert.equal(new MultiplayerPresets(storage).entries.length,10);assert.equal(p.remove('短賽3'),true);assert.equal(p.entries.length,9);assert.equal(p.save(preset({name:'新短賽'})),true);
 const raw=storage.getItem(MULTIPLAYER_PRESETS_KEY);for(const word of ['token','endpoint','playerId','roomCode','session'])assert.equal(raw.includes(word),false);
});
await test('損壞/過大/儲存拒絕範本保留舊bytes、清除限專用鍵',()=>{
 const storage=new Storage();storage.setItem(MULTIPLAYER_PRESETS_KEY,'{broken');storage.setItem('single-player','keep');const p=new MultiplayerPresets(storage);
 assert.equal(p.save(preset()),false);assert.equal(storage.getItem(MULTIPLAYER_PRESETS_KEY),'{broken');assert.equal(p.clear(),true);assert.equal(storage.getItem('single-player'),'keep');
 const denied=new MultiplayerPresets({getItem:()=>null,setItem(){throw Error();},removeItem(){throw Error();}});assert.equal(denied.save(preset()),false);assert.equal(denied.entries.length,0);
});
await test('防堵路權威ghost讓client拒input/可請求恢復，scene不預測碰撞',async()=>{
 const r=hroom({phase:'racing',matchId:'m1',startAt:1700000000000,horizon:{antiBlock:true,reverseGrid:false,elimination:false}});
 for(const p of r.players)p.block=emptyBlock();Object.assign(r.players[0].block,{ghost:true,reason:'idle',warningAt:r.serverTime});
 const e=await environment().create(r);assert.equal(e.client.sendInput(0,false),false);assert.equal(e.client.recoverBlock(),true);assert.equal(e.socket.sent.at(-1).type,'recover-block');
 const f=sceneFixture(r);f.scene.accept(r,'p1',r.serverTime);const before=f.scene.car.snapshot();f.frame(r.serverTime+100);assert.deepEqual(plain(f.scene.car.snapshot()),plain(before));assert.equal(horizonCollisionEligible(r.players[0]),false);
});
await test('遠車ghost不進入預測與最終畫面碰撞集合',()=>{
 const r=hroom({phase:'racing',matchId:'m1',startAt:1700000000000,horizon:{antiBlock:true,reverseGrid:false,elimination:false}});for(const p of r.players)p.block=emptyBlock();Object.assign(r.players[1].block,{ghost:true,reason:'reverse',warningAt:r.serverTime});
 const f=sceneFixture(r);f.scene.accept(r,'p1',r.serverTime);assert.equal(f.scene.predictedPeers.has('p2'),false);f.frame(r.serverTime+100);assert.equal(f.scene.cars.get('p2').model.root.userData.horizonGhost,true);
});
await test('純觀眾與已淘汰車手能追看；尚在比賽車手不能偷切觀戰',()=>{
 const r=hroom({phase:'racing',spectators:[{id:'v1',name:'看台',loaded:true}]});assert.equal(spectatorTargets(r,'v1').length,2);assert.equal(spectatorTargets(r,'p1').length,0);
 r.players[0].eliminated=true;assert.deepEqual(spectatorTargets(r,'p1').map(p=>p.id),['p2']);r.players[1].eliminated=true;assert.equal(spectatorTargets(r,'v1').length,0);
});
await test('淘汰超過預設圈數仍合法，勝者與淘汰分類不接受偽完賽時間',()=>{
 const r=hroom({phase:'results',matchId:'elim',startAt:1700000000000,horizon:{antiBlock:false,reverseGrid:false,elimination:true},elimination:{nextAt:1700000045000,intervalMs:45000,winnerId:'p1'}});
 r.players.forEach((p,i)=>Object.assign(p,{completedLaps:6,lapTimesMs:Array(6).fill(1000),bestLapMs:1000,eliminated:i!==0,eliminationWinner:i===0,eliminationRank:i+1,eliminationReason:i?'last-place':null,eliminationAt:i?r.serverTime:null}));
 const c=environment().client();assert.doesNotThrow(()=>c.validateRoom(r));r.players[0].finishMs=6000;assert.throws(()=>c.validateRoom(r));
});
await test('淘汰本機戰績保存獨立分類，不為純觀眾保存或匯出身分憑證',()=>{
 const r=hroom({phase:'results',matchId:'elim',startAt:1700000000000,horizon:{antiBlock:false,reverseGrid:false,elimination:true},elimination:{nextAt:1700000045000,intervalMs:45000,winnerId:'p1'}});
 r.players.forEach((p,i)=>Object.assign(p,{eliminated:!!i,eliminationWinner:!i,eliminationRank:i+1,eliminationReason:i?'last-place':null,eliminationAt:i?r.serverTime:null}));
 const h=new MultiplayerHistory(new Storage());assert.equal(h.capture(r,'viewer'),false);assert.equal(h.capture(r,'p1'),true);const rows=parseHistory(h.export());assert.equal(rows[0].mode,'elimination');assert.equal(rows[0].players[1].eliminated,true);assert.ok(rows[0].players.every(p=>!p.dnf&&p.finishMs===null));
});
const panelSource=await readFile(new URL('../../src/multiplayer-horizon-ui.ts',import.meta.url),'utf8');
function panelEnvironment(){
 class Element{value='';checked=false;hidden=false;disabled=false;textContent='';children=[];listeners=new Map();append(e){this.children.push(e);if(!this.value)this.value=e.value;}replaceChildren(){this.children=[];this.value='';}addEventListener(type,fn){this.listeners.set(type,fn);}click(){return this.listeners.get('click')?.();}}
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};const storage=new Storage(),calls=[];
 const client={room:hroom(),selfId:'p1',status:'connected',isSpectator:false,horizonAvailable:true,serverNow:()=>1700000000000,setHorizon(h){calls.push(['settings',plain(h)]);},recoverBlock(){calls.push(['recover']);},claimSpectatorSeat(){calls.push(['claim']);},connect(){calls.push(['connect']);}};
 const context=vm.createContext({document:{getElementById:element,createElement:()=>new Element()},localStorage:storage,MultiplayerPresets,defaultHorizon,parseRoomPreset,confirm:()=>true,console});
 const code=stripTypeScriptTypes(panelSource,{mode:'transform'}).replace(/^import[^\n]*\r?\n/gm,'').replace(/\bexport /g,'');vm.runInContext(code+'\nglobalThis.Panel=MultiplayerHorizonPanel;',context);
 const panel=new context.Panel(()=>client,fn=>fn(),()=>calls.push(['watch']),p=>calls.push(['create',plain(p)]));return{panel,client,element,calls,storage};
}
await test('真panel提供房規/範本/觀戰/claim/恢復操作，舊服務隱藏新功能',()=>{
 const e=panelEnvironment();e.panel.render(false);e.element('mp-anti-block').checked=true;e.element('mp-horizon-apply').click();assert.equal(e.calls.at(-1)[1].antiBlock,true);
 e.element('mp-preset-name').value='好友短賽';e.element('mp-preset-save').click();assert.equal(e.panel.presets.entries.length,1);e.element('mp-preset-create').click();assert.equal(e.calls.at(-1)[0],'create');
 e.element('mp-watch').click();assert.equal(e.calls.at(-1)[0],'watch');e.client.isSpectator=true;e.panel.render(false);assert.equal(e.element('mp-ready').hidden,true);assert.equal(e.element('mp-claim-seat').hidden,false);e.element('mp-claim-seat').click();assert.equal(e.calls.at(-1)[0],'claim');
 e.client.room=room();e.client.horizonAvailable=false;e.client.isSpectator=false;e.panel.render(false);assert.equal(e.element('mp-horizon-settings').hidden,true);assert.equal(e.element('mp-horizon-entry').hidden,true);
});
await test('真panel顯示反序格、淘汰倒數與ghost恢復狀態',()=>{
 const e=panelEnvironment();e.client.room=hroom({horizon:{antiBlock:true,reverseGrid:true,elimination:false}});e.client.room.players.forEach((p,i)=>{p.gridIndex=1-i;p.block=emptyBlock();});e.panel.render(false);assert.ok(e.element('mp-grid-order').textContent.indexOf('藍流')<e.element('mp-grid-order').textContent.indexOf('赤焰'));
 Object.assign(e.client.room,{phase:'racing'});Object.assign(e.client.room.players[0].block,{ghost:true,reason:'idle',warningAt:1700000000000});e.panel.render(false);assert.equal(e.element('mp-block-recover').hidden,false);assert.ok(e.element('mp-horizon-race').textContent.includes('凍結'));e.element('mp-block-recover').click();assert.equal(e.calls.at(-1)[0],'recover');
 assert.equal(e.element('mp-controls').hidden,true);e.client.room.players[0].block=emptyBlock();e.panel.render(false);assert.equal(e.element('mp-controls').hidden,false);
 e.client.room.players[0].eliminated=true;e.panel.render(false);assert.equal(e.element('mp-controls').hidden,true);
});
for(const file of ['src/multiplayer-client.ts','src/multiplayer-horizon-ui.ts','src/multiplayer-presets.ts','src/multiplayer-scene.ts','src/multiplayer-spectator.ts','src/multiplayer-history.ts','shared/multiplayer-horizon.ts'])report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex');
report.summary={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length};report.status=report.summary.failed?'FAIL':'PASS';
report.scriptSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
await writeFile(new URL('horizon-multiplayer-ui-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
