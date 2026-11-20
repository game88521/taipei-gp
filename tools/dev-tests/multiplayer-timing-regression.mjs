// Controlled authoritative timing fixtures; no network or physics changes.
// Rex <game88521@gmail.com>
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {RoomService} from '../../server/room-service.mjs';
import * as protocol from '../../shared/multiplayer-protocol.ts';
import * as registry from '../../shared/multiplayer-tracks.ts';
import * as rules from '../../shared/multiplayer-room-rules.ts';
import * as horizon from '../../shared/multiplayer-horizon.ts';
import * as replay from '../../shared/nexus-replay.ts';
import * as arena from '../../shared/multiplayer-arena.ts';
import * as summit from '../../shared/summit-racing.ts';
import * as atlas from '../../shared/atlas-racing.ts';
import {MultiplayerHistory,parseHistory} from '../../src/multiplayer-history.ts';

const deps={'../shared/multiplayer-protocol':protocol,'../shared/multiplayer-tracks':registry,
  '../shared/multiplayer-room-rules':rules,'../shared/multiplayer-horizon':horizon,
  '../shared/nexus-replay':replay,'../shared/multiplayer-arena':arena,
  '../shared/summit-racing':summit,'../shared/atlas-racing':atlas};
const source=await readFile(new URL('../../src/multiplayer-client.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source,{mode:'transform'})
  .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g,(_,names,path)=>{
    assert.ok(deps[path],path);return `const {${names}}=deps[${JSON.stringify(path)}];`;
  }).replace('export class MultiplayerClient','class MultiplayerClient')
  +'\nglobalThis.Client=MultiplayerClient';
const context=vm.createContext({deps,URL,Error,performance,Date,WebSocket:{OPEN:1},console,
  setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(code,context);
const client=new context.Client('ws://127.0.0.1:4320/ws');

function fixture({laps=13,lapMs=49000.00049,endurance=600,mode='race',delay=0}={}){
  const service=new RoomService({now:()=>1e6}),selected=service.trackFor('austria');
  const room={code:'ABC234',hostId:'',phase:'lobby',matchId:null,startAt:null,laps:3,
    lobbyRevision:1,removedPlayerIds:new Set(),series:null,roomRules:{...rules.DEFAULT_ROOM_RULES},
    evolution:{mode,durationSeconds:180,releaseDelays:{},teams:{},vote:{revision:1,ballots:{}}},
    horizon:horizon.defaultHorizon(),arena:arena.defaultArena(),spectators:new Map(),trackId:'austria',
    trackStamp:selected.descriptor.trackStamp,trackRevision:1,track:selected.track,players:new Map(),
    createdAt:1e6,updatedAt:1e6,emptySince:null,simAt:null,lastSnapshotAt:1e6,firstFinishAt:null};
  for(let i=0;i<2;i++){
    const p=service.makePlayer(room,`Driver${i+1}`,{clientCapabilities:{roomRules:true,evolution:true,
      horizon:true,nexusArena:true,summit:true}},1e6);
    room.players.set(p.id,p);room.hostId||=p.id;
  }
  service.snapshot(room);
  room.summit.settings.endurance=endurance;room.phase='results';room.matchId='precision-fixture';room.startAt=1e6;
  for(const p of room.players.values()){
    p.completedLaps=laps;p.lapTimesMs=Array.from({length:laps},()=>lapMs);p.bestLapMs=lapMs;
    p.finishMs=p.lapTimesMs.reduce((a,b)=>a+b,0)+delay*1000;
    if(mode==='pursuit')room.evolution.releaseDelays[p.id]=delay;
  }
  return service.snapshot(room,1720000);
}

const cases=[];
function test(name,fn){try{const details=fn();cases.push({name,status:'PASS',details});}
  catch(error){cases.push({name,status:'FAIL',error:String(error.stack)});}
  console.log(JSON.stringify(cases.at(-1)));}
const clone=value=>structuredClone(value);

test('13 independently rounded authoritative laps remain connected and retain results',()=>{
  const room=fixture(),p=room.players[0],sum=p.lapTimesMs.reduce((a,b)=>a+b,0);
  assert.equal(p.finishMs,637000.006);assert.equal(sum,637000);
  client.validateRoom(room);
  const history=new MultiplayerHistory(null);assert.equal(history.capture(room,p.id),true,history.error);
  assert.ok(parseHistory(history.export()));
  return {laps:p.completedLaps,finishMs:p.finishMs,lapSumMs:sum,roundingDifferenceMs:p.finishMs-sum};
});
test('128-lap boundary accepts accumulated rounding and rejects excess tolerance',()=>{
  const room=fixture({laps:128,lapMs:5000.00049});client.validateRoom(room);
  const changed=clone(room);changed.players[0].finishMs+=.01;
  assert.throws(()=>client.validateRoom(changed));
  return {laps:128,differenceMs:room.players[0].finishMs-room.players[0].lapTimesMs.reduce((a,b)=>a+b,0)};
});
test('invalid total, unfinished driver, excessive lap count and non-finite timings stay rejected',()=>{
  const good=fixture();
  const changes=[
    r=>r.players[0].finishMs+=.002,
    r=>r.players[0].finishMs+=1000,
    r=>r.players[0].finishMs=0,
    r=>r.players[0].finishMs=-1,
    r=>r.players[0].finishMs=Infinity,
    r=>r.players[0].finishMs=600000-1,
    r=>r.players[0].finishMs=720000+1,
    r=>r.players[0].lapTimesMs[0]=-1,
    r=>r.players[0].lapTimesMs[0]=NaN,
    r=>r.players[0].lapTimesMs[0]=Infinity,
    r=>r.players[0].lapTimesMs[0]+=10,
    r=>r.players[0].bestLapMs+=1,
    r=>r.players[0].completedLaps=129,
    r=>r.players[0].lapTimesMs.push(49000),
    r=>{r.players[0].dnf=true;r.players[0].dnfReason='left';},
    r=>{r.summit.settings.endurance=0;r.summit.durationSeconds=null;},
  ];
  for(const [i,change]of changes.entries()){const room=clone(good);change(room);assert.throws(()=>client.validateRoom(room),`forgery ${i}`);}
  const unfinished=fixture({laps:3,lapMs:60000.00049,endurance:0});unfinished.players[0].finishMs=null;
  assert.throws(()=>client.validateRoom(unfinished));
  return {rejected:changes.length+1};
});
test('ordinary and pursuit results keep legacy timing and missing-field compatibility',()=>{
  for(const mode of['race','pursuit']){
    const room=fixture({laps:3,lapMs:60000.00049,endurance:0,mode,delay:mode==='pursuit'?5:0});
    client.validateRoom(room);
    const changed=clone(room);changed.players[0].finishMs+=.004;
    if(mode==='pursuit')changed.players[0].netFinishMs+=.004;
    assert.throws(()=>client.validateRoom(changed));
    for(const p of room.players){delete p.lapTimesMs;delete p.bestLapMs;}
    client.validateRoom(room);
  }
  return {modes:['race','pursuit'],legacyTimingOmission:true};
});
const status=cases.every(v=>v.status==='PASS')?'PASS':'FAIL';
console.log(JSON.stringify({status,localOnly:true,externalRequests:0,trueServerSnapshot:true,
  controlledTimingFixtures:true,cases:cases.length,passed:cases.filter(v=>v.status==='PASS').length}));
if(status!=='PASS')process.exitCode=1;
