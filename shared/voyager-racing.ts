/** Voyager room rules. Author: Rex <game88521@gmail.com> */
export const VOYAGER_RACING_VERSION='voyager-racing-v1';
export const VOYAGER_VSC_MPS=80/3.6;
export type VoyagerWeather='legacy'|'clear'|'rain'|'dry-rain';
export interface VoyagerSettings {practiceSeconds:0|600|1200;weather:VoyagerWeather;vsc:boolean}
export interface VoyagerVsc {phase:'off'|'active'|'resuming';resumeAt:number|null;speedMps:number}
export interface VoyagerEvent {at:number;type:'start'|'resume'|'end'|'order';actors:string[];detail:string}
export interface VoyagerState {version:typeof VOYAGER_RACING_VERSION;settings:VoyagerSettings;wet:number;vsc:VoyagerVsc;events:VoyagerEvent[]}
export interface VoyagerPlayer {lapValid:boolean;validLaps:number[];bestSectorsMs:[number|null,number|null,number|null];lastSectorsMs:[number|null,number|null,number|null];joinedElapsedMs:number}
export const defaultVoyagerSettings=():VoyagerSettings=>({practiceSeconds:0,weather:'legacy',vsc:false});
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function voyagerSettings(v:unknown):VoyagerSettings|null{if(!obj(v)||!exact(v,['practiceSeconds','weather','vsc'])||typeof v.practiceSeconds!=='number'||![0,600,1200].includes(v.practiceSeconds)||typeof v.weather!=='string'||!['legacy','clear','rain','dry-rain'].includes(v.weather)||typeof v.vsc!=='boolean'||!!v.practiceSeconds&&v.vsc)return null;return{practiceSeconds:v.practiceSeconds as 0|600|1200,weather:v.weather as VoyagerWeather,vsc:v.vsc};}
export const voyagerEnabled=(v:VoyagerSettings|undefined)=>!!v&&(v.practiceSeconds>0||v.weather!=='legacy'||v.vsc);
export function voyagerWet(weather:VoyagerWeather,elapsedMs:number,legacy=0){return weather==='legacy'?legacy:weather==='rain'?1:weather==='clear'?0:Math.max(0,Math.min(1,(elapsedMs-120000)/60000));}
export function voyagerForecast(weather:VoyagerWeather){return weather==='rain'?'全程固定雨勢':weather==='clear'?'全程晴天':weather==='dry-rain'?'起跑乾地 → 2:00 開始下雨 → 3:00 全雨；之後維持':'沿用原房規；耐久為乾 → 雨 → 乾';}
export function voyagerVscValid(v:unknown,now:number){return obj(v)&&exact(v,['phase','resumeAt','speedMps'])&&['off','active','resuming'].includes(String(v.phase))&&v.speedMps===VOYAGER_VSC_MPS&&(v.phase==='resuming'?finite(v.resumeAt,0,now+3000.1):v.resumeAt===null);}
export function validateVoyager(room:Record<string,unknown>){
 const cap=(room.capabilities as Record<string,unknown>|undefined)?.voyagerRacing,raw=room.voyager,players=room.players as Record<string,unknown>[];
 if(cap===undefined){if(raw!==undefined||players?.some(p=>p.voyager!==undefined))throw Error('Voyager 能力與資料不一致。');return;}
 if(cap!==true||!obj(raw)||!exact(raw,['version','settings','wet','vsc','events'])||raw.version!==VOYAGER_RACING_VERSION||!voyagerSettings(raw.settings)||!finite(raw.wet,0,1)||!voyagerVscValid(raw.vsc,Number(room.serverTime))||!Array.isArray(raw.events)||raw.events.length>64)throw Error('Voyager 房規格式不正確。');
 const s=voyagerSettings(raw.settings)!,ids=new Set(players.map(p=>p.id));let prior=-1;
 for(const e of raw.events){if(!obj(e)||!exact(e,['at','type','actors','detail'])||!finite(e.at,0,720000)||e.at<prior||!['start','resume','end','order'].includes(String(e.type))||!Array.isArray(e.actors)||e.actors.length>2||new Set(e.actors).size!==e.actors.length||e.actors.some(id=>typeof id!=='string'||!ids.has(id))||typeof e.detail!=='string'||e.detail.length>80||/[\u0000-\u001f\u007f<>]/.test(e.detail))throw Error('VSC 事件格式不正確。');prior=e.at;}
 if(!s.vsc&&((raw.vsc as unknown as VoyagerVsc).phase!=='off'||raw.events.length>0)||s.practiceSeconds&&(room.roomRules as {collisions?:boolean})?.collisions!==false)throw Error('Voyager 房規相互衝突。');
 const summit=room.summit as {weather:number;settings:{weekend:boolean;ai:number;endurance:number}}|undefined;
 if(voyagerEnabled(s)&&(room.series||(room.evolution as {mode?:string})?.mode!=='race'||Object.values(room.horizon as object??{}).some(Boolean)||(room.arena as {mode?:string})?.mode!=='off'||summit?.settings.weekend||s.practiceSeconds&&(summit?.settings.ai||summit?.settings.endurance)))throw Error('Voyager 僅供一般單場／練習使用。');
 if(s.weather!=='legacy'&&Math.abs(raw.wet-voyagerWet(s.weather,Math.max(0,Number(room.serverTime)-Number(room.startAt??room.serverTime))))>.02&&room.phase!=='results')throw Error('天候與伺服器時序不一致。');
 if(summit&&Math.abs(summit.weather-raw.wet)>.00001)throw Error('胎況與天候資料不同步。');
 for(const p of players){const v=p.voyager;if(!obj(v)||!exact(v,['lapValid','validLaps','bestSectorsMs','lastSectorsMs','joinedElapsedMs'])||typeof v.lapValid!=='boolean'||!Array.isArray(v.validLaps)||v.validLaps.length>128||v.validLaps.some(t=>!finite(t,.001,1200000))||!finite(v.joinedElapsedMs,0,1200000)||[v.bestSectorsMs,v.lastSectorsMs].some(a=>!Array.isArray(a)||a.length!==3||a.some(t=>t!==null&&!finite(t,.001,1200000)))||!s.practiceSeconds&&v.validLaps.length)throw Error('練習圈與分段資料不正確。');if(s.practiceSeconds&&Array.isArray(p.lapTimesMs)&&v.validLaps.some(t=>!(p.lapTimesMs as unknown[]).includes(t)))throw Error('有效練習圈必須出自權威逐圈紀錄。');}
}
export function voyagerPredict(car:{speedCap:number;v:number},room:{voyager?:VoyagerState},at:number){const v=room.voyager?.vsc;if(v&&(v.phase==='active'||v.phase==='resuming'&&at<(v.resumeAt??0))){car.speedCap=Math.min(car.speedCap,VOYAGER_VSC_MPS);car.v=Math.min(car.v,VOYAGER_VSC_MPS);}}
