export const LANTERN_WEEKLY_VERSION='lantern-weekly-v1';
export const CUP_CODE=/^[A-HJ-NP-Z2-9]{8}$/;
export interface WeeklyTrack {id:string;name:string;stamp:string}
export interface WeeklyMember {id:string;name:string;joinedAt:number;scores:Record<string,number>}
export interface WeeklyCup {v:1;code:string;name:string;createdAt:number;startAt:number;endAt:number;rules:'classic';tracks:WeeklyTrack[];members:WeeklyMember[];revision:number}
export function utcWeek(now:number):{startAt:number;endAt:number}{const d=new Date(now),day=(d.getUTCDay()+6)%7,startAt=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day);return{startAt,endAt:startAt+7*86400000};}
export function weeklyTrackIds(ids:readonly string[],startAt:number):string[]{const offset=Math.floor(startAt/(7*86400000))*3;return[0,1,2].map(i=>ids[((offset+i)%ids.length+ids.length)%ids.length]);}
export function weeklyStandings(cup:WeeklyCup){const points=[25,18,15,12,10,8,6,4,2,1],rows=cup.members.map(m=>({id:m.id,name:m.name,points:0,completed:0,totalTime:0,stages:[] as {track:string;rank:number|null;time:number|null;points:number}[]}));
 for(const t of cup.tracks){const sorted=cup.members.filter(m=>Number.isFinite(m.scores[t.id])&&m.scores[t.id]>0).sort((a,b)=>a.scores[t.id]-b.scores[t.id]||a.id.localeCompare(b.id));for(const row of rows){const i=sorted.findIndex(m=>m.id===row.id),seconds=i<0?null:sorted[i].scores[t.id],rank=i<0?null:sorted.findIndex(m=>m.scores[t.id]===seconds)+1,p=rank===null?0:points[rank-1]??0;row.stages.push({track:t.id,rank,time:seconds,points:p});row.points+=p;if(seconds!==null){row.completed++;row.totalTime+=seconds;}}}
 return rows.sort((a,b)=>b.points-a.points||b.completed-a.completed||a.totalTime-b.totalTime||a.id.localeCompare(b.id));
}
