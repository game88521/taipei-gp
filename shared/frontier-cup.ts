import {parseRoomRules,type MultiplayerRoomRules} from './multiplayer-room-rules.ts';

export const FRONTIER_CUP_VERSION='frontier-cup-v1';
export const AURORA_CUP_VERSION='aurora-league-v1';
export const CUP_MATCH_KEYS=['semi-a','semi-b','bronze','final'] as const;
export type CupMatchKey=typeof CUP_MATCH_KEYS[number]|`round-${1|2|3|4|5|6}`|`final-${1|2|3}`;
export const CUP_MATCH_LABELS:Record<CupMatchKey,string>={'semi-a':'準決賽 A（1 對 4）','semi-b':'準決賽 B（2 對 3）',bronze:'季軍賽',final:'冠軍賽','round-1':'循環對戰 1','round-2':'循環對戰 2','round-3':'循環對戰 3','round-4':'循環對戰 4','round-5':'循環對戰 5','round-6':'循環對戰 6','final-1':'決賽 BO3 第1場','final-2':'決賽 BO3 第2場','final-3':'決賽 BO3 第3場'};
export const cupMatchLabel=(key:CupMatchKey|{key:CupMatchKey})=>CUP_MATCH_LABELS[typeof key==='string'?key:key.key];
export type CupReplayReason='both-dnf'|'tie'|'server-stall';
export interface CupEntrant {playerId:string;name:string;color:string;seed:1|2|3|4}
export interface CupResult {playerId:string;finishMs:number|null;dnf:boolean;dnfReason:string|null}
export interface CupMatch {key:CupMatchKey;pair:[string,string]|null;attempt:number;matchId:string|null;status:'pending'|'running'|'decided'|'replay';reason:CupReplayReason|null;winnerId:string|null;loserId:string|null;results:CupResult[]}
export interface FrontierCupState {version:typeof FRONTIER_CUP_VERSION;id:string;revision:number;index:number;status:'ready'|'running'|'decided'|'replay'|'complete';locked:{trackId:string;trackStamp:string;laps:1|3|5;roomRules:MultiplayerRoomRules};entrants:CupEntrant[];matches:CupMatch[];league?:{version:typeof AURORA_CUP_VERSION}}
export interface CupIntent {roomCode:string;cupId:string|null;expectedCupRevision:number;expectedLobbyRevision:number;matchId:string|null;trackRevision:number}
export interface CupReadyBinding {cupId:string;cupRevision:number;lobbyRevision:number}
export type CupCommand='cup-configure'|'cup-configure-league'|'cup-start'|'cup-next'|'cup-replay'|'cup-cancel';
type AnyRoom={meridian?:unknown;series?:unknown;evolution?:{mode?:string};horizon?:object;arena?:{mode?:string};summit?:{settings?:{weekend?:boolean;ai?:number;endurance?:number}};voyager?:{settings?:{practiceSeconds?:number;weather?:string;vsc?:boolean}};atlas?:{settings?:{damage?:boolean;flags?:boolean}};odyssey?:{settings?:{sprintWeekend?:boolean;mandatoryStop?:boolean}};expedition?:{settings?:{boundary?:boolean;vsc?:boolean}}};
/** The cup owns its roster, progression and race settings. Other event modes must be closed first. */
export function cupCompatible(r:AnyRoom){return !r.meridian&&!r.series&&(!r.evolution||r.evolution.mode==='race')&&!Object.values(r.horizon??{}).some(Boolean)&&(!r.arena||r.arena.mode==='off')&&!r.summit?.settings?.weekend&&!r.summit?.settings?.ai&&!r.summit?.settings?.endurance&&!r.voyager?.settings?.practiceSeconds&&(!r.voyager?.settings?.weather||r.voyager.settings.weather==='legacy')&&!r.voyager?.settings?.vsc&&!r.atlas?.settings?.damage&&!r.atlas?.settings?.flags&&!r.odyssey?.settings?.sprintWeekend&&!r.odyssey?.settings?.mandatoryStop&&!r.expedition?.settings?.boundary&&!r.expedition?.settings?.vsc;}
export const cupActiveIds=(c:FrontierCupState|null|undefined):readonly string[]=>c?.matches[c.index]?.pair??[];
export function leaguePairs(entrants:CupEntrant[]):[string,string][]{const pairs:[string,string][]=[];for(let a=0;a<entrants.length;a++)for(let b=a+1;b<entrants.length;b++)pairs.push((a+b)%2?[entrants[a].playerId,entrants[b].playerId]:[entrants[b].playerId,entrants[a].playerId]);return pairs;}
export function leagueTable(c:FrontierCupState){const count=leaguePairs(c.entrants).length;return c.entrants.map(e=>{const rows=c.matches.slice(0,count).filter(m=>m.status==='decided'&&m.pair?.includes(e.playerId)),results=rows.flatMap(m=>m.results.filter(r=>r.playerId===e.playerId));return{...e,wins:rows.filter(m=>m.winnerId===e.playerId).length,finishes:results.filter(r=>!r.dnf&&r.finishMs!==null).length,totalMs:results.reduce((sum,r)=>sum+(r.finishMs??0),0)};}).sort((a,b)=>b.wins-a.wins||b.finishes-a.finishes||a.totalMs-b.totalMs||a.seed-b.seed);}
export function leagueFinalWins(c:FrontierCupState){const rows=c.matches.slice(leaguePairs(c.entrants).length);return c.entrants.map(e=>({id:e.playerId,wins:rows.filter(m=>m.status==='decided'&&m.winnerId===e.playerId).length}));}
export function cupIsComplete(c:FrontierCupState){return c.league?leagueFinalWins(c).some(e=>e.wins===2):c.index===3;}
export function cupStandings(c:FrontierCupState){if(c.status!=='complete')return[];if(c.league){const table=leagueTable(c),winner=leagueFinalWins(c).find(e=>e.wins===2)!.id,finalists=table.slice(0,2).map(e=>e.playerId),ids=[winner,finalists.find(id=>id!==winner)!,...table.slice(2).map(e=>e.playerId)];return ids.map((id,index)=>({...c.entrants.find(e=>e.playerId===id)!,rank:index+1}));}const final=c.matches[3],bronze=c.matches[2];return[final.winnerId,final.loserId,bronze.winnerId,bronze.loserId].map((id,index)=>({...c.entrants.find(e=>e.playerId===id)!,rank:index+1}));}
export function cupExpectedPair(c:FrontierCupState,index:number):[string,string]|null {const e=c.entrants;if(c.league){const pairs=leaguePairs(e);if(index<pairs.length)return pairs[index];if(c.matches.slice(0,pairs.length).some(m=>m.status!=='decided'))return null;const finalists=leagueTable(c).slice(0,2).map(e=>e.playerId) as [string,string];return(index-pairs.length)%2?[finalists[1],finalists[0]]:finalists;}if(index===0)return[e[0].playerId,e[3].playerId];if(index===1)return[e[1].playerId,e[2].playerId];const a=c.matches[0],b=c.matches[1];if(a.status!=='decided'||b.status!=='decided')return null;return index===2?[a.loserId!,b.loserId!]:[a.winnerId!,b.winnerId!];}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,ks:string[])=>Object.keys(v).length===ks.length&&ks.every(k=>k in v);
const id=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function parseFrontierCup(v:unknown):FrontierCupState|null {
 if(!object(v))return null;const league='league'in v;if(league&&(!object(v.league)||!keys(v.league,['version'])||v.league.version!==AURORA_CUP_VERSION))return null;
 if(!keys(v,['version','id','revision','index','status','locked','entrants','matches',...(league?['league']:[])])||v.version!==FRONTIER_CUP_VERSION||typeof v.id!=='string'||!/^[a-f0-9]{24}$/.test(v.id)||!integer(v.revision,1,1000000)||!integer(v.index,0,8)||!['ready','running','decided','replay','complete'].includes(String(v.status))||!object(v.locked)||!keys(v.locked,['trackId','trackStamp','laps','roomRules'])||typeof v.locked.trackId!=='string'||v.locked.trackId.length<1||v.locked.trackId.length>64||typeof v.locked.trackStamp!=='string'||v.locked.trackStamp.length<1||v.locked.trackStamp.length>128||typeof v.locked.laps!=='number'||![1,3,5].includes(v.locked.laps)||!parseRoomRules(v.locked.roomRules)||!Array.isArray(v.entrants)||v.entrants.length<(league?2:4)||v.entrants.length>4||!Array.isArray(v.matches))return null;
 const entrants=v.entrants;if(entrants.some((e,i)=>!object(e)||!keys(e,['playerId','name','color','seed'])||!id(e.playerId)||typeof e.name!=='string'||e.name.length<1||e.name.length>16||typeof e.color!=='string'||!/^#[a-f0-9]{6}$/i.test(e.color)||e.seed!==i+1)||new Set(entrants.map(e=>e.playerId)).size!==entrants.length)return null;
 const c=v as unknown as FrontierCupState;
 const roundCount=league?entrants.length*(entrants.length-1)/2:0,matchKeys=league?[...Array.from({length:roundCount},(_,i)=>`round-${i+1}`),'final-1','final-2','final-3']:CUP_MATCH_KEYS;if(v.matches.length!==matchKeys.length||Number(v.index)>=v.matches.length)return null;
 for(let i=0;i<matchKeys.length;i++){
  const m=v.matches[i];if(!object(m)||!keys(m,['key','pair','attempt','matchId','status','reason','winnerId','loserId','results'])||m.key!==matchKeys[i]||!integer(m.attempt,1,9999)||!['pending','running','decided','replay'].includes(String(m.status))||m.matchId!==null&&!id(m.matchId)||!Array.isArray(m.results)||m.results.length>2||![null,'both-dnf','tie','server-stall'].includes(m.reason as null))return null;
  if(!same(m.pair,cupExpectedPair(c,i))||i<Number(v.index)&&m.status!=='decided'||i>Number(v.index)&&(m.status!=='pending'||m.attempt!==1)||i===Number(v.index)&&m.pair===null)return null;
  if(m.status==='pending'){if(m.matchId!==null||m.reason!==null||m.winnerId!==null||m.loserId!==null||m.results.length)return null;continue;}
  if(!m.pair||m.matchId===null)return null;
  if(m.status==='running'){if(m.reason!==null||m.winnerId!==null||m.loserId!==null||m.results.length)return null;continue;}
  if(m.results.length!==2||m.results.some((r,j)=>!object(r)||!keys(r,['playerId','finishMs','dnf','dnfReason'])||r.playerId!==(m.pair as string[])[j]||typeof r.dnf!=='boolean'||r.finishMs!==null&&(typeof r.finishMs!=='number'||!Number.isFinite(r.finishMs)||r.finishMs<=0||r.finishMs>86400000)||r.dnfReason!==null&&!['race-timeout','finish-timeout','disconnect-expired','left','server-stall'].includes(String(r.dnfReason))||r.dnf&&(r.finishMs!==null||r.dnfReason===null)||!r.dnf&&r.dnfReason!==null))return null;
  const rows=m.results as unknown as CupResult[],finish=rows.filter(r=>!r.dnf&&r.finishMs!==null),tie=finish.length===2&&finish[0].finishMs===finish[1].finishMs;
  if(m.status==='replay'){if(m.winnerId!==null||m.loserId!==null||m.reason===null||m.reason==='both-dnf'&&!rows.every(r=>r.dnf)||m.reason==='tie'&&!tie)return null;}
  else{if(m.reason!==null||rows.some(r=>!r.dnf&&r.finishMs===null)||!finish.length||tie)return null;const winner=finish.sort((a,b)=>a.finishMs!-b.finishMs!)[0].playerId;if(m.winnerId!==winner||m.loserId!==(m.pair as string[]).find(p=>p!==winner))return null;}
 }
 const m=c.matches[c.index],expected=c.status==='ready'?'pending':c.status==='complete'?'decided':c.status;
 if(m.status!==expected||c.status==='complete'&&!cupIsComplete(c)||c.status==='decided'&&cupIsComplete(c)||!league&&c.index>3||c.matches.filter(m=>m.matchId!==null).length!==new Set(c.matches.filter(m=>m.matchId!==null).map(m=>m.matchId)).size)return null;
 if(league&&c.index>roundCount&&c.matches.slice(roundCount,c.index).filter(m=>m.status==='decided').some((m,_,prior)=>prior.filter(q=>q.winnerId===m.winnerId).length>=2))return null;
 return c;
}
/** Validate the complete cross-field contract before the client accepts any cup controls. */
export function validateCupSnapshot(value:Record<string,unknown>){
 const cap=(value.capabilities as Record<string,unknown>|undefined)?.frontierCup,cup=value.cup;
 if(cap===undefined){if(cup!==undefined||(value.players as {cup?:unknown}[])?.some(p=>p.cup!==undefined))throw Error('好友盃能力與資料不一致。');return;}
 if(cap!==FRONTIER_CUP_VERSION)throw Error('好友盃版本不一致，請更新後續接。');
 if(cup===null||cup===undefined){if((value.players as {cup?:unknown}[])?.some(p=>p.cup!==undefined))throw Error('好友盃車手資料不一致。');return;}
 const c=parseFrontierCup(cup);if(!c||!cupCompatible(value as AnyRoom))throw Error('好友盃賽程或房規無效。');
 if(c.league&&(value.capabilities as Record<string,unknown>|undefined)?.auroraCup!==AURORA_CUP_VERSION)throw Error('循環好友盃能力不相容。');
 const locked=c.locked,players=value.players as {id:string;name:string;color:string;cup?:{active:boolean;seed:number};dnf:boolean;finishMs:number|null;completedLaps:number;progress:number;lapTimesMs?:number[];bestLapMs?:number|null;summit?:{ai:boolean}}[],active=cupActiveIds(c);
 if(!Array.isArray(players)||players.length!==c.entrants.length||c.entrants.some(e=>!players.some(p=>p.id===e.playerId&&p.name===e.name&&p.color===e.color))||players.some(p=>p.summit?.ai)||value.trackId!==locked.trackId||value.trackStamp!==locked.trackStamp||value.laps!==locked.laps||!same(value.roomRules,locked.roomRules)||(value.spectators as unknown[]|undefined)?.length)throw Error('好友盃固定名單或賽事設定不一致。');
 const expectedPhase=c.status==='ready'?'lobby':c.status==='running'?null:'results';
 if(expectedPhase?value.phase!==expectedPhase:!['countdown','racing'].includes(String(value.phase)))throw Error('好友盃階段與房間不一致。');
 if(value.matchId!==c.matches[c.index].matchId||players.some(p=>!p.cup||Object.keys(p.cup).length!==2||p.cup.active!==active.includes(p.id)||p.cup.seed!==c.entrants.find(e=>e.playerId===p.id)?.seed||!p.cup.active&&(p.dnf||p.finishMs!==null||p.completedLaps!==0||p.progress!==0||p.lapTimesMs?.length||p.bestLapMs!==null)))throw Error('好友盃候場車手狀態無效。');
 const current=c.matches[c.index];
 if(current.results.length&&current.results.some(r=>{const p=players.find(p=>p.id===r.playerId)!;return p.finishMs!==r.finishMs||p.dnf!==r.dnf||(p as unknown as {dnfReason?:string|null}).dnfReason!==r.dnfReason;}))throw Error('好友盃本場結果與權威車手成績不一致。');
}
