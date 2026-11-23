// Rex <game88521@gmail.com>. Authority-only team operations; all requests carry the existing revision/runId.
import {CREW_TEAM_VERSION,TEAM_ROLES} from '../shared/aurora-duty.ts';
export function newCrewTeam(){return{v:CREW_TEAM_VERSION,required:['driver','technician'],covers:[],safety:{front:0,rear:0,clearUntil:0},dispatch:{briefed:true,returnCleared:true},work:[{role:'driver',actions:0},{role:'technician',actions:0}]};}
export function resetTeamCase(r){if(!r.team)return;r.team.safety={front:0,rear:0,clearUntil:0};r.team.dispatch={briefed:!r.team.required.includes('dispatcher'),returnCleared:!r.team.required.includes('dispatcher')};r.safetyHeld=null;r.lastClear=-Infinity;}
export function resetTeamRoster(r){if(!r.team)return;r.team.required=TEAM_ROLES.filter(role=>role==='driver'||role==='technician'||[...r.players.values()].some(p=>p.role===role));r.team.covers=[];r.team.work=r.team.required.map(role=>({role,actions:0}));resetTeamCase(r);}
export function holder(r,role){const own=[...r.players.values()].find(p=>p.role===role&&p.client);if(own)return own;const cover=r.team?.covers.find(c=>c.role===role);return cover?r.players.get(cover.playerId):null;}
export const hasRole=(r,p,role)=>holder(r,role)?.id===p.id&&!!p.client;
export function crewConnected(r){if(!r.team)return r.players.size===2&&[...r.players.values()].every(p=>p.client);const driver=holder(r,'driver'),technician=holder(r,'technician');return[...r.players.values()].filter(p=>p.client).length>=2&&!!driver?.client&&!!technician?.client&&driver.id!==technician.id&&r.team.required.every(role=>holder(r,role)?.client);}
export function teamSafetyReady(r,at,clear=false){return!r.team?.required.includes('safety')||(r.team.safety.front>=2&&r.team.safety.rear>=2&&(!clear||r.team.safety.clearUntil>at));}
export function teamWork(r,role){const row=r.team?.work.find(w=>w.role===role);if(row)row.actions++;}
export function teamBriefed(r){return!r.team||r.team.dispatch.briefed;}
export function teamDepotClear(r){return!r.team||r.team.dispatch.returnCleared;}
export function stepCrewTeam(r,at,dt){
 if(!r.team)return;const held=r.safetyHeld,p=held&&r.players.get(held.playerId),target=r.outbound.target;
 if(!held||at-held.at>=450||!p||!hasRole(r,p,'safety')||!['approach','warning','positioning'].includes(r.stage)||Math.hypot(r.car.x-target.x,r.car.z-target.z)>40||Math.abs(r.car.y-target.y)>1.8||Math.hypot(r.car.vx,r.car.vz)>2)return;
 const field=held.action;if(field!=='front'&&field!=='rear')return;const old=r.team.safety[field];r.team.safety[field]=Math.min(2,old+dt);
 if(old<2&&r.team.safety[field]>=2){teamWork(r,'safety');r.replay?.event(at,'operation',['truck'],'safety-'+field);}
}
export function handleCrewTeam(service,r,p,m,now){
 if(!['safety','dispatch','cover-role'].includes(m.type))return false;if(!r.team)throw Error('此房為原雙人救援，請更新後另建2～4人救援房');
 if(m.type==='cover-role'){
  const keys=['type','revision','runId','role','playerId'];if(Object.keys(m).length!==keys.length||Object.keys(m).some(k=>!keys.includes(k))||p.id!==r.hostId||r.phase!=='running'||!r.team.required.includes(m.role))throw Error('僅目前房主可在勤務中指派斷線職責暫代');
  const original=[...r.players.values()].find(q=>q.role===m.role),next=r.players.get(m.playerId);if(original?.client||!next?.client||next.resumeKey)throw Error('原職責仍在線，或暫代隊員尚未確認連線');
  const previous=r.team.covers;r.team.covers=[...previous.filter(c=>c.role!==m.role),{role:m.role,playerId:next.id}];if(holder(r,'driver')?.id===holder(r,'technician')?.id){r.team.covers=previous;throw Error('司機與技師必須由兩位不同隊員負責');}
  r.revision++;r.input={steer:0,throttle:false,brake:false,handbrake:false,active:false};r.received=r.ack;r.heldAt=-Infinity;r.safetyHeld=null;r.car.vx=r.car.vz=r.car.w=0;r.replay?.event(now,'operation',['truck'],'crew-cover');service.broadcast(r,now);return true;
 }
 if(r.phase!=='running'||!crewConnected(r)||p.resumeKey)throw Error('請等待職責齊備並確認連線後再作業');
 if(m.type==='safety'){
  const keys=['type','revision','runId','action'];if(Object.keys(m).length!==keys.length||Object.keys(m).some(k=>!keys.includes(k))||!hasRole(r,p,'safety')||!['front','rear','clear','stop'].includes(m.action))throw Error('只有警戒員可布置警示區與確認淨空');
  if(m.action==='clear'){
   if(!['positioning','winch','securing'].includes(r.stage)||!service.docked(r)||!teamSafetyReady(r,now))throw Error('請先完成前後警示，待平台同層停穩後確認淨空');
   if(now-(r.lastClear??-Infinity)>=2000){r.team.safety.clearUntil=now+8000;r.lastClear=now;teamWork(r,'safety');r.replay?.event(now,'operation',['truck'],'safety-clear');}
  }else r.safetyHeld=m.action==='stop'?null:{action:m.action,playerId:p.id,at:now};
  return true;
 }
 const keys=['type','revision','runId','action','incidentId'];if(Object.keys(m).length!==keys.length||Object.keys(m).some(k=>!keys.includes(k))||!hasRole(r,p,'dispatcher')||m.incidentId!==r.mission.settings.incidents[r.mission.caseIndex]||!['brief','depot'].includes(m.action))throw Error('只有調度員可確認本件事故與返站接收');
 if(m.action==='brief'){
  if(!['approach','warning','positioning'].includes(r.stage))throw Error('事故簡報只可在出勤與平台定位前確認');if(!r.team.dispatch.briefed){r.team.dispatch.briefed=true;teamWork(r,'dispatcher');r.replay?.event(now,'operation',['truck'],'dispatch-brief');}
 }else{if(!['securing','returning','unloading'].includes(r.stage))throw Error('故障車到達平台後才可通知返站接收');if(!r.team.dispatch.returnCleared){r.team.dispatch.returnCleared=true;teamWork(r,'dispatcher');r.replay?.event(now,'operation',['truck'],'dispatch-depot');}}
 service.broadcast(r,now);return true;
}
