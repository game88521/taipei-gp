import {voyagerWeather,voyagerPublic} from './voyager-racing-service.mjs';
import {voyagerWet} from '../shared/voyager-racing.ts';
import {atlasEnabled,atlasVisible,atlasEnsure,atlasReset,atlasJoinError,atlasAiPlan} from './atlas-racing-service.mjs';
import {ATLAS_PIT_SERVICES,atlasPitMs} from '../shared/atlas-racing.ts';
import {Car} from './physics.mjs';
import {defaultSummitSettings,summitSettings,SUMMIT_TYRES,summitWet,summitWear,summitPredict} from '../shared/summit-racing.ts';
import {summitEvent,summitEventsEnabled} from './summit-events-service.mjs';
import {odysseyPreserveLobby,odysseyRosterChanged,odysseyJoinError,odysseyPitStarted,odysseyPitCompleted} from './odyssey-racing-service.mjs';
export const summitActive=r=>!!r.summit&&(r.summit.settings.weekend||r.summit.settings.ai>0||r.summit.settings.endurance>0||atlasEnabled(r)||voyagerWeather(r));
export const summitTimed=r=>!!r.summit&&(r.summit.stage==='qualifying'||r.summit.settings.endurance>0);
export const summitDuration=r=>r.summit?.stage==='qualifying'?180:r.summit?.settings.endurance||null;
const state=()=>({ai:false,compound:'medium',wear:0,pitArmed:false,pitUntil:0,pitStops:0,nextCompound:'medium',lapValid:true,validLaps:[]});
const ensure=r=>r.summit??={settings:defaultSummitSettings(),stage:'single',qualifying:[],weather:0,revision:1};
export function summitResetPlayer(r,p){atlasReset(p);p.summit={...state(),ai:!!p.isAi};if(p.isAi)p.connected=p.loaded=p.ready=true;}
export function summitResetLobby(r){if(!r.summit)return;if(!r.summitTransition&&!odysseyPreserveLobby(r)){r.summit.stage=r.summit.settings.weekend?'qualifying':'single';r.summit.qualifying=[];}r.summit.weather=0;}
/** A changed race-lobby roster invalidates the entire qualifying grid. */
export function summitRosterChanged(s,r,now){
 if(odysseyRosterChanged(s,r,now))return true;
 if(!r.summit?.settings.weekend||r.summit.stage!=='race'||r.phase!=='lobby')return false;
 const q=r.summit.qualifying;if(q.length===r.players.size&&q.every(row=>r.players.has(row.id)))return false;
 r.summit.stage='qualifying';r.summit.qualifying=[];r.summit.revision++;r.trackRevision++;
 for(const p of r.players.values())p.loaded=false;
 s.toLobby(r,now);return true;
}
export function summitLobby(r){for(const p of r.players.values())if(p.isAi)p.connected=p.ready=p.loaded=true;}
export function summitPublic(r){const s=ensure(r);return{settings:{...s.settings},stage:s.stage,qualifying:structuredClone(s.qualifying),weather:s.weather,durationSeconds:summitDuration(r),mixed:[...r.players.values()].some(p=>p.isAi),revision:s.revision};}
export function summitCompatible(r){return!r.series&&r.evolution.mode==='race'&&!Object.values(r.horizon).some(Boolean)&&(!r.arena||r.arena.mode==='off');}
export function summitRejectOther(r,m){return summitActive(r)&&(['configure-event','configure-series','random-series','set-horizon','set-arena'].includes(m.type))&&!(m.type==='set-arena'&&m.mode==='off');}
export function summitJoinError(r,m){const odysseyError=odysseyJoinError(r,m);if(odysseyError)return odysseyError;const atlasError=atlasJoinError(r,m);if(atlasError)return atlasError;if(summitActive(r)&&m.clientCapabilities?.summit!==true)return'此房包含AI／排位週末／耐久，請更新遊戲後加入。';if(r.summit?.settings.weekend&&r.summit.stage==='race')return'排位名單已鎖定，請等完整週末結束後加入。';return'';}
function fail(s,c,text){s.send(c,{type:'error',code:'SUMMIT_RULE',message:text});return true;}
export function summitReceive(s,c,m,now){
 if(!['set-summit','next-weekend','summit-pit'].includes(m.type))return false;
 const r=c.room,p=c.player;if(!r||!p||c.viewer||!p.supportsSummit)return fail(s,c,'請先以新版車手身分加入房間。');
 if(m.roomCode!==r.code)return fail(s,c,'房間已變更。');ensure(r);
 if(m.type==='summit-pit'){
  if(r.phase!=='racing'||r.summit.stage==='qualifying'||(!r.summit.settings.endurance&&!voyagerWeather(r)&&!r.atlas?.settings.damage)||m.matchId!==r.matchId||m.trackRevision!==r.trackRevision||!Number.isSafeInteger(m.seq)||m.seq<0||m.seq>0x7fffffff||!SUMMIT_TYRES.includes(m.compound)||typeof m.armed!=='boolean'||!p.connected||!p.loaded||p.dnf||p.finishMs!==null)return fail(s,c,'目前無法設定這場耐久的換胎策略。');
  const service=m.service??'tyres';if(!ATLAS_PIT_SERVICES.includes(service)||service!=='tyres'&&(!p.supportsAtlas||!r.atlas?.settings.damage)||service!=='repair'&&!r.summit.settings.endurance&&!voyagerWeather(r))return fail(s,c,'本房不支援這個維修項目。');
  if(m.seq<=(p.summitSeq??-1))return true;p.summitSeq=m.seq;if(p.summit.pitUntil>now)return fail(s,c,'維修作業開始後不能更改胎種。');
  p.atlas.pitService=service;p.atlas.pitDurationMs=atlasPitMs(service,p.atlas.damage);p.summit.nextCompound=m.compound;p.summit.pitArmed=m.armed;s.broadcast(r,'room',now);return true;
 }
 if(r.hostId!==p.id)return fail(s,c,'只有房主能設定進階賽事。');
 if(m.expectedLobbyRevision!==r.lobbyRevision)return fail(s,c,'大廳已更新，請確認目前設定。');
 if(m.type==='next-weekend'){
  if(!r.summit.settings.weekend||r.summit.stage!=='qualifying'||r.phase!=='results')return fail(s,c,'請先完成三分鐘排位。');
  if([...r.players.values()].some(v=>!v.connected&&!v.expired))return fail(s,c,'原席仍在續接期限內，請等車手回來後再進入正賽。');
  const remaining=[...r.players.values()].filter(v=>v.connected&&!v.expired);if(remaining.length<2)return fail(s,c,'正賽至少需要兩位可出賽車手，可先等待原席續接，或重設週末。');
  for(const v of [...r.players.values()])if(!remaining.includes(v))r.players.delete(v.id);
  r.summit.qualifying=r.summit.qualifying.filter(q=>r.players.has(q.id)).map((q,i)=>({...q,grid:i+1}));r.summit.stage='race';r.summit.revision++;r.trackRevision++;
  r.summitTransition=true;s.toLobby(r,now);r.summitTransition=false;return true;
 }
 const settings=summitSettings(m.settings);
 if(r.phase!=='lobby'||!settings||!summitCompatible(r)||[...r.players.values()].some(v=>!v.isAi&&!v.supportsSummit)||[...r.spectators.values()].some(v=>!v.supportsSummit)||settings.ai+[...r.players.values()].filter(v=>!v.isAi).length>4)return fail(s,c,'請在一般單場大廳設定；車手與觀眾全員需新版，真人加AI最多四車，不能混用系列／其他特殊房規。');
 for(const v of [...r.players.values()])if(v.isAi)r.players.delete(v.id);
 r.summit.settings=settings;r.summit.stage=settings.weekend?'qualifying':'single';r.summit.qualifying=[];r.summit.revision++;
 for(let i=0;i<settings.ai;i++){const bot=s.makePlayer(r,`巡航 AI ${i+1}`,{clientCapabilities:{roomRules:true,evolution:true,horizon:true,nexusArena:true,summit:true,...(p.supportsVoyager?{voyagerRacing:true}:{}),...(p.supportsAtlas?{atlasRacing:true}:{})}},now);bot.isAi=true;bot.token=null;bot.client=null;summitResetPlayer(r,bot);r.players.set(bot.id,bot);}
 s.invalidateEvolutionLobby(r,now);summitLobby(r);s.broadcast(r,'room',now);return true;
}
export function summitStartError(r){summitLobby(r);if(atlasEnabled(r)&&[...r.players.values()].some(p=>!p.isAi&&!p.supportsAtlas))return'Atlas 房規需要全員更新。';return summitActive(r)&&(!summitCompatible(r)||[...r.players.values()].some(p=>!p.supportsSummit))?'進階賽事僅搭配一般單場，所有席位需要相同新版。':'';}
export function summitGridCar(r,slot){
 if(!r.summit?.settings.weekend||!['race','sprint'].includes(r.summit.stage)||!r.summit.qualifying.length)return null;
 const p=[...r.players.values()].find(p=>p.slot===slot),rank=r.summit.qualifying.find(q=>q.id===p?.id)?.grid??r.players.size,grid=rank-1,t=r.track;
 const i=grid===0?0:(t.N-Math.ceil(grid*8/t.ds))%t.N,car=new Car();car.resetTransient(false);car.placeAt(t,i);
 const lat=grid%2?1:-1;car.x-=t.tz[i]*lat;car.z+=t.tx[i]*lat;car.pos.lat=lat;if(p)p.gridIndex=grid;return car;
}
export function summitStart(r,at){
 if(!summitActive(r))return;
 r.summit.weather=0;for(const p of r.players.values()){p.summitSeq=-1;if(r.summit.settings.weekend&&['race','sprint'].includes(r.summit.stage)){const grid=r.summit.qualifying.find(q=>q.id===p.id)?.grid??1;p.distance=grid===1?0:-Math.ceil((grid-1)*8/r.track.ds)*r.track.ds;}}
 summitEvent(r,at,'session',[],r.summit.stage==='qualifying'?'三分鐘排位開始':r.summit.settings.endurance?'耐久正賽開始':'正賽開始');
}
export function summitInput(car,t,lat=0,cap=65,brakeFactor=1){
 const look=Math.max(8,Math.min(36,car.v*.55)),i=(car.pos.i+Math.max(2,Math.ceil(look/t.ds)))%t.N;
 const targetX=t.px[i]-t.tz[i]*lat,targetZ=t.pz[i]+t.tx[i]*lat,desired=Math.atan2(targetX-car.x,targetZ-car.z),error=Math.atan2(Math.sin(desired-car.h),Math.cos(desired-car.h));
 let bend=0;for(let ahead=4;ahead<75;ahead+=5){const j=(car.pos.i+Math.ceil(ahead/t.ds))%t.N;const a=Math.atan2(t.tx[j],t.tz[j])-Math.atan2(t.tx[car.pos.i],t.tz[car.pos.i]);bend=Math.max(bend,Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))/Math.max(ahead,1));}
 const speed=Math.min(cap,Math.sqrt(14*brakeFactor*Math.max(.5,car.gripMul)/Math.max(.0015,bend)));
 return{steer:Math.max(-1,Math.min(1,-error*4)),brake:car.v>speed||Math.abs(error)>.7&&car.v>12};
}
export function summitBeforeStep(r,p,at){
 if(!summitActive(r))return false;const s=r.summit,v=p.summit,d=summitDuration(r),a=p.atlas,endurance=(!!s.settings.endurance||voyagerWeather(r))&&s.stage!=='qualifying',damage=!!r.atlas?.settings.damage&&s.stage!=='qualifying';
 if(endurance||voyagerWeather(r)){const prior=s.weather;s.weather=voyagerWet(r.voyager?.settings.weather??'legacy',at-r.startAt,endurance?summitWet(at-r.startAt,d):0);if(r.voyager)r.voyager.wet=s.weather;if((prior>=.5)!==(s.weather>=.5))summitEvent(r,at,'weather',[],s.weather>=.5?'雨勢過半，濕胎較適合':'雨勢減弱，留意胎種');}
 if(endurance||damage){
  if(p.isAi&&v.pitUntil===0&&(endurance&&(v.wear>.65||s.weather>.6&&v.compound!=='wet'||s.weather<.2&&v.compound==='wet')||damage&&a.damage>.6)){v.pitArmed=true;v.nextCompound=s.weather>.4?'wet':'medium';a.pitService=endurance?(damage&&a.damage>.2?'both':'tyres'):'repair';}
  if(v.pitUntil>0){p.car.v=0;if(at<v.pitUntil)return true;const service=a.pitService;if(service!=='repair'){v.compound=v.nextCompound;v.wear=0;}if(service!=='tyres')a.damage=0;v.pitUntil=0;v.pitArmed=false;v.pitStops++;odysseyPitCompleted(r,p,at,service);summitEvent(r,at,'pit',[p.id],`${service==='tyres'?'換胎':service==='repair'?'修復':'換胎及修復'}完成，第${v.pitStops}停`);}
  if(v.pitArmed&&p.car.pos.s<80&&p.car.pos.lat>=2.8&&p.car.v<=5.1){a.pitDurationMs=atlasPitMs(a.pitService,a.damage);v.pitUntil=at+a.pitDurationMs;odysseyPitStarted(r,p,at);p.car.v=0;summitEvent(r,at,'pit',[p.id],`實際停車${(a.pitDurationMs/1000).toFixed(1)}秒：${a.pitService==='tyres'?'換胎':a.pitService==='repair'?'修復':'換胎及修復'}`);return true;}
 }
 summitPredict(p.car,{summit:summitPublic(r),atlas:r.atlas,voyager:r.voyager,startAt:r.startAt,trackLength:r.track.length},{summit:v,atlas:a},at);
 if(p.isAi){const pit=v.pitArmed&&(endurance||damage),near=pit&&(p.car.pos.s>r.track.length-180||p.car.pos.s<80),plan=atlasVisible(r)?atlasAiPlan(r,p,at):{lat:0,cap:65-p.slot,brake:1};p.input=summitInput(p.car,r.track,near?4:plan.lat,near?4:plan.cap,plan.brake);p.lastInputAt=at;}
 return false;
}
export function summitAfterStep(r,p,before,at){if(!summitActive(r))return;if(p.car.touch)p.summit.lapValid=false;if((r.summit.settings.endurance||voyagerWeather(r))&&r.summit.stage!=='qualifying')p.summit.wear=Math.min(1,p.summit.wear+summitWear(p.summit.compound,p.distance-before,r.summit.weather));}
export function summitLap(r,p,elapsed,lapMs,at){
 if(!summitActive(r))return false;
 if(r.summit.stage==='qualifying'){
  if(p.summit.lapValid&&elapsed<=180000)p.summit.validLaps.push(lapMs);
  p.bestLapMs=p.summit.validLaps.length?Math.min(...p.summit.validLaps):null;p.summit.lapValid=true;summitEvent(r,at,'lap',[p.id],p.bestLapMs===null?'尚無有效圈':`有效最快 ${(p.bestLapMs/1000).toFixed(3)}秒`);return true;
 }
 if(r.summit.settings.endurance){if(elapsed>=r.summit.settings.endurance*1000){p.finishMs=elapsed;p.car.v=0;r.firstFinishAt??=at;summitEvent(r,at,'finish',[p.id],`${p.completedLaps}圈耐久完賽`);}return true;}return false;
}
export function summitFinish(s,r,at){
 if(!summitTimed(r))return null;const players=[...r.players.values()],duration=summitDuration(r)*1000,qual=r.summit.stage==='qualifying',all=players.every(p=>p.dnf||p.finishMs!==null);
 if(!all&&at<r.startAt+duration+(qual?0:120000))return false;
 if(qual){r.summit.qualifying=players.sort((a,b)=>(a.bestLapMs??Infinity)-(b.bestLapMs??Infinity)||a.slot-b.slot).map((p,i)=>({id:p.id,name:p.name,bestMs:p.bestLapMs,grid:i+1,ai:!!p.isAi,dnf:p.dnf}));for(const p of players){if(!p.dnf&&p.bestLapMs!==null)p.finishMs=p.bestLapMs;else s.markDnf(p,'time-trial-no-lap');p.car.v=0;}}
 else for(const p of players){s.markDnf(p,'race-timeout');p.car.v=0;}
 r.phase='results';r.updatedAt=at;summitEvent(r,at,'session',[],qual?'排位結束，可依有效圈發車':'耐久結束');s.broadcast(r,'room',at);return true;
}
export function summitDeadline(r){const d=summitDuration(r);return d&&r.startAt!==null?{deadlineAt:r.startAt+d*1000+(r.summit.stage==='qualifying'?0:120000),deadlineReason:'race-timeout'}:null;}
