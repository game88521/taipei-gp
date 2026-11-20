/** Pure save contracts shared by the mode and backup/import validation. Never stores room tokens. */
export const RALLY_KEY='taipei-gp-expedition-rally-v1';
export const CREW_RECORDS='taipei-gp-expedition-crew-results-v1';
export const DUTY_RECORD_BYTES=100000;
export type DutyRecordWrite={ok:true;raw:string}|{ok:false;reason:'changed'|'invalid'|'unavailable'};
/** Preserve an import or another tab's newer data rather than overwriting a stale snapshot. */
export function writeDutyRecords<T>(storage:Pick<Storage,'getItem'|'setItem'>,key:string,expected:string|null,records:T[],parse:(v:unknown)=>T[]|null):DutyRecordWrite{
 try{if(storage.getItem(key)!==expected)return{ok:false,reason:'changed'};const parsed=parse(records);if(!parsed)return{ok:false,reason:'invalid'};const raw=JSON.stringify(parsed);if(raw.length>DUTY_RECORD_BYTES||new TextEncoder().encode(raw).length>DUTY_RECORD_BYTES)return{ok:false,reason:'invalid'};storage.setItem(key,raw);return{ok:true,raw};}catch{return{ok:false,reason:'unavailable'};}
}
export interface RallyResult{id:string;at:number;route:string;seconds:number;penalty:number;speedPenalty:number;arrivals:{gate:number;due:number;actual:number;delta:number}[]}
export interface CrewRecord{id:string;at:number;seconds:number;integrity:number;crew:[string,string]}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const num=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
export function parseRallyRecords(v:unknown):RallyResult[]|null{
 if(!Array.isArray(v)||v.length>30)return null;const ids=new Set<string>();
 for(const r of v){
  if(!record(r)||!keys(r,['id','at','route','seconds','penalty','speedPenalty','arrivals'])||!text(r.id,100)||ids.has(r.id)||!text(r.route,100)||!num(r.at,8640000000000000)||!num(r.seconds,3600)||!num(r.penalty,100000)||!num(r.speedPenalty,100000)||!Array.isArray(r.arrivals)||r.arrivals.length!==4)return null;
  let gate=-1,due=-1,actual=-1,total=r.speedPenalty;
  for(const a of r.arrivals){
   if(!record(a)||!keys(a,['gate','due','actual','delta'])||!num(a.gate,10000)||!Number.isSafeInteger(a.gate)||a.gate<=gate||!num(a.due,3600)||a.due<=due||!num(a.actual,3600)||a.actual<actual||a.actual>r.seconds+.100001||typeof a.delta!=='number'||!Number.isFinite(a.delta)||Math.abs(a.actual-a.due-a.delta)>1e-6)return null;
   gate=a.gate;due=a.due;actual=a.actual;total+=Math.abs(a.delta);
  }
  if(Math.abs(total-r.penalty)>1e-5)return null;ids.add(r.id);
 }
 return structuredClone(v) as RallyResult[];
}
export function parseCrewRecords(v:unknown):CrewRecord[]|null{
 if(!Array.isArray(v)||v.length>30)return null;const ids=new Set<string>();
 for(const r of v){if(!record(r)||!keys(r,['id','at','seconds','integrity','crew'])||!text(r.id,100)||ids.has(r.id)||!num(r.at,8640000000000000)||!num(r.seconds,1801)||!num(r.integrity,100)||!Array.isArray(r.crew)||r.crew.length!==2||r.crew.some(s=>!text(s,30)))return null;ids.add(r.id);}
 return structuredClone(v) as CrewRecord[];
}
