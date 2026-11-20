// Authoritative lap timing and additive-v2 parsing, with real Car gate crossings.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as roomRules from '../../shared/multiplayer-room-rules.ts';
import * as horizon from '../../shared/multiplayer-horizon.ts';
import * as arena from '../../shared/multiplayer-arena.ts';
import * as nexusReplay from '../../shared/nexus-replay.ts';
import * as summit from '../../shared/summit-racing.ts';
import * as atlas from '../../shared/atlas-racing.ts';

import * as protocol from '../../shared/multiplayer-protocol.ts';
import * as registry from '../../shared/multiplayer-tracks.ts';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const before=path.resolve(project,'../taipei-gp-raceplus-before-38335611f205');
const {RoomService,TICK_MS}=await import(pathToFileURL(path.join(project,'server/room-service.mjs')));
const BeforeService=(await import(pathToFileURL(path.join(before,'server/room-service.mjs')))).RoomService;
const identity={version:protocol.PROTOCOL_VERSION,physics:protocol.PHYSICS_VERSION,catalogStamp:registry.CATALOG_STAMP};
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['server/room-service.mjs','src/multiplayer-client.ts','src/multiplayer-ui.ts','shared/multiplayer-protocol.ts','server/physics.mjs'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(path.join(project,f)))])));
const initialHashes=await sourceHashes();
const report={createdAt:new Date().toISOString(),externalRequests:0,playerStorageTouched:false,cases:[],limitations:[
  'True RoomService/Car/track gate crossings, with isolated sockets and arranged test positions/times; not full human driving.',
  'Client and UI use isolated VM/DOM fixtures; browser/mobile/real network validation are separate.',
]};
async function check(name,exercise){try{report.cases.push({name,status:'PASS',details:await exercise()});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack??String(e)});}console.log(JSON.stringify(report.cases.at(-1)));}
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];send(t){this.messages.push(JSON.parse(t));}close(){this.readyState=3;this.emit('close');}}
function pair(Service=RoomService,laps=3){
  let now=1_000_000;const service=new Service({now:()=>now}),a=service.accept(new Socket()),b=service.accept(new Socket());
  service.receive(a,{type:'create',...identity,name:'甲',laps});const room=a.room;
  service.receive(b,{type:'join',...identity,name:'乙',code:room.code});
  for(const c of[a,b]){service.receive(c,{type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});service.receive(c,{type:'ready',ready:true,trackStamp:room.trackStamp,trackRevision:room.trackRevision});}
  service.receive(a,{type:'start',trackRevision:room.trackRevision});now=room.startAt;service.tick(now);
  assert.equal(room.phase,'racing');
  // Keep the second true car off the moving list so the arranged first-car gate is isolated.
  service.markDnf(b.player,'left');
  return{service,a,b,room,setNow:t=>{now=t;}};
}
function cross(h,gate,elapsed){
  const p=h.a.player,t=h.room.track,target=gate===3?t.length:gate*t.length/3;
  p.car.placeAt(t,Math.max(0,Math.floor(target/t.ds)-1));p.car.v=65;
  p.distance=p.completedLaps*t.length+p.car.pos.s;p.nextGate=gate;p.input={steer:0,brake:false};
  const before=p.completedLaps,expectedGate=gate===3?1:gate+1;
  let at=h.room.startAt+elapsed,steps=0;
  for(;steps<30;steps++,at+=TICK_MS){p.lastInputAt=at;h.service.simulate(h.room,at);if(p.nextGate===expectedGate&&(gate!==3||p.completedLaps>before))break;}
  assert.ok(steps<30,{gate,steps,s:p.car.pos.s});h.setNow(at);return at;
}
function lap(h,base){cross(h,1,base+15_000);cross(h,2,base+30_000);return cross(h,3,base+45_000);}
function clientClass(root){return readFile(path.join(root,'src/multiplayer-client.ts'),'utf8').then(source=>{
  const code=stripTypeScriptTypes(source,{mode:'transform'})
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-protocol['"];?/,'const {PROTOCOL_VERSION,PHYSICS_VERSION,validSeries,validSeriesTracks}=protocol;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-tracks['"];?/,'const {CATALOG_STAMP,DEFAULT_MULTIPLAYER_TRACK_ID,getMultiplayerTrack}=registry;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-room-rules['"];?/, 'const {parseRoomRules}=roomRules;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-horizon['"];?/, 'const {parseRoomPreset,parseHorizon,validateHorizonSnapshot}=horizon;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-arena['"];?/, 'const {validateArenaSnapshot}=arena;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/nexus-replay['"];?/, 'const {decodeMultiplayerReplay,validReplayDescriptor,REPLAY_MAX_CHARS,REPLAY_CHUNK_CHARS}=nexusReplay;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/summit-racing['"];?/, 'const {summitSettings,validateSummit}=summit;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/atlas-racing['"];?/, 'const {ATLAS_PIT_SERVICES,atlasSettings,validateAtlas}=atlas;')
    .replace('export class MultiplayerClient','class MultiplayerClient')+'\nglobalThis.Client=MultiplayerClient;';
  const context=vm.createContext({protocol,registry,roomRules,horizon,arena,nexusReplay,summit,atlas,URL,Date,performance,location:{protocol:'http:'}});vm.runInContext(code,context);return context.Client;
});}
const Client=await clientClass(project),BeforeClient=await clientClass(before);
const validate=(snapshot,Class=Client)=>new Class('ws://127.0.0.1:4320/ws').validateRoom(snapshot);

await check('before has no lap metadata; new server starts with a strict empty timing pair',()=>{
  const old=pair(BeforeService),h=pair(),a=old.service.snapshot(old.room),b=h.service.snapshot(h.room);
  assert.equal(a.players[0].lapTimesMs,undefined);assert.equal(a.players[0].bestLapMs,undefined);
  assert.deepEqual(b.players[0].lapTimesMs,[]);assert.equal(b.players[0].bestLapMs,null);
  validate(a);validate(b);validate(b,BeforeClient);
  return{legacyClientAndServerAccepted:true,protocol:protocol.PROTOCOL_VERSION};
});
await check('three real Car laps retain the original finish interpolation and car pose',()=>{
  const old=pair(BeforeService),h=pair();
  for(const base of[0,45_000,90_000]){lap(old,base);lap(h,base);}
  const p=h.a.player;assert.equal(p.finishMs,old.a.player.finishMs);assert.deepEqual(p.car.snapshot(),old.a.player.car.snapshot());
  assert.equal(p.lapTimesMs.length,3);assert.ok(p.lapTimesMs.every(ms=>ms>44_000&&ms<46_000));
  assert.equal(p.lapTimesMs.reduce((a,b)=>a+b,0),p.finishMs);assert.equal(p.bestLapMs,Math.min(...p.lapTimesMs));
  const snapshot=h.service.snapshot(h.room);validate(snapshot);const player=snapshot.players.find(x=>x.id===p.id);
  assert.ok(Math.abs(player.lapTimesMs.reduce((a,b)=>a+b,0)-player.finishMs)<.003);
  return{finishBefore:old.a.player.finishMs,finishAfter:p.finishMs,lapTimesMs:player.lapTimesMs,physicsUnchanged:true};
});
await check('one- and five-lap rooms finish at exactly their configured lap count',()=>{
  const results=[];
  for(const count of[1,5]){
    const h=pair(RoomService,count),old=pair(BeforeService,count);
    for(let i=0;i<count;i++){lap(h,i*45_000);lap(old,i*45_000);if(i<count-1)assert.equal(h.a.player.finishMs,null);}
    assert.equal(h.a.player.finishMs,old.a.player.finishMs);assert.equal(h.a.player.lapTimesMs.length,count);
    const snapshot=h.service.snapshot(h.room);validate(snapshot);
    assert.equal(snapshot.players.find(p=>p.id===h.a.player.id).lapTimesMs.length,count);
    results.push({laps:count,finishMs:h.a.player.finishMs});
  }
  return results;
});
await check('unfinished third lap and reverse/recross cannot fabricate completed lap records',()=>{
  const h=pair();lap(h,0);cross(h,1,55_000);const p=h.a.player,saved=[...p.lapTimesMs];
  // An already-passed gate cannot be re-counted by a repeated positive segment.
  p.car.placeAt(h.room.track,Math.floor(h.room.track.N/3));p.car.v=-15;p.input={steer:0,brake:false};p.lastInputAt=h.room.startAt+56_000;
  h.service.simulate(h.room,h.room.startAt+56_000);assert.deepEqual(p.lapTimesMs,saved);assert.equal(p.completedLaps,1);
  h.service.markDnf(p,'finish-timeout');const snapshot=h.service.snapshot(h.room);validate(snapshot);
  assert.equal(snapshot.players.find(x=>x.id===p.id).lapTimesMs.length,1);assert.equal(p.finishMs,null);
});
await check('DNF/disconnect and finished leave preserve completed timing; reset and map change clear it',()=>{
  const h=pair();lap(h,0);const p=h.a.player,times=[...p.lapTimesMs];h.service.disconnect(h.a);h.service.expireDisconnected(h.room,h.room.startAt+60_000);
  assert.deepEqual(p.lapTimesMs,times);assert.equal(p.dnf,true);validate(h.service.snapshot(h.room));
  const finished=pair();for(const base of[0,45_000,90_000])lap(finished,base);const done=finished.a.player,valid=[...done.lapTimesMs];
  finished.service.leave(finished.a,finished.room.startAt+140_000);assert.equal(done.dnf,false);assert.deepEqual(done.lapTimesMs,valid);
  const reset=pair();lap(reset,0);reset.service.toLobby(reset.room,reset.room.startAt+50_000);
  for(const player of reset.room.players.values()){assert.deepEqual(player.lapTimesMs,[]);assert.equal(player.bestLapMs,null);assert.equal(player.lastLapElapsedMs,0);}
  reset.service.receive(reset.a,{type:'select-track',trackId:'austria',expectedRevision:reset.room.trackRevision});
  assert.equal(reset.room.trackId,'austria');validate(reset.service.snapshot(reset.room));
  assert.ok([...reset.room.players.values()].every(p=>p.lapTimesMs.length===0&&p.bestLapMs===null));
});
await check('client-provided lap/result fields are ignored and snapshots do not expose mutable arrays',()=>{
  const h=pair(),p=h.a.player;h.service.receive(h.a,{type:'input',matchId:h.room.matchId,trackRevision:h.room.trackRevision,seq:0,steer:0,brake:true,lapTimesMs:[1,1,1],bestLapMs:1,finishMs:3,completedLaps:3});
  assert.equal(p.completedLaps,0);assert.deepEqual(p.lapTimesMs,[]);assert.equal(p.bestLapMs,null);assert.equal(p.finishMs,null);
  lap(h,0);const snapshot=h.service.snapshot(h.room),record=snapshot.players.find(x=>x.id===p.id);record.lapTimesMs[0]=1;
  assert.notEqual(p.lapTimesMs[0],1);validate(h.service.snapshot(h.room));
});
await check('new client strictly rejects partial, malformed, oversized and contradictory timing metadata',()=>{
  const h=pair();lap(h,0);const snapshot=h.service.snapshot(h.room),id=h.a.player.id;
  const corrupt=[
    p=>delete p.bestLapMs,p=>delete p.lapTimesMs,p=>p.lapTimesMs=null,p=>p.lapTimesMs='45000',
    p=>p.lapTimesMs=[],p=>p.lapTimesMs=[-1],p=>p.lapTimesMs=[0],p=>p.lapTimesMs=[NaN],p=>p.lapTimesMs=[Infinity],
    p=>p.lapTimesMs=['45000'],p=>p.lapTimesMs=[null],p=>p.lapTimesMs=[[]],p=>p.lapTimesMs=new Array(1),
    p=>p.lapTimesMs=[86_400_001],p=>p.bestLapMs=null,p=>p.bestLapMs=[p.bestLapMs],p=>p.bestLapMs='45000',p=>p.bestLapMs=NaN,
    p=>p.bestLapMs+=1,p=>p.completedLaps=1.5,p=>p.completedLaps=4,p=>{p.completedLaps=6;p.lapTimesMs=Array(6).fill(1);p.bestLapMs=1;},
    p=>p.finishMs=45_000,
  ];
  for(const edit of corrupt){const bad=structuredClone(snapshot),p=bad.players.find(p=>p.id===id);edit(p);assert.throws(()=>validate(bad),/逐圈/);validate(bad,BeforeClient);}
  const legacy=structuredClone(snapshot);for(const p of legacy.players){delete p.lapTimesMs;delete p.bestLapMs;}validate(legacy);
  const completed=pair();for(const base of[0,45_000,90_000])lap(completed,base);
  const final=completed.service.snapshot(completed.room),player=final.players.find(p=>p.id===completed.a.player.id);
  player.finishMs+=1;assert.throws(()=>validate(final),/逐圈/);player.finishMs-=1;player.finishMs=null;assert.throws(()=>validate(final),/逐圈/);
  const lobby=structuredClone(snapshot);lobby.phase='lobby';lobby.startAt=null;lobby.matchId=null;lobby.deadlineAt=null;lobby.deadlineReason=null;
  assert.throws(()=>validate(lobby),/逐圈/);
  return{malformedPlayerCases:corrupt.length,legacyNoMetadataAccepted:true};
});

function uiEnvironment(root=project){
  return readFile(path.join(root,'src/multiplayer-ui.ts'),'utf8').then(source=>{
    const metrics={created:0,writes:0};class Element{children=[];dataset={};style={};parentNode=null;_text='';
      get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set textContent(v){metrics.writes++;this._text=String(v);this.children=[];}
      append(...nodes){for(const n of nodes)this.insertBefore(n,null);}insertBefore(n,a){n.remove();const i=a===null?this.children.length:this.children.indexOf(a);assert.ok(i>=0);this.children.splice(i,0,n);n.parentNode=this;return n;}
      remove(){if(this.parentNode){const p=this.parentNode;p.children.splice(p.children.indexOf(this),1);this.parentNode=null;}}}
    const context=vm.createContext({document:{createElement:()=>{metrics.created++;return new Element();}}});
    const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[^\n]*\r?\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(code+'\nglobalThis.ui={MultiplayerPlayerList,MultiplayerLapList:typeof MultiplayerLapList===\'undefined\'?null:MultiplayerLapList,lapSummaryText:typeof lapSummaryText===\'undefined\'?null:lapSummaryText,finishGapText:typeof finishGapText===\'undefined\'?null:finishGapText};',context);
    return{...context.ui,Element,metrics};
  });
}
function resultRoom(){const player=(id,finishMs,lapTimesMs,dnf=false)=>({id,name:id==='a'?'<img src=x>':'乙',color:'#ff3300',rank:id==='a'?1:2,completedLaps:lapTimesMs.length,lapTimesMs,bestLapMs:Math.min(...lapTimesMs),finishMs,dnf,dnfReason:dnf?'finish-timeout':null,ready:false,loaded:true,connected:true});return{code:'ABC234',matchId:'match',trackId:'taipei',trackRevision:1,laps:3,phase:'results',players:[player('a',135_000,[45_000,46_000,44_000]),player('b',137_500,[47_000,45_000,45_500]) ]};}
await check('result rows add best lap and winner gap, retain total time, and never assign DNF a gap',async()=>{
  const current=await uiEnvironment(),old=await uiEnvironment(before),room=resultRoom();
  const a=new current.Element(),b=new old.Element();new current.MultiplayerPlayerList(a,'results').update(room,'a');new old.MultiplayerPlayerList(b,'results').update(room,'a');
  assert.ok(a.textContent.includes('最快 0:44.000'));assert.ok(a.textContent.includes('落後冠軍 +2.500 秒'));assert.ok(a.textContent.includes('2:17.500'));
  assert.ok(!b.textContent.includes('最快'));assert.ok(!b.textContent.includes('冠軍'));assert.ok(a.textContent.includes('<img src=x>'));
  room.players[1].dnf=true;room.players[1].finishMs=null;room.players[1].dnfReason='finish-timeout';
  const c=new current.Element();new current.MultiplayerPlayerList(c,'results').update(room,'a');assert.ok(c.children[1].textContent.includes('超過完賽期限'));assert.ok(!c.children[1].textContent.includes('冠軍'));
  assert.equal(current.finishGapText(room,room.players[0]),'冠軍');assert.equal(current.finishGapText(room,room.players[1]),'');
});
await check('keyed lap rows update selected drivers, mark best laps and skip unchanged writes',async()=>{
  const env=await uiEnvironment(),element=new env.Element(),list=new env.MultiplayerLapList(element),room=resultRoom();
  list.update(room,'a');assert.equal(element.children.length,3);const rows=[...element.children];assert.equal(rows[2].dataset.fastest,'true');
  assert.ok(element.textContent.includes('較上圈快 2.000 秒'));assert.ok(env.lapSummaryText(room,'a').includes('第 3 圈 0:44.000'));
  env.metrics.created=env.metrics.writes=0;for(let i=0;i<20;i++)list.update(structuredClone(room),'a');assert.deepEqual(env.metrics,{created:0,writes:0});
  list.update(room,'b');assert.deepEqual(element.children,rows);assert.equal(element.children[1].dataset.fastest,'true');assert.equal(env.metrics.created,0);
  room.players[1].lapTimesMs=[47_000];room.players[1].bestLapMs=47_000;list.update(room,'b');assert.equal(element.children.length,1);
  room.phase='lobby';list.update(room,'b');assert.equal(element.children.length,0);list.clear();assert.equal(element.children.length,0);
  delete room.players[0].lapTimesMs;delete room.players[0].bestLapMs;assert.equal(env.lapSummaryText(room,'a'),'伺服器未提供逐圈成績');
  list.update(null,null);assert.equal(element.children.length,0);
  return{stableSnapshots:20,created:0,unchangedWrites:0,driverSwitchReusesRows:true};
});

report.sourceHashes=await sourceHashes();report.sourceUnchanged=JSON.stringify(initialHashes)===JSON.stringify(report.sourceHashes);
report.summary={passed:report.cases.filter(x=>x.status==='PASS').length,failed:report.cases.filter(x=>x.status==='FAIL').length};
report.status=report.summary.failed===0&&report.sourceUnchanged?'PASS':'FAIL';
await writeFile(path.join(project,'tools/dev-tests/raceplus-laps-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,...report.summary,sourceUnchanged:report.sourceUnchanged}));if(report.status!=='PASS')process.exitCode=1;
