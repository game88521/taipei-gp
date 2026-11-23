// Rex <game88521@gmail.com>
// Derived from the frozen beacon-multiplayer-node.mjs loopback soak helpers.
// This independent run measures ten real wall-clock minutes, with no time fast-forward.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {WebSocket} from '../../server/node_modules/ws/wrapper.mjs';
import {createMultiplayerServer} from '../../server/index.mjs';
import {summitInput} from '../../server/summit-racing-service.mjs';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../../shared/multiplayer-protocol.ts';
import {FRONTIER_CUP_VERSION,AURORA_CUP_VERSION} from '../../shared/frontier-cup.ts';
import {validateMeridianRacing} from '../../shared/meridian-racing.ts';

assert.equal(process.argv.length,2,'This bounded test has no shortened mode.');
assert.equal(typeof globalThis.gc,'function','Run with node --expose-gc --experimental-transform-types.');
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.dirname(fileURLToPath(import.meta.url));
const name='beacon-multiplayer-long-soak';
const evidence=`${name}-evidence-${Date.now()}-${randomBytes(3).toString('hex')}`;
const ORIGIN='http://127.0.0.1:4317';
const sources=['server/room-service.mjs','server/meridian-racing-service.mjs','server/index.mjs','server/physics.mjs','server/summit-racing-service.mjs','src/multiplayer-client.ts','src/multiplayer-network.ts','src/multiplayer-scene.ts','shared/meridian-racing.ts','src/car.ts','src/track.ts','src/rivals.ts','src/pitlane.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,sha(await readFile(path.join(root,p)))])));
const report={startedAt:new Date().toISOString(),status:'RUNNING',transport:'real loopback WebSocket; 600 real wall-clock racing seconds; real Car',externalRequests:[],cases:[],limitations:[
 'Four connected seats, two active cars in a 600-second Meridian endurance relay. The two teammates take turns driving.',
 'Six handoff pit-position fixtures isolate legal handoff accounting. No authority clock fast-forward and no finish-position fixture.',
 'Control delay and omission are application scheduling before WebSocket send, not actual TCP packet loss.',
 'No physical phone, public network, human driving or Render/free-host capacity validation.',
 'A PASS establishes bounded local stability. Normal race completion is reported separately and is not required at exactly ten minutes.'
]};
report.sourceHashes=await sourceHashes();
const scriptBytes=await readFile(fileURLToPath(import.meta.url));report.scriptSha256=sha(scriptBytes);
const identity={version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,clientCapabilities:{meridianRacing:true,roomRules:true,evolution:true,horizon:true,nexusArena:true,summit:true,atlasRacing:true,voyagerRacing:true,odysseyRacing:true,expeditionRacing:true,frontierCup:FRONTIER_CUP_VERSION,auroraCup:AURORA_CUP_VERSION}};

class Peer {
 constructor(url){this.ws=new WebSocket(url,{origin:ORIGIN});this.messages=[];this.waiters=new Set();this.error=null;this.closed=false;this.count=0;this.bytes=0;this.seq=0;this.latest=null;
  this.ws.on('error',e=>{this.error=e;});
  this.ws.on('close',()=>{this.closed=true;for(const w of this.waiters){clearTimeout(w.timer);w.reject(Error('socket closed'));}this.waiters.clear();});
  this.ws.on('message',raw=>{const m=JSON.parse(raw.toString());this.count++;this.bytes+=raw.length;this.messages.push(m);if(this.messages.length>32)this.messages.shift();if(m.room)this.latest=m.room;for(const w of [...this.waiters])if(w.fn(m)){clearTimeout(w.timer);this.waiters.delete(w);w.resolve(m);}});
 }
 async open(){if(this.ws.readyState===1)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('open timeout')),3000);this.ws.once('open',()=>{clearTimeout(timer);resolve();});this.ws.once('error',e=>{clearTimeout(timer);reject(e);});});}
 until(fn){const old=this.messages.findLast(fn);if(old)return Promise.resolve(old);return new Promise((resolve,reject)=>{const w={fn,resolve,reject,timer:null};w.timer=setTimeout(()=>{this.waiters.delete(w);reject(Error('message timeout: '+JSON.stringify(this.messages.slice(-2).map(m=>({type:m.type,code:m.code,phase:m.room?.phase})))));},5000);this.waiters.add(w);});}
 send(m){assert.equal(this.ws.readyState,1);this.ws.send(JSON.stringify(m));}
 async request(m,fn){const pending=this.until(fn);this.send(m);return pending;}
 async close(){if(this.ws.readyState===3)return;await new Promise(resolve=>{const timer=setTimeout(()=>{this.ws.terminate();resolve();},1000);this.ws.once('close',()=>{clearTimeout(timer);resolve();});this.ws.close();});}
}

let app=null;const allPeers=[],scheduled=new Set();let pulse=null,stopped=false;
const metrics={samples:[],reconnects:[],backgroundPauses:[],handoffs:[],frames:0,sentControls:0,omittedControls:0,maxScheduledControls:0,maxBufferedBytes:0,maxPeerMessageRing:0,pitPositionFixtures:0,finishPositionFixtures:0};
report.metrics=metrics;
let cleanupComplete=false;
try {
 app=createMultiplayerServer({prewarmCityRace:false,autoTick:true,allowedOrigins:[ORIGIN],roomOptions:{emptyRoomMs:1000,idleRoomMs:1800000}});
 await new Promise((resolve,reject)=>{app.httpServer.once('error',reject);app.httpServer.listen(0,'127.0.0.1',resolve);});
 const url=`ws://127.0.0.1:${app.httpServer.address().port}/ws`;
 const open=async()=>{const p=new Peer(url);allPeers.push(p);await p.open();return p;};
 const players=[];
 for(let i=0;i<4;i++){const p=await open(),w=await p.request({...identity,type:i?'join':'create',name:`長測${i}`,laps:5,trackId:'taipei',...(i?{code:players[0].latest.code}:{})},m=>m.type==='welcome');p.id=w.playerId;p.token=w.resumeToken;players.push(p);}
 const room=app.service.rooms.get(players[0].latest.code),host=players[0];
 await host.request({type:'set-room-rules',roomCode:room.code,expectedLobbyRevision:room.lobbyRevision,roomRules:{collisions:false,finishGraceSeconds:120}},m=>m.type==='room'&&m.room.roomRules.collisions===false);
 await host.request({type:'set-meridian',roomCode:room.code,expectedLobbyRevision:room.lobbyRevision,settings:{mode:'relay-endurance',durationSeconds:600,handoffsRequired:2}},m=>m.room?.meridian?.settings.mode==='relay-endurance');
 for(const p of players){p.send({type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});p.send({type:'ready',ready:true,trackRevision:room.trackRevision,trackStamp:room.trackStamp,meridianRevision:room.meridian.revision,lobbyRevision:room.lobbyRevision});}
 await host.until(m=>m.room?.players.every(p=>p.ready));host.send({type:'start',trackRevision:room.trackRevision});await host.until(m=>m.room?.phase==='racing');assert.equal(room.phase,'racing');
 const began=performance.now();let pulseError=null,handoffBusy=false;
 const pauses=[{at:90000,end:93000,team:'blue'},{at:390000,end:393000,team:'red'}];
 const input=(peer,p,data)=>({type:'input',matchId:room.matchId,trackRevision:room.trackRevision,seq:++peer.seq,steer:data.steer,brake:data.brake,driverGeneration:room.meridian.relayTeams.find(t=>t.memberIds.includes(p.id)).generation});
 pulse=setInterval(()=>{try{const elapsed=performance.now()-began;metrics.frames++;if(handoffBusy||room.phase!=='racing')return;
  for(let i=0;i<players.length;i++){const peer=players[i],p=room.players.get(peer.id),team=room.meridian.relayTeams.find(t=>t.memberIds.includes(peer.id));if(peer.closed||peer.ws.readyState!==1||!p?.loaded||p.dnf||p.finishMs!==null||team.driverId!==peer.id)continue;
   const pause=pauses.find(pause=>pause.team===team.team&&elapsed>=pause.at&&elapsed<pause.end);
   if(pause){if(!pause.started){pause.started=elapsed;pause.player=peer.id;peer.send(input(peer,p,{steer:0,brake:true}));}continue;}
   if(metrics.frames%13===0){metrics.omittedControls++;continue;}
   const control=input(peer,p,summitInput(p.car,room.track,team.team==='red'?-1:1,43)),latency=[0,80,150,220][i]+metrics.frames%3*5;
   const timer=setTimeout(()=>{scheduled.delete(timer);if(stopped||peer.closed||peer.ws.readyState!==1)return;try{peer.send(control);metrics.sentControls++;metrics.maxBufferedBytes=Math.max(metrics.maxBufferedBytes,peer.ws.bufferedAmount);}catch(e){pulseError=e;}},latency);scheduled.add(timer);metrics.maxScheduledControls=Math.max(metrics.maxScheduledControls,scheduled.size);
  }
  for(const pause of pauses)if(pause.started&&!pause.ended&&elapsed>=pause.end){pause.ended=elapsed;metrics.backgroundPauses.push({team:pause.team,playerId:pause.player,startMs:pause.started,endMs:pause.ended,wallMs:pause.ended-pause.started});}
 }catch(e){pulseError=e;}},34);
 const reconnect=async index=>{const old=players[index],id=old.id,token=old.token,at=performance.now();await old.close();await delay(700);const peer=await open(),w=await peer.request({...identity,type:'resume',code:room.code,playerId:id,token},m=>m.type==='welcome');assert.equal(w.playerId,id);peer.id=id;peer.token=w.resumeToken;peer.seq=Math.max(0,room.players.get(id).ackSeq);players[index]=peer;peer.send({type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});await peer.until(m=>m.room?.players.find(p=>p.id===id)?.loaded);metrics.reconnects.push({slot:index,wallSeconds:(performance.now()-began)/1000,interruptionMs:performance.now()-at,retiredSocketClosed:old.closed,meridianSeqAfterResume:room.players.get(id).meridianSeq});};
 const handoff=async()=>{handoffBusy=true;try{for(const team of room.meridian.relayTeams){const p=room.players.get(team.driverId),peer=players.find(p=>p.id===team.driverId),track=room.track,generation=team.generation,old=team.driverId;
   // Explicit legal-pit fixture only. Time and accumulated distance remain real.
   assert.ok(Date.now()-team.stintStartedAt>=20000);assert.ok(p.distance-team.stintStartDistance>=track.length*.2);
   p.car.placeAt(track,1);p.car.x-=track.tz[1]*4;p.car.z+=track.tx[1]*4;p.car.pos.lat=4;p.car.v=0;p.summit.pitUntil=0;metrics.pitPositionFixtures++;
   peer.send({type:'meridian-handoff',roomCode:room.code,matchId:room.matchId,trackRevision:room.trackRevision,driverGeneration:generation,seq:++peer.seq});await peer.until(m=>m.room?.meridian?.relayTeams.some(t=>t.team===team.team&&t.generation>generation));assert.notEqual(team.driverId,old);metrics.handoffs.push({team:team.team,generation:team.generation,wallSeconds:(performance.now()-began)/1000});
  }}finally{handoffBusy=false;}};
 for(let sample=1;sample<=20;sample++){
  await delay(Math.max(1,sample*30000-(performance.now()-began)));if(pulseError)throw pulseError;
  if([5,10,15].includes(sample))await handoff();
  if(sample===6)await reconnect(2);if(sample===14)await reconnect(0);
  globalThis.gc();const elapsed=performance.now()-began,memory=process.memoryUsage();
  const snapshot=app.service.snapshot(room);validateMeridianRacing(snapshot);
  metrics.maxPeerMessageRing=Math.max(metrics.maxPeerMessageRing,...players.map(p=>p.messages.length));
  metrics.samples.push({wallSeconds:+(elapsed/1000).toFixed(3),authoritySeconds:(Date.now()-room.startAt)/1000,heapUsed:memory.heapUsed,rss:memory.rss,clients:app.service.clients.size,rooms:app.service.rooms.size,peerMessages:players.map(p=>p.messages.length),queuedControls:scheduled.size,phase:room.phase,players:[...room.players.values()].map(p=>({slot:p.slot,ack:p.ackSeq,completedLaps:p.completedLaps,distance:p.distance,dnf:p.dnf,finishMs:p.finishMs})),teams:room.meridian.relayTeams.map(t=>({team:t.team,handoffs:t.handoffs,driveMs:{...t.driveMs}}))});
  console.log(JSON.stringify({case:'ten-minute-wall-clock-relay',progressSeconds:metrics.samples.at(-1).wallSeconds,connections:app.service.clients.size,phase:room.phase,heapUsed:memory.heapUsed,scheduledControls:scheduled.size}));
  assert.ok(room.phase==='racing'||sample===20&&room.phase==='results');assert.equal(room.players.size,4);assert.equal(app.service.clients.size,4);assert.equal(app.service.rooms.size,1);assert.ok(players.every(p=>!p.error&&!p.closed&&p.messages.length<=32));assert.ok([...room.players.values()].every(p=>Number.isFinite(p.car.x)&&Number.isFinite(p.car.z)&&!p.dnf));assert.ok(scheduled.size<=40);
 }
 metrics.wallSeconds=+( (performance.now()-began)/1000).toFixed(3);metrics.actualAuthoritySeconds=(Date.now()-room.startAt)/1000;
 metrics.steadyHeapRangeBytes=Math.max(...metrics.samples.slice(2).map(s=>s.heapUsed))-Math.min(...metrics.samples.slice(2).map(s=>s.heapUsed));
 metrics.finalPhase=room.phase;metrics.normalRaceComplete=room.phase==='results'&&room.meridian.complete&&!room.meridian.aborted&&room.meridian.relayTeams.every(t=>!t.dnf&&t.finishMs!==null);
 metrics.finalTeams=room.meridian.relayTeams.map(t=>({team:t.team,handoffs:t.handoffs,completedLaps:t.completedLaps,dnf:t.dnf,finishMs:t.finishMs,driveMs:{...t.driveMs}}));metrics.peerTotals=allPeers.map(p=>({id:p.id,messages:p.count,bytes:p.bytes,retired:p.closed}));
 assert.ok(metrics.wallSeconds>=600);assert.equal(metrics.reconnects.length,2);assert.equal(metrics.backgroundPauses.length,2);assert.equal(metrics.handoffs.length,6);assert.equal(metrics.pitPositionFixtures,6);assert.ok(metrics.maxScheduledControls<=40);assert.ok(metrics.maxBufferedBytes<65536);assert.ok(metrics.steadyHeapRangeBytes<64*1024*1024,'GC-sampled retained heap range exceeded 64MiB.');assert.ok(room.meridian.relayTeams.every(t=>t.memberIds.every(id=>t.driveMs[id]>=30000)));assert.ok([...room.players.values()].every(p=>p.ackSeq>1000));
 report.cases.push({name:'四席兩車真牆鐘十分鐘耐久、兩次續接與背景停控、六次明示pit交棒',status:'PASS'});
} catch(error){report.cases.push({name:'四席兩車真牆鐘十分鐘耐久',status:'FAIL',error:String(error.stack)});}
finally{stopped=true;if(pulse)clearInterval(pulse);for(const timer of scheduled)clearTimeout(timer);scheduled.clear();try{await Promise.all(allPeers.map(p=>p.close()));if(app)await app.close();cleanupComplete=!!app&&app.service.clients.size===0&&app.service.rooms.size===0&&app.wss.clients.size===0;report.cleanup={clients:app?.service.clients.size,rooms:app?.service.rooms.size,webSockets:app?.wss.clients.size,scheduledControls:scheduled.size,allPeersClosed:allPeers.every(p=>p.closed)};if(!cleanupComplete)throw Error('Local server cleanup incomplete.');}catch(error){report.cases.push({name:'清理本次loopback資源',status:'FAIL',error:String(error.stack)});}}
report.finishedAt=new Date().toISOString();report.sourceUnchangedDuringTests=JSON.stringify(report.sourceHashes)===JSON.stringify(await sourceHashes());report.scriptUnchangedDuringTests=report.scriptSha256===sha(await readFile(fileURLToPath(import.meta.url)));report.cleanupComplete=cleanupComplete;
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.summary.FAIL&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests&&cleanupComplete?'PASS':'FAIL';report.evidence='tools/dev-tests/'+evidence;
await mkdir(path.join(directory,evidence));const receipt=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(directory,evidence,'script.mjs'),scriptBytes);await writeFile(path.join(directory,evidence,'report.json'),receipt);await writeFile(path.join(directory,name+'-result.json'),receipt);console.log(JSON.stringify({status:report.status,...report.summary,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;
