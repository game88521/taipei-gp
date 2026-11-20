export const ATLAS_RACING_VERSION='atlas-racing-v1';
export type AtlasAiLevel='relaxed'|'standard'|'competitive';
export type AtlasPitService='tyres'|'repair'|'both';
export interface AtlasSettings {aiLevel:AtlasAiLevel;damage:boolean;flags:boolean}
export interface AtlasPlayer {damage:number;pitService:AtlasPitService;pitDurationMs:number;yellow:boolean;blue:boolean;boundary:boolean;warnings:number}
export interface AtlasState {version:typeof ATLAS_RACING_VERSION;settings:AtlasSettings}
export const ATLAS_AI_LEVELS:readonly AtlasAiLevel[]=['relaxed','standard','competitive'];
export const ATLAS_PIT_SERVICES:readonly AtlasPitService[]=['tyres','repair','both'];
export const defaultAtlasSettings=():AtlasSettings=>({aiLevel:'standard',damage:false,flags:false});
export function atlasSettings(value:unknown):AtlasSettings|null {if(!value||typeof value!=='object'||Array.isArray(value))return null;const p=value as Record<string,unknown>;return Object.keys(p).length===3&&ATLAS_AI_LEVELS.includes(p.aiLevel as AtlasAiLevel)&&typeof p.damage==='boolean'&&typeof p.flags==='boolean'?{aiLevel:p.aiLevel as AtlasAiLevel,damage:p.damage,flags:p.flags}:null;}
export function atlasPlayer():AtlasPlayer{return{damage:0,pitService:'tyres',pitDurationMs:0,yellow:false,blue:false,boundary:false,warnings:0};}
export const atlasDamage=(prior:number,impact:number)=>Math.min(1,Math.max(0,prior)+Math.max(0,impact-2)*.008);
export const atlasRepairMs=(damage:number)=>4000+Math.ceil(Math.max(0,Math.min(1,damage))*6000);
export const atlasPitMs=(service:AtlasPitService,damage:number)=>(service==='repair'?0:6000)+(service==='tyres'?0:atlasRepairMs(damage));
/** Applied after the tyre model; never compounds a previous frame's damage multiplier. */
export function atlasLimits(damage:number){const d=Math.max(0,Math.min(1,damage));return{grip:1-d*.22,cap:95*(1-d*.3)};}
export function validateAtlas(room:Record<string,unknown>){
 const cap=(room.capabilities as Record<string,unknown>|undefined)?.atlasRacing,state=room.atlas as AtlasState|undefined,players=room.players as {atlas?:AtlasPlayer}[];
 if(cap===undefined){if(state!==undefined||players?.some(p=>p.atlas!==undefined))throw Error('Atlas 能力與快照不一致。');return;}
 if(cap!==true||!state||Object.keys(state).length!==2||state.version!==ATLAS_RACING_VERSION||!atlasSettings(state.settings))throw Error('Atlas 房規版本無效。');
 const enabled=state.settings.damage||state.settings.flags||state.settings.aiLevel!=='standard';
 if(enabled&&(room.series||(room.evolution as {mode?:string}|undefined)?.mode!=='race'||Object.values(room.horizon as object??{}).some(Boolean)||((room.arena as {mode?:string}|undefined)?.mode??'off')!=='off'))throw Error('Atlas 與其他特殊玩法不相容。');
 for(const p of players){const a=p.atlas;if(!a||Object.keys(a).length!==7||!Number.isFinite(a.damage)||a.damage<0||a.damage>1||!ATLAS_PIT_SERVICES.includes(a.pitService)||!Number.isInteger(a.pitDurationMs)||a.pitDurationMs<0||a.pitDurationMs>16000||typeof a.yellow!=='boolean'||typeof a.blue!=='boolean'||typeof a.boundary!=='boolean'||!Number.isInteger(a.warnings)||a.warnings<0||a.warnings>999||!state.settings.damage&&a.damage!==0||!state.settings.flags&&(a.yellow||a.blue||a.boundary||a.warnings))throw Error('Atlas 車損或旗號無效。');}
}
