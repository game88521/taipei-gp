import {defaultArena} from '../shared/multiplayer-arena.ts';
import {ATLAS_RACING_VERSION} from '../shared/atlas-racing.ts';
import {VOYAGER_RACING_VERSION,VOYAGER_VSC_MPS} from '../shared/voyager-racing.ts';
import {ODYSSEY_RACING_VERSION} from '../shared/odyssey-racing.ts';
import {EXPEDITION_RACING_VERSION} from '../shared/expedition-racing.ts';
import {newMeridianState} from './meridian-racing-service.mjs';
import {randomUUID} from 'node:crypto';
/** Called only after the entire v2 preset and all referenced maps pass shared validation. */
export function applyMeridianPreset(r,a){
 if(!a)return;
 r.summit={settings:{...a.summit},stage:a.summit.weekend?'qualifying':'single',qualifying:[],weather:0,revision:1};
 r.atlas={version:ATLAS_RACING_VERSION,settings:{...a.atlas}};
 r.voyager={version:VOYAGER_RACING_VERSION,settings:{...a.voyager},wet:0,vsc:{phase:'off',resumeAt:null,speedMps:VOYAGER_VSC_MPS},events:[]};
 if(a.odyssey.sprintWeekend||a.odyssey.mandatoryStop)r.odyssey={version:ODYSSEY_RACING_VERSION,settings:{...a.odyssey},weekend:a.odyssey.sprintWeekend?{id:randomUUID(),trackId:r.trackId,raceLaps:r.laps,locked:false,complete:false,entrants:[],sprint:[],race:[],standings:[]}:null};
 if(a.expedition.boundary||a.expedition.vsc)r.expedition={version:EXPEDITION_RACING_VERSION,settings:{...a.expedition}};
 r.arena={...defaultArena(),mode:a.arena};
 if(a.meridian.mode!=='off')r.meridian=newMeridianState(a.meridian,r.laps);
}
export function meridianPresetCapabilities(preset,caps){return preset.schema!==2||['meridianRacing','summit','atlasRacing','voyagerRacing','odysseyRacing','expeditionRacing','nexusArena'].every(k=>caps?.[k]===true);}
