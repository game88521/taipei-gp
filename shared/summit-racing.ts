import {voyagerSettings as parseVoyagerSettings,validateVoyager,voyagerWet,voyagerPredict,type VoyagerState} from './voyager-racing.ts';
export function voyagerSettings(v:unknown){return parseVoyagerSettings(v);}
import {atlasLimits,type AtlasState,type AtlasPlayer} from './atlas-racing.ts';
import {validateOdyssey} from './odyssey-racing.ts';
export {odysseySettings} from './odyssey-racing.ts';
export type {OdysseySettings} from './odyssey-racing.ts';
export type SummitTyre='soft'|'medium'|'hard'|'wet';
export interface SummitSettings { weekend:boolean; ai:number; endurance:0|480|600 }
export interface SummitQualifying {id:string;name:string;bestMs:number|null;grid:number;ai:boolean;dnf:boolean}
export interface SummitPlayer { ai:boolean;compound:SummitTyre;wear:number;pitArmed:boolean;pitUntil:number;pitStops:number;nextCompound:SummitTyre;lapValid:boolean;validLaps:number[] }
export interface SummitState { settings:SummitSettings;stage:'single'|'qualifying'|'sprint'|'race';qualifying:SummitQualifying[];weather:number;durationSeconds:number|null;mixed:boolean;revision:number }
export const SUMMIT_VERSION='summit-racing-v1';
export const SUMMIT_TYRES:readonly SummitTyre[]=['soft','medium','hard','wet'];
export const defaultSummitSettings=():SummitSettings=>({weekend:false,ai:0,endurance:0});
export const summitSettings=(v:unknown):SummitSettings|null=>{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;const p=v as Record<string,unknown>;
 return typeof p.weekend==='boolean'&&Number.isInteger(p.ai)&&Number(p.ai)>=0&&Number(p.ai)<=3&&[0,480,600].includes(Number(p.endurance))&&typeof p.endurance==='number'&&Object.keys(p).length===3?{weekend:p.weekend,ai:Number(p.ai),endurance:p.endurance as 0|480|600}:null;
};
export function summitWet(elapsed:number,duration:number){const f=Math.max(0,elapsed)/(duration*1000);return f<.3?0:f<.38?(f-.3)/.08:f<.66?1:f<.78?1-(f-.66)/.12:0;}
export function summitGrip(compound:SummitTyre,wear:number,wet:number){const dry={soft:1.04,medium:1,hard:.97,wet:.87}[compound];return(dry*(1-wet)+(compound==='wet'?1.01:.69)*wet)*Math.max(.55,1-Math.max(0,wear)*.4);}
export function summitWear(compound:SummitTyre,metres:number,wet:number){return Math.max(0,metres)/({soft:13000,medium:21000,hard:31000,wet:24000}[compound])*(compound==='wet'?1+(1-wet)*1.1:1);}
export function summitPredict(car:{gripMul:number;speedCap:number;v:number;pos:{s:number}},room:{summit?:SummitState;atlas?:AtlasState;voyager?:VoyagerState;startAt?:number|null;trackLength:number},player:{summit?:SummitPlayer;atlas?:AtlasPlayer},at:number){
 const s=room.summit,p=player.summit,endurance=(!!s?.settings.endurance||!!room.voyager&&room.voyager.settings.weather!=='legacy')&&s?.stage!=='qualifying',damage=!!room.atlas?.settings.damage&&s?.stage!=='qualifying';if((!endurance&&!damage)||!p){if(room.voyager?.settings.vsc){car.gripMul=1;car.speedCap=Infinity;voyagerPredict(car,room,at);}return;}
 const approach=car.pos.s<80||car.pos.s>room.trackLength-180,limits=atlasLimits(damage?player.atlas?.damage??0:0);
 car.gripMul=(endurance?summitGrip(p.compound,p.wear,room.voyager?voyagerWet(room.voyager.settings.weather,Math.max(0,at-(room.startAt??at)),s!.weather):s!.weather):1)*limits.grip;car.speedCap=p.pitUntil>at?0:p.pitArmed&&approach?12:damage?limits.cap:Infinity;if(p.pitUntil>at)car.v=0;voyagerPredict(car,room,at);
}
export function validateSummit(room:Record<string,unknown>){
 validateVoyager(room);
 validateOdyssey(room);
 const cap=(room.capabilities as Record<string,unknown>|undefined)?.summit,s=room.summit as SummitState|undefined;
 if(cap===undefined){if(s!==undefined||(room.players as {summit?:unknown}[])?.some(p=>p.summit!==undefined))throw Error('進階賽事能力與資料不一致。');return;}
 if(cap!==true||!s||!summitSettings(s.settings)||!['single','qualifying','sprint','race'].includes(s.stage)||s.stage==='sprint'&&!(room.odyssey as {settings?:{sprintWeekend?:boolean}}|undefined)?.settings?.sprintWeekend||!Number.isSafeInteger(s.revision)||s.revision<1||!Number.isFinite(s.weather)||s.weather<0||s.weather>1||!Array.isArray(s.qualifying)||s.qualifying.length>4||!([null,180,480,600] as unknown[]).includes(s.durationSeconds)||typeof s.mixed!=='boolean')throw Error('進階賽事快照無效。');
 const players=room.players as {id:string;summit?:SummitPlayer;gridIndex?:number}[],ids=new Set(players.map(p=>p.id));
 const settings=s.settings,expectedDuration=s.stage==='qualifying'?180:settings.endurance||null;
 if(s.durationSeconds!==expectedDuration||(settings.weekend?!['qualifying','sprint','race'].includes(s.stage):s.stage!=='single'))throw Error('進階賽事階段無效。');
 if(!['race','sprint'].includes(s.stage)&&room.phase!=='results'&&s.qualifying.length||s.weather!==0&&(!(room.voyager as VoyagerState|undefined)?.settings||((room.voyager as VoyagerState).settings.weather==='legacy'))&&(!settings.endurance||s.stage==='qualifying')||s.mixed!==players.some(p=>p.summit?.ai)||settings.ai!==players.filter(p=>p.summit?.ai).length)throw Error('進階賽事名單不一致。');
 if(settings.weekend&&['race','sprint'].includes(s.stage)&&(s.qualifying.length!==players.length||new Set(players.map(p=>p.gridIndex)).size!==players.length||players.some(p=>!Number.isInteger(p.gridIndex)||p.gridIndex!<0||p.gridIndex!>=players.length)))throw Error('排位發車格無效。');
 if(settings.weekend||settings.ai||settings.endurance){const evo=room.evolution as {mode?:string}|undefined,arena=room.arena as {mode?:string}|undefined;if(room.series||evo?.mode!=='race'||Object.values(room.horizon as object??{}).some(Boolean)||arena?.mode&&arena.mode!=='off')throw Error('進階賽事與其他房規不相容。');}
 if(s.qualifying.some(q=>typeof q.id!=='string'||!ids.has(q.id)||typeof q.name!=='string'||!Number.isInteger(q.grid)||q.grid<1||q.grid>4||q.bestMs!==null&&(!Number.isFinite(q.bestMs)||q.bestMs<=0)||typeof q.ai!=='boolean'||typeof q.dnf!=='boolean')||new Set(s.qualifying.map(q=>q.id)).size!==s.qualifying.length)throw Error('排位排名無效。');
 for(const p of players){const v=p.summit;if(!v||typeof v.ai!=='boolean'||!SUMMIT_TYRES.includes(v.compound)||!SUMMIT_TYRES.includes(v.nextCompound)||!Number.isFinite(v.wear)||v.wear<0||v.wear>1||typeof v.pitArmed!=='boolean'||!Number.isFinite(v.pitUntil)||v.pitUntil<0||v.pitUntil>Number(room.serverTime)+((room.atlas as AtlasState|undefined)?.settings.damage?16000.1:6000.1)||!Number.isInteger(v.pitStops)||v.pitStops<0||v.pitStops>100||typeof v.lapValid!=='boolean'||!Array.isArray(v.validLaps)||v.validLaps.length>128||v.validLaps.some(t=>!Number.isFinite(t)||t<=0||t>180000)||s.stage!=='qualifying'&&v.validLaps.length)throw Error('胎況／AI資料無效。');}
}
