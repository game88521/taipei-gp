import {parseMeridianResumeSave} from './meridian-city-resume';
import {parsePublicCheckpoints} from '../shared/meridian-checkpoints';
import {parseCityMissionRecords} from '../shared/meridian-city';
import {parseRotationHistory} from '../shared/meridian-social';
import {parseNavigatorHistory} from '../shared/meridian-navigator';
import {parseControls} from './input';
import {parseHistory} from './multiplayer-history';
import {MultiplayerPresets} from './multiplayer-presets';
import {parseWorkshopStorage} from './nexus-workshop';
import {ReplayBookmarks} from './summit-replay-bookmarks';
import {parseDutyRecords,parseRoadDutyRecords} from './summit-city-duty';
import {parseMultiplayerReplay} from '../shared/nexus-replay';
import {parseModePreferences} from './atlas-modes';
import {parseCoopHistory} from './atlas-coop-history';
import {parseVoyagerComfort} from './voyager-comfort';
import {parseHarborReading} from './harbor-accessibility-model';
import {parseWorkshopGhostStorage} from './voyager-workshop-ghost';
import {parsePadPreferences} from './odyssey-pad-settings';
import {parseHudLayouts} from './expedition-hud';
import {validCoachStoreRaw} from './expedition-coach';
import {validDailyStoreRaw} from './expedition-daily';
import {parseRallyRecords,parseCrewRecords} from './expedition-duty-records';
import {parseSocialResults} from './expedition-social-history';
import {parsePerformanceHistory} from './frontier-performance-history';
import {parseRallyResults} from './frontier-rally-history';
import {parseDutyMissionRecords} from './frontier-duty-records';
import {parsePracticeGhost,parsePracticeResults} from './frontier-tandem-practice';
import {parseTouchLayouts} from './aurora-touch';
import {parseBusOperation} from './aurora-bus';
import {parseStorySave} from './aurora-story';
import {parseAuroraDutyRecords} from './aurora-duty-records';
import type {AtlasBackup} from './atlas-backup';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const num=(v:unknown,lo=0,hi=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const integer=(v:unknown,lo=0,hi=Number.MAX_SAFE_INTEGER)=>num(v,lo,hi)&&Number.isInteger(v);
export function validateAtlasBackup(b:AtlasBackup,main:(text:string)=>{ok:boolean;dropped?:string[]}) {
  for(const {key,raw} of b.slots) {
    if(raw===null)continue;
    const v:unknown=['taipei-gp-multiplayer-quality-v1','taipei-gp-expedition-network-v1'].includes(key)?raw:JSON.parse(raw);
    let valid=false;
    const memory={getItem:()=>raw,setItem:()=>{throw Error('驗證不可寫入');},removeItem:()=>{throw Error('驗證不可刪除');}};
    switch(key){
      case 'taipei-gp-v2': {const p=main(raw);valid=p.ok&&!p.dropped?.length;break;}
      case 'taipei-gp-v2-last-good': {if(obj(v)&&num(v.at)&&typeof v.raw==='string'&&Object.keys(v).every(k=>['at','raw'].includes(k))){const p=main(v.raw);valid=p.ok&&!p.dropped?.length;}break;}
      case 'taipei-gp-controls-v1':valid=!!parseControls(v);break;
      case 'taipei-gp-workshop-v1':valid=!!parseWorkshopStorage(v);break;
      case 'taipei-gp-replay-bookmarks-v1':valid=new ReplayBookmarks(memory).error==='';break;
      case 'taipei-gp-multiplayer-presets-v1':valid=new MultiplayerPresets(memory).error==='';break;
      case 'taipei-gp-multiplayer-history-v1':valid=!!parseHistory(raw);break;
      case 'taipei-gp-summit-duty-v1':valid=!!parseDutyRecords(v);break;
      case 'taipei-gp-mode-browser-v1':valid=!!parseModePreferences(v);break;
      case 'taipei-gp-voyager-comfort-v1':valid=!!parseVoyagerComfort(v);break;
      case 'taipei-gp-harbor-reading-v1':valid=!!parseHarborReading(v);break;
      case 'taipei-gp-voyager-workshop-ghost-v1':valid=!!parseWorkshopGhostStorage(v);break;
      case 'taipei-gp-odyssey-pad-v1':valid=!!parsePadPreferences(v);break;
      case 'taipei-gp-odyssey-road-duty-v1':valid=!!parseRoadDutyRecords(v);break;
      case 'taipei-gp-expedition-hud-v1':valid=!!parseHudLayouts(raw);break;
      case 'taipei-gp-expedition-network-v1':valid=['balanced','responsive','stable'].includes(raw);break;
      case 'taipei-gp-expedition-coach-v1':valid=validCoachStoreRaw(raw);break;
      case 'taipei-gp-expedition-daily-v1':valid=validDailyStoreRaw(raw);break;
      case 'taipei-gp-expedition-rally-v1':valid=!!parseRallyRecords(v);break;
      case 'taipei-gp-expedition-crew-results-v1':valid=!!parseCrewRecords(v);break;
      case 'taipei-gp-expedition-social-results-v1':valid=!!parseSocialResults(v);break;
      case 'taipei-gp-frontier-performance-v1':valid=!!parsePerformanceHistory(raw);break;
      case 'taipei-gp-frontier-rally-results-v1':valid=!!parseRallyResults(v);break;
      case 'taipei-gp-frontier-crew-v2':valid=!!parseDutyMissionRecords(v);break;
      case 'taipei-gp-frontier-tandem-ghost-v1':valid=!!parsePracticeGhost(v);break;
      case 'taipei-gp-frontier-tandem-results-v1':valid=!!parsePracticeResults(v);break;
      case 'taipei-gp-meridian-city-resume-v1':valid=!!parseMeridianResumeSave(v);break;
      case 'taipei-gp-meridian-checkpoints-v1':valid=!!parsePublicCheckpoints(v);break;
      case 'taipei-gp-meridian-city-records-v1':valid=!!parseCityMissionRecords(v);break;
      case 'taipei-gp-meridian-tandem-rotation-v1':valid=!!parseRotationHistory(v);break;
      case 'taipei-gp-meridian-navigator-results-v1':valid=!!parseNavigatorHistory(v);break;
      case 'taipei-gp-aurora-touch-v1':valid=!!parseTouchLayouts(v);break;
      case 'taipei-gp-aurora-bus-v1':valid=!!parseBusOperation(v);break;
      case 'taipei-gp-aurora-story-v1':valid=!!parseStorySave(v);break;
      case 'taipei-gp-aurora-duty-results-v1':valid=!!parseAuroraDutyRecords(v);break;
      case 'taipei-gp-multiplayer-quality-v1':valid=['auto','standard','economy'].includes(String(v));break;
      case 'taipei-gp-multiplayer-fps-v1':valid=v===30||v===60;break;
      case 'taipei-gp-scenarios-v1':valid=obj(v)&&Object.keys(v).length<=100&&Object.entries(v).every(([k,r])=>k.length<150&&obj(r)&&integer(r.wins,1,999999)&&num(r.best,.000001,1800));break;
      case 'taipei-gp-city-coop-results-v1':valid=!!parseCoopHistory(v);break;
      case 'taipei-gp-split-results-v1':valid=Array.isArray(v)&&v.length<=20&&v.every(r=>obj(r)&&num(r.at)&&typeof r.track==='string'&&/^[a-z0-9-]{1,40}$/.test(r.track)&&[1,3,5].includes(Number(r.laps))&&Array.isArray(r.drivers)&&r.drivers.length===2&&r.drivers.every(d=>obj(d)&&['P1','P2'].includes(String(d.id))&&typeof d.dnf==='boolean'&&integer(d.laps,0,5)&&(d.finish===null||num(d.finish,0,2000)))&&new Set(r.drivers.map(d=>(d as {id:string}).id)).size===2);break;
      case 'taipei-gp-pit-calibration-v1':valid=Array.isArray(v)&&v.length<=48&&v.every(r=>obj(r)&&typeof r.key==='string'&&r.key.length<=200&&Array.isArray(r.samples)&&r.samples.length<=40&&r.samples.every(s=>obj(s)&&num(s.predicted,-299.999,299.999)&&num(s.observed,-299.999,299.999)&&num(s.elapsed,.000001,599.999)&&num(s.baseline)&&num(s.at)));break;
    }
    if(!valid)throw Error(`資料格式不支援或含無效紀錄：${key}。原資料尚未改動。`);
  }
  const ids=new Set<string>();for(const r of b.replays){const p=parseMultiplayerReplay(r);if(!p||ids.has(p.id))throw Error('回放無效或重複，原資料尚未改動。');ids.add(p.id);}
}
