/** Rex <game88521@gmail.com>. Authority-only moving-crown rules and bounded public contracts. */
import {COOP_STATIONS} from './nexus-coop.ts';
export const CROWN_VERSION='frontier-crown-v1';
export const CROWN_DURATION_MS=180_000;
export const CROWN_PROTECTION_MS=3000;
export const CROWN_OUTSIDE_MS=5000;
export const CROWN_ARENA={x:COOP_STATIONS[0].x,y:COOP_STATIONS[0].y,z:COOP_STATIONS[0].z,radius:220} as const;
export type CrownZone='inside'|'outside'|'level'|'offline'|'left';
export interface CrownMember{slot:number;zone:CrownZone;outsideMs:number}
export interface CrownState{v:typeof CROWN_VERSION;arena:typeof CROWN_ARENA;holderSlot:number|null;protectedUntil:number;transfers:number;lastChange:'none'|'start'|'contact'|'reassign';winnerPoints:number|null;members:CrownMember[]}
export interface CrownSummary{durationMs:number;transfers:number;winnerPoints:number|null}
export interface CrownWatchState{holderSlot:number|null;protectedUntil:number}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const num=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const int=(v:unknown,lo:number,hi:number):v is number=>num(v,lo,hi)&&Number.isSafeInteger(v);
export function crownZone(p:{x:number;y:number;z:number}):'inside'|'outside'|'level'{return Math.abs(p.y-CROWN_ARENA.y)>=1.8?'level':Math.hypot(p.x-CROWN_ARENA.x,p.z-CROWN_ARENA.z)>CROWN_ARENA.radius?'outside':'inside';}
export function parseCrownState(v:unknown):CrownState|null{
 if(!obj(v)||!exact(v,['v','arena','holderSlot','protectedUntil','transfers','lastChange','winnerPoints','members'])||v.v!==CROWN_VERSION||!obj(v.arena)||!exact(v.arena,['x','y','z','radius'])||v.arena.x!==CROWN_ARENA.x||v.arena.y!==CROWN_ARENA.y||v.arena.z!==CROWN_ARENA.z||v.arena.radius!==CROWN_ARENA.radius||v.holderSlot!==null&&!int(v.holderSlot,0,3)||!num(v.protectedUntil,0,1e16)||!int(v.transfers,0,61)||!['none','start','contact','reassign'].includes(String(v.lastChange))||v.winnerPoints!==null&&!num(v.winnerPoints,0,180)||!Array.isArray(v.members)||v.members.length<1||v.members.length>4)return null;
 const slots=new Set<number>();for(const m of v.members){if(!obj(m)||!exact(m,['slot','zone','outsideMs'])||!int(m.slot,0,3)||slots.has(m.slot)||!['inside','outside','level','offline','left'].includes(String(m.zone))||!int(m.outsideMs,0,CROWN_OUTSIDE_MS)||['inside','offline'].includes(String(m.zone))&&m.outsideMs!==0)return null;slots.add(m.slot);}
 if(v.holderSlot!==null&&!slots.has(v.holderSlot as number)||v.lastChange==='none'&&(v.holderSlot!==null||v.transfers!==0||v.protectedUntil!==0)||v.lastChange!=='none'&&v.holderSlot===null)return null;
 return structuredClone(v) as unknown as CrownState;
}
export function parseCrownSummary(v:unknown):CrownSummary|null{return obj(v)&&exact(v,['durationMs','transfers','winnerPoints'])&&int(v.durationMs,0,CROWN_DURATION_MS)&&int(v.transfers,0,61)&&(v.winnerPoints===null||num(v.winnerPoints,0,180))?{...v} as unknown as CrownSummary:null;}
export function validCrownWatch(v:unknown):v is CrownWatchState{return obj(v)&&exact(v,['holderSlot','protectedUntil'])&&(v.holderSlot===null||int(v.holderSlot,0,3))&&num(v.protectedUntil,0,1e16);}
export const crownSeconds=(n:number)=>Math.round(n*10)/10;
