// Rex <game88521@gmail.com>. Local transport only; authority fast-forward and position fixtures are explicit.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {WebSocket} from '../../server/node_modules/ws/wrapper.mjs';
import {RoomService} from '../../server/room-service.mjs';
import {createMultiplayerServer} from '../../server/index.mjs';
import {summitInput} from '../../server/summit-racing-service.mjs';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../../shared/multiplayer-protocol.ts';
import {MULTIPLAYER_TRACKS} from '../../shared/multiplayer-tracks.ts';
import {FRONTIER_CUP_VERSION,AURORA_CUP_VERSION} from '../../shared/frontier-cup.ts';
import {validateMeridianRacing} from '../../shared/meridian-racing.ts';

const args=process.argv.slice(2);assert.ok(args.every(a=>['--before','--core','--soak'].includes(a)));assert.ok(args.length<=1);
const mode=args[0]??'--core',beforeMode=mode==='--before',soakMode=mode==='--soak';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.dirname(fileURLToPath(import.meta.url));
const name=beforeMode?'beacon-multiplayer-before':soakMode?'beacon-multiplayer-soak':'beacon-multiplayer-node';
const evidence=`${name}-evidence-${Date.now()}-${randomBytes(3).toString('hex')}`;
const report={startedAt:new Date().toISOString(),status:'RUNNING',mode,transport:soakMode?'real loopback WebSocket; real wall clock':'real loopback WebSocket plus explicitly labelled state fixtures',externalRequests:[],cases:[],limitations:['No physical phone, public network, hosted-capacity or human driving validation.','Application-scheduled delayed/dropped controls are not a real TCP packet-loss experiment.','Accelerated authority time and pit/stage fixtures never count as real wall-clock racing.']};
const sources=['server/room-service.mjs','server/meridian-racing-service.mjs','server/index.mjs','server/physics.mjs','src/multiplayer-client.ts','src/multiplayer-network.ts','src/multiplayer-scene.ts','shared/meridian-racing.ts','src/car.ts','src/track.ts','src/rivals.ts','src/pitlane.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex'),sourceHashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,sha(await readFile(path.join(root,p)))])));
report.sourceHashes=await sourceHashes();report.scriptSha256=sha(await readFile(fileURLToPath(import.meta.url)));
const identity={version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,clientCapabilities:{meridianRacing:true,roomRules:true,evolution:true,horizon:true,nexusArena:true,summit:true,atlasRacing:true,voyagerRacing:true,odysseyRacing:true,expeditionRacing:true,frontierCup:FRONTIER_CUP_VERSION,auroraCup:AURORA_CUP_VERSION}};
const ORIGIN='http://127.0.0.1:4317';
let serversOpened=0,serversCleaned=0;
async function test(label,fn){try{report.cases.push({name:label,status:'PASS',details:await fn()});}catch(e){report.cases.push({name:label,status:'FAIL',error:String(e.stack)});}console.log(JSON.stringify(report.cases.at(-1)));}
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];send(raw){this.messages.push(JSON.parse(raw));this.messages=this.messages.slice(-64);}close(){this.readyState=3;this.emit('close');}ping(){}terminate(){this.close();}}

// Explicit state fixtures: the replacement is authenticated by the real RoomService;
// only the legal pit pose/distance/time are placed by the test to isolate action sequence ownership.
function resumeFixture(){let now=1795415000000;const service=new RoomService({now:()=>now}),clients=[];
 for(let i=0;i<4;i++){const c=service.accept(new Socket());service.receive(c,{...identity,type:i?'join':'create',name:`續接${i}`,laps:3,trackId:'taipei',...(i?{code:clients[0].room.code}:{})});assert.ok(c.player);clients.push(c);}
 const room=clients[0].room;service.receive(clients[0],{type:'set-meridian',roomCode:room.code,expectedLobbyRevision:room.lobbyRevision,settings:{mode:'relay-endurance',durationSeconds:600,handoffsRequired:2}});
 for(const c of clients){service.receive(c,{type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});service.receive(c,{type:'ready',ready:true,trackRevision:room.trackRevision,trackStamp:room.trackStamp,meridianRevision:room.meridian.revision,lobbyRevision:room.lobbyRevision});}
 service.receive(clients[0],{type:'start',trackRevision:room.trackRevision});assert.equal(room.phase,'countdown');now=room.startAt;service.tick(now);assert.equal(room.phase,'racing');
 const team=room.meridian.relayTeams[0],original=room.players.get(team.driverId),retired=original.client;
 service.receive(retired,{type:'meridian-handoff',roomCode:room.code,matchId:room.matchId,trackRevision:room.trackRevision,driverGeneration:team.generation,seq:50});assert.equal(original.meridianSeq,50);assert.equal(team.handoffs,0);
 const token=original.token;retired.ws.close();now+=500;const replacement=service.accept(new Socket());service.receive(replacement,{...identity,type:'resume',code:room.code,playerId:original.id,token});assert.equal(replacement.player,original);assert.equal(original.connected,true);
 service.receive(replacement,{type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});assert.equal(original.loaded,true);
 now=room.startAt+40000;const t=room.track;original.car.placeAt(t,1);original.car.x-=t.tz[1]*4;original.car.z+=t.tx[1]*4;original.car.pos.lat=4;original.car.v=0;original.distance=t.length;team.stintStartDistance=0;team.stintStartedAt=room.startAt;
 const seqAfterResume=original.meridianSeq;
 service.receive(replacement,{type:'meridian-handoff',roomCode:room.code,matchId:room.matchId,trackRevision:room.trackRevision,driverGeneration:team.generation,seq:1});
 return{service,room,team,original,replacement,retired,seqAfterResume};
}

class Peer{
 constructor(url){this.ws=new WebSocket(url,{origin:ORIGIN});this.messages=[];this.latest=null;this.count=0;this.bytes=0;this.waiters=new Set();this.error=null;this.closed=false;this.welcome=null;
  this.ws.on('error',e=>{this.error=e;});this.ws.on('close',()=>{this.closed=true;for(const w of this.waiters){clearTimeout(w.timer);w.reject(Error('socket closed'));}this.waiters.clear();});
  this.ws.on('message',raw=>{const m=JSON.parse(raw.toString());this.count++;this.bytes+=raw.length;this.messages.push(m);if(this.messages.length>32)this.messages.shift();if(m.room)this.latest=m.room;if(m.type==='welcome')this.welcome=m;for(const w of [...this.waiters])if(w.fn(m)){clearTimeout(w.timer);this.waiters.delete(w);w.resolve(m);}});
 }
 async open(){if(this.ws.readyState===1)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('open timeout')),3000);this.ws.once('open',()=>{clearTimeout(timer);resolve();});this.ws.once('error',e=>{clearTimeout(timer);reject(e);});});}
 async until(fn){const old=this.messages.findLast(fn);if(old)return old;return new Promise((resolve,reject)=>{const w={fn,resolve,reject,timer:null};w.timer=setTimeout(()=>{this.waiters.delete(w);reject(Error('message timeout; recent='+JSON.stringify(this.messages.slice(-2).map(m=>({type:m.type,code:m.code,phase:m.room?.phase,revision:m.room?.trackRevision})))));},5000);this.waiters.add(w);});}
 send(m){assert.equal(this.ws.readyState,1);this.ws.send(JSON.stringify(m));}
 async request(m,fn){const waiting=this.until(fn);this.send(m);return waiting;}
 async close(){if(this.ws.readyState===3)return;await new Promise(resolve=>{const timer=setTimeout(()=>{this.ws.terminate();resolve();},1000);this.ws.once('close',()=>{clearTimeout(timer);resolve();});this.ws.close();});}
}
async function withServer(fn,{real=false}={}){let now=1795416000000;const app=createMultiplayerServer({prewarmCityRace:false,autoTick:real,allowedOrigins:[ORIGIN],...(real?{}:{now:()=>now}),roomOptions:{emptyRoomMs:1000,idleRoomMs:1800000}}),peers=[];
 await new Promise((resolve,reject)=>{app.httpServer.once('error',reject);app.httpServer.listen(0,'127.0.0.1',resolve);});serversOpened++;const url=`ws://127.0.0.1:${app.httpServer.address().port}/ws`;
 const open=async()=>{const p=new Peer(url);peers.push(p);await p.open();return p;};
 const advance=ms=>{const end=now+ms;now=end;app.service.tick(now);};
 try{return await fn({app,open,peers,advance,now:()=>real?Date.now():now});}finally{await Promise.all(peers.map(p=>p.close()));await app.close();assert.equal(app.service.clients.size,0);assert.equal(app.service.rooms.size,0);assert.equal(app.wss.clients.size,0);serversCleaned++;}
}
async function four(f,{relay=false,real=false}={}){const players=[];for(let i=0;i<4;i++){const p=await f.open();const w=await p.request({...identity,type:i?'join':'create',name:`耐測${i}`,laps:5,trackId:'taipei',...(i?{code:players[0].latest.code}:{})},m=>m.type==='welcome');p.id=w.playerId;p.token=w.resumeToken;p.seq=0;players.push(p);}
 const room=f.app.service.rooms.get(players[0].latest.code),host=players[0];
 await host.request({type:'set-room-rules',roomCode:room.code,expectedLobbyRevision:room.lobbyRevision,roomRules:{collisions:false,finishGraceSeconds:120}},m=>m.type==='room'&&m.room.roomRules.collisions===false);
 if(relay){const revision=room.lobbyRevision;await host.request({type:'set-meridian',roomCode:room.code,expectedLobbyRevision:revision,settings:{mode:'relay-endurance',durationSeconds:600,handoffsRequired:2}},m=>m.room?.meridian?.settings.mode==='relay-endurance');}
 for(const p of players){p.send({type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});p.send({type:'ready',ready:true,trackRevision:room.trackRevision,trackStamp:room.trackStamp,...(relay?{meridianRevision:room.meridian.revision,lobbyRevision:room.lobbyRevision}:{})});}
 await host.until(m=>m.room?.players.every(p=>p.ready));host.send({type:'start',trackRevision:room.trackRevision});await host.until(m=>m.room?.phase==='countdown');
 if(real)await host.until(m=>m.room?.phase==='racing');else{f.advance(room.startAt-f.now());await delay(2);}assert.equal(room.phase,'racing');return{players,room,host};
}
const wireInput=(p,room,input,seq=++p.seq)=>({type:'input',matchId:room.matchId,trackRevision:room.trackRevision,seq,steer:input.steer,brake:input.brake,...(room.meridian?{driverGeneration:room.meridian.relayTeams.find(t=>t.memberIds.includes(p.id))?.generation}:{})});
const legalPitFixture=(room,team)=>{const p=room.players.get(team.driverId),t=room.track;p.car.placeAt(t,1);p.car.x-=t.tz[1]*4;p.car.z+=t.tx[1]*4;p.car.pos.lat=4;p.car.v=0;p.distance=Math.max(p.distance,team.stintStartDistance+t.length*.25);p.nextGate=1;p.summit.pitUntil=0;return p;};

if(!soakMode)await test(beforeMode?'修前：過早換棒後重新載入，合法低序號換棒被舊序號擋住（明示pit/time fixture）':'原席重載後新socket的換棒序號重新起算，退休socket與舊世代不得換棒（pit/time fixture）',()=>{const f=resumeFixture();try{
 if(beforeMode){assert.equal(f.seqAfterResume,50);assert.equal(f.team.driverId,f.original.id);assert.equal(f.team.handoffs,0);return{reproduced:true,retainedSequence:50,replacementSequence:1,legalHandoffIgnored:true};}
 assert.equal(f.seqAfterResume,-1);assert.notEqual(f.team.driverId,f.original.id);assert.equal(f.team.handoffs,1);const generation=f.team.generation;f.service.receive(f.retired,{type:'meridian-handoff',roomCode:f.room.code,matchId:f.room.matchId,trackRevision:f.room.trackRevision,driverGeneration:generation,seq:999});assert.equal(f.team.generation,generation);validateMeridianRacing(f.service.snapshot(f.room));return{replacementSequence:1,handoffs:1,retiredSocketIgnored:true};
 }finally{f.service.close();}});

if(!beforeMode&&!soakMode){
 await test('四人十分鐘耐久：真WS／真Car固定步、延後或略過控制、三次交棒與原席續接（加速authority及pit fixtures）',()=>withServer(async f=>{
  const {players,room}=await four(f,{relay:true}),start=room.startAt;let steps=0,dropped=0,delayed=0,handoffs=0,reconnected=0,maxQueued=0,maxRing=0,realMotionMetres=0,finishFixtures=0;const pending=[],closedTotals=[];let nextHandoff=160000;
  for(let elapsed=0;elapsed<=730000&&room.phase==='racing';elapsed+=100){
   for(let i=0;i<players.length;i++){const peer=players[i],p=room.players.get(peer.id),team=room.meridian.relayTeams.find(t=>t.memberIds.includes(peer.id));if(team.driverId!==p.id||p.dnf||p.finishMs!==null)continue;
    if(elapsed>0&&elapsed%1700===0){dropped++;continue;}const input=summitInput(p.car,room.track,team.team==='red'?-1:1,43);pending.push({at:f.now()+(i%2?180:80),peer,message:wireInput(peer,room,input)});delayed++;}
   for(let i=pending.length-1;i>=0;i--)if(pending[i].at<=f.now()){const q=pending.splice(i,1)[0];if(!q.peer.closed)q.peer.send(q.message);}
   maxQueued=Math.max(maxQueued,pending.length);await delay(1);const priorDistance=new Map(room.meridian.relayTeams.map(t=>{const p=room.players.get(t.driverId);return[p.id,p.distance];}));f.advance(100);steps+=6;for(const [id,distance]of priorDistance)realMotionMetres+=Math.max(0,room.players.get(id).distance-distance);
   if(elapsed===90000){const target=players[1],token=target.token,id=target.id;closedTotals.push({count:target.count,bytes:target.bytes});await target.close();await delay(2);const replacement=await f.open();const w=await replacement.request({...identity,type:'resume',code:room.code,playerId:id,token},m=>m.type==='welcome');replacement.id=w.playerId;replacement.token=w.resumeToken;replacement.seq=0;players[1]=replacement;replacement.send({type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});await replacement.until(m=>m.room?.players.find(p=>p.id===id)?.loaded);reconnected++;}
   if(elapsed>=nextHandoff&&nextHandoff<=480000){for(const team of room.meridian.relayTeams){const p=legalPitFixture(room,team),peer=players.find(c=>c.id===p.id),old=team.driverId,generation=team.generation;peer.send({type:'meridian-handoff',roomCode:room.code,matchId:room.matchId,trackRevision:room.trackRevision,driverGeneration:generation,seq:++peer.seq});await peer.until(m=>m.room?.meridian?.relayTeams.some(t=>t.team===team.team&&t.generation>generation));assert.notEqual(team.driverId,old);handoffs++;}nextHandoff+=160000;}
   // This controlled soak checks the full duration/driver accounting, not an AI's lap ability.
   // Explicitly move only the final approach; real Car steps still cross the authoritative finish gate.
   if(elapsed===605000)for(const team of room.meridian.relayTeams){const p=room.players.get(team.driverId),t=room.track,index=t.N-Math.ceil(45/t.ds);p.car.placeAt(t,index);p.car.v=15;p.distance=(p.completedLaps+1)*t.length-(t.length-p.car.pos.s);p.nextGate=3;finishFixtures++;}
   if(elapsed%10000===0){validateMeridianRacing(f.app.service.snapshot(room));for(const p of players){assert.equal(p.closed,false);assert.equal(p.error,null);maxRing=Math.max(maxRing,p.messages.length);}assert.equal(f.app.service.clients.size,4);assert.equal(room.players.size,4);}
  }
  assert.equal(room.phase,'results');assert.equal(room.meridian.complete,true);assert.equal(room.meridian.aborted,false);assert.equal(handoffs,6);assert.equal(reconnected,1);assert.ok(maxQueued<=24);assert.ok(maxRing<=32);assert.ok(realMotionMetres>100);assert.ok(room.meridian.relayTeams.every(t=>!t.dnf&&t.finishMs!==null));validateMeridianRacing(f.app.service.snapshot(room));
  return{authoritySeconds:(f.now()-start)/1000,approxRealFixedSteps:steps,realWS:true,realCar:true,pitPositionFixtures:6,finishApproachFixtures:finishFixtures,realForwardMotionMetres:Number(realMotionMetres.toFixed(3)),handoffs,shortReconnects:reconnected,delayedControlMessages:delayed,omittedControlMessages:dropped,maxScheduledControls:maxQueued,maxPeerMessageRing:maxRing,teamResults:room.meridian.relayTeams.map(t=>({team:t.team,handoffs:t.handoffs,dnf:t.dnf,finished:t.finishMs!==null,driveMs:t.driveMs})),note:'Accelerated ten-minute authority run with six pit and two final-approach pose fixtures; not ten wall-clock minutes or a full human-driven endurance race.'};
 }));
 await test('四人四十次大廳換圖，舊世代載圖／ready拒絕，房間與連線／track cache有界（真WS）',()=>withServer(async f=>{
  const players=[];for(let i=0;i<4;i++){const p=await f.open(),w=await p.request({...identity,type:i?'join':'create',name:`換圖${i}`,laps:3,trackId:'taipei',...(i?{code:players[0].latest.code}:{})},m=>m.type==='welcome');p.id=w.playerId;players.push(p);}const room=f.app.service.rooms.get(players[0].latest.code),tracks=MULTIPLAYER_TRACKS.map(t=>t.id);let staleRejected=0;
  for(let round=0;round<40;round++){const revision=room.trackRevision,oldId=room.trackId,oldStamp=room.trackStamp,id=tracks[(round+1)%tracks.length];players[0].send({type:'select-track',roomCode:room.code,trackId:id,expectedRevision:revision});await players[0].until(m=>m.room?.trackRevision>revision);for(const p of players){p.send({type:'track-loaded',trackId:oldId,trackStamp:oldStamp,trackRevision:revision});p.send({type:'ready',ready:true,trackRevision:revision,trackStamp:oldStamp});}await delay(2);assert.ok([...room.players.values()].every(p=>!p.loaded&&!p.ready));staleRejected+=8;for(const p of players)p.send({type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});await players[0].until(m=>m.room?.trackRevision===room.trackRevision&&m.room.players.every(p=>p.loaded));assert.equal(room.players.size,4);assert.equal(f.app.service.clients.size,4);assert.equal(f.app.service.rooms.size,1);assert.ok(f.app.service.trackCache.size<=tracks.length);f.advance(100);}
  return{switches:40,staleMessagesRejected:staleRejected,players:room.players.size,connections:f.app.service.clients.size,trackCache:f.app.service.trackCache.size,catalogSize:tracks.length,scope:'Server/transport and stale-generation state; does not claim browser GPU cleanup.'};
 }));
 await test('700ms控制停頓與主動背景煞車安全減速，慢socket關閉後清理（固定authority fixture）',()=>{let now=1795418000000;const s=new RoomService({now:()=>now}),a=s.accept(new Socket()),b=s.accept(new Socket());try{s.receive(a,{...identity,type:'create',name:'控制一',laps:5});s.receive(b,{...identity,type:'join',name:'控制二',code:a.room.code});const r=a.room;r.roomRules.collisions=false;for(const c of[a,b]){s.receive(c,{type:'track-loaded',trackId:r.trackId,trackStamp:r.trackStamp,trackRevision:r.trackRevision});s.receive(c,{type:'ready',ready:true,trackStamp:r.trackStamp,trackRevision:r.trackRevision});}s.receive(a,{type:'start',trackRevision:r.trackRevision});now=r.startAt;s.tick(now);a.player.car.v=20;s.receive(a,{type:'input',matchId:r.matchId,trackRevision:r.trackRevision,seq:1,steer:0,brake:false});for(let i=0;i<42;i++){now+=1000/60;s.tick(now);}const beforeStale=a.player.car.v;for(let i=0;i<14;i++){now+=1000/60;s.tick(now);}const staleSpeed=a.player.car.v;assert.ok(staleSpeed<beforeStale,JSON.stringify({beforeStale,staleSpeed}));s.receive(a,{type:'input',matchId:r.matchId,trackRevision:r.trackRevision,seq:2,steer:0,brake:true});for(let i=0;i<60;i++){now+=1000/60;s.tick(now);}const afterBrake=a.player.car.v;assert.ok(afterBrake<staleSpeed);a.ws.bufferedAmount=262145;s.send(a,{type:'snapshot',room:s.snapshot(r)});assert.equal(a.ws.readyState,3);assert.equal(s.clients.size,1);return{staleAfterMs:933,speedBeforeStale:beforeStale,speedAfterStale:staleSpeed,speedAfterBrake:afterBrake,slowSocketClosed:true,remainingConnections:s.clients.size};}finally{s.close();}});
}

if(soakMode)await test('四名真WS玩家120秒牆鐘持續駕駛、80～220ms延後／省略控制、背景停控與短續接（真Car）',()=>withServer(async f=>{
 const {players,room}=await four(f,{real:true}),began=performance.now(),samples=[],scheduled=new Set();let frames=0,sent=0,dropped=0,maxScheduled=0,maxBuffered=0,resumes=0,background=false;const lastSeq=new Map();let error=null,stopped=false;
 const pulse=setInterval(()=>{try{const elapsed=performance.now()-began;frames++;for(let i=0;i<players.length;i++){const peer=players[i];if(peer.closed||peer.ws.readyState!==1)continue;const p=room.players.get(peer.id);if(!p?.loaded||p.dnf||p.finishMs!==null)continue;
  if(i===1&&elapsed>=30000&&elapsed<32000){if(!background){peer.send(wireInput(peer,room,{steer:0,brake:true}));background=true;}continue;}
  if(frames%13===0){dropped++;continue;}const input=summitInput(p.car,room.track,(i%2?1:-1),43),message=wireInput(peer,room,input),latency=[0,80,150,220][i]+(frames%3)*5;
  const timer=setTimeout(()=>{scheduled.delete(timer);if(stopped||peer.closed||peer.ws.readyState!==1)return;peer.send(message);sent++;lastSeq.set(peer.id,message.seq);maxBuffered=Math.max(maxBuffered,peer.ws.bufferedAmount);},latency);scheduled.add(timer);maxScheduled=Math.max(maxScheduled,scheduled.size);
 }}catch(e){error=e;}},34);
 try{for(let sample=0;sample<12;sample++){await delay(10000);if(error)throw error;if(globalThis.gc)globalThis.gc();samples.push({wallSeconds:Number(((performance.now()-began)/1000).toFixed(3)),heapUsed:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss,clients:f.app.service.clients.size,rooms:f.app.service.rooms.size,peerMessages:players.map(p=>p.messages.length),phase:room.phase});assert.equal(room.phase,'racing');assert.equal(room.players.size,4);assert.equal(f.app.service.clients.size,4);assert.ok(players.every(p=>!p.error&&!p.closed&&p.messages.length<=32));assert.ok([...room.players.values()].every(p=>Number.isFinite(p.car.x)&&Number.isFinite(p.car.z)&&!p.dnf));
  if(sample===5){const old=players[2],id=old.id,token=old.token;await old.close();await delay(700);const replacement=await f.open(),w=await replacement.request({...identity,type:'resume',code:room.code,playerId:id,token},m=>m.type==='welcome');replacement.id=id;replacement.token=w.resumeToken;replacement.seq=Math.max(0,room.players.get(id).ackSeq);players[2]=replacement;replacement.send({type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});await replacement.until(m=>m.room?.players.find(p=>p.id===id)?.loaded);resumes++;}
  console.log(JSON.stringify({case:'wall-clock-soak',progressSeconds:samples.at(-1).wallSeconds,connections:f.app.service.clients.size}));
 }}finally{stopped=true;clearInterval(pulse);for(const timer of scheduled)clearTimeout(timer);scheduled.clear();}
 const wallMs=performance.now()-began;assert.ok(wallMs>=120000);assert.equal(resumes,1);assert.equal(background,true);assert.ok(maxScheduled<=40);assert.ok(maxBuffered<65536);assert.ok([...room.players.values()].every(p=>p.ackSeq>500));const steady=samples.slice(2).map(s=>s.heapUsed),heapGrowth=Math.max(...steady)-Math.min(...steady);assert.ok(heapGrowth<64*1024*1024,'GC-sampled retained heap grew beyond 64MiB in the bounded short soak');
 return{wallSeconds:Number((wallMs/1000).toFixed(3)),actualAuthoritySeconds:(f.now()-room.startAt)/1000,frames,sentControls:sent,omittedControls:dropped,backgroundControlPauseMs:2000,shortReconnects:resumes,maxScheduledControls:maxScheduled,maxBufferedBytes:maxBuffered,gcAvailable:!!globalThis.gc,steadyHeapRangeBytes:heapGrowth,samples,players:[...room.players.values()].map(p=>({slot:p.slot,ack:p.ackSeq,distance:p.distance,completedLaps:p.completedLaps})),note:'120-second local four-player transport/physics soak, not real mobile/public-network ten-minute endurance proof. Delay/drop is before WebSocket send; TCP reliability remains unchanged.'};
},{real:true}));

report.finishedAt=new Date().toISOString();report.sourceUnchangedDuringTests=JSON.stringify(report.sourceHashes)===JSON.stringify(await sourceHashes());report.scriptUnchangedDuringTests=report.scriptSha256===sha(await readFile(fileURLToPath(import.meta.url)));report.cleanupComplete=serversOpened===serversCleaned;report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.summary.FAIL&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests&&report.cleanupComplete?'PASS':'FAIL';report.evidence='tools/dev-tests/'+evidence;
await mkdir(path.join(directory,evidence));const receipt=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(directory,evidence,'report.json'),receipt);await writeFile(path.join(directory,name+'-result.json'),receipt);console.log(JSON.stringify({status:report.status,...report.summary,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;
