import {voyagerPractice} from './voyager-racing-service.mjs';
import {voyagerEnabled,defaultVoyagerSettings,VOYAGER_VSC_MPS} from '../shared/voyager-racing.ts';
import {odysseyActive} from './odyssey-racing-service.mjs';
import {atlasEnabled,atlasEnsure} from './atlas-racing-service.mjs';
import {randomUUID} from 'node:crypto';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../shared/multiplayer-protocol.ts';
import {REPLAY_STEP_MS,REPLAY_MAX_MS,REPLAY_MAX_FRAMES,REPLAY_MAX_CHARS,REPLAY_CHUNK_CHARS} from '../shared/nexus-replay.ts';
import {summitEventsEnabled} from './summit-events-service.mjs';
import {expeditionEnabled} from './expedition-racing-service.mjs';

function pose(p,rank){const c=p.car.snapshot();return[c.x,c.z,c.h,c.v,c.steer,c.pos.i,c.pos.lat,c.pos.s,Math.max(0,p.distance),p.completedLaps,rank,p.finishMs===null?null:Math.round(p.finishMs*1000)/1000,!!p.dnf,p.arena?.active!==false];}
export function observeReplay(room,now,publicPlayers){
  if(room.cup||voyagerPractice(room)||room.phase==='lobby'||!room.matchId||room.startAt===null){room.replayRecording=null;return null;}
  let r=room.replayRecording;
  if(!r||r.matchId!==room.matchId){
    const drivers=[...room.players.values()].sort((a,b)=>a.slot-b.slot);
    const expedition=expeditionEnabled(room),odyssey=odysseyActive(room),voyager=voyagerEnabled(room.voyager?.settings)||odyssey||expedition,atlas=atlasEnabled(room)||voyager,summit=summitEventsEnabled(room)||expedition,data={schema:expedition?6:odyssey?5:voyager?4:atlas?3:summit?2:1,version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,id:randomUUID(),createdAt:Math.max(0,room.startAt),trackId:room.trackId,trackStamp:room.trackStamp,trackLength:room.track.length,laps:room.laps,
      ...(expedition?{expedition:structuredClone(room.expedition)}:{}),
      mode:room.arena?.mode&&room.arena.mode!=='off'?room.arena.mode:room.summit?.stage==='qualifying'?'qualifying':room.summit?.settings.endurance?'endurance':room.horizon.elimination?'elimination':room.evolution.mode,durationMs:0,recordedMs:0,truncated:false,
      ...(atlas?{atlas:structuredClone(atlasEnsure(room))}:{}),...(voyager?{voyager:{settings:structuredClone(room.voyager?.settings??defaultVoyagerSettings())}}:{}),drivers:drivers.map((p,i)=>({id:`driver-${i+1}`,name:p.name,color:p.color,...(summit?{ai:!!p.isAi}:{})})),frames:[],...(summit?{events:[],summit:room.summit?{settings:{...room.summit.settings},stage:room.summit.stage}:null}:{})};
    r=room.replayRecording={matchId:room.matchId,ids:drivers.map(p=>p.id),data,text:null,lastAt:-Infinity,complete:false};
  }
  if(r.complete)return descriptor(r);
  const elapsed=Math.max(0,now-room.startAt),at=Math.min(REPLAY_MAX_MS,elapsed),done=room.phase==='results';
  r.data.durationMs=elapsed;
  if(at===0&&r.data.frames.length===0||at>r.lastAt&&(at-r.lastAt>=REPLAY_STEP_MS-.01||done)||done&&at===r.lastAt){
    if(r.data.frames.length<REPLAY_MAX_FRAMES||at===r.lastAt){
      const ordered=publicPlayers??[...room.players.values()].sort((a,b)=>{
        if(a.finishMs!==null||b.finishMs!==null)return(a.finishMs??Infinity)-(b.finishMs??Infinity)||a.slot-b.slot;
        return Number(a.dnf)-Number(b.dnf)||b.distance-a.distance||a.slot-b.slot;
      });
      const vsc=room.voyager?.vsc??{phase:'off',resumeAt:null,speedMps:VOYAGER_VSC_MPS};
      const frame={at,...(r.data.schema===6?{expedition:r.ids.map(id=>{const p=room.players.get(id)?.expedition;return p?[p.warnings,p.vscPasses,p.penaltyMs,p.lastReason,p.lastAt]:[0,0,0,null,null];})}:{}),...(r.data.schema>=4?{vsc:{...vsc,resumeAt:vsc.resumeAt===null?null:Math.max(0,vsc.resumeAt-room.startAt)}}:{}),...(r.data.schema===5?{odyssey:r.ids.map(id=>{const p=room.players.get(id)?.odyssey;return p?[p.pitStartedMs,p.qualifiedStopMs,p.stopMissed]:[null,null,false];})}:{}),...(r.data.schema>=3?{atlas:r.ids.map(id=>{const a=room.players.get(id)?.atlas;return a?[a.damage,a.pitService,a.pitDurationMs,a.yellow,a.blue,a.boundary,a.warnings]:[0,'tyres',0,false,false,false,0];})}:{}),cars:r.ids.map((id,i)=>{const p=room.players.get(id);return p?pose(p,Math.max(1,ordered.findIndex(row=>row.id===id)+1)):r.data.frames.at(-1)?.cars[i]??[0,0,0,0,0,0,0,0,0,0,i+1,null,true,false];}),...(r.data.schema>=2?{wet:room.summit?.weather??0,strategy:r.ids.map(id=>{const p=room.players.get(id)?.summit;return p?[p.compound,p.wear,p.pitUntil?Math.max(0,p.pitUntil-room.startAt):0,p.pitStops,p.pitArmed,p.nextCompound,p.lapValid]:['medium',0,0,0,false,'medium',true];})}:{})};
      if(at===r.lastAt)r.data.frames[r.data.frames.length-1]=frame;else r.data.frames.push(frame);
      r.lastAt=at;r.data.recordedMs=at;
    }
  }
  if(elapsed>REPLAY_MAX_MS)r.data.truncated=true;
  if(r.data.schema===5){const state=structuredClone(room.odyssey),anonymous=id=>`driver-${r.ids.indexOf(id)+1}`;if(state.weekend){const w=state.weekend;w.id='weekend';w.entrants=w.entrants.map(e=>({...e,id:anonymous(e.id)}));for(const key of['sprint','race','standings'])w[key]=w[key].map(e=>({...e,id:anonymous(e.id)}));}r.data.odyssey=state;}
  if(r.data.schema>=2)r.data.events=(room.summitEventMatch===room.matchId?room.summitEvents??[]:[]).filter(e=>e.at<=r.data.recordedMs&&e.actors.every(id=>r.ids.includes(id))).map(e=>({...e,actors:e.actors.map(id=>`driver-${r.ids.indexOf(id)+1}`)}));
  if(done){r.complete=true;r.data.truncated ||= r.data.recordedMs+0.01<elapsed;r.text=JSON.stringify(r.data);if(r.text.length>REPLAY_MAX_CHARS){r.text=null;r.complete=false;}}
  return descriptor(r);
}
function descriptor(r){return{id:r.data.id,ready:r.complete&&r.text!==null,frames:r.data.frames.length,durationMs:r.data.durationMs,recordedMs:r.data.recordedMs,truncated:r.data.truncated};}
export function receiveReplay(service,client,m,now){
  if(m.type!=='replay-chunk')return false;
  const room=client.room;
  if(!room||(!client.player&&!client.viewer)){service.fail(client,'NOT_IN_ROOM',m);return true;}
  const meta=observeReplay(room,now),r=room.replayRecording;
  if(room.phase!=='results'||!meta?.ready||m.replayId!==meta.id){service.fail(client,'REPLAY_UNAVAILABLE',m);return true;}
  if(!Number.isSafeInteger(m.offset)||m.offset<0||m.offset>=r.text.length||m.offset%REPLAY_CHUNK_CHARS!==0){service.fail(client,'BAD_MESSAGE',m);return true;}
  service.send(client,{type:'replay-part',replayId:meta.id,offset:m.offset,totalChars:r.text.length,text:r.text.slice(m.offset,m.offset+REPLAY_CHUNK_CHARS)});return true;
}
