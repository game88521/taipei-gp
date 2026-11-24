// Rex <game88521@gmail.com>. Server-owned pause clock; no client poses or elapsed times accepted.
import {HARBOR_NETWORK_VERSION,HARBOR_NETWORK_GRACE_MS,HARBOR_NETWORK_RESUME_MS,HARBOR_NETWORK_LIMIT,harborNetworkPlain} from '../shared/harbor-network-pause.ts';
const players=r=>[...r.players.values()];
const fresh=enabled=>({v:HARBOR_NETWORK_VERSION,enabled,epoch:0,phase:'idle',elapsedMs:null,pausedAt:null,resumeAt:null,incidents:new Map(),uses:{},clockAt:null});
const state=r=>r.harborNetwork??=fresh(false);
const live=p=>!p.dnf&&p.finishMs===null&&!p.expired;
const stop=(r,now)=>{for(const p of players(r)){p.input={steer:0,brake:true};p.lastInputAt=now;}};
const error=(s,c,m,text)=>{s.send(c,{type:'error',code:'HARBOR_NETWORK_RULE',requestId:m.requestId,message:text});return true;};
const compatible=r=>harborNetworkPlain(r)&&!r.spectators.size&&players(r).every(p=>!p.isAi&&p.supportsHarborNetwork);
export const harborNetworkActive=r=>!!r?.harborNetwork?.enabled&&r.harborNetwork.phase!=='idle';
export function harborNetworkClock(r,now){const n=r?.harborNetwork;if(!n?.enabled||n.phase==='idle'||r.phase!=='racing'||now<n.clockAt)return;const delta=now-n.clockAt;r.startAt+=delta;if(r.firstFinishAt!==null)r.firstFinishAt+=delta;r.simAt=now;n.clockAt=now;}
const clear=n=>{n.phase='idle';n.elapsedMs=n.pausedAt=n.resumeAt=n.clockAt=null;n.incidents.clear();};
export function harborNetworkStart(r){if(!r.harborNetwork)return;const n=r.harborNetwork;clear(n);n.epoch++;n.uses=Object.fromEntries(players(r).map(p=>[p.id,0]));}
export function harborNetworkDisconnect(s,r,p,now){
 const n=r.harborNetwork;if(!n?.enabled||r.phase!=='racing'||!live(p))return;
 harborNetworkClock(r,now);
 if(!n.incidents.has(p.id)){
  if((n.uses[p.id]??0)>=HARBOR_NETWORK_LIMIT){s.markDnf(p,'disconnect-expired');p.expired=true;p.token=null;return;}
  n.uses[p.id]=(n.uses[p.id]??0)+1;n.incidents.set(p.id,{playerId:p.id,deadlineAt:now+HARBOR_NETWORK_GRACE_MS,confirmed:false});
 }else n.incidents.get(p.id).confirmed=false;
 if(n.phase==='idle'){
  // Freeze at the authoritative disconnect instant, including its sub-step fraction.
  n.elapsedMs=Math.max(0,now-r.startAt);n.pausedAt=now;n.clockAt=now;r.simAt=now;n.phase='waiting';
 }
 n.phase='waiting';n.resumeAt=null;n.epoch++;stop(r,now);
}
/** Returns true while physics must stay frozen; preserves the original incident deadlines. */
export function harborNetworkTick(s,r,now){
 const n=r.harborNetwork;if(!n?.enabled||n.phase==='idle')return false;
 if(r.phase!=='racing'){clear(n);return false;}
 harborNetworkClock(r,now);let changed=false;
 for(const [id,incident]of n.incidents){const p=r.players.get(id);
  if(!p||!live(p)){n.incidents.delete(id);changed=true;continue;}
  if(incident.confirmed&&(!p.connected||!p.loaded)){incident.confirmed=false;n.phase='waiting';n.resumeAt=null;changed=true;}
  if(!incident.confirmed&&now>=incident.deadlineAt){s.markDnf(p,'disconnect-expired');p.expired=true;p.token=null;n.incidents.delete(id);changed=true;}
 }
 if(players(r).every(p=>p.dnf||p.finishMs!==null)){clear(n);s.maybeFinish(r,now);return false;}
 if(n.phase==='waiting'&&[...n.incidents.values()].every(i=>i.confirmed)){n.phase='resuming';n.resumeAt=now+HARBOR_NETWORK_RESUME_MS;n.epoch++;changed=true;}
 if(n.phase==='resuming'&&now>=n.resumeAt){clear(n);n.epoch++;stop(r,now);s.broadcast(r,'room',now);return false;}
 if(changed)s.broadcast(r,'room',now);return true;
}
const mutations=new Set(['set-summit','set-atlas','set-voyager','set-odyssey','set-expedition','set-horizon','set-arena','configure-event','configure-series','random-series','cup-create','cup-configure','cup-configure-league','set-meridian','claim-seat']);
export function harborNetworkReceive(s,c,m,now){
 const r=c.room,p=c.player;harborNetworkClock(r,now);
 const admission=!r&&['join','resume','watch','create-configured'].includes(m.type)?s.rooms.get(m.code):null;
 if(admission?.harborNetwork?.enabled&&(m.type==='watch'||m.clientCapabilities?.harborNetworkPause!==HARBOR_NETWORK_VERSION))return error(s,c,m,'此房開啟短斷線保護；請以相同新版車手加入，不提供觀眾席。');
 if(r?.harborNetwork?.enabled&&mutations.has(m.type))return error(s,c,m,'請先在大廳關閉短斷線保護，再設定進階玩法或觀眾。');
 if(r?.harborNetwork?.enabled&&m.type==='input'&&(harborNetworkActive(r)||m.harborEpoch!==r.harborNetwork.epoch))return true;
 if(r?.harborNetwork?.enabled&&m.type==='start'&&(!compatible(r)||r.players.size<2||r.players.size>4))return error(s,c,m,'短斷線保護僅供2～4位同版真人的一般單場圈數競速。');
 if(!['set-harbor-network','harbor-network-confirm'].includes(m.type))return false;
 if(!r||!p||c.viewer||m.roomCode!==r.code||p.client!==c)return error(s,c,m,'請以目前原席操作正確房間。');
 if(m.type==='set-harbor-network'){
  if(r.phase!=='lobby'||p.id!==r.hostId||m.expectedLobbyRevision!==r.lobbyRevision||typeof m.enabled!=='boolean'||!p.supportsHarborNetwork)return error(s,c,m,'只有房主可在最新大廳設定短斷線保護。');
  if(m.enabled&&!compatible(r))return error(s,c,m,'需全員同版真人、無觀眾的一般單場；請先關閉AI、系列及其他進階房規。');
  const n=state(r);n.enabled=m.enabled;clear(n);n.epoch++;n.uses={};s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);return true;
 }
 harborNetworkTick(s,r,now);const n=r.harborNetwork,i=n?.incidents.get(p.id);
 if(!n?.enabled||n.phase!=='waiting'||m.matchId!==r.matchId||m.trackRevision!==r.trackRevision||m.trackStamp!==r.trackStamp||m.epoch!==n.epoch||!i||!live(p)||!p.connected||!p.loaded||now>=i.deadlineAt)return error(s,c,m,'確認已過期，或地圖／原席狀態已變更；請確認最新提示。');
 i.confirmed=true;harborNetworkTick(s,r,now);s.broadcast(r,'room',now);return true;
}
export function harborNetworkPublic(r,now){
 harborNetworkClock(r,now);const n=state(r);if(r.phase!=='racing'&&n.phase!=='idle')clear(n);
 return {v:n.v,enabled:n.enabled,epoch:n.epoch,phase:n.phase,elapsedMs:n.elapsedMs,pausedAt:n.pausedAt,resumeAt:n.resumeAt,incidents:[...n.incidents.values()].map(i=>({...i})),uses:Object.fromEntries(players(r).map(p=>[p.id,n.uses[p.id]??0]))};
}
