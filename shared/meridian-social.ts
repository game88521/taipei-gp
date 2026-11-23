/** Rex <game88521@gmail.com>. Every ordered pair gets exactly one equal-duration chase. */
export const MERIDIAN_ROTATION_VERSION='meridian-tandem-rotation-v1';
export const MERIDIAN_ROTATION_HISTORY_KEY='taipei-gp-meridian-tandem-rotation-v1';
export interface RotationHeat{leaderSlot:number;followerSlot:number;points:number|null}
export interface RotationState{version:typeof MERIDIAN_ROTATION_VERSION;cursor:number;heats:RotationHeat[];paused:boolean;pausedUntil:number|null}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function rotationPairs(slots:number[]):RotationHeat[]{const ordered=[...slots].sort((a,b)=>a-b),heats:RotationHeat[]=[];for(let offset=1;offset<ordered.length;offset++)for(let i=0;i<ordered.length;i++)heats.push({leaderSlot:ordered[i],followerSlot:ordered[(i+offset)%ordered.length],points:null});return heats;}
export function parseRotation(v:unknown,slots:number[],phase:string):RotationState|null{
 if(!obj(v)||Object.keys(v).length!==5||!['version','cursor','heats','paused','pausedUntil'].every(k=>k in v))return null;
 return parseRotationValue(v,slots,phase);
}
function parseRotationValue(v:Record<string,unknown>,slots:number[],phase:string):RotationState|null{
 if(v.version!==MERIDIAN_ROTATION_VERSION||!Number.isSafeInteger(v.cursor)||typeof v.paused!=='boolean'||!(v.pausedUntil===null||typeof v.pausedUntil==='number'&&Number.isFinite(v.pausedUntil)&&v.pausedUntil>=0)||v.paused!==(v.pausedUntil!==null)||!Array.isArray(v.heats))return null;
 if(phase==='lobby')return v.cursor===0&&!v.heats.length&&!v.paused?structuredClone(v) as unknown as RotationState:null;
 const pairs=rotationPairs(slots);if(slots.length<3||slots.length>4||v.heats.length!==pairs.length||Number(v.cursor)<0||Number(v.cursor)>=pairs.length)return null;
 for(let i=0;i<pairs.length;i++){const h=v.heats[i];if(!obj(h)||Object.keys(h).length!==3||h.leaderSlot!==pairs[i].leaderSlot||h.followerSlot!==pairs[i].followerSlot||!(h.points===null||typeof h.points==='number'&&Number.isFinite(h.points)&&h.points>=0&&h.points<=2400)||i<Number(v.cursor)&&h.points===null||i>Number(v.cursor)&&h.points!==null||phase!=='finished'&&i===Number(v.cursor)&&h.points!==null)return null;}
 return structuredClone(v) as unknown as RotationState;
}
export function rotationTable(state:RotationState,slots:number[]){return slots.map(slot=>({slot,turns:state.heats.filter(h=>h.followerSlot===slot&&h.points!==null).length,points:Math.round(state.heats.filter(h=>h.followerSlot===slot).reduce((n,h)=>n+(h.points??0),0)*10)/10})).sort((a,b)=>b.points-a.points||a.slot-b.slot);}
export interface RotationRecord{version:typeof MERIDIAN_ROTATION_VERSION;runId:string;at:number;players:{slot:number;name:string;points:number;turns:number}[];heats:RotationHeat[]}
/** Official progress is never part of these local, separately namespaced party summaries. */
export function parseRotationHistory(raw:unknown):RotationRecord[]|null{
 if(!Array.isArray(raw)||raw.length>20)return null;const ids=new Set();
 for(const r of raw){if(!obj(r)||Object.keys(r).length!==5||r.version!==MERIDIAN_ROTATION_VERSION||typeof r.runId!=='string'||!/^[a-f0-9]{24}$/.test(r.runId)||ids.has(r.runId)||typeof r.at!=='number'||!Number.isSafeInteger(r.at)||r.at<0||!Array.isArray(r.players)||r.players.length<3||r.players.length>4||!Array.isArray(r.heats))return null;ids.add(r.runId);const slots=new Set<number>();for(const p of r.players){if(!obj(p)||Object.keys(p).length!==4||!Number.isSafeInteger(p.slot)||Number(p.slot)<0||Number(p.slot)>3||slots.has(Number(p.slot))||typeof p.name!=='string'||!p.name||p.name.length>20||/[\x00-\x1f\x7f<>]/.test(p.name))return null;slots.add(Number(p.slot));}const state=parseRotation({version:MERIDIAN_ROTATION_VERSION,cursor:r.heats.length-1,heats:r.heats,paused:false,pausedUntil:null},[...slots],'finished');if(!state||state.heats.some(h=>h.points===null))return null;for(const p of r.players){const expected=rotationTable(state,[Number(p.slot)])[0];if(p.points!==expected.points||p.turns!==expected.turns||p.turns!==slots.size-1)return null;}}
 return structuredClone(raw) as RotationRecord[];
}
