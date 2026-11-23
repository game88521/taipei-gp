// Rex <game88521@gmail.com>. Cup station continuation preserves signed results and original seat identity, never cars.
import {parseFrontierCup} from '../shared/frontier-cup.ts';
import {checkpointPublish,checkpointRoomBase,checkpointRestoreRoom,checkpointAttach} from './meridian-room-checkpoints.mjs';
const VERSION='meridian-cup-checkpoint-v1',obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v),exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function parse(value){
 if(!exact(value,['version','cup','hostSlot','players'])||value.version!==VERSION||!Array.isArray(value.players)||value.players.length<2||value.players.length>4)return null;
 const cup=parseFrontierCup(value.cup);if(!cup||cup.status!=='ready'||value.players.length!==cup.entrants.length)return null;
 const ids=new Set(),slots=new Set();for(const p of value.players){if(!exact(p,['id','slot','name','color'])||!Number.isSafeInteger(p.slot)||p.slot<0||p.slot>3||slots.has(p.slot)||ids.has(p.id)||!cup.entrants.some(e=>e.playerId===p.id&&e.name===p.name&&e.color===p.color))return null;ids.add(p.id);slots.add(p.slot);}if(!slots.has(value.hostSlot))return null;return structuredClone(value);
}
export function meridianCupReceive(s,c,m,now){
 if(m.type==='checkpoint-export'&&c.room?.cup){
  try{const r=c.room,p=c.player;if(c.viewer||!p||p.id!==r.hostId||r.phase!=='lobby'||r.cup.status!=='ready'||!exact(m,['type','roomCode','expectedLobbyRevision','cupRevision',...m.requestId!==undefined?['requestId']:[]])||m.roomCode!==r.code||m.expectedLobbyRevision!==r.lobbyRevision||m.cupRevision!==r.cup.revision)throw Error('好友盃請先前往下一小場大廳，再由房主保存站間續局。');
   const state=parse({version:VERSION,cup:r.cup,hostSlot:p.slot,players:[...r.players.values()].map(q=>({id:q.id,slot:q.slot,name:q.name,color:q.color}))});if(!state)throw Error('好友盃站間摘要無效。');
   const sealed=checkpointPublish(s,r,{kind:'cup',state,previous:r.checkpointLineage},now);r.checkpointLineage={lineage:sealed.lineage,generation:sealed.generation};s.meridianCheckpoints.active('cup',sealed.id,()=>r);
  }catch(e){s.send(c,{type:'error',code:'CHECKPOINT_REJECTED',message:e.message,requestId:m.requestId});}return true;
 }
 if(m.type!=='checkpoint-restore'||c.room)return false;
 let verified;try{verified=s.meridianCheckpoints.verify(m.ticket);if(verified.kind!=='cup')return false;}catch{return false;}
 try{
  if(!s.compatible(m)||m.clientCapabilities?.meridianRacing!==true||!exact(m,['type','ticket','seatId','secret','version','physics','catalogStamp','clientCapabilities',...m.requestId!==undefined?['requestId']:[]]))throw Error('好友盃續局版本不相容。');
  const {payload,seat}=s.meridianCheckpoints.prove(m.ticket,m.seatId,m.secret,'cup'),state=parse(payload.state);if(!state||state.players.length!==payload.roster.length||state.players.some(p=>!payload.roster.some(q=>q.slot===p.slot&&q.name===p.name)))throw Error('好友盃簽章摘要與原席不一致。');
  const room=checkpointRestoreRoom(s,{payload,create:at=>{const r=checkpointRoomBase(s,state.cup.locked,at);if(r.trackStamp!==state.cup.locked.trackStamp)throw Error('大獎賽賽道已改版，無法恢復舊站間摘要。');r.cup=structuredClone(state.cup);for(const row of state.players.sort((a,b)=>a.slot-b.slot)){const p=s.makePlayer(r,row.name,m,at);p.id=row.id;p.slot=row.slot;p.color=row.color;p.client=null;p.connected=false;p.token=null;p.awaitingCheckpoint=true;p.disconnectedAt=null;p.loaded=p.ready=false;r.players.set(p.id,p);s.resetPlayer(r,p,at);}r.hostId=state.players.find(p=>p.slot===state.hostSlot).id;r.checkpointLineage={lineage:payload.lineage,generation:payload.generation};s.rooms.set(r.code,r);return r;}},now);
  if(room.phase!=='lobby'||!room.cup||room.cup.id!==state.cup.id||JSON.stringify(room.cup)!==JSON.stringify(state.cup))throw Error('原好友盃已繼續進行，不能使用較早站間摘要取代。');
  const original=state.players.find(p=>p.slot===seat.slot),p=room.players.get(original?.id);if(!p||p.client)throw Error('原席仍在線上；請先關閉原遊戲頁，避免同一車手開兩份。');
  checkpointAttach(s,c,m,{room,playerId:p.id},now);
 }catch(e){s.send(c,{type:'error',code:'CHECKPOINT_REJECTED',message:e.message,requestId:m.requestId});}return true;
}
export {parse as parseCupCheckpoint};
