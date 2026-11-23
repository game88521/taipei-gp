/** Rex <game88521@gmail.com>. Entry intents only; never creates a room or starts a run. */
import type {AtlasMode} from './atlas-modes';
export const BEACON_MULTIPLAYER_SETUPS=['relay-endurance','championship','cup','league'] as const;
export type BeaconMultiplayerSetup=typeof BEACON_MULTIPLAYER_SETUPS[number];
export const BEACON_WORKSHOP_SECTIONS=['story','story-coop','hunt-solo','hunt-friends'] as const;
export type BeaconWorkshopSection=typeof BEACON_WORKSHOP_SECTIONS[number];
export function beaconMultiplayerSetup(raw:string):BeaconMultiplayerSetup|null {
  try{const values=new URL(raw,'http://127.0.0.1').searchParams.getAll('setup');return values.length===1&&BEACON_MULTIPLAYER_SETUPS.includes(values[0] as BeaconMultiplayerSetup)?values[0] as BeaconMultiplayerSetup:null;}catch{return null;}
}
export function beaconWorkshopSection(raw:unknown):BeaconWorkshopSection|null{return typeof raw==='string'&&BEACON_WORKSHOP_SECTIONS.includes(raw as BeaconWorkshopSection)?raw as BeaconWorkshopSection:null;}
export function beaconModeHref(mode:AtlasMode,base:string):string|null {
  if(mode.target!=='btn-multiplayer'||!BEACON_MULTIPLAYER_SETUPS.includes(mode.variant as BeaconMultiplayerSetup))return null;
  const url=new URL('/multiplayer.html',base);url.searchParams.set('setup',mode.variant!);return url.href;
}
export function prepareBeaconModeLaunch(mode:AtlasMode,target:HTMLElement) {
  if(mode.target==='btn-expedition-social'){
    target.dataset.socialMode=mode.variant==='tandem-rotation'?'tandem':mode.variant==='party'?'cruise':mode.variant??'cruise';
    if(mode.variant==='tandem-rotation'||mode.variant==='tandem')target.dataset.socialRotation=String(mode.variant==='tandem-rotation');
    if(mode.variant==='party')target.dataset.socialGuide='party';
  }
  if(mode.target==='btn-frontier-rally')target.dataset.navigatorMode=String(mode.variant==='navigator');
  if(mode.target==='btn-nexus-workshop'&&beaconWorkshopSection(mode.variant))target.dataset.workshopSection=mode.variant;
  if(mode.target==='btn-expedition-duty'&&mode.variant)target.dataset.dutyMode=mode.variant;
}
type BeaconSocialMode='cruise'|'chase'|'tandem'|'convoy'|'crown';
export type BeaconOpenSelection=[BeaconSocialMode|undefined,boolean|undefined,boolean]|[boolean|undefined]|[BeaconWorkshopSection];
/** Read before a lazy placeholder is removed; pass only validated method arguments to the mounted UI. */
export function takeBeaconModeSelection(target:HTMLElement):BeaconOpenSelection|null {
  if(target.id==='btn-expedition-social'&&['socialMode','socialRotation','socialGuide'].some(key=>target.dataset[key]!==undefined)){
    const mode=target.dataset.socialMode,rotation=target.dataset.socialRotation,party=target.dataset.socialGuide==='party';delete target.dataset.socialMode;delete target.dataset.socialRotation;delete target.dataset.socialGuide;
    return[['cruise','chase','tandem','convoy','crown'].includes(mode??'')?mode as BeaconSocialMode:undefined,rotation==='true'?true:rotation==='false'?false:undefined,party];
  }
  if(target.id==='btn-frontier-rally'&&target.dataset.navigatorMode!==undefined){const value=target.dataset.navigatorMode;delete target.dataset.navigatorMode;return[value==='true'?true:value==='false'?false:undefined];}
  if(target.id==='btn-nexus-workshop'){const section=beaconWorkshopSection(target.dataset.workshopSection);delete target.dataset.workshopSection;if(section)return[section];}
  return null;
}
export function focusBeaconSection(element:HTMLElement|null){if(!element)return;element.tabIndex=-1;element.scrollIntoView({block:'center',behavior:'instant'});element.focus({preventScroll:true});}
let launchSequence=0;
const acknowledged=new Set(['btn-expedition-social','btn-frontier-rally','btn-nexus-workshop']);
export function finishBeaconModeLaunch(target:HTMLElement,id:string|undefined,opened:boolean){if(id)target.dispatchEvent(new CustomEvent('beacon-mode-result',{detail:{id,opened}}));}
export function cancelBeaconModeLaunch(target:HTMLElement){target.dispatchEvent(new Event('beacon-mode-cancel'));}
export function launchBeaconMode(mode:AtlasMode,target:HTMLElement):Promise<boolean>{
  prepareBeaconModeLaunch(mode,target);
  if(!acknowledged.has(mode.target)){target.click();return Promise.resolve(true);}
  const id=String(++launchSequence);target.dataset.beaconLaunchId=id;
  return new Promise(resolve=>{
    let done=false;const finish=(opened:boolean)=>{if(done)return;done=true;clearTimeout(timer);target.removeEventListener('beacon-mode-result',result);target.removeEventListener('beacon-mode-cancel',cancel);removeEventListener('pagehide',cancel);if(target.dataset.beaconLaunchId===id)delete target.dataset.beaconLaunchId;resolve(opened);};
    const result=(event:Event)=>{const detail=(event as CustomEvent<{id:string;opened:boolean}>).detail;if(detail?.id===id)finish(detail.opened===true);},cancel=()=>finish(false),timer=setTimeout(()=>cancelBeaconModeLaunch(target),45000);
    target.addEventListener('beacon-mode-result',result);target.addEventListener('beacon-mode-cancel',cancel);addEventListener('pagehide',cancel,{once:true});
    try{target.click();}catch{finish(false);}
  });
}
