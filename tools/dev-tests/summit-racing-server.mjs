import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {createMultiplayerServer} from '../../server/index.mjs';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../../shared/multiplayer-protocol.ts';
import {MULTIPLAYER_TRACKS} from '../../shared/multiplayer-tracks.ts';
import {summitInput} from '../../server/summit-racing-service.mjs';
import {validateSummit,summitPredict,summitGrip,summitWear,summitWet} from '../../shared/summit-racing.ts';
import {parseMultiplayerReplay,replayRoomAt} from '../../shared/nexus-replay.ts';
import {WireClient,ORIGIN,settle,drivingInput} from './multiplayer-test-helpers.mjs';
const identity={version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP};
const caps={roomRules:true,evolution:true,horizon:true,nexusArena:true,summit:true};
const report={localOnly:true,realWebSocket:true,externalRequests:0,cases:[]};
const clone=v=>JSON.parse(JSON.stringify(v));
async function test(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).slice(0,6000)});}console.log(JSON.stringify(report.cases.at(-1)));}
async function harness(fn,options={}){
 let now=1000000;const app=(options.factory??createMultiplayerServer)({now:()=>now,autoTick:false,allowedOrigins:[ORIGIN]});await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));const wires=[];
 const open=async()=>{const w=await new WireClient(`ws://127.0.0.1:${app.httpServer.address().port}/ws`).open();wires.push(w);return w;};
 const send=async(w,m,p=r=>!!r.room||r.type==='error')=>{await settle();const mark=w.mark();w.send(m);return w.until(p,mark);};
 const enter=(w,m,supported=true)=>send(w,{...identity,clientCapabilities:supported?caps:{roomRules:true,evolution:true,horizon:true,nexusArena:true},...m},r=>['welcome','watching','error'].includes(r.type));
 const a=await open(),aw=await enter(a,{type:'create',name:'甲車手',laps:3,trackId:options.trackId??'taipei'}),room=app.service.rooms.get(aw.room.code),players=[{w:a,welcome:aw}];
 for(let i=1;i<(options.count??2);i++){const w=await open(),welcome=await enter(w,{type:'join',name:`真人${i+1}`,code:room.code},!options.legacy);players.push({w,welcome});}
 const lobby=()=>({roomCode:room.code,expectedLobbyRevision:room.lobbyRevision});const selection=()=>({trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});
 const start=async()=>{for(const{w}of players){await send(w,{type:'track-loaded',...selection()});await send(w,{type:'ready',ready:true,...selection()});}const result=await send(a,{type:'start',trackRevision:room.trackRevision});if(room.phase==='countdown'){now=room.startAt;app.service.tick(now);await settle();}return result;};
 const h={app,a,aw,room,players,open,send,enter,lobby,selection,start,settings:(settings={weekend:false,ai:0,endurance:0})=>send(a,{type:'set-summit',settings,...lobby()}),now:()=>now,setNow(t){now=t;},step(auto=false){now+=1000/60;if(auto)for(const p of room.players.values())if(!p.isAi){p.input=summitInput(p.car,room.track);p.lastInputAt=now;}app.service.simulate(room,now);app.service.maybeFinish(room,now);},player(i=0){return room.players.get(players[i].welcome.playerId);}};
 try{return await fn(h);}finally{await Promise.all(wires.map(w=>w.close()));await app.close();}
}
await test('設定權限、非法組合、過期大廳與舊客戶端能力不可繞過',()=>harness(async h=>{
 for(const settings of[{weekend:true,ai:4,endurance:0},{weekend:true,ai:0,endurance:3},{weekend:true,ai:0,endurance:'480'},{weekend:true,ai:0,endurance:0,extra:true}])assert.equal((await h.settings(settings)).code,'SUMMIT_RULE');
 assert.equal((await h.send(h.players[1].w,{type:'set-summit',...h.lobby(),settings:{weekend:true,ai:0,endurance:0}})).code,'SUMMIT_RULE');
 assert.equal((await h.send(h.a,{type:'set-summit',...h.lobby(),expectedLobbyRevision:0,settings:{weekend:true,ai:0,endurance:0}})).code,'SUMMIT_RULE');
 await h.settings({weekend:true,ai:1,endurance:480});assert.equal(h.room.players.size,3);validateSummit(h.app.service.snapshot(h.room));
 assert.equal((await h.send(h.a,{type:'set-arena',mode:'items',...h.lobby()})).code,'SUMMIT_RULE');assert.equal((await h.send(h.a,{type:'configure-event',mode:'time-trial',durationSeconds:180,releaseDelays:{},...h.lobby()})).code,'SUMMIT_RULE');
 const w=await h.open();for(const m of[{type:'join',name:'舊車手',code:h.room.code},{type:'watch',name:'舊觀眾',code:h.room.code},{type:'resume',code:h.room.code,playerId:h.aw.playerId,token:h.aw.resumeToken}])assert.equal((await h.enter(w,m,false)).code,'SUMMIT_RULE');
}));
await test('真 AI 席位無 socket、不會成為房主，可開跑且離開真人後會清房',()=>harness(async h=>{
 await h.settings({weekend:false,ai:3,endurance:0});assert.equal(h.room.players.size,4);for(const p of h.room.players.values())if(p.isAi){assert.equal(p.client,null);assert.equal(p.token,null);assert.equal(p.ready,true);assert.equal(p.loaded,true);}
 assert.equal((await h.start()).room.phase,'countdown');const ai=[...h.room.players.values()].find(p=>p.isAi);for(let i=0;i<600;i++)h.step();assert.ok(ai.distance>50);assert.ok(ai.car.v>0);assert.equal(h.room.hostId,h.aw.playerId);
 await h.send(h.a,{type:'leave'},m=>m.type==='left');assert.equal(h.room.hostId,'');assert.equal(h.room.emptySince,h.now());h.setNow(h.now()+60001);h.app.service.tick(h.now());assert.equal(h.app.service.rooms.has(h.room.code),false);
},{count:1}));
await test('三分鐘排位真Car有效圈→新場次正賽，保留原席、正確grid、清準備與載入',()=>harness(async h=>{
 await h.settings({weekend:true,ai:1,endurance:0});h.room.roomRules.collisions=false;await h.start();const match=h.room.matchId;let ticks=0;for(;ticks<10802&&h.room.phase==='racing';ticks++){h.step(true);if(ticks%12===0)h.app.service.snapshot(h.room,h.now());}
 assert.equal(h.room.phase,'results');assert.ok([...h.room.players.values()].every(p=>p.bestLapMs!==null));assert.equal(h.room.summit.qualifying.length,2);validateSummit(h.app.service.snapshot(h.room,h.now()));
 const order=h.room.summit.qualifying.map(p=>p.id);await h.send(h.a,{type:'next-weekend',...h.lobby()});assert.equal(h.room.phase,'lobby');assert.equal(h.room.summit.stage,'race');assert.equal(h.player().loaded,false);assert.equal(h.player().ready,false);
 assert.equal((await h.send(h.a,{type:'select-track',trackId:'japan',expectedRevision:h.room.trackRevision})).code,'SUMMIT_RULE');
 await h.start();assert.notEqual(h.room.matchId,match);const snap=h.app.service.snapshot(h.room,h.now());assert.deepEqual([...snap.players].sort((a,b)=>a.gridIndex-b.gridIndex).map(p=>p.id),order);assert.ok([...h.room.players.values()].every(p=>p.completedLaps===0&&p.bestLapMs===null));validateSummit(snap);return{qualifyingTicks:ticks,grid:order.map(id=>h.room.players.get(id).name)};
},{count:1}));
await test('AI 真 Car 全24張地圖至少完成一圈，無瞬移／改進度／改完賽結果',async()=>{
 const maps=[];for(const track of MULTIPLAYER_TRACKS)await harness(async h=>{await h.settings({weekend:false,ai:1,endurance:0});h.room.roomRules.collisions=false;await h.start();const ai=[...h.room.players.values()].find(p=>p.isAi);let ticks=0,hits=0;for(;ticks<60*360&&ai.completedLaps<1;ticks++){h.step();if(ai.car.touch)hits++;}assert.equal(ai.completedLaps,1,track.id);maps.push({id:track.id,seconds:+(ticks/60).toFixed(3),touchTicks:hits});},{count:1,trackId:track.id});return maps;
});
await test('胎況共用函式：依實距磨耗、濕胎選擇、維修限速僅在終點區',()=>{
 assert.equal(summitWear('soft',0,0),0);assert.ok(summitWear('soft',1000,0)>summitWear('hard',1000,0));assert.ok(summitGrip('wet',0,1)>summitGrip('soft',0,1));assert.equal(summitWet(480000*.4,480),1);
 const p={summit:{ai:false,compound:'medium',wear:0,pitArmed:true,pitUntil:0,pitStops:0,nextCompound:'wet',lapValid:true,validLaps:[]}},room={summit:{settings:{weekend:false,ai:0,endurance:480},stage:'single',weather:1},trackLength:3000},car={v:30,gripMul:1,speedCap:Infinity,pos:{s:1500}};
 summitPredict(car,room,p,1);assert.equal(car.speedCap,Infinity);car.pos.s=2950;summitPredict(car,room,p,1);assert.equal(car.speedCap,12);p.summit.pitUntil=6000;summitPredict(car,room,p,1);assert.equal(car.v,0);assert.equal(car.speedCap,0);
});
await test('8／10分鐘耐久真Car：超過圈數、共享雨勢、AI實際低速進站6秒換胎、截止後過線完賽',async()=>{
 const runs=[];for(const duration of[480,600])await harness(async h=>{await h.settings({weekend:false,ai:1,endurance:duration});h.room.roomRules.collisions=false;await h.start();const ai=[...h.room.players.values()].find(p=>p.isAi),weather=new Set(),pit=[];let maxWear=0,ticks=0,previousPit=0;
 for(;ticks<60*(duration+121)&&h.room.phase==='racing';ticks++){h.step(true);weather.add(Math.round(h.room.summit.weather*10));maxWear=Math.max(maxWear,ai.summit.wear);if(ai.summit.pitUntil!==previousPit){pit.push({at:h.now()-h.room.startAt,until:ai.summit.pitUntil?h.room.summit&&ai.summit.pitUntil-h.room.startAt:0,s:ai.car.pos.s,lat:ai.car.pos.lat,v:ai.car.v,stops:ai.summit.pitStops});previousPit=ai.summit.pitUntil;}if(ticks%12===0)h.app.service.snapshot(h.room,h.now());}
 assert.equal(h.room.phase,'results');assert.ok(ai.completedLaps>3);assert.ok(ai.finishMs>=duration*1000);assert.equal(ai.dnf,false);assert.ok(weather.has(0)&&weather.has(10));assert.ok(ai.summit.pitStops>=1,JSON.stringify(pit));assert.ok(maxWear>0);for(const row of pit.filter(p=>p.until)){assert.ok(row.s<80);assert.ok(row.lat>=2.8);assert.equal(row.v,0);assert.ok(Math.abs(row.until-row.at-6000)<.1);}
 validateSummit(h.app.service.snapshot(h.room,h.now()));const replay=parseMultiplayerReplay(JSON.parse(h.room.replayRecording.text));assert.ok(replay);assert.equal(replay.schema,2);assert.ok(replay.events.some(e=>e.type==='pit'));assert.ok(replay.events.some(e=>e.type==='weather'));assert.ok(replay.frames.some(f=>f.wet===1));assert.ok(replayRoomAt(replay,replay.recordedMs).players.some(p=>p.summit?.pitStops>0));runs.push({duration,seconds:ticks/60,laps:ai.completedLaps,finishMs:ai.finishMs,pitStops:ai.summit.pitStops,pit,events:replay.events.length});
 },{count:1});return runs;
});
await test('真碰撞／護牆事件來自模擬，失敗交棒／道具不記事件，匯出只有匿名driver參照',()=>harness(async h=>{
 await h.start();const[a,b]=[h.player(0),h.player(1)],t=h.room.track;for(const p of[a,b]){p.car.placeAt(t,100);p.car.v=p===a?30:0;p.input={steer:0,brake:false};p.lastInputAt=h.now();}b.car.x+=.5;
 h.step();assert.ok(h.room.summitEvents.some(e=>e.type==='collision'));a.car.x-=t.tz[a.car.pos.i]*30;a.car.z+=t.tx[a.car.pos.i]*30;h.step();assert.ok(h.room.summitEvents.some(e=>e.type==='wall'));
 const count=h.room.summitEvents.length;assert.equal((await h.send(h.a,{type:'use-item',roomCode:h.room.code,matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:1})).code,'ARENA_RULE');assert.equal(h.room.summitEvents.length,count);
 for(const p of h.room.players.values())h.app.service.markDnf(p,'race-timeout');h.app.service.maybeFinish(h.room,h.now());const text=h.room.replayRecording.text,replay=parseMultiplayerReplay(JSON.parse(text));assert.ok(replay);assert.equal(replay.schema,2);assert.ok(replay.events.some(e=>e.type==='collision'));for(const id of h.room.players.keys())assert.equal(text.includes(id),false);assert.equal(text.includes(h.aw.resumeToken),false);assert.equal(text.includes(h.room.code),false);
 const invalid=[r=>r.events[0].actors=['raw-player-id'],r=>r.events[0].at=-1,r=>r.events[0].type='penalty',r=>r.events[0].detail='<script>',r=>r.frames[0].strategy[0][1]=2,r=>r.frames[0].wet=NaN,r=>r.drivers[0].token='secret'];for(const mutate of invalid){const r=clone(replay);mutate(r);assert.equal(parseMultiplayerReplay(r),null);}
 return{types:replay.events.map(e=>e.type),importRejections:invalid.length};
}));
await test('排位擦牆／接觸只使本圈無效，不採用無效最快圈；無有效圈後排、原席可續接',()=>harness(async h=>{
 await h.settings({weekend:true,ai:0,endurance:0});await h.start();const p=h.player(0),q=h.player(1),t=h.room.track;p.car.x-=t.tz[p.car.pos.i]*30;p.car.z+=t.tx[p.car.pos.i]*30;h.step();assert.equal(p.summit.lapValid,false);
 // Boundary fixture: crossing timing is covered by the complete real-Car test above.
 p.completedLaps=2;p.lapTimesMs=[50000,60000];p.lastLapElapsedMs=110000;p.summit.validLaps=[60000];p.bestLapMs=60000;q.completedLaps=1;q.lapTimesMs=[40000];q.lastLapElapsedMs=40000;q.summit.validLaps=[];q.bestLapMs=null;
 const w=h.players[1].w,token=h.players[1].welcome.resumeToken;await w.close();await settle();const replacement=await h.open(),resume=await h.enter(replacement,{type:'resume',code:h.room.code,playerId:q.id,token});assert.equal(resume.type,'welcome');assert.equal(q.bestLapMs,null);assert.equal(q.completedLaps,1);await h.send(replacement,{type:'track-loaded',...h.selection()});
 h.setNow(h.room.startAt+180000);h.app.service.maybeFinish(h.room,h.now());const snap=h.app.service.snapshot(h.room,h.now());validateSummit(snap);assert.equal(snap.players[0].id,p.id);assert.equal(p.finishMs,60000);assert.equal(q.dnfReason,'time-trial-no-lap');assert.equal(h.room.summit.qualifying[1].bestMs,null);
 await h.send(h.a,{type:'next-weekend',...h.lobby()});const join=await h.open();assert.equal((await h.enter(join,{type:'join',code:h.room.code,name:'新車手'})).code,'SUMMIT_RULE');
 return{invalidFastMs:50000,validBestMs:p.finishMs,noLapRearGrid:true,resumePreserved:true};
}));
await test('普通競速逐幀與 immutable before 一致，五個核心檔案 SHA256 不變',async()=>{
 const before=new URL('../../../taipei-gp-summit-before-64bc8f19a76a/',import.meta.url),hook=registerHooks({resolve(specifier,context,next){return specifier==='ws'&&context.parentURL?.startsWith(before.href)?{url:new URL('../../server/node_modules/ws/wrapper.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context);}});const old=await import(new URL('server/index.mjs',before));hook.deregister();const sequences=[];
 for(const factory of[old.createMultiplayerServer,createMultiplayerServer])await harness(async h=>{await h.start();const frames=[];for(let tick=0;tick<3600;tick++){for(const p of h.room.players.values()){p.input=drivingInput(p.car,h.room.track);p.lastInputAt=h.now();}h.step();if(tick%60===0)frames.push([...h.room.players.values()].map(p=>({car:p.car.snapshot(),distance:p.distance,completedLaps:p.completedLaps,nextGate:p.nextGate})));}sequences.push(frames);},{factory});assert.deepEqual(sequences[0],sequences[1]);const sourceHashes={};for(const f of['src/car.ts','src/track.ts','src/rivals.ts','src/pitlane.ts','server/physics.mjs']){const hash=bytes=>createHash('sha256').update(bytes).digest('hex');sourceHashes[f]=hash(await readFile(new URL('../../'+f,import.meta.url)));assert.equal(sourceHashes[f],hash(await readFile(new URL(f,before))),f);}return{comparedFrames:sequences[0].length,sourceHashes};
});
await test('真人＋三台AI真Car完整三圈碰撞賽，所有車手自然完賽',()=>harness(async h=>{
 await h.settings({weekend:false,ai:3,endurance:0});await h.start();let tick=0;for(;tick<60*600&&h.room.phase==='racing';tick++)h.step(true);assert.equal(h.room.phase,'results');assert.ok([...h.room.players.values()].every(p=>p.finishMs!==null&&!p.dnf),JSON.stringify([...h.room.players.values()].map(p=>({name:p.name,laps:p.completedLaps,finish:p.finishMs,dnf:p.dnf}))));return{seconds:tick/60,results:[...h.room.players.values()].map(p=>({name:p.name,finishMs:p.finishMs}))};
},{count:1}));
await test('交棒／道具只在成功權威mutation後記事件；重送seq不重複',()=>harness(async h=>{
 await h.send(h.a,{type:'set-arena',mode:'relay',...h.lobby()});await h.start();const p=h.player(0),next=h.player(2),t=h.room.track;p.car.placeAt(t,Math.floor(20/t.ds));p.completedLaps=1;p.distance=t.length+p.car.pos.s;p.lapTimesMs=[60000];p.bestLapMs=p.lastLapElapsedMs=60000;
 const message={type:'relay-handoff',roomCode:h.room.code,matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:100};await h.send(h.a,message);assert.equal(next.arena.active,true);assert.equal(h.room.summitEvents.filter(e=>e.type==='handoff').length,1);h.a.send(message);await settle();assert.equal(h.room.summitEvents.filter(e=>e.type==='handoff').length,1);
 for(const p of h.room.players.values())h.app.service.markDnf(p,'race-timeout');h.app.service.maybeFinish(h.room,h.now());await h.send(h.a,{type:'reset'});await h.send(h.a,{type:'set-arena',mode:'items',...h.lobby()});await h.start();p.arena.item='shield';await h.send(h.a,{type:'use-item',roomCode:h.room.code,matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:101});assert.equal(h.room.summitEvents.filter(e=>e.type==='item').length,1);assert.ok(p.arena.shieldUntil>h.now());return{handoff:true,item:true};
},{count:4}));
await test('耐久策略真WS：綁場次／地圖／seq，重送不改胎，維修6秒期間鎖定',()=>harness(async h=>{
 await h.settings({weekend:false,ai:0,endurance:480});await h.start();const p=h.player(0),message={type:'summit-pit',roomCode:h.room.code,matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:100,armed:true,compound:'wet'};for(const extra of[{matchId:'old'},{trackRevision:0},{seq:-1},{compound:'super'},{armed:'true'}])assert.equal((await h.send(h.a,{...message,...extra})).code,'SUMMIT_RULE');await h.send(h.a,message);assert.equal(p.summit.nextCompound,'wet');h.a.send({...message,compound:'hard',wear:0});await settle();assert.equal(p.summit.nextCompound,'wet');const t=h.room.track,i=Math.floor(20/t.ds);p.car.placeAt(t,i);p.car.x-=t.tz[i]*4;p.car.z+=t.tx[i]*4;p.car.pos.lat=4;p.car.v=0;h.step();assert.ok(p.summit.pitUntil>h.now());assert.equal((await h.send(h.a,{...message,seq:101,compound:'hard'})).code,'SUMMIT_RULE');assert.equal(p.summit.nextCompound,'wet');return{duplicateRejected:true,pitUntil:p.summit.pitUntil};
}));
await test('舊觀眾已在普通房時，房主不能直接開啟不支援的排位／AI／耐久',()=>harness(async h=>{
 const viewer=await h.open();assert.equal((await h.enter(viewer,{type:'watch',code:h.room.code,name:'舊觀眾'},false)).type,'watching');assert.equal((await h.settings({weekend:true,ai:0,endurance:0})).code,'SUMMIT_RULE');await h.send(viewer,{type:'leave'},m=>m.type==='left');await h.settings({weekend:true,ai:0,endurance:0});assert.equal(h.room.summit.stage,'qualifying');
}));
await test('真WS新socket續接：耐久及道具序號重新起算，舊socket失效、場次與地圖綁定保留',async()=>{
 const results=[];
 for(const mode of ['endurance','items'])await harness(async h=>{
  if(mode==='endurance')await h.settings({weekend:false,ai:0,endurance:480});
  else await h.send(h.a,{type:'set-arena',mode:'items',...h.lobby()});
  await h.start();const p=h.player(0),oldClient=p.client,oldWire=h.a;
  const message=mode==='endurance'?{type:'summit-pit',armed:true,compound:'wet'}:{type:'use-item'};
  const binding={roomCode:h.room.code,matchId:h.room.matchId,trackRevision:h.room.trackRevision};
  if(mode==='items')p.arena.item='shield';
  await h.send(h.a,{...message,...binding,seq:100});
  assert.equal(mode==='endurance'?p.summitSeq:p.arenaUsedSeq,100);
  const replacement=await h.open(),resumed=await h.enter(replacement,{type:'resume',code:h.room.code,playerId:p.id,token:h.aw.resumeToken});
  assert.equal(resumed.type,'welcome');assert.equal(resumed.playerId,p.id);assert.equal(resumed.room.matchId,binding.matchId);
  await oldWire.waitClosed();assert.equal(oldClient.room,null);assert.equal(oldClient.player,null);
  assert.equal(mode==='endurance'?p.summitSeq:p.arenaUsedSeq,-1);
  await h.send(replacement,{type:'track-loaded',...h.selection()});
  for(const extra of [{matchId:'retired-match'},{trackRevision:binding.trackRevision-1}])assert.equal((await h.send(replacement,{...message,...binding,...extra,seq:1})).code,mode==='endurance'?'SUMMIT_RULE':'ARENA_RULE');
  if(mode==='items'){p.arena.item='boost';h.setNow(h.now()+4001);}
  const next=mode==='endurance'?{...message,armed:false,compound:'hard'}:message;
  await h.send(replacement,{...next,...binding,seq:1});
  if(mode==='endurance'){assert.equal(p.summit.pitArmed,false);assert.equal(p.summit.nextCompound,'hard');}
  else {assert.equal(p.arena.item,null);assert.equal(p.arena.boostUntil,h.now()+2500);}
  assert.equal(mode==='endurance'?p.summitSeq:p.arenaUsedSeq,1);
  replacement.send({...message,...binding,seq:1});await settle();
  assert.equal(mode==='endurance'?p.summit.nextCompound:p.arena.item,mode==='endurance'?'hard':null);
  // Explicitly replay a retired connection callback after the real WS was detached.
  h.app.service.receive(oldClient,{...message,...binding,seq:999});
  assert.equal(mode==='endurance'?p.summitSeq:p.arenaUsedSeq,1);
  assert.notEqual(p.client,oldClient);assert.equal(p.client.room,h.room);assert.equal(p.connected,true);
  results.push({mode,samePlayer:true,sequenceRestarted:true,retiredSocketDetached:true,staleMatchAndTrackRejected:true});
 });return results;
});
await test('真WS正賽大廳離席／續接逾時／移除：整份排位失效、保留AI、重新載入準備及加入',async()=>{
 const results=[];
 for(const kind of ['leave','expire','kick'])await harness(async h=>{
  await h.settings({weekend:true,ai:1,endurance:0});await h.start();const previousMatch=h.room.matchId;
  // Arrange only the qualifying-result boundary; natural laps are tested above.
  for(const [i,p]of [...h.room.players.values()].entries()){p.completedLaps=1;p.lapTimesMs=[60000+i*1000];p.lastLapElapsedMs=p.bestLapMs=p.lapTimesMs[0];p.summit.validLaps=[p.bestLapMs];}
  h.setNow(h.room.startAt+180000);h.app.service.maybeFinish(h.room,h.now());
  await h.send(h.a,{type:'next-weekend',...h.lobby()});assert.equal(h.room.summit.stage,'race');
  const trackRevision=h.room.trackRevision,revision=h.room.summit.revision,removed=h.player(1),joining=await h.open();
  assert.equal((await h.enter(joining,{type:'join',code:h.room.code,name:'新車手'})).code,'SUMMIT_RULE');
  const previousSelection=h.selection();
  if(kind==='leave')await h.send(h.players[1].w,{type:'leave'},m=>m.type==='left');
  else if(kind==='kick')await h.send(h.a,{type:'kick-player',targetPlayerId:removed.id,...h.lobby()});
  else {await h.players[1].w.close();await settle();assert.equal(h.room.summit.stage,'race');validateSummit(h.app.service.snapshot(h.room,h.now()));h.setNow(h.now()+10000);h.app.service.expireDisconnected(h.room,h.now());await settle();}
  const snapshot=h.app.service.snapshot(h.room,h.now());validateSummit(snapshot);
  assert.equal(h.room.players.has(removed.id),false);assert.equal(snapshot.phase,'lobby');assert.equal(snapshot.summit.stage,'qualifying');assert.deepEqual(snapshot.summit.qualifying,[]);
  assert.deepEqual(snapshot.summit.settings,{weekend:true,ai:1,endurance:0});assert.equal(snapshot.trackRevision,trackRevision+1);assert.equal(snapshot.summit.revision,revision+1);assert.equal(snapshot.matchId,null);
  assert.deepEqual([...h.room.gridSlots.values()],[0,1]);
  for(const p of snapshot.players){assert.equal(p.completedLaps,0);assert.equal(p.bestLapMs,null);assert.deepEqual(p.summit.validLaps,[]);assert.equal(p.loaded,p.summit.ai);assert.equal(p.ready,p.summit.ai);}
  assert.equal((await h.send(h.a,{type:'track-loaded',...previousSelection})).code,'STALE_TRACK');
  assert.equal((await h.send(h.a,{type:'ready',ready:true,...previousSelection})).code,'STALE_TRACK');
  assert.equal((await h.send(h.a,{type:'start',trackRevision:h.room.trackRevision})).code,'NOT_READY');
  const welcome=await h.enter(joining,{type:'join',code:h.room.code,name:'新車手'});assert.equal(welcome.type,'welcome');validateSummit(welcome.room);
  for(const w of [h.a,joining]){await h.send(w,{type:'track-loaded',...h.selection()});await h.send(w,{type:'ready',ready:true,...h.selection()});}
  assert.equal((await h.send(h.a,{type:'start',trackRevision:h.room.trackRevision})).room.phase,'countdown');
  assert.notEqual(h.room.matchId,previousMatch);assert.equal(h.room.summit.stage,'qualifying');validateSummit(h.app.service.snapshot(h.room,h.now()));
  results.push({kind,wholeGridInvalidated:true,aiPreserved:true,newJoinAfterReset:true,freshPreparationRequired:true});
 });return results;
});
report.status=report.cases.every(c=>c.status==='PASS')?'PASS':'FAIL';report.summary={pass:report.cases.filter(c=>c.status==='PASS').length,fail:report.cases.filter(c=>c.status==='FAIL').length};await writeFile(new URL('summit-racing-server-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.status!=='PASS')process.exitCode=1;
