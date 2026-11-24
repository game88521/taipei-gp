/** Rex <game88521@gmail.com>. Optional, bounded pause for ordinary private lap races. */
export const HARBOR_NETWORK_VERSION='harbor-network-pause-v1';
export const HARBOR_NETWORK_GRACE_MS=10000;
export const HARBOR_NETWORK_RESUME_MS=3000;
export const HARBOR_NETWORK_LIMIT=2;
export interface HarborNetworkPause {
 v:typeof HARBOR_NETWORK_VERSION;enabled:boolean;epoch:number;phase:'idle'|'waiting'|'resuming';
 elapsedMs:number|null;pausedAt:number|null;resumeAt:number|null;
 incidents:{playerId:string;deadlineAt:number;confirmed:boolean}[];uses:Record<string,number>;
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown,min=0,max=8.64e15):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export const harborNetworkFrozen=(room:{harborNetwork?:HarborNetworkPause}|null|undefined)=>!!room?.harborNetwork?.enabled&&room.harborNetwork.phase!=='idle';
export function harborNetworkNow(room:{startAt:number|null;harborNetwork?:HarborNetworkPause}|null|undefined,now:number){return harborNetworkFrozen(room)&&room?.startAt!==null&&room?.startAt!==undefined?room.startAt+(room.harborNetwork!.elapsedMs??0):now;}
/** Shared compatibility predicate accepts internal rooms and their public snapshots. */
export function harborNetworkPlain(room:Record<string,unknown>){
 const settings=(key:string)=>obj(room[key])&&obj(room[key].settings)?room[key].settings as Record<string,unknown>:{};
 const summit=settings('summit'),atlas=settings('atlas'),voyager=settings('voyager');
 return !room.series&&!room.cup&&!room.meridian&&(!obj(room.evolution)||room.evolution.mode==='race')
  &&(!obj(room.arena)||room.arena.mode==='off')&&(!obj(room.horizon)||!Object.values(room.horizon).some(Boolean))
  &&!summit.weekend&&!summit.ai&&!summit.endurance&&!atlas.damage&&!atlas.flags&&(!atlas.aiLevel||atlas.aiLevel==='standard')
  &&!voyager.practiceSeconds&&(!voyager.weather||voyager.weather==='legacy')&&!voyager.vsc
  &&!Object.values(settings('odyssey')).some(Boolean)&&!Object.values(settings('expedition')).some(Boolean);
}
export function validateHarborNetwork(room:Record<string,unknown>){
 const cap=obj(room.capabilities)?room.capabilities.harborNetworkPause:undefined,raw=room.harborNetwork;
 if(cap===undefined){if(raw!==undefined)throw Error('短斷線保護缺少相容能力。');return;}
 if(cap!==HARBOR_NETWORK_VERSION||!obj(raw)||Object.keys(raw).sort().join(',')!=='elapsedMs,enabled,epoch,incidents,pausedAt,phase,resumeAt,uses,v'||raw.v!==HARBOR_NETWORK_VERSION||typeof raw.enabled!=='boolean'||!Number.isSafeInteger(raw.epoch)||Number(raw.epoch)<0||!['idle','waiting','resuming'].includes(String(raw.phase))||!Array.isArray(raw.incidents)||raw.incidents.length>4||!obj(raw.uses))throw Error('短斷線保護格式無效。');
 const players=room.players as {id:string;connected:boolean;loaded:boolean;dnf:boolean;finishMs:number|null}[],ids=players.map(p=>p.id);
 if(Object.keys(raw.uses).length!==ids.length||ids.some(id=>!Number.isSafeInteger((raw.uses as Record<string,unknown>)[id])||Number((raw.uses as Record<string,unknown>)[id])<0||Number((raw.uses as Record<string,unknown>)[id])>HARBOR_NETWORK_LIMIT)||Object.keys(raw.uses).some(id=>!ids.includes(id)))throw Error('短斷線保護次數無效。');
 const seen=new Set<string>();for(const incident of raw.incidents){if(!obj(incident)||Object.keys(incident).sort().join(',')!=='confirmed,deadlineAt,playerId'||typeof incident.playerId!=='string'||!ids.includes(incident.playerId)||seen.has(incident.playerId)||!finite(incident.deadlineAt)||typeof incident.confirmed!=='boolean')throw Error('短斷線保護原席無效。');seen.add(incident.playerId);}
 if(raw.enabled&&!harborNetworkPlain(room))throw Error('短斷線保護不能混用進階賽事。');
 if(raw.phase==='idle'){if(raw.elapsedMs!==null||raw.pausedAt!==null||raw.resumeAt!==null||raw.incidents.length)throw Error('非暫停場次不可提供暫停計時。');}
 else if(!raw.enabled||room.phase!=='racing'||!finite(raw.elapsedMs,0,86400000)||!finite(raw.pausedAt)||raw.phase==='waiting'&&(raw.resumeAt!==null||!raw.incidents.length)||raw.phase==='resuming'&&!finite(raw.resumeAt))throw Error('短斷線暫停時序無效。');
}
