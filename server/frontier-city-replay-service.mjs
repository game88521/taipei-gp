// Rex <game88521@gmail.com>. RAM-only bounded recorder. Input keys map to anonymous actor indices and never enter its serialized archive.
import {randomBytes} from 'node:crypto';
import {COOP_CITY_STAMP} from '../shared/nexus-coop.ts';
import {CITY_REPLAY_VERSION,CITY_REPLAY_STEP_MS,CITY_REPLAY_MAX_MS,CITY_REPLAY_MAX_FRAMES,CITY_REPLAY_MAX_ACTORS,CITY_REPLAY_MAX_EVENTS,CITY_REPLAY_MAX_CHARS,CITY_REPLAY_CHUNK_CHARS,CITY_REPLAY_MODES,CITY_REPLAY_VEHICLES,CITY_REPLAY_ROLES,CITY_REPLAY_EVENTS,CITY_REPLAY_DETAILS,CITY_REPLAY_REASONS,parseCityReplay,validCityReplayDuty} from '../shared/frontier-city-replay.ts';
const finite=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const angle=h=>Math.atan2(Math.sin(h),Math.cos(h));
export class CityReplayRecorder{
 constructor({source,mode}){if(!['social','duty'].includes(source)||!CITY_REPLAY_MODES.includes(mode)||source==='social'&&['rescue','rally'].includes(mode)||source==='duty'&&!['rescue','rally'].includes(mode))throw Error('城市回放來源無效');this.source=source;this.mode=mode;this.reset();}
 reset(){this.key=randomBytes(12).toString('hex');this.startedAt=null;this.ids=new Map();this.lastSeen=-Infinity;this.latest=null;this.complete=false;this.stopped=false;this.text=null;this.data={schema:1,version:CITY_REPLAY_VERSION,cityStamp:COOP_CITY_STAMP,source:this.source,mode:this.mode,weather:'dry',durationMs:0,recordedMs:0,truncated:false,reason:'stopped',actors:[],frames:[],events:[]};}
 descriptor(){const d=this.data;return{key:this.key,ready:this.complete&&this.text!==null,frames:d.frames.length,durationMs:d.durationMs,recordedMs:d.recordedMs,truncated:d.truncated};}
 sample(now,rows,extra={}){
  if(this.complete||!finite(now,0,1e16)||!Array.isArray(rows)||rows.length<1||rows.length>(this.source==='duty'?1:4)||now<this.lastSeen)return false;
  const elapsed=Math.min(86_400_000,Math.max(0,now-(this.startedAt??now)));if(this.startedAt!==null){this.lastSeen=now;this.data.durationMs=elapsed;}
  if(this.stopped||elapsed>CITY_REPLAY_MAX_MS){this.data.truncated=true;return false;}
  const weather=extra.weather??'dry';if(!['dry','rain','night'].includes(weather)||extra.duty!==undefined&&extra.duty!==null&&!validCityReplayDuty(extra.duty)||this.source==='duty'&&this.mode==='rescue'&&!validCityReplayDuty(extra.duty)){this.data.truncated=true;return false;}
  const cars=[],keys=new Set(),slots=new Set(),newActors=[];
  for(const row of rows){const p=row?.pose,role=row?.role??(this.source==='duty'?'truck':'driver'),outcome=row?.outcome??'',epoch=row?.epoch??0;
   if(typeof row?.key!=='string'||!row.key||keys.has(row.key)||!Number.isInteger(row.slot)||row.slot<0||row.slot>3||slots.has(row.slot)||!CITY_REPLAY_VEHICLES.includes(row.vehicle)||!p||!finite(p.x,-15000,15000)||!finite(p.y,-150,800)||!finite(p.z,-15000,15000)||!finite(p.h,-1e8,1e8)||!finite(p.vx,-200,200)||!finite(p.vz,-200,200)||!finite(p.steer??0,-2,2)||!finite(p.pitch??0,-200,200)||!finite(p.roll??0,-200,200)||!Number.isSafeInteger(epoch)||epoch<0||epoch>1e9||!CITY_REPLAY_ROLES.includes(role)||!['','captured','escaped','left'].includes(outcome)||row.connected!==undefined&&typeof row.connected!=='boolean'||this.source==='social'&&(row.vehicle==='rescue'||role==='truck')||this.source==='duty'&&this.mode==='rescue'&&(row.vehicle!=='rescue'||role!=='truck')){this.data.truncated=true;return false;}
   keys.add(row.key);slots.add(row.slot);let actor=this.ids.get(row.key);if(actor===undefined){actor=this.data.actors.length+newActors.length;if(actor>=CITY_REPLAY_MAX_ACTORS){this.data.truncated=true;this.stopped=true;return false;}newActors.push({key:row.key,slot:row.slot,actor});}else if(this.data.actors[actor].slot!==row.slot){this.data.truncated=true;return false;}
   cars.push({actor,vehicle:row.vehicle,x:p.x,y:p.y,z:p.z,h:angle(p.h),vx:p.vx,vz:p.vz,steer:p.steer??0,pitch:p.pitch??0,roll:p.roll??0,epoch,visible:row.connected!==false&&outcome!=='left',role,outcome});
  }
  if(this.startedAt===null)this.startedAt=now;this.lastSeen=now;this.data.durationMs=elapsed;
  for(const a of newActors){this.ids.set(a.key,a.actor);this.data.actors.push({slot:a.slot});}
  if(!this.data.frames.length)this.data.weather=weather;
  this.latest={at:elapsed,weather,cars,duty:extra.duty?structuredClone(extra.duty):null};
  if(!this.data.frames.length||elapsed-this.data.recordedMs>=CITY_REPLAY_STEP_MS-.01)this.append(this.latest);
  return true;
 }
 append(frame){if(this.data.frames.length>=CITY_REPLAY_MAX_FRAMES){this.stopped=true;this.data.truncated=true;return;}const last=this.data.frames.at(-1);if(last?.at===frame.at)this.data.frames[this.data.frames.length-1]=structuredClone(frame);else this.data.frames.push(structuredClone(frame));this.data.recordedMs=frame.at;}
 event(now,type,keys=[],detail=''){
  if(this.complete||this.stopped||this.startedAt===null||!finite(now,this.startedAt,this.startedAt+CITY_REPLAY_MAX_MS)||!CITY_REPLAY_EVENTS.includes(type)||!Array.isArray(keys)||keys.length>4||new Set(keys).size!==keys.length||keys.some(key=>!this.ids.has(key)))return false;
  if(this.data.events.length>=CITY_REPLAY_MAX_EVENTS){
   // An omitted event can change ownership/state. Keep only the complete prefix,
   // including when sample() already appended a frame earlier in this same step.
   const cut=now-this.startedAt;this.stopped=true;this.data.truncated=true;
   this.data.frames=this.data.frames.filter(f=>f.at<cut);this.data.events=this.data.events.filter(e=>e.at<cut);
   this.latest=this.data.frames.at(-1)??null;this.data.recordedMs=this.latest?.at??0;return false;
  }
  this.data.events.push({at:now-this.startedAt,type,actors:keys.map(key=>this.ids.get(key)),detail:CITY_REPLAY_DETAILS.includes(detail)?detail:''});return true;
 }
 finish(now,reason='complete'){
  if(this.complete)return this.descriptor();if(this.startedAt===null||!finite(now,this.startedAt,this.startedAt+86_400_000)||!this.latest)return this.descriptor();
  this.data.durationMs=now-this.startedAt;if(this.latest.at>this.data.recordedMs)this.append(this.latest);
  this.data.truncated ||= this.data.recordedMs+.01<this.data.durationMs;this.data.reason=CITY_REPLAY_REASONS.includes(reason)?reason:'stopped';
  // An event beyond the retained trajectory is deliberately omitted rather than presented at a false time.
  this.data.events=this.data.events.filter(e=>e.at<=this.data.recordedMs).sort((a,b)=>a.at-b.at);
  const used=new Set(this.data.frames.flatMap(f=>f.cars.map(p=>p.actor))),map=new Map([...used].sort((a,b)=>a-b).map((a,i)=>[a,i]));
  this.data.actors=this.data.actors.filter((_,i)=>map.has(i));for(const frame of this.data.frames)for(const p of frame.cars)p.actor=map.get(p.actor);for(const e of this.data.events)e.actors=e.actors.filter(a=>map.has(a)).map(a=>map.get(a));
  const valid=parseCityReplay(this.data);if(!valid){this.stopped=true;return this.descriptor();}const text=JSON.stringify(valid);if(text.length>CITY_REPLAY_MAX_CHARS){this.data.truncated=true;this.stopped=true;return this.descriptor();}
  this.data=valid;this.text=text;this.complete=true;this.ids.clear();this.latest=null;return this.descriptor();
 }
 part(key,offset){if(!this.complete||!this.text||key!==this.key)throw Error('本場城市回放尚未就緒或已換場');if(!Number.isSafeInteger(offset)||offset<0||offset>=this.text.length||offset%CITY_REPLAY_CHUNK_CHARS)throw Error('城市回放片段位置無效');return{type:'city-replay-part',key:this.key,offset,totalChars:this.text.length,text:this.text.slice(offset,offset+CITY_REPLAY_CHUNK_CHARS)};}
}
