/** Rex <game88521@gmail.com>. Public station checkpoints contain no driving state or private credentials. */
export const MERIDIAN_CHECKPOINT_VERSION='meridian-checkpoints-v1';
export const MERIDIAN_CHECKPOINT_PUBLIC_KEY='taipei-gp-meridian-checkpoints-v1';
export const MERIDIAN_CHECKPOINT_PRIVATE_KEY='taipei-gp-meridian-private-continuation-v1';
export const MERIDIAN_CHECKPOINT_TTL=7*86400000;
export const MERIDIAN_CHECKPOINT_MAX_TICKET=65536;
export const MERIDIAN_CHECKPOINT_KINDS=['party','cup','championship'] as const;
export type CheckpointKind=typeof MERIDIAN_CHECKPOINT_KINDS[number];
export interface CheckpointPayload{v:typeof MERIDIAN_CHECKPOINT_VERSION;kind:CheckpointKind;id:string;lineage:string;generation:number;issuedAt:number;expiresAt:number;state:unknown;roster:{seatId:string;slot:number;name:string;proofHash:string}[]}
export interface PublicCheckpoint{ticket:string;at:number;label:string}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v),exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const hex=(v:unknown,n:number):v is string=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const number=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
export function checkpointStateSafe(value:unknown,depth=0,budget={nodes:0}):boolean{
 if(++budget.nodes>12000||depth>16)return false;if(value===null||typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value)&&Math.abs(value)<=1e16;if(typeof value==='string')return value.length<=4000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
 if(Array.isArray(value))return value.length<=500&&value.every(v=>checkpointStateSafe(v,depth+1,budget));if(!object(value)||Object.keys(value).length>100)return false;
 return Object.entries(value).every(([key,row])=>key.length>0&&key.length<=80&&!/^(?:__proto__|constructor|prototype|token|secret|password|credential|session|seatToken|resumeToken|resumeKey|input|queue|pose|physics|carState)$/i.test(key)&&checkpointStateSafe(row,depth+1,budget));
}
export function parseCheckpointPayload(raw:unknown):CheckpointPayload|null{
 if(!object(raw)||!exact(raw,['v','kind','id','lineage','generation','issuedAt','expiresAt','state','roster'])||raw.v!==MERIDIAN_CHECKPOINT_VERSION||!MERIDIAN_CHECKPOINT_KINDS.includes(raw.kind as CheckpointKind)||!hex(raw.id,24)||!hex(raw.lineage,24)||!Number.isSafeInteger(raw.generation)||!number(raw.generation,1,10000)||!number(raw.issuedAt,0,8.64e15)||!number(raw.expiresAt,Number(raw.issuedAt)+1,Number(raw.issuedAt)+MERIDIAN_CHECKPOINT_TTL)||!checkpointStateSafe(raw.state)||!Array.isArray(raw.roster)||raw.roster.length<2||raw.roster.length>4)return null;
 const ids=new Set(),slots=new Set();for(const p of raw.roster){if(!object(p)||!exact(p,['seatId','slot','name','proofHash'])||!hex(p.seatId,24)||ids.has(p.seatId)||!Number.isSafeInteger(p.slot)||!number(p.slot,0,3)||slots.has(p.slot)||typeof p.name!=='string'||p.name.length<1||p.name.length>20||/[\x00-\x1f\x7f<>]/.test(p.name)||!hex(p.proofHash,64))return null;ids.add(p.seatId);slots.add(p.slot);}
 return structuredClone(raw) as unknown as CheckpointPayload;
}
/** Structural decoding is not signature verification. Only the server may accept a restored checkpoint. */
export function decodeCheckpointTicket(ticket:unknown):CheckpointPayload|null{
 if(typeof ticket!=='string'||ticket.length>MERIDIAN_CHECKPOINT_MAX_TICKET)return null;const parts=ticket.split('.');if(parts.length!==3||parts[0]!=='MC1'||!/^[A-Za-z0-9_-]+$/.test(parts[1])||!hex(parts[2],64))return null;
 try{const binary=atob(parts[1].replaceAll('-','+').replaceAll('_','/')),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return parseCheckpointPayload(JSON.parse(text));}catch{return null;}
}
export function parsePublicCheckpoints(value:unknown):PublicCheckpoint[]|null{
 if(!Array.isArray(value)||value.length>12)return null;const ids=new Set();for(const row of value){if(!object(row)||!exact(row,['ticket','at','label'])||!number(row.at,0,8.64e15)||typeof row.label!=='string'||row.label.length<1||row.label.length>80||/[\x00-\x1f<>]/.test(row.label))return null;const p=decodeCheckpointTicket(row.ticket);if(!p||ids.has(p.id))return null;ids.add(p.id);}return structuredClone(value) as PublicCheckpoint[];
}
