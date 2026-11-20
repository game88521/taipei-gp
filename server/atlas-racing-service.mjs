import {ATLAS_RACING_VERSION,defaultAtlasSettings,atlasSettings,atlasPlayer,atlasDamage} from '../shared/atlas-racing.ts';
import {summitEvent} from './summit-events-service.mjs';
export const atlasVisible=r=>[...r.players.values()].some(p=>p.supportsAtlas);
export const atlasEnabled=r=>!!r.atlas&&(r.atlas.settings.damage||r.atlas.settings.flags||r.atlas.settings.aiLevel!=='standard');
export const atlasEnsure=r=>r.atlas??={version:ATLAS_RACING_VERSION,settings:defaultAtlasSettings()};
export const atlasReset=p=>{p.atlas=atlasPlayer();p.atlasLastDamage=-Infinity;p.atlasBoundarySince=null;p.atlasBoundaryRecorded=false;p.atlasYellowUntil=0;p.atlasBlueUntil=0;p.atlasLane=0;};
export function atlasJoinError(r,m){return atlasEnabled(r)&&m.clientCapabilities?.atlasRacing!==true?'此房使用 Atlas 車損／旗號／AI 設定，請全員更新後再加入。':'';}
export function atlasReceive(s,c,m,now){
 if(m.type!=='set-atlas')return false;const r=c.room,p=c.player,fail=text=>{s.send(c,{type:'error',code:'ATLAS_RULE',message:text});return true;};
 if(!r||!p||c.viewer||!p.supportsAtlas||r.hostId!==p.id)return fail('只有新版房主能設定 Atlas 房規。');
 const settings=atlasSettings(m.settings);if(r.phase!=='lobby'||m.roomCode!==r.code||m.expectedLobbyRevision!==r.lobbyRevision||!settings)return fail('大廳或房規已變更，請確認最新設定。');
 if(r.series||r.evolution.mode!=='race'||Object.values(r.horizon).some(Boolean)||(r.arena?.mode??'off')!=='off'||[...r.players.values()].some(v=>!v.isAi&&!v.supportsAtlas)||[...r.spectators.values()].some(v=>!v.supportsAtlas))return fail('請在一般單場設定，所有車手與觀眾需支援 Atlas。');
 atlasEnsure(r).settings=settings;s.invalidateEvolutionLobby(r,now);s.broadcast(r,'room',now);return true;
}
export function atlasImpact(r,p,impact,at){
 if(!r.atlas?.settings.damage||r.summit?.stage==='qualifying'||!p.atlas||p.dnf||p.finishMs!==null||p.summit?.pitUntil>at||impact<=2||at-(p.atlasLastDamage??-Infinity)<500)return;
 p.atlasLastDamage=at;p.atlas.damage=atlasDamage(p.atlas.damage,impact);summitEvent(r,at,'damage',[p.id],`輕度車損 ${Math.round(p.atlas.damage*100)}%；未判肇責`);
}
export function atlasContacts(r,contacts,at){for(const contact of contacts)for(const p of r.players.values())if([contact.a,contact.b].includes(String(p.slot)))atlasImpact(r,p,contact.impact,at);}
export function atlasFlags(r,at){
 if(!r.atlas?.settings.flags)return;const all=[...r.players.values()],active=p=>!p.dnf&&p.finishMs===null&&p.connected&&p.loaded&&!(p.summit?.pitUntil>at),length=r.track.length;
 for(const p of all){const a=p.atlas;if(!a)continue;const before=[a.yellow,a.blue,a.boundary].join();a.yellow=false;a.blue=false;
  if(active(p)){
   for(const other of all){if(other===p||!active(other)||other.block?.ghost)continue;const ahead=(other.car.pos.s-p.car.pos.s+length)%length,behind=(p.car.pos.s-other.car.pos.s+length)%length;
    if(ahead>2&&ahead<110&&other.car.v<7&&Math.abs(other.car.pos.lat)<7-1)p.atlasYellowUntil=at+1800;
    if(behind>1&&behind<85&&other.distance-p.distance>length*.8&&other.car.v>p.car.v+1)p.atlasBlueUntil=at+1500;
   }
   a.yellow=p.atlasYellowUntil>at;a.blue=p.atlasBlueUntil>at;
   a.boundary=Math.abs(p.car.pos.lat)>Math.max(1,7-1.2);
   if(a.boundary){p.atlasBoundarySince??=at;if(!p.atlasBoundaryRecorded&&at-p.atlasBoundarySince>=1000){a.warnings=Math.min(999,a.warnings+1);p.atlasBoundaryRecorded=true;summitEvent(r,at,'boundary',[p.id],`界線警告 ${a.warnings}；僅提示、不罰秒`);}}
   else{p.atlasBoundarySince=null;p.atlasBoundaryRecorded=false;}
  }else a.boundary=false;
  const after=[a.yellow,a.blue,a.boundary].join();if(before!==after&&(a.yellow||a.blue))summitEvent(r,at,'flag',[p.id],`${a.yellow?'前方低速車輛黃旗 ':''}${a.blue?'快車將套圈藍旗':''}；僅提示`);
 }
}
/** Deterministic local perception, no rubber band or player progress multiplier. */
export function atlasAiPlan(r,p,at){
 const car=p.car,t=r.track,level=r.atlas?.settings.aiLevel??'standard',profile={relaxed:{cap:49,brake:.88,gap:25},standard:{cap:62,brake:1,gap:19},competitive:{cap:72,brake:1.08,gap:15}}[level];
 const width=Math.max(0,Math.min(2.6,7-2.4));let target=p.atlasLane??0,cap=profile.cap;
 const eligible=[...r.players.values()].filter(o=>o!==p&&!o.dnf&&o.finishMs===null&&o.connected&&o.loaded&&!(o.summit?.pitUntil>at));
 const ahead=eligible.map(o=>({o,gap:(o.car.pos.s-car.pos.s+t.length)%t.length})).filter(v=>v.gap>0&&v.gap<Math.max(35,car.v*1.2)&&Math.abs(v.o.car.pos.lat-car.pos.lat)<2.4).sort((a,b)=>a.gap-b.gap)[0];
 if(ahead){
  const lanes=[-width,width].filter(lane=>eligible.every(o=>{const ds=Math.abs(o.car.pos.s-car.pos.s),gap=Math.min(ds,t.length-ds);return gap>Math.max(18,car.v*.6)||Math.abs(o.car.pos.lat-lane)>2.3;}));
  if(lanes.length&&width>1&&ahead.gap>8&&car.v>ahead.o.car.v+1)target=lanes.sort((a,b)=>Math.abs(a-car.pos.lat)-Math.abs(b-car.pos.lat))[0];
  else if(ahead.gap<profile.gap+car.v*.35){cap=Math.min(cap,Math.max(5,ahead.o.car.v-(ahead.gap<8?4:0)));target=car.pos.lat;}
 }else if(eligible.every(o=>Math.abs(o.car.pos.s-car.pos.s)>20))target=0;
 if(Math.abs(car.pos.lat)>7-1.8){target=0;cap=Math.min(cap,18);}
 p.atlasLane=(p.atlasLane??car.pos.lat)+Math.max(-.035,Math.min(.035,target-(p.atlasLane??car.pos.lat)));
 return{lat:p.atlasLane,cap,brake:profile.brake};
}
