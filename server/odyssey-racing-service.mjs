// Rex <game88521@gmail.com>. Authority for the optional human-only racing rules.
import {randomUUID} from 'node:crypto';
import {ODYSSEY_RACING_VERSION,odysseySettings,odysseyEnabled,odysseyStopWindow,odysseyStandings,ODYSSEY_SPRINT_POINTS,ODYSSEY_RACE_POINTS} from '../shared/odyssey-racing.ts';
import {summitEvent} from './summit-events-service.mjs';
import {getMultiplayerTrack} from '../shared/multiplayer-tracks.ts';

export const odysseyActive=r=>odysseyEnabled(r.odyssey?.settings);
export const odysseySprint=r=>!!r.odyssey?.settings.sprintWeekend;
export const odysseyMandatory=r=>!!r.odyssey?.settings.mandatoryStop;
const emptyWeekend=r=>({id:randomUUID(),trackId:r.trackId,raceLaps:r.laps,locked:false,complete:false,entrants:[],sprint:[],race:[],standings:[]});
const sameRoster=r=>{const w=r.odyssey?.weekend;return!!w&&w.entrants.length===r.players.size&&w.entrants.every(e=>r.players.has(e.id));};
export function odysseyResetPlayer(r,p){p.odyssey={pitStartedMs:null,qualifiedStopMs:null,stopMissed:false};}
export function odysseyJoinError(r,m){if(!odysseyActive(r))return'';if(m.clientCapabilities?.odysseyRacing!==true)return'此房需要 Odyssey 衝刺週末／有效換胎版本，請更新後加入。';if(odysseySprint(r)&&r.odyssey.weekend.locked)return'衝刺週末名單已固定；請原車手續接，或等房主重設完整週末。';return'';}
export function odysseyStartError(r){
 if(!odysseyActive(r))return'';
 if(r.series||r.evolution.mode!=='race'||Object.values(r.horizon).some(Boolean)||(r.arena?.mode??'off')!=='off'||[...r.players.values()].some(p=>p.isAi||!p.supportsOdyssey||!p.supportsSummit)||[...r.spectators.values()].some(p=>!p.supportsOdyssey||!p.supportsSummit))return'Odyssey 首版限同版本真人一般單場，不能混用 AI／系列／其他特殊玩法。';
 if(odysseySprint(r)){if(!r.summit?.settings.weekend||r.summit.settings.endurance||!getMultiplayerTrack(r.trackId)?.circuit||r.odyssey.weekend.trackId!==r.trackId||r.odyssey.weekend.locked&&!sameRoster(r))return'衝刺週末需同張 GP 圖與完整固定名單；請先重設完整週末。';}
 else if(![480,600].includes(r.summit?.settings.endurance)||r.summit.settings.weekend)return'強制一停僅限八／十分鐘真人單場耐久。';
 return'';
}
function fail(s,c,m,message){s.send(c,{type:'error',code:'ODYSSEY_RULE',...(m.requestId?{requestId:m.requestId}:{}),message});return true;}
export function odysseyReceive(s,c,m,now){
 const r=c.room;
 if(odysseyActive(r??{})&&['set-summit','next-weekend','set-voyager','set-atlas','set-room-rules','set-laps','select-track'].includes(m.type))return fail(s,c,m,'請先在 Odyssey 區關閉規則或重設完整週末，再修改賽道、圈數或其他房規。');
 if(!['set-odyssey','next-odyssey-stage'].includes(m.type))return false;
 const p=c.player;if(!r||!p||c.viewer||!p.supportsOdyssey||!p.supportsSummit)return fail(s,c,m,'請以支援 Odyssey 的車手身分加入。');
 const keys=['type','roomCode','expectedLobbyRevision','requestId',...(m.type==='set-odyssey'?['settings']:[])];
 if(Object.keys(m).some(k=>!keys.includes(k))||m.roomCode!==r.code||!Number.isSafeInteger(m.expectedLobbyRevision)||m.expectedLobbyRevision!==r.lobbyRevision||r.hostId!==p.id)return fail(s,c,m,'只有目前房主可依最新大廳世代設定。');
 if(m.type==='next-odyssey-stage'){
  const w=r.odyssey?.weekend,stage=r.summit?.stage;
  if(!odysseySprint(r)||r.phase!=='results'||!w.locked||w.complete||!['qualifying','sprint'].includes(stage))return fail(s,c,m,'請先完成本階段；整個週末完成後可重設再玩。');
  if(!sameRoster(r)||[...r.players.values()].some(v=>!v.connected||v.expired)||r.players.size<2)return fail(s,c,m,'下一階段需要原車手全部回來；逾期或明確離席時請重設完整週末，不能換人。');
  odysseyFinalize(r,now);
  if(stage==='sprint'){
   if(w.sprint.length!==w.entrants.length)return fail(s,c,m,'衝刺結果尚未完整，請稍候。');
   r.summit.qualifying=w.sprint.map((q,i)=>({id:q.id,name:r.players.get(q.id).name,bestMs:null,grid:i+1,ai:false,dnf:q.dnf}));r.laps=w.raceLaps;r.summit.stage='race';
  }else{r.laps=1;r.summit.stage='sprint';}
  r.summit.revision++;r.trackRevision++;r.odysseyTransition=true;r.summitTransition=true;
  try{s.toLobby(r,now);}finally{r.odysseyTransition=false;r.summitTransition=false;}return true;
 }
 const settings=odysseySettings(m.settings);
 if(r.phase!=='lobby'||!settings)return fail(s,c,m,'請在大廳選擇一種有效的 Odyssey 房規。');
 if(settings.sprintWeekend===!!r.odyssey?.settings.sprintWeekend&&settings.mandatoryStop===!!r.odyssey?.settings.mandatoryStop){s.broadcast(r,'room',now);return true;}
 if(odysseyEnabled(settings)){
  if(r.series||r.evolution.mode!=='race'||Object.values(r.horizon).some(Boolean)||(r.arena?.mode??'off')!=='off'||r.summit?.settings.ai||[...r.players.values(),...r.spectators.values()].some(v=>v.isAi||!v.supportsOdyssey||!v.supportsSummit)||r.voyager?.settings.practiceSeconds||r.voyager?.settings.weather&&r.voyager.settings.weather!=='legacy'||r.voyager?.settings.vsc)return fail(s,c,m,'首版需全員新版、只限真人一般單場；先關閉 AI／練習／自選天候／VSC／系列及其他玩法。');
  if(settings.sprintWeekend&&!s.trackFor(r.trackId)?.descriptor.circuit)return fail(s,c,m,'衝刺週末僅支援大獎賽地圖。');
  if(settings.mandatoryStop&&(![480,600].includes(r.summit?.settings.endurance)||r.summit.settings.weekend))return fail(s,c,m,'先套用八／十分鐘真人單場耐久，再啟用強制一停。');
 }
 if(odysseySprint(r))r.laps=r.odyssey.weekend.raceLaps;
 const wasSprint=odysseySprint(r);
 r.odyssey=odysseyEnabled(settings)?{version:ODYSSEY_RACING_VERSION,settings,weekend:settings.sprintWeekend?emptyWeekend(r):null}:null;
 if(settings.sprintWeekend)r.summit={settings:{weekend:true,ai:0,endurance:0},stage:'qualifying',qualifying:[],weather:0,revision:(r.summit?.revision??0)+1};
 else if(wasSprint&&r.summit){r.summit.settings.weekend=false;r.summit.stage='single';r.summit.qualifying=[];r.summit.revision++;}
 r.trackRevision++;s.toLobby(r,now);return true;
}
/** Called before toLobby changes phase: cancellation preserves completed stages, reset does not. */
export function odysseyBeforeLobby(r){
 if(!odysseySprint(r))return;
 if(r.odysseyTransition)return;
 if(r.phase==='countdown'&&r.odyssey.weekend.locked&&sameRoster(r)){r.odysseyCancel=true;return;}
 r.laps=r.odyssey.weekend.raceLaps;r.odyssey.weekend=emptyWeekend(r);r.odysseyCancel=false;
}
export function odysseyPreserveLobby(r){return odysseySprint(r)&&(r.odysseyTransition||r.odysseyCancel);}
export function odysseyRosterChanged(s,r,now){
 if(!odysseySprint(r)||!r.odyssey.weekend.locked||sameRoster(r)||!['lobby','countdown'].includes(r.phase))return false;
 r.laps=r.odyssey.weekend.raceLaps;r.odyssey.weekend=emptyWeekend(r);r.summit.stage='qualifying';r.summit.qualifying=[];r.summit.revision++;r.trackRevision++;r.odysseyCancel=false;s.toLobby(r,now);return true;
}
export function odysseyStart(r){
 if(!odysseySprint(r))return;
 const w=r.odyssey.weekend;if(!w.locked){w.entrants=[...r.players.values()].sort((a,b)=>a.slot-b.slot).map(p=>({id:p.id,name:p.name}));w.locked=true;w.standings=odysseyStandings(w.entrants,[],[]);}
}
export function odysseyPitStarted(r,p,at){if(odysseyMandatory(r)&&p.odyssey.qualifiedStopMs===null)p.odyssey.pitStartedMs=Math.max(0,at-r.startAt);}
export function odysseyPitCompleted(r,p,at,service){
 if(!odysseyMandatory(r)||service==='repair'||p.odyssey.qualifiedStopMs!==null)return;
 const v=p.odyssey,w=odysseyStopWindow(r.summit.settings.endurance),elapsed=at-r.startAt;
 if(v.pitStartedMs!==null&&v.pitStartedMs>=w.openMs&&elapsed>=v.pitStartedMs&&elapsed<=w.closeMs){v.qualifiedStopMs=elapsed;v.stopMissed=false;summitEvent(r,at,'pit',[p.id],'中段有效換胎完成，已滿足強制一停');}
}
export function odysseyTick(r,at){if(odysseyMandatory(r)&&r.startAt!==null&&at-r.startAt>odysseyStopWindow(r.summit.settings.endurance).closeMs)for(const p of r.players.values())if(p.odyssey.qualifiedStopMs===null)p.odyssey.stopMissed=true;}
export const odysseyRuleMissed=(r,p)=>odysseyMandatory(r)&&p.odyssey?.qualifiedStopMs===null&&(p.odyssey?.stopMissed||r.phase==='results');
export function odysseyFinalize(r,at){
 if(!odysseyActive(r)||r.phase!=='results')return;
 odysseyTick(r,at);
 if(odysseyMandatory(r)){for(const p of r.players.values())if(p.odyssey.qualifiedStopMs===null)p.odyssey.stopMissed=true;return;}
 const w=r.odyssey.weekend,stage=r.summit.stage;if(!['sprint','race'].includes(stage)||w[stage].length)return;
 const table=stage==='sprint'?ODYSSEY_SPRINT_POINTS:ODYSSEY_RACE_POINTS;
 w[stage]=[...r.players.values()].sort((a,b)=>Number(a.dnf)-Number(b.dnf)||(a.finishMs??Infinity)-(b.finishMs??Infinity)||b.distance-a.distance||a.slot-b.slot).map((p,i)=>({id:p.id,rank:i+1,finishMs:p.dnf?null:p.finishMs,dnf:p.dnf,points:p.dnf?0:table[i]}));
 w.standings=odysseyStandings(w.entrants,w.sprint,w.race);w.complete=stage==='race';
}
export const odysseyPublic=r=>odysseyActive(r)?structuredClone(r.odyssey):null;
