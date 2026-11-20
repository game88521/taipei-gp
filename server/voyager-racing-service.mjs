import {getMultiplayerTrack} from '../shared/multiplayer-tracks.ts';
import {VOYAGER_RACING_VERSION,VOYAGER_VSC_MPS,defaultVoyagerSettings,voyagerSettings,voyagerEnabled,voyagerWet,voyagerPredict} from '../shared/voyager-racing.ts';
import {summitEvent} from './summit-events-service.mjs';
export const voyagerVisible=r=>[...r.players.values()].some(p=>p.supportsVoyager);
export const voyagerPractice=r=>r.voyager?.settings.practiceSeconds??0;
export const voyagerWeather=r=>!!r.voyager&&r.voyager.settings.weather!=='legacy';
const ensure=r=>r.voyager??={version:VOYAGER_RACING_VERSION,settings:defaultVoyagerSettings(),wet:0,vsc:{phase:'off',resumeAt:null,speedMps:VOYAGER_VSC_MPS},events:[]};
export function voyagerReset(r,p,now){p.voyager={lapValid:true,validLaps:[],bestSectorsMs:[null,null,null],lastSectorsMs:[null,null,null],joinedElapsedMs:0};p.voyagerSectorAt=0;p.voyagerSectors=[];p.voyagerSeq=-1;}
export function voyagerAdded(r,p,now){if(!voyagerPractice(r)||r.phase!=='racing')return;const elapsed=Math.max(0,now-r.startAt);p.lastLapElapsedMs=elapsed;p.voyager.joinedElapsedMs=elapsed;p.voyager.lapValid=false;p.voyagerSectorAt=elapsed;}
export function voyagerPublic(r){const v=ensure(r);v.wet=voyagerWet(v.settings.weather,Math.max(0,(r.simAt??r.startAt??0)-(r.startAt??0)),r.summit?.weather??0);if(r.summit&&v.settings.weather!=='legacy')r.summit.weather=v.wet;return structuredClone(v);}
export function voyagerJoinError(r,m){return voyagerEnabled(r.voyager?.settings)&&m.clientCapabilities?.voyagerRacing!==true?'此房使用自由練習／自選天候／VSC，請更新遊戲後加入。':'';}
export const voyagerCompatible=r=>!r.series&&r.evolution.mode==='race'&&!Object.values(r.horizon).some(Boolean)&&(!r.arena||r.arena.mode==='off')&&!r.summit?.settings.weekend;
const fail=(s,c,m,text)=>{s.send(c,{type:'error',code:'VOYAGER_RULE',requestId:m.requestId,message:text});return true;};
export function voyagerReceive(s,c,m,now){
 if(!['set-voyager','voyager-vsc'].includes(m.type)){
  if(c.room&&voyagerPractice(c.room)&&m.type==='select-track'&&!getMultiplayerTrack(m.trackId)?.circuit)return fail(s,c,m,'自由練習只能選擇大獎賽地圖。');
  if(c.room&&voyagerEnabled(c.room.voyager?.settings)&&['resolve-vote','configure-event','configure-series','random-series','set-horizon','set-arena','set-summit','set-room-rules'].includes(m.type))return fail(s,c,m,'請先關閉 Voyager 練習／天候／VSC，再切換其他房規。');return false;
 }
 const r=c.room,p=c.player;if(!r||!p||c.viewer||!p.supportsVoyager||r.hostId!==p.id)return fail(s,c,m,'只有使用新版的房主能設定 Voyager 房規。');
 if(m.roomCode!==r.code)return fail(s,c,m,'房間已變更。');const v=ensure(r);
 if(m.type==='set-voyager'){
  const keys=['type','roomCode','expectedLobbyRevision','settings','requestId'];if(Object.keys(m).some(k=>!keys.includes(k))||r.phase!=='lobby'||m.expectedLobbyRevision!==r.lobbyRevision)return fail(s,c,m,'請確認目前大廳版本後再套用。');
  const settings=voyagerSettings(m.settings);if(!settings||voyagerEnabled(settings)&&(!voyagerCompatible(r)||[...r.players.values()].some(q=>!q.supportsVoyager||!q.supportsSummit)||[...r.spectators.values()].some(q=>!q.supportsVoyager||!q.supportsSummit)||settings.practiceSeconds&&(r.summit?.settings.ai||r.summit?.settings.endurance||!s.trackFor(r.trackId)?.descriptor.circuit)))return fail(s,c,m,'自由練習需大獎賽地圖、只限真人的一般單場；所有席位需新版。天候與 VSC 可搭配一般賽／耐久，先關閉排位與其他玩法。');
  if(!v.settings.practiceSeconds&&settings.practiceSeconds)r.voyagerSavedCollisions=r.roomRules.collisions;
  if(v.settings.practiceSeconds&&!settings.practiceSeconds)r.roomRules.collisions=r.voyagerSavedCollisions??true;
  v.settings=settings;
  // A lobby setting change starts a new weather selection. Do not feed the old
  // forced rain into legacy; its endurance curve begins only after race start.
  v.wet=voyagerWet(settings.weather,0,0);if(r.summit)r.summit.weather=v.wet;
  if(settings.practiceSeconds)r.roomRules.collisions=false;v.events=[];v.vsc={phase:'off',resumeAt:null,speedMps:VOYAGER_VSC_MPS};s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);return true;
 }
 if(Object.keys(m).some(k=>!['type','roomCode','matchId','trackRevision','seq','active','requestId'].includes(k))||!v.settings.vsc||r.phase!=='racing'||m.matchId!==r.matchId||m.trackRevision!==r.trackRevision||!Number.isSafeInteger(m.seq)||m.seq<0||m.seq>0x7fffffff||typeof m.active!=='boolean')return fail(s,c,m,'目前無法切換 VSC。');
 if(m.seq<=p.voyagerSeq)return true;p.voyagerSeq=m.seq;
 if(m.active){if(v.vsc.phase==='active')return true;v.vsc.phase='active';v.vsc.resumeAt=null;record(r,now,'start',[],`VSC 啟動：80 km/h、禁止超車；${r.expedition?.settings.vsc?'正式賽規每次超車加5秒':'超車不自動加秒'}`);r.voyagerOrder=null;r.expeditionOrder=null;}
 else{if(v.vsc.phase!=='active')return true;v.vsc.phase='resuming';v.vsc.resumeAt=now+3000;record(r,now,'resume',[],'VSC 三秒後解除；倒數期間仍限速、禁止超車');}
 s.broadcast(r,'room',now);return true;
}
function record(r,at,type,actors,detail){const v=ensure(r);v.events.push({at:Math.min(720000,Math.max(0,at-r.startAt)),type,actors,detail});if(v.events.length>64)v.events.shift();summitEvent(r,at,'session',actors,detail);}
export function voyagerStart(r){if(!voyagerVisible(r))return;const v=ensure(r);v.events=[];v.vsc={phase:'off',resumeAt:null,speedMps:VOYAGER_VSC_MPS};r.voyagerOrder=null;v.wet=voyagerWet(v.settings.weather,0,0);if(r.summit)r.summit.weather=v.wet;}
export function voyagerTick(r,at){const v=r.voyager;if(!v)return;if(v.vsc.phase==='resuming'&&at>=v.vsc.resumeAt){v.vsc.phase='off';v.vsc.resumeAt=null;record(r,at,'end',[],'VSC 解除，可恢復競速');r.voyagerOrder=null;}}
export function voyagerBefore(r,p,at){voyagerTick(r,at);const active=r.voyager?.vsc.phase!=='off'&&!!r.voyager;if(!active&&p.voyagerCapApplied&&!r.summit?.settings.endurance&&!voyagerWeather(r)&&!r.atlas?.settings.damage)p.car.speedCap=Infinity;voyagerPredict(p.car,{voyager:r.voyager},at);p.voyagerCapApplied=active;}
export function voyagerAfter(r,p,at){voyagerPredict(p.car,{voyager:r.voyager},at);if(voyagerPractice(r)&&p.car.touch)p.voyager.lapValid=false;}
export function voyagerGate(r,p,gate,elapsed,lapMs){
 if(!voyagerPractice(r))return false;const v=p.voyager,part=elapsed-p.voyagerSectorAt;p.voyagerSectorAt=elapsed;p.voyagerSectors.push(Math.max(.001,part));
 if(gate!==3)return false;
 v.lastSectorsMs=[...p.voyagerSectors];if(v.lapValid&&elapsed<=voyagerPractice(r)*1000){v.validLaps.push(lapMs);for(let i=0;i<3;i++)v.bestSectorsMs[i]=Math.min(v.bestSectorsMs[i]??Infinity,p.voyagerSectors[i]);}
 p.bestLapMs=v.validLaps.length?Math.min(...v.validLaps):null;v.lapValid=true;p.voyagerSectors=[];return true;
}
export function voyagerOrder(r,at){const v=r.voyager;if(!v||v.vsc.phase==='off')return;const rows=[...r.players.values()].filter(p=>p.connected&&p.loaded&&!p.dnf&&p.finishMs===null&&!(p.summit?.pitUntil>at)&&!p.summit?.pitArmed).sort((a,b)=>b.distance-a.distance||a.slot-b.slot),old=r.voyagerOrder;if(!old){r.voyagerOrder=rows.map(p=>p.id);r.voyagerOrderSeen=new Set();return;}for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],key=[a.id,b.id].sort().join(':');if(!r.voyagerOrderSeen.has(key)&&old.includes(a.id)&&old.includes(b.id)&&old.indexOf(a.id)>old.indexOf(b.id)&&a.distance-b.distance>1){r.voyagerOrderSeen.add(key);record(r,at,'order',[a.id,b.id],r.expedition?.settings.vsc?'VSC 次序變動：正式賽規另按有效超車加秒；不判肇責':'VSC 次序變動：請遵守禁超車；只記錄，不自動加秒／判肇責');}}}
export function voyagerFinish(s,r,now){const seconds=voyagerPractice(r);if(!seconds)return null;if(now<r.startAt+seconds*1000&&![...r.players.values()].every(p=>p.dnf))return false;for(const p of r.players.values()){if(!p.dnf&&p.bestLapMs!==null)p.finishMs=p.bestLapMs;else s.markDnf(p,'time-trial-no-lap');p.car.v=0;}r.phase='results';r.updatedAt=now;s.broadcast(r,'room',now);return true;}
