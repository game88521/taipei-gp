import {randomUUID} from 'node:crypto';
import {Car} from './physics.mjs';
import {MERIDIAN_RACING_VERSION,meridianSettings} from '../shared/meridian-racing.ts';
import {defaultSummitSettings} from '../shared/summit-racing.ts';
const values=r=>[...r.players.values()];
const changeTrack=(s,r,id,now)=>{s.changeTrack(r,id,s.trackFor(id),now);for(const p of values(r))p.loaded=false;s.toLobby(r,now);};
const err=(s,c,m,message)=>{s.send(c,{type:'error',code:'MERIDIAN_RULE',requestId:m.requestId,message});return true;};
export const meridianActive=r=>!!r?.meridian;
export const meridianRelay=r=>r?.meridian?.settings.mode==='relay-endurance';
export const meridianQualifying=r=>r?.meridian?.settings.mode==='championship'&&r.meridian.stage==='qualifying';
export const meridianCanDrive=(r,p)=>!meridianRelay(r)||r.phase==='lobby'||r.meridian.relayTeams.find(t=>t.memberIds.includes(p.id))?.driverId===p.id;
export const meridianCollision=(r,p)=>meridianCanDrive(r,p)&&!meridianQualifying(r);
export function meridianPlayer(r,p){const t=r.meridian?.relayTeams.find(t=>t.memberIds.includes(p.id));return{active:meridianCanDrive(r,p),team:meridianRelay(r)?r.meridian.teams[p.id]??null:null,generation:t?.generation??0,...(meridianQualifying(r)?{validLaps:(p.meridianValidLaps??[]).map(t=>Math.round(t*1000)/1000),lapValid:p.meridianLapValid!==false}:{})};}
export function newMeridianState(settings,laps=3){return{version:MERIDIAN_RACING_VERSION,revision:1,settings:structuredClone(settings),locked:false,entrants:[],stage:settings.mode==='relay-endurance'?'endurance':'qualifying',roundIndex:0,rounds:[],grid:[],complete:false,aborted:false,teams:{},relayTeams:[],standings:[],raceLaps:laps};}
export function meridianAdded(r,p){if(!meridianRelay(r)||r.meridian.locked)return;const m=r.meridian,counts=t=>Object.values(m.teams).filter(v=>v===t).length;m.teams[p.id]=counts('red')<=counts('blue')?'red':'blue';}
export function meridianJoinError(r,request,watch=false){if(!r?.meridian)return'';if(request.clientCapabilities?.meridianRacing!==true)return'此房需要更新的耐久接力／跨圖錦標賽版本。';return!watch&&r.meridian.locked?'本場名單已鎖定，請使用原席續接；也可觀戰。':'';}
const compatible=r=>!r.cup&&!r.series&&r.evolution.mode==='race'&&!Object.values(r.horizon).some(Boolean)&&(r.arena?.mode??'off')==='off'&&!r.summit?.settings.weekend&&!r.summit?.settings.ai&&!r.voyager?.settings.practiceSeconds&&!r.odyssey?.settings.sprintWeekend&&!r.odyssey?.settings.mandatoryStop&&!r.expedition?.settings.boundary&&!r.expedition?.settings.vsc;
export function meridianReceive(s,c,m,now){
 const r=c.room,p=c.player;
 if(r?.meridian&&m.type==='summit-pit'&&!meridianCanDrive(r,p))return err(s,c,m,'請由目前駕駛設定維修，候場車手不能替獨立停放車輛換胎。');
 if(r?.meridian&&['set-summit','set-arena','set-horizon','configure-event','configure-series','random-series','resolve-vote','set-odyssey','set-expedition','set-voyager','set-atlas','set-room-rules','select-track','set-laps','kick-player'].includes(m.type))return err(s,c,m,'請先結束 Meridian 賽事，再更改名單、地圖或進階房規。');
 if(r?.meridian&&['cup-create','cup-reset','cup-start'].includes(m.type))return err(s,c,m,'請先結束 Meridian 賽事，再建立好友盃。');
 if(r?.meridian&&m.type==='ready'&&(m.meridianRevision!==r.meridian.revision||m.lobbyRevision!==r.lobbyRevision))return err(s,c,m,'賽事或大廳已更新，請重新確認準備。');
 if(r?.meridian&&m.type==='input'&&meridianRelay(r)&&m.driverGeneration!==meridianPlayer(r,p).generation)return true;
 if(r?.meridian&&m.type==='reset'){
  if(!p||p.id!==r.hostId||r.phase!=='results')return err(s,c,m,'只有房主能在結算後重設整場賽事。');const settings=r.meridian.settings,laps=r.meridian.raceLaps;r.meridian=newMeridianState(settings,laps);for(const q of values(r))meridianAdded(r,q);
  if(settings.mode==='championship')changeTrack(s,r,settings.trackIds[0],now);else s.toLobby(r,now);return true;
 }
 if(!['set-meridian','meridian-team','meridian-handoff','meridian-next-stage','meridian-close'].includes(m.type))return false;
 if(!r||!p||c.viewer||!p.supportsMeridian||m.roomCode!==r.code)return err(s,c,m,'請先以新版車手加入正確房間。');
 if(m.type==='meridian-handoff')return handoff(s,c,m,now);
 if(m.expectedLobbyRevision!==r.lobbyRevision)return err(s,c,m,'大廳已更新，請確認目前設定。');
 if(m.type==='meridian-team'){
  if(r.phase!=='lobby'||!meridianRelay(r)||r.meridian.locked||!['red','blue'].includes(m.team))return err(s,c,m,'請在接力開賽前選擇隊伍。');const teams=r.meridian.teams,old=teams[p.id],members=values(r).filter(q=>q.id!==p.id&&teams[q.id]===m.team);if(members.length>=2){if(!old)return err(s,c,m,'該隊已滿。');teams[members.sort((a,b)=>b.slot-a.slot)[0].id]=old;}teams[p.id]=m.team;r.meridian.revision++;s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);return true;
 }
 if(r.hostId!==p.id)return err(s,c,m,'只有房主能設定或推進賽事。');
 if(m.type==='meridian-close'){
  if(!r.meridian||!['lobby','results'].includes(r.phase))return err(s,c,m,'請在大廳或結算後結束賽事。');const relay=meridianRelay(r);delete r.meridian;if(relay&&r.summit)r.summit.settings.endurance=0;for(const q of values(r))if(!q.connected)r.players.delete(q.id);s.toLobby(r,now);return true;
 }
 if(m.type==='meridian-next-stage')return nextStage(s,c,m,now);
 const settings=meridianSettings(m.settings);
 if(!settings||r.phase!=='lobby'||r.meridian?.locked)return err(s,c,m,'請在尚未開跑的大廳套用完整賽事設定。');
 if(settings.mode==='off'){if(meridianRelay(r)&&r.summit)r.summit.settings.endurance=0;delete r.meridian;s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);return true;}
 if(!compatible(r)||[...values(r),...r.spectators.values()].some(q=>!q.supportsMeridian||!q.supportsSummit||q.isAi))return err(s,c,m,'需全員新版真人，一般單場；先關閉其他系列／特殊玩法／AI。');
 try{if(settings.mode==='championship')for(const id of settings.trackIds)s.trackFor(id);}catch{return err(s,c,m,'部分地圖尚未提供。');}
 r.meridian=newMeridianState(settings,r.laps);r.summit??={settings:defaultSummitSettings(),stage:'single',qualifying:[],weather:0,revision:1};r.summit.settings.endurance=settings.mode==='relay-endurance'?settings.durationSeconds:0;
 for(const q of values(r))meridianAdded(r,q);
 if(settings.mode==='championship'&&r.trackId!==settings.trackIds[0])changeTrack(s,r,settings.trackIds[0],now);else{s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);}return true;
}
export function meridianStartError(r){
 const m=r.meridian;if(!m)return'';if(!compatible(r)||m.complete||m.aborted||values(r).some(p=>!p.supportsMeridian||p.isAi||p.expired))return'賽事狀態不允許開跑；請全員續接，或重設整場。';
 if(m.locked&&(m.entrants.length!==r.players.size||m.entrants.some(e=>!r.players.has(e.id))))return'必須原名單全員到齊。';
 if(m.settings.mode==='relay-endurance'&&(r.players.size!==4||['red','blue'].some(t=>values(r).filter(p=>m.teams[p.id]===t).length!==2)))return'耐久接力需要四位真人，紅藍兩隊各兩人。';
 return'';
}
export function meridianStart(r){
 const m=r.meridian;if(!m)return;if(!m.locked){m.locked=true;m.entrants=values(r).sort((a,b)=>a.slot-b.slot).map(p=>({id:p.id,name:p.name,slot:p.slot}));m.grid=m.settings.mode==='championship'?m.entrants.map(e=>e.id):[];}
 if(meridianRelay(r)){m.relayTeams=['red','blue'].map(team=>{const members=m.entrants.filter(e=>m.teams[e.id]===team).map(e=>e.id);return{team,memberIds:members,driverId:members[0],generation:1,handoffs:0,progress:0,completedLaps:0,finishMs:null,dnf:false,driveMs:Object.fromEntries(members.map(id=>[id,0])),stintStartedAt:r.startAt,stintStartDistance:0};});}
 for(const p of values(r)){p.meridianSeq=-1;p.meridianLapValid=true;p.meridianValidLaps=[];if(m.settings.mode==='championship'&&m.stage!=='qualifying'){const i=m.grid.indexOf(p.id);p.distance=i<=0?0:-Math.ceil(i*8/r.track.ds)*r.track.ds;}}m.revision++;
}
export function meridianGridCar(r,slot){
 const m=r.meridian;if(!m||m.settings.mode!=='championship'||m.stage==='qualifying'||!m.grid.length)return null;const p=values(r).find(p=>p.slot===slot),index=Math.max(0,m.grid.indexOf(p?.id)),t=r.track,i=index===0?0:(t.N-Math.ceil(index*8/t.ds))%t.N,car=new Car();car.resetTransient(false);car.placeAt(t,i);const lat=index%2?1:-1;car.x-=t.tz[i]*lat;car.z+=t.tx[i]*lat;car.pos.lat=lat;return car;
}
export function meridianBeforeStep(r,p,at){if(!meridianCanDrive(r,p)){p.car.v=0;p.input={steer:0,brake:true};return true;}if(meridianRelay(r)){const t=r.meridian.relayTeams.find(t=>t.driverId===p.id);if(t&&!p.dnf&&p.finishMs===null&&p.connected&&p.loaded)t.driveMs[p.id]=Math.min(900000,t.driveMs[p.id]+1000/60);}return false;}
export function meridianAfterStep(r,p){if(meridianQualifying(r)&&p.car.touch)p.meridianLapValid=false;}
export function meridianLap(r,p,elapsed,lapMs,at){
 const m=r.meridian;if(!m)return false;
 if(meridianQualifying(r)){if(p.meridianLapValid&&elapsed<=180000)p.meridianValidLaps.push(lapMs);p.bestLapMs=p.meridianValidLaps.length?Math.min(...p.meridianValidLaps):null;p.meridianLapValid=true;return true;}
 if(meridianRelay(r)){const t=m.relayTeams.find(t=>t.driverId===p.id);if(t&&elapsed>=m.settings.durationSeconds*1000){const valid=t.handoffs>=m.settings.handoffsRequired&&t.memberIds.every(id=>t.driveMs[id]>=30000);if(valid){p.finishMs=elapsed;p.car.v=0;r.firstFinishAt??=at;}else{p.dnf=true;p.dnfReason='race-timeout';}}syncRelay(r);return true;}
 return false;
}
function handoff(s,c,m,at){
 const r=c.room,p=c.player,t=r.meridian?.relayTeams.find(t=>t.driverId===p.id);
 if(!meridianRelay(r)||r.phase!=='racing'||m.matchId!==r.matchId||m.trackRevision!==r.trackRevision||!t||p.dnf||p.finishMs!==null||m.driverGeneration!==t.generation||!Number.isSafeInteger(m.seq)||m.seq<0||m.seq>0x7fffffff)return err(s,c,m,'換棒狀態已變更，請確認目前駕駛與比賽。');
 if(m.seq<=p.meridianSeq)return true;p.meridianSeq=m.seq;const next=r.players.get(t.memberIds.find(id=>id!==p.id));
 if(!next?.connected||!next.loaded||next.expired||next.dnf)return err(s,c,m,'隊友需仍在原席、連線且地圖載入完成。');
 if(p.car.pos.s>=80||p.car.pos.lat<2.8||p.car.v>5.1||p.summit?.pitUntil>at||at-t.stintStartedAt<20000||p.distance-t.stintStartDistance<r.track.length*.2)return err(s,c,m,'每棒至少20秒並行駛五分之一圈；請在起終點後80公尺內、右側維修區停穩，等待維修完成後換棒。');
 if(t.handoffs>=9999)return err(s,c,m,'本場換棒次數已達上限。');
 next.car.restore(p.car.snapshot());for(const key of ['completedLaps','distance','nextGate','lastLapElapsedMs','bestLapMs'])next[key]=p[key];next.lapTimesMs=[...p.lapTimesMs];next.summit=structuredClone(p.summit);next.atlas=structuredClone(p.atlas);next.dnf=false;next.dnfReason=null;next.finishMs=null;
 for(const q of [p,next]){q.input={steer:0,brake:true};q.lastInputAt=at;q.meridianSeq=-1;}p.car.v=0;t.driverId=next.id;t.generation++;t.handoffs++;t.stintStartedAt=at;t.stintStartDistance=next.distance;r.meridian.revision++;syncRelay(r);s.broadcast(r,'room',at);return true;
}
export function syncRelay(r){
 if(!meridianRelay(r))return;for(const t of r.meridian.relayTeams){const driver=r.players.get(t.driverId);if(!driver)continue;t.progress=Math.max(0,driver.distance);t.completedLaps=driver.completedLaps;t.finishMs=driver.finishMs;t.dnf=t.memberIds.some(id=>r.players.get(id)?.dnf||r.players.get(id)?.expired);if(t.dnf){t.finishMs=null;for(const id of t.memberIds){const q=r.players.get(id);if(q){q.dnf=true;q.finishMs=null;q.dnfReason??='disconnect-expired';}}}else if(t.finishMs!==null)for(const id of t.memberIds){const q=r.players.get(id);q.finishMs=t.finishMs;q.completedLaps=driver.completedLaps;q.distance=driver.distance;q.lapTimesMs=[...driver.lapTimesMs];q.bestLapMs=driver.bestLapMs;q.lastLapElapsedMs=driver.lastLapElapsedMs;}}
}
export function meridianDeadline(r){const m=r.meridian;if(!m||r.startAt===null)return null;return meridianRelay(r)?{deadlineAt:r.startAt+m.settings.durationSeconds*1000+120000,deadlineReason:'race-timeout'}:meridianQualifying(r)?{deadlineAt:r.startAt+180000,deadlineReason:'race-timeout'}:null;}
function resultRows(r,stage){const points=stage==='sprint'?[3,2,1,0]:stage==='race'?[10,6,4,2]:[0,0,0,0];return values(r).sort((a,b)=>Number(a.dnf)-Number(b.dnf)||(a.finishMs??Infinity)-(b.finishMs??Infinity)||b.distance-a.distance||a.slot-b.slot).map((p,i)=>({id:p.id,rank:i+1,dnf:p.dnf,finishMs:p.finishMs,points:p.dnf||p.finishMs===null?0:points[i]}));}
function recordStage(r){const m=r.meridian;if(m.settings.mode!=='championship'||m.aborted)return;let round=m.rounds[m.roundIndex];if(!round){round={trackId:r.trackId,qualifying:[],sprint:[],race:[]};m.rounds.push(round);}if(round[m.stage].length)return;round[m.stage]=resultRows(r,m.stage);m.grid=round[m.stage].map(row=>row.id);if(m.stage==='race'){const aggregate=new Map(m.entrants.map(e=>[e.id,{id:e.id,points:0,wins:0,rank:0}]));for(const rnd of m.rounds)for(const row of [...rnd.sprint,...rnd.race]){const t=aggregate.get(row.id);t.points+=row.points;if(rnd.race.includes(row)&&row.rank===1&&!row.dnf)t.wins++;}m.standings=[...aggregate.values()].sort((a,b)=>b.points-a.points||b.wins-a.wins||m.entrants.find(e=>e.id===a.id).slot-m.entrants.find(e=>e.id===b.id).slot).map((row,i)=>({...row,rank:i+1}));m.complete=m.roundIndex===m.settings.trackIds.length-1;}m.revision++;}
export function meridianFinish(s,r,at){
 const m=r.meridian;if(!m)return null;const players=values(r);if(players.some(p=>p.dnfReason==='server-stall')){m.aborted=true;for(const p of players){s.markDnf(p,'server-stall');p.car.v=0;}r.phase='results';r.updatedAt=at;m.revision++;s.broadcast(r,'room',at);return true;}
 if(meridianRelay(r)){syncRelay(r);const limit=r.startAt+m.settings.durationSeconds*1000+120000;if(at<limit&&!m.relayTeams.every(t=>t.dnf||t.finishMs!==null))return false;for(const t of m.relayTeams)if(!t.dnf&&t.finishMs===null)for(const id of t.memberIds)s.markDnf(r.players.get(id),'race-timeout');syncRelay(r);m.complete=true;}
 else if(meridianQualifying(r)){
  if(at<r.startAt+180000&&!players.every(p=>p.dnf))return false;for(const p of players){if(!p.dnf&&p.bestLapMs!==null)p.finishMs=p.bestLapMs;else s.markDnf(p,'time-trial-no-lap');} 
 }else{
  if(at-r.startAt<s.raceLimitMs&&(r.firstFinishAt===null||at-r.firstFinishAt<s.graceMs(r))&&!players.every(p=>p.dnf||p.finishMs!==null))return false;for(const p of players)s.markDnf(p,s.deadline(r).deadlineReason);
 }
 for(const p of players)p.car.v=0;r.phase='results';r.updatedAt=at;recordStage(r);s.broadcast(r,'room',at);return true;
}
function nextStage(s,c,m,now){
 const r=c.room,state=r.meridian;if(!state||state.settings.mode!=='championship'||r.phase!=='results'||state.complete||state.aborted||m.meridianRevision!==state.revision)return err(s,c,m,'請先完成目前階段；已結束或中止的錦標賽需整場重設。');
 if(state.entrants.length!==r.players.size||state.entrants.some(e=>{const p=r.players.get(e.id);return!p||!p.connected||p.expired;}))return err(s,c,m,'需原名單全員到齊，不能中途更換車手。');
 if(state.stage==='race'){state.roundIndex++;state.stage='qualifying';state.grid=state.entrants.map(e=>e.id);state.revision++;r.laps=state.raceLaps;changeTrack(s,r,state.settings.trackIds[state.roundIndex],now);}
 else{state.stage=state.stage==='qualifying'&&state.settings.sprint?'sprint':'race';r.laps=state.stage==='sprint'?1:state.raceLaps;state.revision++;r.trackRevision++;for(const p of values(r))p.loaded=false;s.toLobby(r,now);}return true;
}
export function meridianPublic(r){syncRelay(r);return r.meridian?structuredClone(r.meridian):undefined;}
