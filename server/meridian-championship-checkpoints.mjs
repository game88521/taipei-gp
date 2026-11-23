import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../shared/multiplayer-protocol.ts';
import {parseRoomRules} from '../shared/multiplayer-room-rules.ts';
import {parseMeridianState} from '../shared/meridian-racing.ts';
import {defaultMeridianAdvanced,parseMeridianAdvanced} from '../shared/meridian-presets.ts';
import {applyMeridianPreset} from './meridian-presets-service.mjs';
import {checkpointPublish,checkpointRestoreRoom,checkpointRoomBase,checkpointAttach} from './meridian-room-checkpoints.mjs';
import {decodeCheckpointTicket} from '../shared/meridian-checkpoints.ts';
const canSave=r=>r?.phase==='results'&&r.meridian?.settings.mode==='championship'&&r.meridian.stage==='race'&&!r.meridian.complete&&!r.meridian.aborted&&r.meridian.rounds[r.meridian.roundIndex]?.race.length===r.meridian.entrants.length;
function stateFor(r){const advanced=defaultMeridianAdvanced();advanced.summit=r.summit?.settings??advanced.summit;advanced.atlas=r.atlas?.settings??advanced.atlas;advanced.voyager=r.voyager?.settings??advanced.voyager;advanced.meridian=r.meridian.settings;return{format:'meridian-championship-station-v1',protocol:PROTOCOL_VERSION,physicsVersion:PHYSICS_VERSION,catalog:CATALOG_STAMP,trackId:r.trackId,laps:r.meridian.raceLaps,roomRules:r.roomRules,advanced,championship:r.meridian,hostId:r.hostId};}
function parseState(v,roster){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==10||v.format!=='meridian-championship-station-v1'||v.protocol!==PROTOCOL_VERSION||v.physicsVersion!==PHYSICS_VERSION||v.catalog!==CATALOG_STAMP||![1,3,5].includes(v.laps))throw Error('跨圖錦標賽摘要版本不符。');const m=parseMeridianState(v.championship),rules=parseRoomRules(v.roomRules);
 if(!m||m.settings.mode!=='championship'||!m.locked||m.stage!=='race'||m.complete||m.aborted||m.rounds.length!==m.roundIndex+1||m.rounds.at(-1)?.race.length!==m.entrants.length||v.trackId!==m.settings.trackIds[m.roundIndex]||v.laps!==m.raceLaps||roster.length!==m.entrants.length||roster.some(seat=>!m.entrants.some(e=>e.slot===seat.slot&&e.name===seat.name))||!m.entrants.some(e=>e.id===v.hostId)||!rules)throw Error('只有完整正賽站間、原席一致的摘要可恢復。');
 const advanced=parseMeridianAdvanced(v.advanced,{trackId:m.settings.trackIds[0],laps:v.laps,trackIds:[],mode:'race',roomRules:rules,horizon:{}});if(!advanced||JSON.stringify(advanced.meridian)!==JSON.stringify(m.settings))throw Error('跨圖錦標賽房規不一致。');return{...v,championship:m,roomRules:rules,advanced};
}
function nextLobby(s,r,state,payload,now){
 r.meridian=structuredClone(state.championship);const season=r.meridian;season.roundIndex++;season.stage='qualifying';season.grid=season.entrants.map(e=>e.id);season.revision++;r.laps=season.raceLaps;
 for(const p of r.players.values()){p.client=null;p.token=null;p.connected=p.loaded=p.ready=false;p.awaitingCheckpoint=true;p.disconnectedAt=now;p.expired=false;}
 const id=season.settings.trackIds[season.roundIndex];s.changeTrack(r,id,s.trackFor(id),now);s.toLobby(r,now);r.hostId=state.hostId;r.checkpointLineage={lineage:payload.lineage,generation:payload.generation};r.checkpointRestoringId=payload.id;r.checkpointMeridianRevision=season.revision;
}
export function meridianChampionshipCheckpoints(s,c,m,now){
 if(m.type==='checkpoint-export'&&c.room?.meridian?.settings.mode==='championship'){
  try{const r=c.room;if(c.viewer||r.hostId!==c.player?.id||m.roomCode!==r.code||m.expectedLobbyRevision!==r.lobbyRevision||m.meridianRevision!==r.meridian.revision||!canSave(r))throw Error('只有房主能在完整正賽結束後保存下一站續局。');const sealed=checkpointPublish(s,r,{kind:'championship',state:stateFor(r),previous:r.checkpointLineage},now);r.checkpointLineage={lineage:sealed.lineage,generation:sealed.generation};r.checkpointMeridianRevision=r.meridian.revision;s.meridianCheckpoints.active('championship',sealed.id,()=>r);}catch(e){s.send(c,{type:'error',code:'CHECKPOINT_REJECTED',requestId:m.requestId,message:e.message});}return true;
 }
 if(m.type!=='checkpoint-restore'||decodeCheckpointTicket(m.ticket)?.kind!=='championship')return false;
 try{
  if(c.room||!s.compatible(m)||m.clientCapabilities?.meridianRacing!==true||m.clientCapabilities?.summit!==true||m.clientCapabilities?.atlasRacing!==true||m.clientCapabilities?.voyagerRacing!==true)throw Error('請先離開房間，並更新到相同版本。');const {payload,seat}=s.meridianCheckpoints.prove(m.ticket,m.seatId,m.secret,'championship'),state=parseState(payload.state,payload.roster);
  for(const id of state.championship.settings.trackIds)s.trackFor(id);
  const room=checkpointRestoreRoom(s,{payload,create(){const r=checkpointRoomBase(s,{trackId:state.trackId,laps:state.laps,roomRules:state.roomRules},now);applyMeridianPreset(r,state.advanced);r.meridian=structuredClone(state.championship);r.hostId=state.hostId;
   for(const e of r.meridian.entrants){const p=s.makePlayer(r,e.name,m,now);p.id=e.id;p.slot=e.slot;p.color=['#ef5350','#42a5f5','#ffca28','#66bb6a'][e.slot];r.players.set(p.id,p);}s.rooms.set(r.code,r);nextLobby(s,r,state,payload,now);return r;}},now);
  if(room.checkpointRestoringId!==payload.id){if(!canSave(room)||room.checkpointMeridianRevision!==room.meridian.revision||[...room.players.values()].some(p=>p.connected)||JSON.stringify(room.meridian)!==JSON.stringify(state.championship))throw Error('原房仍有人在線，或已進入下一階段；請全員離開後恢復，或使用最新站間續局。');nextLobby(s,room,state,payload,now);}
  if(room.phase!=='lobby'||room.meridian.stage!=='qualifying'||room.meridian.roundIndex!==state.championship.roundIndex+1||room.checkpointMeridianRevision!==room.meridian.revision)throw Error('該來源房已繼續比賽，請使用最新站間續局。');const entrant=state.championship.entrants.find(e=>e.slot===seat.slot);if(room.players.get(entrant.id)?.connected)throw Error('這個原席仍在線上，請先關閉原遊戲頁。');checkpointAttach(s,c,m,{room,playerId:entrant.id},now);
 }catch(e){s.send(c,{type:'error',code:'CHECKPOINT_REJECTED',requestId:m.requestId,message:e.message});}return true;
}
export {canSave as meridianChampionshipCanSave};
