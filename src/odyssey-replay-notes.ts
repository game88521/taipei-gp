import type {MultiplayerReplay} from '../shared/nexus-replay';
export const REPLAY_NOTES_MAX_BYTES=32768;
export interface ReplayLoop {a:number;b:number}
export interface ReplayNote {at:number;label:string}
export interface ReplayNotes {app:'taipei-gp-replay-notes';v:1;replayId:string;fingerprint:string;durationMs:number;loop:ReplayLoop|null;marks:ReplayNote[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string)=>Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const at=(v:unknown,duration:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=duration;
export function validReplayLoop(value:unknown,duration:number):value is ReplayLoop{return object(value)&&exact(value,'a,b')&&at(value.a,duration)&&at(value.b,duration)&&value.b-value.a>=200;}
/** Canonical JSON orders every object key, keeping frame/driver array order significant. */
export function canonicalReplay(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonicalReplay).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonicalReplay(value[k])).join(',')+'}';return JSON.stringify(value);}
export async function replayFingerprint(replay:MultiplayerReplay):Promise<string>{const bytes=new TextEncoder().encode(canonicalReplay(replay));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function parseReplayNotes(raw:unknown,replay:Pick<MultiplayerReplay,'id'|'recordedMs'>,fingerprint:string):ReplayNotes|null{
 if(!object(raw)||!exact(raw,'app,v,replayId,fingerprint,durationMs,loop,marks')||raw.app!=='taipei-gp-replay-notes'||raw.v!==1||raw.replayId!==replay.id||typeof raw.replayId!=='string'||!/^[-\w]{1,64}$/.test(raw.replayId)||raw.fingerprint!==fingerprint||!/^[a-f0-9]{64}$/.test(fingerprint)||raw.durationMs!==replay.recordedMs||!Number.isFinite(replay.recordedMs)||replay.recordedMs<0||replay.recordedMs>720000||raw.loop!==null&&!validReplayLoop(raw.loop,replay.recordedMs)||!Array.isArray(raw.marks)||raw.marks.length>64)return null;
 const marks:ReplayNote[]=[];for(const item of raw.marks){if(!object(item)||!exact(item,'at,label')||!at(item.at,replay.recordedMs)||typeof item.label!=='string'||item.label!==item.label.trim()||item.label.length<1||item.label.length>40||/[\u0000-\u001f\u007f<>]/.test(item.label))return null;marks.push({at:item.at,label:item.label});}
 return {app:'taipei-gp-replay-notes',v:1,replayId:raw.replayId,fingerprint,durationMs:replay.recordedMs,loop:raw.loop===null?null:{a:(raw.loop as unknown as ReplayLoop).a,b:(raw.loop as unknown as ReplayLoop).b},marks};
}
export function decodeReplayNotes(text:string,replay:Pick<MultiplayerReplay,'id'|'recordedMs'>,fingerprint:string):ReplayNotes{
 if(new TextEncoder().encode(text).byteLength>REPLAY_NOTES_MAX_BYTES)throw Error('註記檔超過32KB，未匯入。');let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('註記不是有效JSON，未匯入。');}const parsed=parseReplayNotes(raw,replay,fingerprint);if(!parsed)throw Error('註記的回放識別碼、內容指紋、時間或格式不符，未匯入。');return parsed;
}
export function advanceReplayLoop(atMs:number,deltaMs:number,loop:ReplayLoop|null,duration:number){const next=atMs+Math.max(0,deltaMs);return loop&&validReplayLoop(loop,duration)?next>=loop.b?loop.a+(next-loop.b)%(loop.b-loop.a):Math.max(loop.a,next):Math.min(duration,next);}
