import {summitSettings,defaultSummitSettings,type SummitSettings} from './summit-racing.ts';
import {atlasSettings,defaultAtlasSettings,type AtlasSettings} from './atlas-racing.ts';
import {voyagerSettings,defaultVoyagerSettings,voyagerEnabled,type VoyagerSettings} from './voyager-racing.ts';
import {odysseySettings,type OdysseySettings} from './odyssey-racing.ts';
import {expeditionSettings,type ExpeditionSettings} from './expedition-racing.ts';
import {meridianSettings,type MeridianSettings} from './meridian-racing.ts';
import {getMultiplayerTrack} from './multiplayer-tracks.ts';
export interface MeridianAdvancedPreset {summit:SummitSettings;atlas:AtlasSettings;voyager:VoyagerSettings;odyssey:OdysseySettings;expedition:ExpeditionSettings;arena:'off'|'relay'|'items';meridian:MeridianSettings}
export const defaultMeridianAdvanced=():MeridianAdvancedPreset=>({summit:defaultSummitSettings(),atlas:defaultAtlasSettings(),voyager:defaultVoyagerSettings(),odyssey:{sprintWeekend:false,mandatoryStop:false},expedition:{boundary:false,vsc:false},arena:'off',meridian:{mode:'off'}});
export function parseMeridianAdvanced(v:unknown,base:{trackId:string;laps:number;trackIds:string[];mode:string;roomRules:{collisions:boolean};horizon:Record<string,boolean>|object}):MeridianAdvancedPreset|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;const r=v as Record<string,unknown>,keys=['summit','atlas','voyager','odyssey','expedition','arena','meridian'];if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))return null;
 const summit=summitSettings(r.summit),atlas=atlasSettings(r.atlas),voyager=voyagerSettings(r.voyager),odyssey=odysseySettings(r.odyssey),expedition=expeditionSettings(r.expedition),meridian=meridianSettings(r.meridian);if(!summit||!atlas||!voyager||!odyssey||!expedition||!meridian||!['off','relay','items'].includes(String(r.arena)))return null;
 const h=Object.values(base.horizon).some(Boolean),special=base.mode!=='race'||!!base.trackIds.length||h,arena=r.arena as 'off'|'relay'|'items',a=atlas.damage||atlas.flags||atlas.aiLevel!=='standard',s=summit.weekend||!!summit.ai||!!summit.endurance,voy=voyagerEnabled(voyager),ody=odyssey.sprintWeekend||odyssey.mandatoryStop,exp=expedition.boundary||expedition.vsc;
 if((s||a||voy||ody||exp||arena!=='off'||meridian.mode!=='off')&&special)return null;
 if(arena!=='off'&&(s||a||voy||ody||exp||meridian.mode!=='off')||arena==='relay'&&base.laps===1)return null;
 if(voy&&(summit.weekend||voyager.practiceSeconds&&(summit.ai||summit.endurance||!getMultiplayerTrack(base.trackId)?.circuit||base.roomRules.collisions)))return null;
 if(ody&&(summit.ai||voy||exp)||odyssey.sprintWeekend&&(!summit.weekend||!!summit.endurance||!getMultiplayerTrack(base.trackId)?.circuit)||odyssey.mandatoryStop&&(!summit.endurance||summit.weekend))return null;
 if(exp&&(summit.weekend||summit.endurance||voyager.practiceSeconds||ody))return null;
 if(meridian.mode!=='off'&&(summit.weekend||summit.ai||ody||exp||voyager.practiceSeconds||arena!=='off'))return null;
 if(meridian.mode==='relay-endurance'&&summit.endurance!==meridian.durationSeconds||meridian.mode==='championship'&&(summit.endurance||base.trackId!==meridian.trackIds[0]))return null;
 return{summit,atlas,voyager,odyssey,expedition,arena,meridian};
}
