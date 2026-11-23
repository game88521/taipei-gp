import {randomBytes,randomUUID} from 'node:crypto';
import {Car} from './physics.mjs';
import {FRONTIER_CUP_VERSION,AURORA_CUP_VERSION,CUP_MATCH_KEYS,cupActiveIds,cupCompatible,cupExpectedPair,leaguePairs,cupIsComplete} from '../shared/frontier-cup.ts';
export const CUP_RESUME_MS=15000;
export const cupCanDrive=(room,player)=>!room.cup||cupActiveIds(room.cup).includes(player.id);
export const cupPlayer=(room,player)=>room.cup?{active:cupCanDrive(room,player),seed:room.cup.entrants.find(e=>e.playerId===player.id).seed}:null;
function fail(s,c,m,message){s.send(c,{type:'error',code:'CUP_RULE',message,requestId:m.requestId});return true;}
const pending=(key)=>({key,pair:null,attempt:1,matchId:null,status:'pending',reason:null,winnerId:null,loserId:null,results:[]});
function clearMatch(m){m.matchId=null;m.status='pending';m.reason=null;m.winnerId=null;m.loserId=null;m.results=[];}
/** Match seats use the same two lateral grid locations in every round, regardless of their original seed. */
export function cupGridCar(room,slot){
 if(!room.cup)return null;const p=[...room.players.values()].find(p=>p.slot===slot),index=cupActiveIds(room.cup).indexOf(p?.id),lat=index===0?-1:index===1?1:0;
 const car=new Car();car.resetTransient(false);car.placeAt(room.track,0);car.x+=-room.track.tz[0]*lat;car.z+=room.track.tx[0]*lat;car.pos.lat=lat;return car;
}
/** A cancelled countdown preserves the fixed bracket and asks all four original seats to ready again. */
export function cupBeforeLobby(room){if(room.cup?.status==='running'){clearMatch(room.cup.matches[room.cup.index]);room.cup.status='ready';room.cup.revision++;}}
export function cupReceive(s,c,m,now){
 const target=c.room??(['join','watch'].includes(m.type)?s.rooms.get(m.code):null);
 if(target?.cup&&['join','watch','claim-seat'].includes(m.type))return fail(s,c,m,'好友盃已鎖定四位原車手；請原車手用原席續接，或等房主結束整盃。');
 const r=c.room,p=c.player,command=['cup-configure','cup-configure-league','cup-start','cup-next','cup-replay','cup-cancel'].includes(m.type);
 if(!command){
  if(m.type==='ready'&&r&&!r.cup&&m.cupReady!==undefined)return fail(s,c,m,'這是先前好友盃的準備操作；請在目前大廳重新確認。');
  if(!r?.cup)return false;
  if(m.type==='ready'){
   const binding=m.cupReady;
   if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).length!==3||!['cupId','cupRevision','lobbyRevision'].every(k=>Object.hasOwn(binding,k))||binding.cupId!==r.cup.id||binding.cupRevision!==r.cup.revision||binding.lobbyRevision!==r.lobbyRevision||Object.keys(m).some(k=>!['type','ready','trackRevision','trackStamp','cupReady','requestId'].includes(k)))return fail(s,c,m,'本小場或大廳已更新；請確認目前好友盃後重新準備。');
  }
  if(m.type==='input'&&p&&!cupCanDrive(r,p))return fail(s,c,m,'你正在原席觀戰，本小場只有兩位指定車手能操控。');
  if(['track-loaded','ready','input','leave','transfer-host','replay-chunk'].includes(m.type))return false;
  return fail(s,c,m,'好友盃期間名單、賽道、圈數與房規固定；請使用好友盃操作，或明確取消整盃。');
 }
 if(!r||!p||c.viewer||r.hostId!==p.id||!p.supportsCup)return fail(s,c,m,'只有新版房主能操作好友盃。');
 if(Object.keys(m).some(k=>!['type','roomCode','cupId','expectedCupRevision','expectedLobbyRevision','matchId','trackRevision','requestId'].includes(k))||m.roomCode!==r.code||m.expectedLobbyRevision!==r.lobbyRevision||m.trackRevision!==r.trackRevision||m.cupId!==(r.cup?.id??null)||m.expectedCupRevision!==(r.cup?.revision??0)||m.matchId!==r.matchId)return fail(s,c,m,'好友盃狀態已更新，請確認目前小場後再操作。');
 if(m.type==='cup-cancel'){
  if(!r.cup)return fail(s,c,m,'目前沒有進行中的好友盃。');
  r.cup=null;for(const q of [...r.players.values()])if(q.expired&&!q.connected)r.players.delete(q.id);s.toLobby(r,now);return true;
 }
 if(m.type==='cup-configure'||m.type==='cup-configure-league'){
  const league=m.type==='cup-configure-league';if(r.cup||r.phase!=='lobby'||!cupCompatible(r)||r.spectators.size||r.players.size<(league?2:4)||r.players.size>4||[...r.players.values()].some(q=>q.isAi||!q.connected||!q.loaded||!q.supportsCup||league&&!q.supportsAuroraCup))return fail(s,c,m,league?'循環好友盃需要2～4位已載入的Aurora真人、沒有外部觀眾，並先關閉其他特殊玩法。':'好友盃需要四位已載入的新版真人、沒有外部觀眾，並先關閉系列／AI／其他特殊玩法。');
  const entrants=[...r.players.values()].sort((a,b)=>a.slot-b.slot).map((q,i)=>({playerId:q.id,name:q.name,color:q.color,seed:i+1}));
  const matchKeys=league?[...leaguePairs(entrants).map((_,i)=>`round-${i+1}`),'final-1','final-2','final-3']:CUP_MATCH_KEYS;
  r.cup={version:FRONTIER_CUP_VERSION,id:randomBytes(12).toString('hex'),revision:1,index:0,status:'ready',locked:{trackId:r.trackId,trackStamp:r.trackStamp,laps:r.laps,roomRules:{...r.roomRules}},entrants,matches:matchKeys.map(pending),...(league?{league:{version:AURORA_CUP_VERSION}}:{})};
  for(let i=0;i<r.cup.matches.length;i++)r.cup.matches[i].pair=cupExpectedPair(r.cup,i);s.toLobby(r,now);return true;
 }
 const cup=r.cup,match=cup?.matches[cup.index];
 if(!cup)return fail(s,c,m,'請先建立好友盃。');
 if(m.type==='cup-start'){
  if(cup.status!=='ready'||r.phase!=='lobby'||!cupCompatible(r)||[...r.players.values()].some(q=>q.expired||!q.connected||!q.loaded||!q.ready||!q.supportsCup))return fail(s,c,m,'本小場需要四個原席都已連線、載入並重新準備；失去原席且逾期時，請取消整盃後重開。');
  r.phase='countdown';r.matchId=randomUUID();r.startAt=now+3000;r.simAt=r.startAt;r.firstFinishAt=null;r.updatedAt=now;
  cup.status='running';cup.revision++;match.status='running';match.matchId=r.matchId;
  for(const q of r.players.values())s.resetPlayer(r,q,now);
  s.broadcast(r,'room',now);return true;
 }
 if(r.phase!=='results')return fail(s,c,m,'請等待本小場結算，再前往下一場或重賽。');
 if(m.type==='cup-next'){
  if(cup.status!=='decided'||cup.index>=cup.matches.length-1)return fail(s,c,m,'本小場還沒有可晉級的勝負；平手、雙方未完賽或伺服器停頓必須重賽。');
  cup.index++;cup.status='ready';cup.revision++;s.toLobby(r,now);return true;
 }
 if(m.type==='cup-replay'){
  if(cup.status!=='replay'||match.attempt>=9999)return fail(s,c,m,'目前沒有可重賽的小場，或已達重賽上限；可明確取消整盃。');
  match.attempt++;clearMatch(match);cup.status='ready';cup.revision++;s.toLobby(r,now);return true;
 }
 return true;
}
export function cupStall(s,room,now){
 if(!room.cup)return false;
 room.cupStalled=true;for(const p of room.players.values())if(cupCanDrive(room,p))s.markDnf(p,'server-stall');cupFinish(s,room,now);return true;
}
/** Only two active seats participate in finish/timeout logic. A lone DNF never awards an unfinished opponent a win. */
export function cupFinish(s,r,now){
 const cup=r.cup;if(!cup)return null;if(r.phase!=='racing')return false;
 const m=cup.matches[cup.index];if(cup.status!=='running'||m.matchId!==r.matchId||m.status!=='running')return false;
 const pair=m.pair.map(id=>r.players.get(id));
 const expired=now-r.startAt>=s.raceLimitMs||r.firstFinishAt!==null&&now-r.firstFinishAt>=s.graceMs(r);
 if(!r.cupStalled&&!expired&&!pair.every(p=>p.dnf||p.finishMs!==null))return false;
 if(expired)for(const p of pair)s.markDnf(p,s.deadline(r).deadlineReason);
 const results=pair.map(p=>({playerId:p.id,finishMs:p.finishMs===null?null:Math.round(p.finishMs*1000)/1000,dnf:!!p.dnf,dnfReason:p.dnfReason??null}));
 const finish=results.filter(p=>!p.dnf&&p.finishMs!==null).sort((a,b)=>a.finishMs-b.finishMs);
 const reason=r.cupStalled?'server-stall':finish.length===0?'both-dnf':finish.length===2&&finish[0].finishMs===finish[1].finishMs?'tie':null;
 m.results=results;m.reason=reason;
 if(reason){m.status='replay';cup.status='replay';}
 else{m.status='decided';m.winnerId=finish[0].playerId;m.loserId=m.pair.find(id=>id!==m.winnerId);cup.status=cupIsComplete(cup)?'complete':'decided';}
 cup.revision++;r.cupStalled=false;
 for(let i=0;i<cup.matches.length;i++)cup.matches[i].pair=cupExpectedPair(cup,i);
 for(const p of r.players.values())p.car.v=0;
 r.phase='results';r.updatedAt=now;s.broadcast(r,'room',now);return true;
}
