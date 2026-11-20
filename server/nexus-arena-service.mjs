import {defaultArena} from '../shared/multiplayer-arena.ts';
import {summitEvent} from './summit-events-service.mjs';
export {defaultArena};
const teams=['red','blue'];
const state=()=>({active:true,item:null,boostUntil:0,shieldUntil:0,receivedAt:0,handoffs:0});
export function resetArenaPlayer(room,p){room.arena??=defaultArena();if(room.phase==='lobby')room.arena.relayTeams=[];p.arena=state();p.arenaPickup=0;p.arenaUsedSeq=-1;}
export function arenaMode(room){return room.arena?.mode??'off';}
export function arenaCanDrive(room,p){return arenaMode(room)!=='relay'||p.arena?.active!==false;}
export function arenaCanCollide(room,p,at){return arenaCanDrive(room,p)&&!(arenaMode(room)==='items'&&p.arena?.shieldUntil>at);}
const teamOf=(room,p)=>room.arena?.relayTeams.find(t=>t.memberIds.includes(p.id));
function fail(s,c,m,text){s.send(c,{type:'error',code:'ARENA_RULE',message:text,...(m.requestId?{requestId:m.requestId}:{})});return true;}
export function arenaReceive(s,c,m,now){
 if(!['set-arena','arena-team','relay-handoff','use-item'].includes(m.type))return false;
 const r=c.room,p=c.player;if(!r||!p||c.viewer)return fail(s,c,m,'請先以車手身分加入房間。');
 if(!p.supportsArena)return fail(s,c,m,'請更新遊戲以使用接力與道具賽。');
 if(m.roomCode!==r.code)return fail(s,c,m,'房間已變更，請確認目前狀態。');
 if(m.type==='set-arena'||m.type==='arena-team'){
  if(r.phase!=='lobby'||m.expectedLobbyRevision!==r.lobbyRevision)return fail(s,c,m,'請在最新大廳設定玩法。');
  if(m.type==='set-arena'){
   if(r.hostId!==p.id)return fail(s,c,m,'只有房主能設定玩法。');
   if(!['off','relay','items'].includes(m.mode)||typeof m.mode!=='string')return fail(s,c,m,'請選擇一般、接力或道具玩法。');
   if(m.mode!=='off'&&([...r.players.values()].some(v=>!v.supportsArena)||r.series||r.evolution.mode!=='race'||Object.values(r.horizon).some(Boolean)))return fail(s,c,m,'接力／道具僅搭配單場圈數競速；請關閉系列、淘汰、防堵路、倒序並確認全員更新。');
   if(r.arena.mode===m.mode)return s.broadcast(r,'room',now),true;
   r.arena={...defaultArena(),revision:r.arena.revision+1,mode:m.mode};
   if(m.mode==='relay'){if(r.laps===1)r.laps=3;[...r.players.values()].sort((a,b)=>a.slot-b.slot).forEach((v,i)=>r.arena.teams[v.id]=i%2?'blue':'red');}
  }else{
   if(r.arena.mode!=='relay'||!teams.includes(m.team))return fail(s,c,m,'請先開啟接力賽，再選擇紅隊或藍隊。');
   if(r.arena.teams[p.id]===m.team)return s.broadcast(r,'room',now),true;
   const targetMembers=[...r.players.values()].filter(v=>v.id!==p.id&&r.arena.teams[v.id]===m.team);
   if(targetMembers.length>=2){const old=r.arena.teams[p.id];if(!old)return fail(s,c,m,'這一隊已有兩名車手。');r.arena.teams[targetMembers.sort((a,b)=>b.slot-a.slot)[0].id]=old;}
   r.arena.teams[p.id]=m.team;r.arena.revision++;
  }
  s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);return true;
 }
 if(r.phase!=='racing'||m.matchId!==r.matchId||m.trackRevision!==r.trackRevision)return fail(s,c,m,'這場比賽或地圖已變更。');
 if(!Number.isSafeInteger(m.seq)||m.seq<0||m.seq>0x7fffffff)return fail(s,c,m,'操作序號無效。');
 if(m.seq<=p.arenaUsedSeq)return true;
 p.arenaUsedSeq=m.seq;
 if(!p.connected||!p.loaded||p.dnf||p.finishMs!==null)return fail(s,c,m,'目前車手無法使用這項操作。');
 if(m.type==='use-item'){
  if(r.arena.mode!=='items'||!p.arena.item)return fail(s,c,m,'目前沒有可用道具。');
  if(now<p.arena.boostUntil||now<p.arena.shieldUntil)return fail(s,c,m,'請等目前道具效果結束。');
  if(p.arena.item==='boost')p.arena.boostUntil=now+2500;else p.arena.shieldUntil=now+4000;
  summitEvent(r,now,'item',[p.id],p.arena.item==='boost'?'使用加速道具':'使用護盾道具');p.arena.item=null;s.broadcast(r,'room',now);return true;
 }
 const t=teamOf(r,p),next=t&&r.players.get(t.memberIds.find(id=>id!==p.id));
 if(r.arena.mode!=='relay'||!t||t.driverId!==p.id||t.handoffs!==0||p.completedLaps<1||p.completedLaps>=r.laps||p.car.pos.s>80||p.car.v>5.1||!next?.connected||!next.loaded||next.dnf)return fail(s,c,m,'首圈完成後，在起終線後80公尺內減速至18 km/h以下，由當值車手交棒給已連線隊友。');
 next.car.restore(p.car.snapshot());next.car.v=0;next.car.speedCap=Infinity;
 for(const k of['completedLaps','distance','nextGate','lastLapElapsedMs','bestLapMs'])next[k]=p[k];
 next.lapTimesMs=[...p.lapTimesMs];next.input={steer:0,brake:true};next.lastInputAt=now;next.receivedSeq=next.ackSeq;
 p.car.v=0;p.car.speedCap=Infinity;p.input={steer:0,brake:true};p.arena.active=false;next.arena.active=true;
 p.arena.handoffs=next.arena.handoffs=t.handoffs=1;t.driverId=next.id;r.arena.revision++;
 summitEvent(r,now,'handoff',[p.id,next.id],'維修區成功交棒');
 arenaSync(r);s.broadcast(r,'room',now);return true;
}
export function arenaStartError(room){
 if(arenaMode(room)==='off')return '';
 if([...room.players.values()].some(p=>!p.supportsArena)||room.series||room.evolution.mode!=='race'||Object.values(room.horizon).some(Boolean))return '接力／道具只能使用單場圈數競速，請全員更新並關閉其他特殊房規。';
 if(arenaMode(room)==='relay'&&(room.laps===1||room.players.size!==4||teams.some(t=>[...room.players.values()].filter(p=>room.arena.teams[p.id]===t).length!==2)))return '接力需四名車手，每隊兩名，總圈數選3或5圈。';
 return '';
}
export function prepareArena(room){
 if(arenaMode(room)==='relay')room.arena.relayTeams=teams.map(team=>{const members=[...room.players.values()].filter(p=>room.arena.teams[p.id]===team).sort((a,b)=>a.slot-b.slot);members.forEach((p,i)=>p.arena.active=i===0);return{team,driverId:members[0].id,memberIds:members.map(p=>p.id),handoffs:0,finishMs:null,dnf:false,progress:0,completedLaps:0};});
 else room.arena.relayTeams=[];
}
export function arenaBeforeStep(room,p,at){
 if(arenaMode(room)==='off')return false;
 if(arenaMode(room)==='items'){p.car.boost=p.arena.boostUntil>at?.35:0;return false;}
 const t=teamOf(room,p);if(!p.arena.active)return true;
 if(t?.handoffs===0&&p.completedLaps>=1){p.car.speedCap=5;if(p.car.pos.s>=70){p.car.v=0;return true;}}
 return false;
}
export function arenaAfterStep(room,p,beforeDistance,at){
 if(arenaMode(room)!=='items')return;
 const spacing=room.track.length/3,next=(p.arenaPickup+.5)*spacing;
 if(p.distance>=next&&p.distance>beforeDistance){p.arenaPickup++;if(!p.arena.item&&at>=p.arena.boostUntil&&at>=p.arena.shieldUntil){p.arena.item=(p.arenaPickup+p.slot)%2?'boost':'shield';p.arena.receivedAt=at;}}
}
export function arenaSync(room){
 if(arenaMode(room)!=='relay'||!['racing','results'].includes(room.phase))return;
 for(const t of room.arena.relayTeams){const members=t.memberIds.map(id=>room.players.get(id)).filter(Boolean),d=room.players.get(t.driverId);if(!d)continue;
  if(members.some(p=>p.dnf)){for(const p of members){p.dnf=true;p.dnfReason??=members.find(p=>p.dnfReason)?.dnfReason??'disconnect-expired';p.car.v=0;}t.dnf=true;}
  t.progress=Math.max(0,d.distance);t.completedLaps=d.completedLaps;t.finishMs=d.finishMs;
  for(const p of members){if(p===d)continue;for(const k of['completedLaps','distance','nextGate','finishMs','lastLapElapsedMs','bestLapMs'])p[k]=d[k];p.lapTimesMs=[...d.lapTimesMs];}
 }
}
export function arenaPublic(room){const a=room.arena??defaultArena();const ids=new Set(room.players.keys());return{...structuredClone(a),relayTeams:room.phase==='lobby'?[]:structuredClone(a.relayTeams),teams:Object.fromEntries(Object.entries(a.teams).filter(([id])=>ids.has(id)))};}
