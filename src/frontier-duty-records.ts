import {parseDutyMission,type DutyMission} from '../shared/frontier-duty-missions';
import type {CrewRoom,CrewRole} from '../shared/expedition-duty';
export const DUTY_MISSION_RECORDS_KEY='taipei-gp-frontier-crew-v2';
export interface DutyMissionRecord{id:string;at:number;seconds:number;integrity:number;mission:DutyMission;crew:{name:string;role:CrewRole}[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
export function parseDutyMissionRecords(value:unknown):DutyMissionRecord[]|null{
 if(!Array.isArray(value)||value.length>30)return null;const ids=new Set();
 for(const row of value){if(!obj(row)||!exact(row,['id','at','seconds','integrity','mission','crew'])||typeof row.id!=='string'||!/^[a-f0-9]{20}$/.test(row.id)||ids.has(row.id)||!num(row.at,8.64e15)||!num(row.seconds,5401)||!num(row.integrity,100))return null;
  const m=parseDutyMission(row.mission);if(!m||m.completed.length!==m.settings.incidents.length||Math.abs(m.completed.reduce((sum,c)=>sum+c.seconds,0)-row.seconds)>1e-5||m.completed.at(-1)!.integrity!==row.integrity)return null;
  if(!Array.isArray(row.crew)||row.crew.length!==2||row.crew.some(p=>!obj(p)||!exact(p,['name','role'])||typeof p.name!=='string'||p.name.length<1||p.name.length>20||/[\x00-\x1f\x7f<>]/.test(p.name)||!['driver','technician'].includes(String(p.role)))||new Set(row.crew.map(p=>p.role)).size!==2)return null;ids.add(row.id);
 }return structuredClone(value) as DutyMissionRecord[];
}
export function dutyMissionRecord(room:CrewRoom,at=Date.now()):DutyMissionRecord|null{
 if(room.phase!=='finished'||room.stage!=='complete')return null;const value={id:room.runId,at,seconds:room.elapsed,integrity:room.integrity,mission:structuredClone(room.mission),crew:room.players.map(p=>({name:p.name,role:p.role}))};return parseDutyMissionRecords([value])?.[0]??null;
}
