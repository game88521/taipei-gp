/** Public arena state contains no session capability or client-provided result. */
export type ArenaMode = 'off' | 'relay' | 'items';
export type ArenaItem = 'boost' | 'shield';
export interface ArenaPlayer { active: boolean; item: ArenaItem | null; boostUntil: number; shieldUntil: number; receivedAt: number; handoffs: number }
export interface RelayTeam { team: 'red' | 'blue'; driverId: string; memberIds: string[]; handoffs: number; finishMs: number | null; dnf: boolean; progress: number; completedLaps: number }
export interface ArenaState { mode: ArenaMode; revision: number; teams: Record<string,'red'|'blue'>; exchangeEnd: number; relayTeams: RelayTeam[] }
export const defaultArena = (): ArenaState => ({mode:'off',revision:1,teams:{},exchangeEnd:80,relayTeams:[]});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function validateArenaSnapshot(room:Record<string,unknown>) {
  const cap=object(room.capabilities)?room.capabilities.nexusArena:undefined;
  if(cap===undefined){if('arena'in room)throw Error('對戰玩法能力與資料不一致。');return;}
  const a=room.arena;
  if(cap!==true||!object(a)||!['off','relay','items'].includes(String(a.mode))||typeof a.mode!=='string'||!Number.isSafeInteger(a.revision)||Number(a.revision)<1
    ||!object(a.teams)||Object.keys(a.teams).length>4||Object.values(a.teams).some(t=>t!=='red'&&t!=='blue')||a.exchangeEnd!==80||!Array.isArray(a.relayTeams)||a.relayTeams.length>2||!Array.isArray(room.players))throw Error('對戰玩法資料無效。');
  const ids=new Set(room.players.map(p=>object(p)?p.id:null));
  if(Object.keys(a.teams).some(id=>!ids.has(id)))throw Error('接力隊伍成員無效。');
  if(a.mode!=='relay'&&(Object.keys(a.teams).length||a.relayTeams.length))throw Error('非接力賽不可提供接力隊伍。');
  if(a.mode!=='off'&&(room.series||object(room.evolution)&&room.evolution.mode!=='race'||object(room.horizon)&&(room.horizon.elimination||room.horizon.reverseGrid||room.horizon.antiBlock)))throw Error('玩法組合不相容。');
  for(const t of a.relayTeams){if(!object(t)||!['red','blue'].includes(String(t.team))||!Array.isArray(t.memberIds)||t.memberIds.length!==2||new Set(t.memberIds).size!==2||t.memberIds.some(id=>!ids.has(id)||(a.teams as Record<string,unknown>)[String(id)]!==t.team)||!t.memberIds.includes(t.driverId)||!Number.isInteger(t.handoffs)||Number(t.handoffs)<0||Number(t.handoffs)>1||!finite(t.progress)||!Number.isInteger(t.completedLaps)||Number(t.completedLaps)<0||t.finishMs!==null&&!finite(t.finishMs)||typeof t.dnf!=='boolean')throw Error('接力進度無效。');}
  if(a.mode==='relay'&&room.phase!=='lobby'&&(a.relayTeams.length!==2||new Set(a.relayTeams.map(t=>(t as RelayTeam).team)).size!==2))throw Error('接力隊伍不完整。');
  for(const p of room.players){if(!object(p))throw Error('車手資料無效。');if(a.mode==='off'){if('arena'in p)throw Error('一般競速不可提供道具狀態。');continue;}const v=p.arena;
    if(!object(v)||typeof v.active!=='boolean'||![null,'boost','shield'].includes(v.item as null)||![v.boostUntil,v.shieldUntil,v.receivedAt].every(finite)||!Number.isInteger(v.handoffs)||Number(v.handoffs)<0||Number(v.handoffs)>1)throw Error('車手道具／接力資料無效。');
    if(a.mode==='items'&&!v.active||a.mode==='relay'&&(v.item!==null||v.boostUntil!==0||v.shieldUntil!==0))throw Error('車手玩法狀態不相容。');
    if(a.mode==='relay'&&room.phase!=='lobby'){const t=a.relayTeams.find(t=>object(t)&&(t.memberIds as unknown[]).includes(p.id));if(!object(t)||v.active!==(t.driverId===p.id))throw Error('接力駕駛權不一致。');}
  }
}
export function arenaDriver(p:{arena?:ArenaPlayer}) {return p.arena?.active!==false;}
export function arenaCollision(p:{arena?:ArenaPlayer},at:number){return arenaDriver(p)&&!(p.arena&&p.arena.shieldUntil>at);}
