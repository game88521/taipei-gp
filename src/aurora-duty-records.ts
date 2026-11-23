import {TEAM_ROLES,type TeamRole} from '../shared/aurora-duty';
import {parseDutyMission,type DutyMission} from '../shared/frontier-duty-missions';
import type {CrewRoom} from '../shared/expedition-duty';
/** Rex <game88521@gmail.com>. Public completion summary; no room, player IDs or private seats. */
export const AURORA_DUTY_RECORDS_KEY='taipei-gp-aurora-duty-results-v1';
export interface AuroraDutyRecord{id:string;at:number;seconds:number;integrity:number;mission:DutyMission;crew:{name:string;role:TeamRole}[];required:TeamRole[];work:{role:TeamRole;actions:number}[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
export function parseAuroraDutyRecords(value:unknown):AuroraDutyRecord[]|null{
 if(!Array.isArray(value)||value.length>30)return null;const ids=new Set();
 for(const row of value){if(!obj(row)||!exact(row,['id','at','seconds','integrity','mission','crew','required','work'])||typeof row.id!=='string'||!/^[a-f0-9]{20}$/.test(row.id)||ids.has(row.id)||!num(row.at,8.64e15)||!num(row.seconds,5401)||!num(row.integrity,100))return null;
  const mission=parseDutyMission(row.mission);if(!mission||mission.completed.length!==mission.settings.incidents.length||Math.abs(mission.completed.reduce((sum,r)=>sum+r.seconds,0)-row.seconds)>1e-5||mission.completed.at(-1)!.integrity!==row.integrity)return null;
  if(!Array.isArray(row.crew)||row.crew.length<2||row.crew.length>4||new Set(row.crew.map(p=>p?.role)).size!==row.crew.length||row.crew.some(p=>!obj(p)||!exact(p,['name','role'])||typeof p.name!=='string'||p.name.length<1||p.name.length>20||/[\x00-\x1f\x7f<>]/.test(p.name)||!TEAM_ROLES.includes(p.role as TeamRole)))return null;
  if(!Array.isArray(row.required)||row.required.length<2||row.required.length>4||new Set(row.required).size!==row.required.length||!row.required.includes('driver')||!row.required.includes('technician')||row.required.some(r=>!TEAM_ROLES.includes(r as TeamRole))||!Array.isArray(row.work)||row.work.length!==row.required.length||new Set(row.work.map(w=>w?.role)).size!==row.work.length||row.work.some(w=>!obj(w)||!exact(w,['role','actions'])||!(row.required as unknown[]).includes(w.role)||!Number.isSafeInteger(w.actions)||!num(w.actions,100000)))return null;
  ids.add(row.id);
 }return structuredClone(value) as AuroraDutyRecord[];
}
export function auroraDutyRecord(room:CrewRoom,at=Date.now()):AuroraDutyRecord|null{
 if(!room.team||room.phase!=='finished'||room.stage!=='complete')return null;
 return parseAuroraDutyRecords([{id:room.runId,at,seconds:room.elapsed,integrity:room.integrity,mission:room.mission,crew:room.players.map(p=>({name:p.name,role:p.role})),required:room.team.required,work:room.team.work}])?.[0]??null;
}
