/** Rex <game88521@gmail.com>. Bounded explicit result saves; no private seats, tokens, room codes or trajectory data. */
import {FRONTIER_RALLY_AVERAGES,type RallyAverage,type RallyRoom,type RallyArrival} from '../shared/frontier-rally';
export const FRONTIER_RALLY_RESULTS_KEY='taipei-gp-frontier-rally-results-v1',FRONTIER_RALLY_RESULTS_BYTES=100000;
export interface RallyResult{id:string;at:number;map:string;route:string;average:RallyAverage;lengthM:number;reason:'complete'|'timeout'|'server-stall';players:{slot:number;name:string;finishMs:number|null;dnf:string|null;timingPenaltyMs:number;speedPenaltyMs:number;penaltyMs:number;rank:number|null;arrivals:RallyArrival[]}[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v),exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b,int=(v:unknown,a:number,b:number):v is number=>Number.isSafeInteger(v)&&num(v,a,b);
const safe=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=n&&v.trim()===v&&!/[\x00-\x1f\x7f<>]/.test(v);
export function parseRallyResults(value:unknown):RallyResult[]|null{
 if(!obj(value)||!exact(value,['v','records'])||value.v!==1||!Array.isArray(value.records)||value.records.length>20||new TextEncoder().encode(JSON.stringify(value)).length>FRONTIER_RALLY_RESULTS_BYTES)return null;const ids=new Set<string>();
 for(const r of value.records){
  if(!obj(r)||!exact(r,['id','at','map','route','average','lengthM','reason','players'])||typeof r.id!=='string'||!/^[a-f0-9]{24}$/.test(r.id)||ids.has(r.id)||!num(r.at,0,1e16)||typeof r.map!=='string'||!/^roads-v1:[a-f0-9]{8}$/.test(r.map)||!safe(r.route,36)||!FRONTIER_RALLY_AVERAGES.includes(r.average as RallyAverage)||!num(r.lengthM,200,20000)||!['complete','timeout','server-stall'].includes(String(r.reason))||!Array.isArray(r.players)||r.players.length<2||r.players.length>4)return null;ids.add(r.id);const slots=new Set<number>();
  for(const p of r.players){if(!obj(p)||!exact(p,['slot','name','finishMs','dnf','timingPenaltyMs','speedPenaltyMs','penaltyMs','rank','arrivals'])||!int(p.slot,0,3)||slots.has(p.slot)||!safe(p.name,20)||!(p.finishMs===null||num(p.finishMs,.001,600000))||!(p.dnf===null||safe(p.dnf,60))||!int(p.timingPenaltyMs,0,1e8)||!int(p.speedPenaltyMs,0,1e8)||!int(p.penaltyMs,0,2e8)||p.penaltyMs!==p.timingPenaltyMs+p.speedPenaltyMs||!(p.rank===null||int(p.rank,1,4))||!Array.isArray(p.arrivals)||p.arrivals.length>4)return null;slots.add(p.slot);let sum=0,previousGate=-1,priorActual=-1,priorDue=-1;
   for(const a of p.arrivals){if(!obj(a)||!exact(a,['gate','dueMs','actualMs','deltaMs'])||!int(a.gate,0,699)||a.gate<=previousGate||!int(a.dueMs,0,3000000)||a.dueMs<=priorDue||!int(a.actualMs,0,600000)||a.actualMs<priorActual||!int(a.deltaMs,-3000000,600000)||a.deltaMs!==a.actualMs-a.dueMs)return null;sum+=Math.abs(a.deltaMs);previousGate=a.gate;priorDue=a.dueMs;priorActual=a.actualMs;}
   if(sum!==p.timingPenaltyMs||p.finishMs!==null&&p.arrivals.length!==4||p.finishMs===null&&!p.dnf)return null;
  }
  const players=r.players as unknown as RallyResult['players'];for(const p of players){const rank=r.reason!=='server-stall'&&p.finishMs!==null&&!p.dnf?1+players.filter(q=>q.finishMs!==null&&!q.dnf&&q.penaltyMs<p.penaltyMs).length:null;if(p.rank!==rank)return null;}
 }
 return structuredClone(value.records) as RallyResult[];
}
interface StorageLike{getItem(k:string):string|null;setItem(k:string,v:string):void}
export class FrontierRallyResults{
 private rows:RallyResult[]=[];private raw:string|null=null;error='';private blocked=false;
 constructor(private storage:StorageLike|null){if(!storage){this.blocked=true;this.error='本機戰績儲存不可用；仍可下載本場結果。';return;}try{this.raw=storage?.getItem(FRONTIER_RALLY_RESULTS_KEY)??null;if(this.raw!==null){if(new TextEncoder().encode(this.raw).length>FRONTIER_RALLY_RESULTS_BYTES)throw Error();const rows=parseRallyResults(JSON.parse(this.raw));if(!rows)throw Error();this.rows=rows;}}catch{this.blocked=true;this.error='定速拉力戰績原文無法讀取，已保留原文；仍可下載本場結果。';}}
 get records(){return structuredClone(this.rows);}
 get writable(){return!this.blocked;}
 result(room:RallyRoom):RallyResult|null{if(room.phase!=='results'||!room.matchId||!room.reason)return null;const saved=this.rows.find(row=>row.id===room.matchId);if(saved)return structuredClone(saved);return{id:room.matchId,at:room.serverTime,map:room.definition.map,route:room.definition.name,average:room.average,lengthM:room.route.length,reason:room.reason,players:room.players.map(p=>({slot:p.slot,name:p.name,finishMs:p.finishMs,dnf:p.dnf,timingPenaltyMs:p.timingPenaltyMs,speedPenaltyMs:p.speedPenaltyMs,penaltyMs:p.penaltyMs,rank:p.rank,arrivals:structuredClone(p.arrivals)}))};}
 add(room:RallyRoom){if(this.blocked)return false;const result=this.result(room);if(!result)return false;if(this.rows.some(r=>r.id===result.id))return true;const rows=[result,...this.rows].slice(0,20),raw=JSON.stringify({v:1,records:rows});if(!parseRallyResults({v:1,records:rows})){this.error='本場結果未通過一致性驗證，未保存。';return false;}
  if(this.storage)try{if(this.storage.getItem(FRONTIER_RALLY_RESULTS_KEY)!==this.raw){this.blocked=true;this.error='其他頁面已變更戰績，未覆寫；請重新開啟頁面後再保存。';return false;}this.storage.setItem(FRONTIER_RALLY_RESULTS_KEY,raw);if(this.storage.getItem(FRONTIER_RALLY_RESULTS_KEY)!==raw){this.blocked=true;this.error='寫入後資料已變更，未宣稱保存成功；請保留下載檔。';return false;}this.raw=raw;}catch{this.error='戰績寫入失敗，原紀錄保留；可下載本場結果。';return false;}
  this.rows=rows;this.error='';return true;
 }
}
