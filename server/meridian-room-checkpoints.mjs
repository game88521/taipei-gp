import {randomUUID,randomBytes} from 'node:crypto';
import {defaultEvolution} from '../shared/multiplayer-evolution.ts';
import {defaultHorizon} from '../shared/multiplayer-horizon.ts';
import {defaultArena} from '../shared/multiplayer-arena.ts';
import {MERIDIAN_CHECKPOINT_VERSION} from '../shared/meridian-checkpoints.ts';
const status=(s,r)=>{const x=r.checkpointSession;if(!x)return;const ready=x.acks.size===x.sealed.seats.length,message={type:'checkpoint-state',v:MERIDIAN_CHECKPOINT_VERSION,id:x.sealed.id,acks:x.acks.size,required:x.sealed.seats.length,ready,persistentSigning:s.meridianCheckpoints.persistentSigning,ticket:ready?x.sealed.ticket:null};for(const p of r.players.values())if(p.connected)s.send(p.client,message);};
export function checkpointPublish(s,r,{kind,state,previous},now){
 const players=[...r.players.values()];if(players.length<2||players.some(p=>p.isAi||!p.connected||!p.client||p.expired||!p.supportsMeridian))throw Error('站間保存需要全員新版原席連線。');
 const sealed=s.meridianCheckpoints.seal({kind,state,seats:players.map(p=>({ref:p.id,slot:p.slot,name:p.name})),previous});if(r.checkpointSession)s.meridianCheckpoints.forget(r.checkpointSession.kind,r.checkpointSession.sealed.id,r);r.checkpointSession={kind,sealed,acks:new Set(),revision:r.lobbyRevision};
 for(const seat of sealed.seats){const p=r.players.get(seat.ref);s.send(p.client,{type:'checkpoint-seat',v:MERIDIAN_CHECKPOINT_VERSION,ticket:sealed.ticket,seatId:seat.seatId,secret:seat.secret,persistentSigning:s.meridianCheckpoints.persistentSigning});}status(s,r);r.updatedAt=now;return sealed;
}
export function checkpointAck(s,c,m){
 if(m.type!=='checkpoint-ack')return false;const r=c.room,x=r?.checkpointSession,p=c.player;
 try{if(!p||c.viewer||!x||m.id!==x.sealed.id||Object.keys(m).some(k=>!['type','id','seatId','secret'].includes(k)))throw Error('站間確認已失效。');const seat=x.sealed.seats.find(seat=>seat.ref===p.id);if(!seat||seat.seatId!==m.seatId)throw Error('原席確認不符。');s.meridianCheckpoints.prove(x.sealed.ticket,m.seatId,m.secret,x.kind);x.acks.add(p.id);status(s,r);}catch(e){s.send(c,{type:'error',code:'CHECKPOINT_REJECTED',message:e.message});}return true;
}
export function checkpointRoomBase(s,{trackId,laps,roomRules},now){
 if(s.rooms.size>=s.maxRooms)throw Error('房間數量已滿，請稍後再恢復。');const selected=s.trackFor(trackId);let code;do{code=randomUUID().replaceAll('-','').slice(0,6).toUpperCase().replace(/[01]/g,'A');}while(s.rooms.has(code));
 return{code,hostId:'',phase:'lobby',matchId:null,startAt:null,laps,lobbyRevision:1,removedPlayerIds:new Set(),series:null,roomRules:{...roomRules},evolution:defaultEvolution(),horizon:defaultHorizon(),arena:defaultArena(),spectators:new Map(),requiresEvolution:false,trackId,trackStamp:selected.descriptor.trackStamp,trackRevision:1,track:selected.track,players:new Map(),createdAt:now,updatedAt:now,emptySince:null,simAt:null,lastSnapshotAt:now,firstFinishAt:null};
}
export function checkpointRestoreRoom(s,{payload,create},now){
 let room=s.meridianCheckpoints.active(payload.kind,payload.id,()=>create(now));
 if(!s.rooms.has(room.code)){s.meridianCheckpoints.forget(payload.kind,payload.id,room);room=s.meridianCheckpoints.active(payload.kind,payload.id,()=>create(now));}
 room.restoredCheckpoint={kind:payload.kind,id:payload.id};return room;
}
export function checkpointAttach(s,c,m,{room,playerId},now){
 const p=room.players.get(playerId);if(!p||c.room)throw Error('原席或連線狀態已變更。');const old=p.client;
 if(old&&old!==c){old.room=null;old.player=null;s.send(old,{type:'left'});old.ws.close(1000,'Checkpoint seat resumed');}
 p.client=c;p.token=randomBytes(32).toString('hex');p.connected=true;p.disconnectedAt=null;p.expired=false;p.awaitingCheckpoint=false;p.loaded=false;p.ready=false;p.receivedSeq=p.ackSeq=-1;p.input={steer:0,brake:true};p.lastInputAt=now;p.meridianSeq=-1;p.summitSeq=-1;p.arenaUsedSeq=-1;p.voyagerSeq=-1;
 c.room=room;c.player=p;room.emptySince=null;room.updatedAt=now;
 s.welcome(c,m,now);s.broadcast(room,'room',now);return p;
}
export function checkpointForget(s,r){const x=r.restoredCheckpoint;if(x)s.meridianCheckpoints.forget(x.kind,x.id,r);if(r.checkpointSession)s.meridianCheckpoints.forget(r.checkpointSession.kind,r.checkpointSession.sealed.id,r);}
