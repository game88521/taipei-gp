// Rex <game88521@gmail.com>. Results never include room codes, player IDs or resumable seats.
import {SOCIAL_MODES,type SocialMode,type SocialWeather,type SocialRole,type SocialRoom} from '../shared/expedition-social';
import {convoyDefinition,parseConvoySummary,type ConvoySummary} from '../shared/frontier-convoy';
import {CROWN_DURATION_MS,parseCrownSummary,type CrownSummary} from '../shared/frontier-crown';
export const SOCIAL_RESULTS_KEY='taipei-gp-expedition-social-results-v1';
export interface SocialResult{runId:string;at:number;mode:SocialMode;weather:SocialWeather;reason:SocialRoom['reason'];players:{name:string;role:SocialRole;points:number;maxCombo:number;outcome:string}[];convoy?:ConvoySummary;crown?:CrownSummary}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
export function parseSocialResults(v:unknown):SocialResult[]|null{
  if(!obj(v)||!exact(v,['v','records'])||v.v!==1||!Array.isArray(v.records)||v.records.length>20)return null;
  const ids=new Set();
  for(const r of v.records){if(!obj(r)||!exact(r,['runId','at','mode','weather','reason','players',...r.mode==='convoy'?['convoy']:[],...r.mode==='crown'?['crown']:[]])||typeof r.runId!=='string'||!/^[a-f0-9]{24}$/.test(r.runId)||ids.has(r.runId)||!num(r.at,0,1e16)||!SOCIAL_MODES.includes(r.mode as SocialMode)||!['dry','rain','night'].includes(String(r.weather))||!['timeout','captured','left','complete','server-stall'].includes(String(r.reason))||!Array.isArray(r.players)||r.players.length<1||r.players.length>(r.mode==='tandem'?2:4))return null;
    if(r.mode==='convoy'){const c=parseConvoySummary(r.convoy);if(!c||r.reason==='complete'&&(c.completed!==c.total||c.finished<2)||c.finished>r.players.length)return null;}
    ids.add(r.runId);for(const p of r.players)if(!obj(p)||!exact(p,['name','role','points','maxCombo','outcome'])||typeof p.name!=='string'||!p.name.trim()||p.name.length>20||/[\x00-\x1f\x7f<>]/.test(p.name)||!['driver','pursuer','runner','leader','follower'].includes(String(p.role))||!num(p.points,0,1e8)||!num(p.maxCombo,0,120)||!['','captured','escaped','left'].includes(String(p.outcome)))return null;
    if(r.mode==='crown'){const c=parseCrownSummary(r.crown),players=r.players as SocialResult['players'];if(!c||players.some(p=>p.role!=='driver'||p.points>180||!['','left'].includes(p.outcome))||players.reduce((n,p)=>n+p.points,0)>180.201||(r.reason==='complete')!==(c.winnerPoints!==null)||r.reason==='complete'&&(c.durationMs!==CROWN_DURATION_MS||players.filter(p=>!p.outcome).length<2||c.winnerPoints!==Math.max(0,...players.filter(p=>!p.outcome).map(p=>p.points))))return null;}
  }
  return structuredClone(v.records) as SocialResult[];
}
interface Store{getItem(k:string):string|null;setItem(k:string,v:string):void}
export class SocialResults{
  records:SocialResult[]=[];error='';private seen=new Set<string>();private raw:string|null=null;
  constructor(private storage:Store|null){try{this.raw=storage?.getItem(SOCIAL_RESULTS_KEY)??null;if(this.raw!==null){if(this.raw.length>100000)throw Error();const parsed=parseSocialResults(JSON.parse(this.raw));if(!parsed)throw Error();this.records=parsed;}}catch{this.error='巡航／警匪／追走原戰績無法讀取，已保留原文。';}}
  add(room:SocialRoom){if(room.phase!=='finished'||this.seen.has(room.runId))return;this.seen.add(room.runId);if(this.records.some(r=>r.runId===room.runId)||this.error)return;
    const result:SocialResult={runId:room.runId,at:room.serverTime,mode:room.mode,weather:room.weather,reason:room.reason,players:room.players.map(p=>({name:p.name,role:p.role,points:p.points,maxCombo:p.maxCombo,outcome:p.outcome})),...room.convoy?{convoy:{routeId:room.convoy.routeId,completed:room.convoy.completed,total:convoyDefinition(room.convoy.routeId)!.stations.length,participants:room.convoy.participants.length,finished:room.reason==='complete'?room.convoy.participants.filter(p=>!p.withdrawn&&p.arrived).length:0}}:{},...room.crown?{crown:{durationMs:room.reason==='complete'?CROWN_DURATION_MS:Math.min(CROWN_DURATION_MS,Math.max(0,Math.round(room.serverTime-Number(room.startAt)))),transfers:room.crown.transfers,winnerPoints:room.crown.winnerPoints}}:{}},next=[result,...this.records].slice(0,20);
    if(!parseSocialResults({v:1,records:next})){this.error='本場戰績格式未確認，沒有寫入。';return;}
    if(this.storage)try{if(this.storage.getItem(SOCIAL_RESULTS_KEY)!==this.raw){this.error='戰績已被其他頁面變更，原資料未覆寫。';return;}const raw=JSON.stringify({v:1,records:next});this.storage.setItem(SOCIAL_RESULTS_KEY,raw);this.raw=raw;}catch{this.error='戰績寫入失敗，原有紀錄仍保留。';return;}this.records=next;
  }
}
