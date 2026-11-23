/** Rex <game88521@gmail.com>. Party state contains public slots and scores, never seat credentials. */
export const PARTY_VERSION='aurora-social-party-v1';
export const PARTY_MODES=['cruise','convoy','crown','chase'] as const;
export type PartyMode=typeof PARTY_MODES[number];
export const PARTY_LABELS:Record<PartyMode,string>={cruise:'自由巡航（不計分）',convoy:'車隊巡遊',crown:'移動王冠',chase:'警匪追逐'};
export const PARTY_ROUND_LIMIT=20;
export interface PartyAward{slot:number;points:number}
export interface PartyRound{number:number;mode:PartyMode;reason:string;awards:PartyAward[]}
export interface PartyState{v:typeof PARTY_VERSION;ballot:number;rounds:PartyRound[];scores:{slot:number;points:number}[];votes:{slot:number;mode:PartyMode}[];selected:PartyMode|null}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const integer=(v:unknown,lo:number,hi:number):v is number=>Number.isSafeInteger(v)&&Number(v)>=lo&&Number(v)<=hi;
export const partyMode=(v:unknown):v is PartyMode=>PARTY_MODES.includes(v as PartyMode);
export function partyChoice(votes:{slot:number;mode:PartyMode}[]):PartyMode|null{
 if(!votes.length)return null;const counts=PARTY_MODES.map(mode=>votes.filter(v=>v.mode===mode).length),max=Math.max(...counts);return PARTY_MODES[counts.indexOf(max)];
}
export function parsePartyState(raw:unknown,slots?:number[]):PartyState|null{
 if(!obj(raw)||!exact(raw,['v','ballot','rounds','scores','votes','selected'])||raw.v!==PARTY_VERSION||!integer(raw.ballot,1,1e9)||!Array.isArray(raw.rounds)||raw.rounds.length>PARTY_ROUND_LIMIT||!Array.isArray(raw.scores)||raw.scores.length<1||raw.scores.length>4||!Array.isArray(raw.votes)||raw.votes.length>4||raw.selected!==null&&!partyMode(raw.selected))return null;
 const seen=new Set<number>();for(const row of raw.scores){if(!obj(row)||!exact(row,['slot','points'])||!integer(row.slot,0,3)||seen.has(row.slot)||!integer(row.points,0,PARTY_ROUND_LIMIT*5))return null;seen.add(row.slot);}
 if(slots&&(slots.length!==seen.size||slots.some(slot=>!seen.has(slot))))return null;
 const voted=new Set<number>();for(const row of raw.votes){if(!obj(row)||!exact(row,['slot','mode'])||!integer(row.slot,0,3)||!seen.has(row.slot)||voted.has(row.slot)||!partyMode(row.mode))return null;voted.add(row.slot);}
 if(raw.selected!==partyChoice(raw.votes as PartyState['votes']))return null;
 for(let i=0;i<raw.rounds.length;i++){const row=raw.rounds[i];if(!obj(row)||!exact(row,['number','mode','reason','awards'])||row.number!==i+1||!partyMode(row.mode)||!['complete','timeout','captured','left','server-stall'].includes(String(row.reason))||!Array.isArray(row.awards)||row.awards.length<1||row.awards.length>4)return null;const awarded=new Set<number>();for(const a of row.awards){if(!obj(a)||!exact(a,['slot','points'])||!integer(a.slot,0,3)||awarded.has(a.slot)||!integer(a.points,0,5))return null;awarded.add(a.slot);}}
 for(const score of raw.scores as PartyState['scores'])if(score.points!==(raw.rounds as PartyRound[]).reduce((sum,round)=>sum+(round.awards.find(award=>award.slot===score.slot)?.points??0),0))return null;
 return structuredClone(raw) as unknown as PartyState;
}
