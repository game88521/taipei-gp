import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { createMultiplayerServer } from '../../server/index.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { defaultHorizon } from '../../shared/multiplayer-horizon.ts';
import { parseRoomPreset } from '../../shared/multiplayer-horizon.ts';
import { SeriesCheckpointSigner } from '../../server/series-checkpoint.mjs';
import { multiplayerCarsOverlap } from '../../server/physics.mjs';
import { WireClient, ORIGIN, settle, drivingInput } from './multiplayer-test-helpers.mjs';
const before = new URL('../../../taipei-gp-horizon-before-b1f70bac2788/', import.meta.url);
const hook = registerHooks({ resolve(specifier, context, next) { return specifier==='ws' && context.parentURL?.startsWith(before.href)
  ? { url: new URL('../../server/node_modules/ws/wrapper.mjs', import.meta.url).href, shortCircuit: true } : next(specifier,context); } });
const old = await import(new URL('server/index.mjs', before)); hook.deregister();
const identity={version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP};
const caps={clientCapabilities:{roomRules:true,evolution:true,horizon:true}};
const key='horizon-loopback-only-fixed-test-secret-thirty-two-bytes';
const report={localOnly:true,realWebSocket:true,externalRequests:0,cases:[],limitations:['Car poses / finish fixtures are explicitly service-side, not claims of human driving or external network behavior.']};
async function test(name,fn){try{const details=await fn();report.cases.push({name,status:'PASS',details});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack});}console.log(JSON.stringify(report.cases.at(-1)));}
async function harness(fn,options={}){
 let now=1000000;const app=(options.factory??createMultiplayerServer)({now:()=>now,autoTick:false,allowedOrigins:[ORIGIN],roomOptions:{seriesResumeSecret:key}});
 await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));const wires=[];
 const open=async()=>{const w=await new WireClient(`ws://127.0.0.1:${app.httpServer.address().port}/ws`).open();wires.push(w);return w;};
 const send=async(w,m,p=r=>r.room||r.type==='error')=>{await settle();const mark=w.mark();w.send(m);return w.until(p,mark);};
 const enter=(w,m,supported=true)=>send(w,{...identity,...(supported?caps:{clientCapabilities:{roomRules:true,evolution:true}}),...m},r=>['welcome','watching','error'].includes(r.type));
 const a=await open(),aw=await enter(a,{type:'create',name:'甲車手',laps:3});
 const b=await open(),bw=await enter(b,{type:'join',code:aw.room.code,name:'乙車手'},!options.legacy);
 const room=app.service.rooms.get(aw.room.code),lobby=()=>({roomCode:room.code,expectedLobbyRevision:room.lobbyRevision});
 const selection=()=>({trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});
 const begin=async(drivers=[a,b])=>{for(const w of drivers){await send(w,{type:'track-loaded',...selection()});await send(w,{type:'ready',ready:true,...selection()});}
  const r=await send(a,{type:'start',trackRevision:room.trackRevision});if(r.room?.phase==='countdown'){now=room.startAt;app.service.tick(now);await settle();}return r;};
 const h={app,a,b,aw,bw,room,open,send,enter,lobby,selection,begin,now:()=>now,setNow(t){now=t;},
  settings:settings=>send(a,{type:'set-horizon',horizon:{...defaultHorizon(),...settings},...lobby()}),
  step(ms=1000){now+=ms;app.service.simulate(room,now);},tick(ms=1000){now+=ms;app.service.tick(now);}};
 try{return await fn(h);}finally{await Promise.all(wires.map(w=>w.close()));await app.close();}
}
for(const reverse of [false,true])await test(`before真WS：連線${reverse?'逆向':'停車'}仍有車身接觸，非斷線事故`,()=>harness(async h=>{
 await h.begin();h.setNow(h.room.startAt+30000);const [a,b]=[...h.room.players.values()],t=h.room.track;
 a.car.placeAt(t,100);b.car.placeAt(t,100);if(reverse)a.car.h+=Math.PI;a.car.v=reverse?8:0;b.car.v=8;
 b.car.x+=.5;const original=[a.car.snapshot(),b.car.snapshot()];h.room.roomRules.collisions=false;h.app.service.simulate(h.room,h.now());
 const without=a.car.snapshot();a.car.restore(original[0]);b.car.restore(original[1]);h.room.roomRules.collisions=true;h.app.service.simulate(h.room,h.now());
 const displacement=Math.hypot(a.car.x-without.x,a.car.z-without.z);
 assert.equal(a.connected&&a.loaded,true);assert.ok(displacement>.05);
 assert.equal((await h.send(h.a,{type:'set-horizon',horizon:{antiBlock:true,reverseGrid:false,elimination:false},...h.lobby()})).code,'BAD_MESSAGE');
 return {connected:true,loaded:true,speed:original[0].v,collisionDisplacement:displacement,beforeSource:'immutable snapshot'};
},{factory:old.createMultiplayerServer}));

if(!process.argv.includes('--before-only')) {
const preset=(extra={})=>({schema:1,name:'週末短賽',trackId:'taipei',laps:3,roomRules:{collisions:true,finishGraceSeconds:60},mode:'race',durationSeconds:180,trackIds:[],horizon:defaultHorizon(),...extra});
const command=(h,extra={})=>({type:'set-horizon',horizon:{antiBlock:true,reverseGrid:false,elimination:false},...h.lobby(),...extra});
await test('能力發現與預設：舊client仍可一般房參賽',()=>harness(async h=>{
 assert.equal(h.aw.room.capabilities.horizon,true);assert.deepEqual(h.aw.room.horizon,defaultHorizon());assert.equal(h.bw.type,'welcome');await h.begin();assert.equal(h.room.phase,'racing');
},{legacy:true}));
await test('新房規：非房主/舊世代/多欄/非boolean拒絕，改動清ready',()=>harness(async h=>{
 assert.equal((await h.send(h.b,command(h))).code,'HOST_ONLY');assert.equal((await h.send(h.a,command(h,{expectedLobbyRevision:0}))).code,'STALE_LOBBY');
 for(const horizon of [{...defaultHorizon(),antiBlock:1},{...defaultHorizon(),x:true}])assert.equal((await h.send(h.a,command(h,{horizon}))).code,'INVALID_HORIZON');
 const p=[...h.room.players.values()][0];p.ready=p.loaded=true;const rev=h.room.trackRevision;await h.settings({antiBlock:true});assert.equal(h.room.trackRevision,rev+1);assert.equal(p.ready||p.loaded,false);
 const after=h.room.trackRevision;await h.settings({antiBlock:true});assert.equal(h.room.trackRevision,after);
}));
await test('全原席能力包含斷線保留席，禁止新舊非預設混房',()=>harness(async h=>{
 assert.equal((await h.settings({antiBlock:true})).code,'HORIZON_UNSUPPORTED');await h.b.close();await settle();assert.equal((await h.settings({reverseGrid:true})).code,'HORIZON_UNSUPPORTED');
},{legacy:true}));
await test('非預設房拒舊client加入與續接',()=>harness(async h=>{
 await h.settings({antiBlock:true});const c=await h.open();assert.equal((await h.enter(c,{type:'join',code:h.room.code,name:'舊車手'},false)).code,'HORIZON_UNSUPPORTED');
 const token=h.bw.resumeToken;await h.b.close();await settle();assert.equal((await h.enter(c,{type:'resume',code:h.room.code,playerId:h.bw.playerId,token},false)).code,'HORIZON_UNSUPPORTED');
}));
await test('防堵路：開場保護、低速8秒加警告3秒、ghost凍車且不計進度',()=>harness(async h=>{
 await h.settings({antiBlock:true});await h.begin();const p=h.room.players.get(h.aw.playerId);
 for(let t=0;t<=14000;t+=1000){h.setNow(h.room.startAt+t);h.app.service.simulate(h.room,h.now());assert.equal(p.block.warningAt,null);}
 for(let t=15000;t<=26000;t+=1000){h.setNow(h.room.startAt+t);h.app.service.simulate(h.room,h.now());if(t===23000)assert.equal(p.block.reason,'idle');}
 assert.equal(p.block.ghost,true);const snap=p.car.snapshot(),distance=p.distance;
 h.a.send({type:'input',matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:100,steer:1,brake:false});await settle();
 h.step(1000);assert.deepEqual(p.car.snapshot(),snap);assert.equal(p.distance,distance);assert.notEqual(p.receivedSeq,100);
}));
await test('防堵路：正常行駛取消逆向警告，不將一次轉向事故直接ghost',()=>harness(async h=>{
 await h.settings({antiBlock:true});await h.begin();const p=h.room.players.get(h.aw.playerId),t=h.room.track;
 for(let s=0;s<=4;s++){p.car.placeAt(t,100);p.car.h+=Math.PI;p.car.v=12;h.setNow(h.room.startAt+20000+s*1000);h.app.service.simulate(h.room,h.now());}
 assert.equal(p.block.reason,'reverse');assert.equal(p.block.ghost,false);p.car.placeAt(t,100);p.car.v=12;h.step(1000);assert.equal(p.block.warningAt,null);assert.equal(p.block.ghost,false);
}));
await test('防堵路：碰撞後八秒保護、TT與未放行車不誤判',()=>harness(async h=>{
 await h.settings({antiBlock:true});await h.begin();const [a,b]=[...h.room.players.values()],t=h.room.track;
 h.setNow(h.room.startAt+24000);a.car.placeAt(t,100);b.car.placeAt(t,100);b.car.x+=.5;h.app.service.simulate(h.room,h.now());assert.ok(a.blockProtectedUntil>=h.now()+8000);
 b.car.placeAt(t,300);h.step(7000);assert.equal(a.block.warningAt,null);
 h.room.evolution.mode='time-trial';for(let n=0;n<30;n++)h.step(1000);assert.equal(a.block.ghost,false);
 h.room.evolution.mode='pursuit';h.room.evolution.releaseDelays[a.id]=10;h.setNow(h.room.startAt+9000);h.app.service.simulate(h.room,h.now());assert.equal(a.block.ghost,false);
}));
await test('安全恢復：重疊持續ghost，分離後正向恢復且不送免費進度',()=>harness(async h=>{
 await h.settings({antiBlock:true});await h.begin();const [p,q]=[...h.room.players.values()],t=h.room.track;
 Object.assign(p.block,{ghost:true,reason:'idle',warningAt:h.now()});const distance=p.distance;
 assert.equal((await h.send(h.b,{type:'recover-block',roomCode:h.room.code,matchId:h.room.matchId})).code,'INVALID_PHASE');
 await h.send(h.a,{type:'recover-block',roomCode:h.room.code,matchId:h.room.matchId});q.car.restore(p.car.snapshot());h.step(2100);assert.equal(p.block.ghost,true);
 q.car.placeAt(t,300);h.step(1000);assert.equal(p.block.ghost,false);assert.equal(p.distance,distance);assert.ok(p.blockProtectedUntil>h.now());
}));
await test('中途純觀眾獨立身分、不佔四席、不能投票準備管理輸入',()=>harness(async h=>{
 await h.begin();const w=await h.open(),response=await h.enter(w,{type:'watch',code:h.room.code,name:'看台甲'});
 assert.equal(response.type,'watching');assert.equal('resumeToken' in response,false);assert.equal(h.room.players.size,2);assert.equal(h.room.spectators.size,1);
 for(const m of [{type:'ready',ready:true,...h.selection()},{type:'vote-track',trackId:'japan',...h.lobby()},{type:'transfer-host',targetPlayerId:h.aw.playerId,...h.lobby()},{type:'input',seq:1,steer:1,brake:false}])assert.equal((await h.send(w,m,r=>r.type==='error')).code,'SPECTATOR_READ_ONLY');
 assert.equal((await h.send(w,{type:'track-loaded',...h.selection()})).room.spectators[0].loaded,true);
 assert.equal((await h.send(w,{type:'claim-seat',...h.lobby()},r=>r.type==='error')).code,'INVALID_PHASE');
}));
await test('觀眾上限8、離開清理、房間銷毀通知與隔離',()=>harness(async h=>{
 const viewers=[];for(let i=0;i<8;i++){const w=await h.open();viewers.push(w);assert.equal((await h.enter(w,{type:'watch',code:h.room.code,name:`觀眾${i}`})).type,'watching');}
 const ninth=await h.open();assert.equal((await h.enter(ninth,{type:'watch',code:h.room.code,name:'額外'})).code,'SPECTATORS_FULL');
 await viewers[0].close();await settle();assert.equal(h.room.spectators.size,7);assert.equal((await h.enter(ninth,{type:'watch',code:h.room.code,name:'補位'})).type,'watching');
 const mark=ninth.mark();h.app.service.destroyRoom(h.room);await ninth.until(m=>m.type==='left',mark);assert.equal(h.room.spectators.size,0);
}));
await test('候場claim必須空位/大廳新世代，成功才核發全新車手身分',()=>harness(async h=>{
 const w=await h.open(),watched=await h.enter(w,{type:'watch',code:h.room.code,name:'候場甲'});
 assert.equal((await h.send(w,{type:'claim-seat',roomCode:h.room.code,expectedLobbyRevision:0},r=>r.type==='error')).code,'STALE_LOBBY');
 const joined=await h.send(w,{type:'claim-seat',...h.lobby(),requestId:'claim'},r=>r.type==='welcome'||r.type==='error');
 assert.equal(joined.type,'welcome');assert.notEqual(joined.playerId,watched.spectatorId);assert.equal(joined.resumeToken.length,64);assert.equal(h.room.spectators.size,0);assert.equal(h.room.players.size,3);
}));
await test('已鎖系列觀眾不能插隊、不影響ready/房主選舉',()=>harness(async h=>{
 await h.send(h.a,{type:'configure-series',trackIds:MULTIPLAYER_TRACKS.slice(0,3).map(t=>t.id),...h.lobby()});await h.begin();
 const w=await h.open();await h.enter(w,{type:'watch',code:h.room.code,name:'候場甲'});h.room.phase='lobby';
 assert.equal((await h.send(w,{type:'claim-seat',...h.lobby()},r=>r.type==='error')).code,'SERIES_LOCKED');
 await h.a.close();await settle();assert.equal(h.room.hostId,h.bw.playerId);assert.notEqual(h.room.hostId,[...h.room.spectators.keys()][0]);
}));
await test('原子範本：完整新房設定與系列一次提交，不含舊身分',()=>harness(async h=>{
 const w=await h.open(),p=preset({trackIds:MULTIPLAYER_TRACKS.slice(0,3).map(t=>t.id),horizon:{antiBlock:true,reverseGrid:true,elimination:false}});
 const created=await h.enter(w,{type:'create-configured',name:'新房主',preset:p});assert.equal(created.type,'welcome');assert.deepEqual(created.room.horizon,p.horizon);
 assert.deepEqual(created.room.series.trackIds,p.trackIds);assert.equal(created.room.series.originalHostId,created.playerId);assert.notEqual(created.playerId,h.aw.playerId);assert.ok(created.room.players.every(p=>!p.ready&&!p.loaded));
}));
await test('原子範本：錯誤/未知身分欄/淘汰系列衝突不留下空房',()=>harness(async h=>{
 const w=await h.open(),count=h.app.service.rooms.size;
 for(const p of [preset({roomCode:'ABC234'}),preset({mode:'invalid'}),preset({horizon:{antiBlock:false,reverseGrid:true,elimination:true}}),preset({trackIds:['taipei','japan','taipei']})]){
  assert.equal(parseRoomPreset(p),null);assert.equal((await h.enter(w,{type:'create-configured',name:'新房主',preset:p})).code,'INVALID_PRESET');assert.equal(h.app.service.rooms.size,count);
 }
}));
await test('反序格：24圖四人安全間距、真實負起跑距離與穩定slot',()=>harness(async h=>{
 for(let i=0;i<2;i++)await h.enter(await h.open(),{type:'join',code:h.room.code,name:`同伴${i}`});await h.settings({reverseGrid:true});
 const ids=[...h.room.players.values()].map(p=>[p.id,p.slot]);
 for(const descriptor of MULTIPLAYER_TRACKS){const selected=h.app.service.trackFor(descriptor.id);h.room.track=selected.track;h.room.trackId=descriptor.id;h.room.trackStamp=descriptor.trackStamp;
  for(const p of h.room.players.values())h.app.service.resetPlayer(h.room,p,h.now());const players=[...h.room.players.values()];
  for(let i=0;i<players.length;i++){assert.equal(players[i].slot,ids[i][1]);assert.equal(players[i].distance<=0,true);if(i)assert.ok(players[i].distance<players[i-1].distance-6);
   for(let j=i+1;j<players.length;j++)assert.equal(multiplayerCarsOverlap(h.room.track,players[i].car,players[j].car,.5),false,descriptor.id);}
 }return {tracks:24,drivers:4};
}));
await test('反序格：上站分類反轉、舊新HMAC checkpoint與下一站重建',()=>harness(async h=>{
 await h.settings({reverseGrid:true});await h.send(h.a,{type:'configure-series',trackIds:MULTIPLAYER_TRACKS.slice(0,3).map(t=>t.id),...h.lobby()});await h.begin();
 let index=0;for(const p of h.room.players.values()){p.completedLaps=3;p.lapTimesMs=[1000,1000,1000+index++*100];p.finishMs=p.lapTimesMs.reduce((a,b)=>a+b,0);p.bestLapMs=1000;}
 h.app.service.maybeFinish(h.room,h.now());const cp=await h.send(h.a,{type:'checkpoint-series',roomCode:h.room.code,matchId:h.room.matchId,expectedSeriesRevision:h.room.series.revision},r=>r.type==='series-checkpoint'||r.type==='error');
 assert.equal(cp.type,'series-checkpoint');const signer=new SeriesCheckpointSigner(key),data=signer.verify(cp.token,h.now());assert.equal(data.horizon.reverseGrid,true);
 const guest=await h.open(),restored=await h.enter(guest,{type:'resume-series',token:cp.token});assert.equal(restored.type,'welcome');assert.equal(restored.room.players.find(p=>p.id===h.bw.playerId).gridIndex,0);
 const legacyPayload={...data};for(const k of ['schema','catalogStamp','physics','issuedAt','expiresAt','horizon'])delete legacyPayload[k];
 for(const s of legacyPayload.seats)delete s.horizon;const legacy=signer.sign(legacyPayload,h.now());const oldGuest=await h.open(),oldRestore=await h.enter(oldGuest,{type:'resume-series',token:legacy.token});assert.equal(oldRestore.type,'welcome');assert.deepEqual(oldRestore.room.horizon,defaultHorizon());
}));
await test('反序後排真WS輸入與未替換Car：跨共同線不送免費圈，完整跑回共同終點',()=>harness(async h=>{
 await h.settings({reverseGrid:true});h.room.roomRules.collisions=false;await h.begin();
 const rear=h.room.players.get(h.bw.playerId),initial=rear.distance,length=h.room.track.length;assert.ok(initial<=-8);
 let seq=0,firstLine=null,travelled=0,previous=rear.car.pos.s;
 for(let elapsed=0;elapsed<120000&&rear.completedLaps===0;elapsed+=50){
  for(const [wire,id] of [[h.a,h.aw.playerId],[h.b,h.bw.playerId]]){const p=h.room.players.get(id);wire.send({type:'input',matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq,...drivingInput(p.car,h.room.track)});}
  seq++;await settle();h.tick(50);const current=rear.car.pos.s;let delta=current-previous;if(delta>length/2)delta-=length;if(delta< -length/2)delta+=length;travelled+=delta;
  if(firstLine===null&&previous>length/2&&current<length/2){firstLine={elapsedMs:h.now()-h.room.startAt,completedLaps:rear.completedLaps,nextGate:rear.nextGate};assert.equal(rear.completedLaps,0);assert.equal(rear.nextGate,1);}
  previous=current;
 }
 assert.ok(firstLine);assert.equal(rear.completedLaps,1);assert.ok(travelled>=length-initial-1);assert.equal(rear.lapTimesMs.length,1);
 return{injectedPoseOrProgress:false,initialDistance:initial,firstLine,completedLaps:rear.completedLaps,travelled,trackLength:length};
}));
await test('淘汰模式明確拒絕系列/其他玩法/反序組合',()=>harness(async h=>{
 await h.settings({elimination:true});assert.equal((await h.send(h.a,{type:'configure-series',trackIds:MULTIPLAYER_TRACKS.slice(0,3).map(t=>t.id),...h.lobby()})).code,'INVALID_HORIZON');
 assert.equal((await h.send(h.a,{type:'configure-event',mode:'time-trial',durationSeconds:180,releaseDelays:{},...h.lobby()})).code,'INVALID_HORIZON');
 assert.equal((await h.settings({elimination:true,reverseGrid:true})).code,'INVALID_HORIZON');
}));
for(const count of [2,3,4])await test(`淘汰${count}人：45秒保護、每次末位、勝者與分類不混DNF`,()=>harness(async h=>{
 const drivers=[h.a,h.b];for(let i=2;i<count;i++){const w=await h.open();await h.enter(w,{type:'join',code:h.room.code,name:`車手${i}`});drivers.push(w);}
 await h.settings({elimination:true});await h.begin(drivers);const players=[...h.room.players.values()];players.forEach((p,i)=>p.distance=(count-i)*100);
 h.setNow(h.room.startAt+44999);assert.equal(h.app.service.maybeFinish(h.room,h.now()),false);assert.equal(players.some(p=>p.eliminated),false);
 for(let n=1;n<count;n++){h.setNow(h.room.startAt+n*45000);h.app.service.maybeFinish(h.room,h.now());assert.equal(players.filter(p=>p.eliminated).length,n);}
 const result=h.app.service.snapshot(h.room,h.now());assert.equal(result.phase,'results');assert.equal(result.players[0].eliminationWinner,true);
 assert.deepEqual(result.players.map(p=>p.eliminationRank),Array.from({length:count},(_,i)=>i+1));assert.ok(result.players.every(p=>!p.dnf&&p.finishMs===null));return {count,eliminations:count-1};
}));
await test('淘汰同進度依slot、淘汰者不能輸入且立即能追看',()=>harness(async h=>{
 await h.settings({elimination:true});await h.begin();for(const p of h.room.players.values())p.distance=100;
 h.setNow(h.room.startAt+45000);h.app.service.maybeFinish(h.room,h.now());const loser=h.room.players.get(h.bw.playerId);assert.equal(loser.eliminated,true);assert.equal(loser.eliminationRank,2);
 h.b.send({type:'input',matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:500,steer:1,brake:false});await settle();assert.notEqual(loser.receivedSeq,500);
}));
await test('淘汰斷線保留十秒、逾期分類淘汰，全部同時斷線無假冠軍',()=>harness(async h=>{
 await h.settings({elimination:true});await h.begin();await h.a.close();await h.b.close();await settle();h.setNow(h.now()+9999);h.app.service.expireDisconnected(h.room,h.now());assert.equal([...h.room.players.values()].some(p=>p.eliminated),false);
 h.setNow(h.now()+1);h.app.service.expireDisconnected(h.room,h.now());assert.equal(h.room.phase,'results');assert.equal(h.room.elimination.winnerId,null);assert.ok([...h.room.players.values()].every(p=>p.eliminated&&!p.dnf));
}));
}
const sha=b=>createHash('sha256').update(b).digest('hex');
report.scriptSha256=sha(await readFile(new URL(import.meta.url)));
report.sourceHashes={};for(const file of ['server/room-service.mjs','server/horizon-service.mjs','shared/multiplayer-horizon.ts','server/series-checkpoint.mjs','src/multiplayer-client.ts','src/multiplayer-horizon-ui.ts','src/multiplayer-scene.ts']){
 try{report.sourceHashes[file]=sha(await readFile(new URL('../../'+file,import.meta.url)));}catch{}
}
for(const file of ['src/car.ts','src/track.ts','src/pitlane.ts','server/physics.mjs'])assert.equal(sha(await readFile(new URL('../../'+file,import.meta.url))),sha(await readFile(new URL(file,before))),file+' immutable');
report.status=report.cases.every(c=>c.status==='PASS')?'PASS':'FAIL';report.summary={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length};
await writeFile(new URL(process.argv.includes('--before-only')?'horizon-multiplayer-before-result.json':'horizon-multiplayer-server-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,...report.summary}));if(report.status!=='PASS')process.exitCode=1;
