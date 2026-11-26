/** Rex <game88521@gmail.com>. Public flags are authority snapshots, never client commands. */
export const CTF_VERSION='lantern-ctf-v1';
export const CTF_DURATION_MS=180000,CTF_TARGET=3,CTF_RETURN_MS=15000,CTF_LOCK_MS=2000;
export type CtfTeam='red'|'blue';
export interface CtfPoint{x:number;y:number;z:number;h:number}
export interface CtfFlag{team:CtfTeam;state:'home'|'carried'|'dropped';carrierSlot:number|null;x:number;y:number;z:number;returnAt:number;pickupAfter:number}
export interface CtfState{v:typeof CTF_VERSION;bases:{red:CtfPoint;blue:CtfPoint};flags:CtfFlag[];scores:{red:number;blue:number};winner:CtfTeam|'draw'|null;events:number}
export const ctfTeam=(slot:number):CtfTeam=>slot%2===0?'red':'blue';
export const ctfOther=(team:CtfTeam):CtfTeam=>team==='red'?'blue':'red';
export const ctfTeamLabel=(team:CtfTeam)=>team==='red'?'紅隊':'藍隊';
export const CTF_RULES='四人2對2，席位1／3紅隊、2／4藍隊，全員同款轎車。三秒倒數後比賽180秒，先得3旗或時間到分高者勝，同分平手。到敵方旗幟同層8公尺內、低於18km/h可取旗；己旗在基地時，攜敵旗返己方基地同樣停慢可得分。與敵車真實碰撞會掉旗，兩秒後可再拾取；己方碰到掉落己旗可歸還，15秒自動歸還。斷線立即掉旗、席位保留15秒；永久離席或模擬中斷取消勝負。';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join(',')===s;
const n=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
const point=(v:unknown):v is CtfPoint=>obj(v)&&exact(v,'h,x,y,z')&&n(v.x,-12000,12000)&&n(v.z,-12000,12000)&&n(v.y,-120,600)&&n(v.h,-Math.PI,Math.PI);
export function parseCtfSummary(raw:unknown):Pick<CtfState,'scores'|'winner'>|null{if(!obj(raw)||!exact(raw,'scores,winner')||!obj(raw.scores)||!exact(raw.scores,'blue,red')||!n(raw.scores.red,0,3)||!n(raw.scores.blue,0,3)||!Number.isInteger(raw.scores.red)||!Number.isInteger(raw.scores.blue)||!['red','blue','draw',null].includes(raw.winner as null))return null;const {red,blue}=raw.scores;if(raw.winner==='red'&&red<=blue||raw.winner==='blue'&&blue<=red||raw.winner==='draw'&&red!==blue)return null;return{scores:{red,blue},winner:raw.winner as CtfState['winner']};}
export function parseCtfState(raw:unknown):CtfState|null{
 if(!obj(raw)||!exact(raw,'bases,events,flags,scores,v,winner')||raw.v!==CTF_VERSION||!obj(raw.bases)||!exact(raw.bases,'blue,red')||!point(raw.bases.red)||!point(raw.bases.blue)||Math.hypot(raw.bases.red.x-raw.bases.blue.x,raw.bases.red.z-raw.bases.blue.z)<40||!obj(raw.scores)||!exact(raw.scores,'blue,red')||!['red','blue','draw',null].includes(raw.winner as null)||!Number.isSafeInteger(raw.events)||!n(raw.events,0,100000)||!Array.isArray(raw.flags)||raw.flags.length!==2)return null;
 for(const t of ['red','blue']as const)if(!Number.isSafeInteger(raw.scores[t])||!n(raw.scores[t],0,CTF_TARGET))return null;
 const slots=new Set();for(const [i,f]of raw.flags.entries()){
  if(!obj(f)||!exact(f,'carrierSlot,pickupAfter,returnAt,state,team,x,y,z')||f.team!==(['red','blue']as const)[i]||!['home','carried','dropped'].includes(String(f.state))||!n(f.x,-12000,12000)||!n(f.z,-12000,12000)||!n(f.y,-120,600)||!n(f.returnAt,0,1e16)||!n(f.pickupAfter,0,1e16))return null;
  if(f.state==='carried'){if(!Number.isInteger(f.carrierSlot)||!n(f.carrierSlot,0,3)||ctfTeam(f.carrierSlot)===f.team||slots.has(f.carrierSlot)||f.returnAt!==0)return null;slots.add(f.carrierSlot);}else if(f.carrierSlot!==null)return null;
  const base=raw.bases[f.team as CtfTeam] as CtfPoint;if(f.state==='home'&&(f.returnAt!==0||f.x!==base.x||f.y!==base.y||f.z!==base.z)||f.state==='dropped'&&f.returnAt===0)return null;
 }
 if(!parseCtfSummary({scores:raw.scores,winner:raw.winner}))return null;
 return structuredClone(raw)as unknown as CtfState;
}
export function ctfNear(p:{x:number;y:number;z:number;vx:number;vz:number},g:{x:number;y:number;z:number}){return Math.hypot(p.x-g.x,p.z-g.z)<=8&&Math.abs(p.y-g.y)<1.5&&Math.hypot(p.vx,p.vz)<5;}
export function ctfReadout(s:CtfState,slot:number){const team=ctfTeam(slot),enemy=s.flags.find(f=>f.team!==team)!;return `${ctfTeamLabel(team)} · 紅 ${s.scores.red}：${s.scores.blue} 藍 · `+(s.winner?(s.winner==='draw'?'平手':ctfTeamLabel(s.winner)+'獲勝'):enemy.carrierSlot===slot?'你正載旗，返回己方基地':s.flags.map(f=>ctfTeamLabel(f.team)+'旗'+(f.state==='home'?'在基地':f.state==='dropped'?'掉落中':'由席位'+(f.carrierSlot!+1)+'攜帶')).join('／'));}
