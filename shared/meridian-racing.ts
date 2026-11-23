import {getMultiplayerTrack} from './multiplayer-tracks.ts';
export const MERIDIAN_RACING_VERSION='meridian-racing-v1';
export type MeridianSettings={mode:'off'}|{mode:'relay-endurance';durationSeconds:480|600;handoffsRequired:1|2|3}|{mode:'championship';trackIds:string[];sprint:boolean};
export interface MeridianEntrant {id:string;name:string;slot:number}
export interface MeridianResult {id:string;rank:number;dnf:boolean;finishMs:number|null;points:number}
export interface MeridianRound {trackId:string;qualifying:MeridianResult[];sprint:MeridianResult[];race:MeridianResult[]}
export interface MeridianRelayTeam {team:'red'|'blue';memberIds:string[];driverId:string;generation:number;handoffs:number;progress:number;completedLaps:number;finishMs:number|null;dnf:boolean;driveMs:Record<string,number>;stintStartedAt:number;stintStartDistance:number}
export interface MeridianRacingState {version:typeof MERIDIAN_RACING_VERSION;revision:number;settings:Exclude<MeridianSettings,{mode:'off'}>;locked:boolean;entrants:MeridianEntrant[];stage:'endurance'|'qualifying'|'sprint'|'race';roundIndex:number;rounds:MeridianRound[];grid:string[];complete:boolean;aborted:boolean;teams:Record<string,'red'|'blue'>;relayTeams:MeridianRelayTeam[];standings:{id:string;points:number;wins:number;rank:number}[];raceLaps:1|3|5}
export interface MeridianRacingPlayer {active:boolean;team:'red'|'blue'|null;generation:number;validLaps?:number[];lapValid?:boolean}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const finite=(v:unknown,min=0,max=8.64e15)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function meridianSettings(v:unknown):MeridianSettings|null{
 if(!obj(v))return null;
 if(v.mode==='off'&&exact(v,['mode']))return{mode:'off'};
 if(v.mode==='relay-endurance'&&exact(v,['mode','durationSeconds','handoffsRequired'])&&[480,600].includes(v.durationSeconds as number)&&[1,2,3].includes(v.handoffsRequired as number))return{mode:v.mode,durationSeconds:v.durationSeconds as 480|600,handoffsRequired:v.handoffsRequired as 1|2|3};
 if(v.mode==='championship'&&exact(v,['mode','trackIds','sprint'])&&typeof v.sprint==='boolean'&&Array.isArray(v.trackIds)&&[3,4,5].includes(v.trackIds.length)&&new Set(v.trackIds).size===v.trackIds.length&&v.trackIds.every(id=>typeof id==='string'&&!!getMultiplayerTrack(id)?.circuit))return{mode:v.mode,trackIds:[...v.trackIds] as string[],sprint:v.sprint};
 return null;
}
export const meridianCanDrive=(p:{meridian?:MeridianRacingPlayer})=>p.meridian?.active!==false;
/** Independent capability leaves the classic relay and Summit snapshot rules unchanged. */
export function validateMeridianRacing(room:Record<string,unknown>){
 const cap=(room.capabilities as Record<string,unknown>|undefined)?.meridianRacing,m=room.meridian,players=room.players as Record<string,unknown>[];
 if(cap===undefined){if(m!==undefined||players?.some(p=>p.meridian!==undefined))throw Error('Meridian 能力與狀態不一致。');return;}
 if(cap!==true)throw Error('Meridian 能力無效。');if(m===undefined){if(players?.some(p=>p.meridian!==undefined))throw Error('未開啟玩法不可提供接力狀態。');return;}
 const parsed=parseMeridianState(m,players.map(p=>String(p.id)));if(!parsed)throw Error('Meridian 賽事狀態無效。');
 if(room.series||(room.arena as {mode?:string}|undefined)?.mode!=='off'||(room.evolution as {mode?:string}|undefined)?.mode!=='race'||Object.values(room.horizon as object??{}).some(Boolean))throw Error('Meridian 與其他賽制不相容。');
 for(const p of players){const v=p.meridian,qual=parsed.settings.mode==='championship'&&parsed.stage==='qualifying',keys=['active','team','generation',...(qual?['validLaps','lapValid']:[])];if(!obj(v)||!exact(v,keys)||typeof v.active!=='boolean'||![null,'red','blue'].includes(v.team as null)||!int(v.generation,0,10000)||qual&&(!Array.isArray(v.validLaps)||v.validLaps.length>128||v.validLaps.some(t=>!finite(t,1,180000))||typeof v.lapValid!=='boolean'))throw Error('Meridian 駕駛權無效。');if(parsed.settings.mode==='championship'){if(!v.active||v.team!==null||v.generation!==0)throw Error('錦標賽席位無效。');}else{const t=parsed.relayTeams.find(t=>t.memberIds.includes(String(p.id)));if(v.team!==parsed.teams[String(p.id)]||t&&(v.active!==(room.phase==='lobby'||t.driverId===p.id)||v.generation!==t.generation))throw Error('耐久接力駕駛權不一致。');}}
}
export function parseMeridianState(v:unknown,allowedIds?:string[]):MeridianRacingState|null {
 if(!obj(v)||!exact(v,['version','revision','settings','locked','entrants','stage','roundIndex','rounds','grid','complete','aborted','teams','relayTeams','standings','raceLaps'])||v.version!==MERIDIAN_RACING_VERSION||!int(v.revision,1,1e9)||typeof v.locked!=='boolean'||typeof v.complete!=='boolean'||typeof v.aborted!=='boolean'||![1,3,5].includes(v.raceLaps as number)||!Array.isArray(v.entrants)||v.entrants.length>4||!Array.isArray(v.grid)||v.grid.length>4||new Set(v.grid).size!==v.grid.length||!Array.isArray(v.rounds)||v.rounds.length>5||!Array.isArray(v.relayTeams)||v.relayTeams.length>2||!Array.isArray(v.standings)||v.standings.length>4||!obj(v.teams))return null;
 const settings=meridianSettings(v.settings);if(!settings||settings.mode==='off')return null;
 const entrants=v.entrants as MeridianEntrant[];if(entrants.some(e=>!obj(e)||!exact(e as unknown as Record<string,unknown>,['id','name','slot'])||typeof e.id!=='string'||!e.id||e.id.length>128||typeof e.name!=='string'||e.name.length>16||!int(e.slot,0,3))||new Set(entrants.map(e=>e.id)).size!==entrants.length||new Set(entrants.map(e=>e.slot)).size!==entrants.length)return null;
 const ids=allowedIds??entrants.map(e=>e.id),lockedIds=entrants.map(e=>e.id);if(v.locked&&(entrants.length<2||lockedIds.some(id=>!ids.includes(id)))||v.grid.some(id=>typeof id!=='string'||!ids.includes(id))||Object.keys(v.teams).some(id=>!ids.includes(id))||Object.values(v.teams).some(t=>typeof t!=='string'||!['red','blue'].includes(t)))return null;
 const validRows=(rows:unknown,scoring:boolean)=>Array.isArray(rows)&&rows.length<=4&&new Set(rows.map(r=>obj(r)?r.id:null)).size===rows.length&&rows.every(r=>obj(r)&&exact(r,['id','rank','dnf','finishMs','points'])&&typeof r.id==='string'&&lockedIds.includes(r.id)&&int(r.rank,1,4)&&typeof r.dnf==='boolean'&&(r.finishMs===null||finite(r.finishMs,0,900000))&&int(r.points,0,10)&&(!r.dnf||r.points===0)&&(!scoring||r.finishMs!==null||r.points===0));
 if(v.rounds.some(r=>!obj(r)||!exact(r,['trackId','qualifying','sprint','race'])||typeof r.trackId!=='string'||!getMultiplayerTrack(r.trackId)||!validRows(r.qualifying,false)||!validRows(r.sprint,true)||!validRows(r.race,true)))return null;
 if(v.standings.some(r=>!obj(r)||!exact(r,['id','points','wins','rank'])||typeof r.id!=='string'||!lockedIds.includes(r.id)||!int(r.points,0,65)||!int(r.wins,0,5)||!int(r.rank,1,4))||new Set(v.standings.map(r=>obj(r)?r.id:null)).size!==v.standings.length)return null;
 if(settings.mode==='championship'){
  if(typeof v.stage!=='string'||!['qualifying','sprint','race'].includes(v.stage)||v.stage==='sprint'&&!settings.sprint||!int(v.roundIndex,0,settings.trackIds.length-1)||Object.keys(v.teams).length||v.relayTeams.length||v.rounds.some((r,i)=>!obj(r)||r.trackId!==settings.trackIds[i])||v.complete&&(v.roundIndex!==settings.trackIds.length-1||!(v.rounds.at(-1) as MeridianRound|undefined)?.race.length))return null;
  const rounds=v.rounds as MeridianRound[];
  if(rounds.length<Number(v.roundIndex)||rounds.length>Number(v.roundIndex)+1||!v.locked&&(entrants.length||rounds.length||v.grid.length||v.standings.length||v.roundIndex!==0)||v.locked&&v.grid.length!==entrants.length)return null;
  const pointsFor=(stage:'qualifying'|'sprint'|'race')=>stage==='race'?[10,6,4,2]:stage==='sprint'?[3,2,1,0]:[0,0,0,0];
  for(const [i,round]of rounds.entries()){
   if(!settings.sprint&&round.sprint.length||i<Number(v.roundIndex)&&(!round.qualifying.length||!round.race.length||settings.sprint&&!round.sprint.length)||round.sprint.length&&!round.qualifying.length||round.race.length&&(!round.qualifying.length||settings.sprint&&!round.sprint.length))return null;
   if(i===Number(v.roundIndex)&&(v.stage==='qualifying'&&(round.sprint.length||round.race.length)||v.stage==='sprint'&&round.race.length))return null;
   for(const stage of ['qualifying','sprint','race'] as const){const rows=round[stage],award=pointsFor(stage);if(rows.length&&(rows.length!==entrants.length||rows.some((row,index)=>row.rank!==index+1||row.dnf!==(row.finishMs===null)||row.points!==(row.dnf?0:award[index]))))return null;}
  }
  const completed=rounds.filter(round=>round.race.length),aggregate=entrants.map(e=>({id:e.id,points:0,wins:0,slot:e.slot}));
  for(const round of completed)for(const row of [...round.sprint,...round.race]){const a=aggregate.find(a=>a.id===row.id)!;a.points+=row.points;if(round.race.includes(row)&&row.rank===1&&!row.dnf)a.wins++;}
  const expected=completed.length?aggregate.sort((a,b)=>b.points-a.points||b.wins-a.wins||a.slot-b.slot).map(({slot:_,...row},i)=>({...row,rank:i+1})):[];
  if(JSON.stringify(expected)!==JSON.stringify(v.standings)||v.complete!==(completed.length===settings.trackIds.length))return null;
 }else{
  if(v.stage!=='endurance'||v.roundIndex!==0||v.rounds.length||v.grid.length||v.standings.length)return null;
  for(const t of v.relayTeams){if(!obj(t)||!exact(t,['team','memberIds','driverId','generation','handoffs','progress','completedLaps','finishMs','dnf','driveMs','stintStartedAt','stintStartDistance'])||typeof t.team!=='string'||!['red','blue'].includes(t.team)||!Array.isArray(t.memberIds)||t.memberIds.length!==2||new Set(t.memberIds).size!==2||t.memberIds.some(id=>typeof id!=='string'||!ids.includes(id)||(v.teams as Record<string,unknown>)[id]!==t.team)||typeof t.driverId!=='string'||!t.memberIds.includes(t.driverId)||!int(t.generation,1,10000)||!int(t.handoffs,0,9999)||t.generation!==Number(t.handoffs)+1||!finite(t.progress)||!int(t.completedLaps,0,1000)||t.finishMs!==null&&!finite(t.finishMs,0,900000)||typeof t.dnf!=='boolean'||!finite(t.stintStartedAt)||!finite(t.stintStartDistance,-100,1e9)||!obj(t.driveMs)||Object.keys(t.driveMs).length!==2||t.memberIds.some(id=>typeof id!=='string'||!finite((t.driveMs as Record<string,unknown>)[id],0,900000)))return null;}
  if(v.locked&&(v.relayTeams.length!==2||new Set(v.relayTeams.map(t=>(t as MeridianRelayTeam).team)).size!==2||entrants.length!==4))return null;
 }
 return structuredClone(v) as unknown as MeridianRacingState;
}
