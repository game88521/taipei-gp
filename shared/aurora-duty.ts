/** Rex <game88521@gmail.com>. Extra roles are authority tasks, not spectator aliases. */
export const CREW_TEAM_VERSION='aurora-duty-team-v1';
export const TEAM_ROLES=['driver','technician','safety','dispatcher'] as const;
export type TeamRole=typeof TEAM_ROLES[number];
export const TEAM_ROLE_LABELS:Record<TeamRole,string>={driver:'拖救司機',technician:'絞盤技師',safety:'現場警戒',dispatcher:'領航調度'};
export interface CrewTeamState{v:typeof CREW_TEAM_VERSION;required:TeamRole[];covers:{role:TeamRole;playerId:string}[];safety:{front:number;rear:number;clearUntil:number};dispatch:{briefed:boolean;returnCleared:boolean};work:{role:TeamRole;actions:number}[]}
interface Player{id:string;name?:string;role:TeamRole;connected:boolean}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
export function crewRoleOwner(players:Player[],team:CrewTeamState|undefined,role:TeamRole){const owner=players.find(p=>p.role===role&&p.connected);if(owner)return owner;const cover=team?.covers.find(c=>c.role===role);return cover?players.find(p=>p.id===cover.playerId&&p.connected):undefined;}
export function crewRolesFor(players:Player[],team:CrewTeamState|undefined,playerId:string):TeamRole[]{return(team?.required??['driver','technician'] as TeamRole[]).filter(role=>crewRoleOwner(players,team,role)?.id===playerId);}
export function crewPaused(players:Player[],team?:CrewTeamState){if(!team)return players.length!==2||players.some(p=>!p.connected);const driver=crewRoleOwner(players,team,'driver'),technician=crewRoleOwner(players,team,'technician');return players.filter(p=>p.connected).length<2||!driver||!technician||driver.id===technician.id||team.required.some(role=>!crewRoleOwner(players,team,role));}
export function parseCrewTeam(raw:unknown,players:Player[]):CrewTeamState|null{
 if(!obj(raw)||!exact(raw,['v','required','covers','safety','dispatch','work'])||raw.v!==CREW_TEAM_VERSION||!Array.isArray(raw.required)||raw.required.length<2||raw.required.length>4||new Set(raw.required).size!==raw.required.length||!raw.required.includes('driver')||!raw.required.includes('technician')||raw.required.some(v=>!TEAM_ROLES.includes(v as TeamRole))||!Array.isArray(raw.covers)||raw.covers.length>4||!Array.isArray(raw.work)||raw.work.length!==raw.required.length)return null;
 const roles=new Set();for(const row of raw.covers){if(!obj(row)||!exact(row,['role','playerId'])||!raw.required.includes(row.role)||roles.has(row.role)||!players.some(p=>p.id===row.playerId&&p.connected)||players.some(p=>p.role===row.role&&p.connected))return null;roles.add(row.role);}
 const work=new Set();for(const row of raw.work){if(!obj(row)||!exact(row,['role','actions'])||!raw.required.includes(row.role)||work.has(row.role)||!Number.isSafeInteger(row.actions)||!num(row.actions,0,100000))return null;work.add(row.role);}
 const s=raw.safety,d=raw.dispatch;if(!obj(s)||!exact(s,['front','rear','clearUntil'])||!num(s.front,0,2)||!num(s.rear,0,2)||!num(s.clearUntil,0,1e16)||!obj(d)||!exact(d,['briefed','returnCleared'])||typeof d.briefed!=='boolean'||typeof d.returnCleared!=='boolean')return null;
 const team=raw as unknown as CrewTeamState,driver=crewRoleOwner(players,team,'driver'),technician=crewRoleOwner(players,team,'technician');if(driver&&technician&&driver.id===technician.id)return null;
 return structuredClone(team);
}
