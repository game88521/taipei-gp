/** Rex <game88521@gmail.com>. Visual viewport and page restoration; does not resume a game. */
import {harborViewport} from './harbor-accessibility-model';
export function installHarborMobile(options:{release():void}){
 let disposed=false,frame=0,last='',lastActive:Element|null=null;
 const update=()=>{frame=0;if(disposed)return;const view=window.visualViewport,active=document.activeElement,metrics=harborViewport({width:innerWidth,height:innerHeight},view?{width:view.width,height:view.height,left:view.offsetLeft,top:view.offsetTop,scale:view.scale}:null),key=JSON.stringify([metrics,innerWidth,innerHeight]);if(key===last&&active===lastActive)return;last=key;lastActive=active;
  const style=document.documentElement.style;for(const[name,value]of Object.entries(metrics))if(name!=='scale')style.setProperty('--harbor-vv-'+name,value+'px');
  const typing=active instanceof HTMLElement&&active.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]'),keyboard=!!typing&&metrics.height<innerHeight-80&&metrics.scale===1;
  document.documentElement.dataset.harborKeyboard=String(keyboard);
  if(keyboard&&active instanceof HTMLElement&&active.closest('[data-harbor-modal-top]')){const rect=active.getBoundingClientRect();if(rect.top<metrics.top+12||rect.bottom>metrics.top+metrics.height-12)active.scrollIntoView({block:'nearest',inline:'nearest'});}
 };
 const schedule=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(update);};
 const page=()=>{options.release();last='';schedule();};
 const view=window.visualViewport;
 addEventListener('resize',schedule);addEventListener('orientationchange',page);addEventListener('pageshow',page);addEventListener('pagehide',page);document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);view?.addEventListener('resize',schedule);view?.addEventListener('scroll',schedule);update();
 return{refresh:schedule,dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);removeEventListener('resize',schedule);removeEventListener('orientationchange',page);removeEventListener('pageshow',page);removeEventListener('pagehide',page);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);view?.removeEventListener('resize',schedule);view?.removeEventListener('scroll',schedule);for(const name of['width','height','left','top'])document.documentElement.style.removeProperty('--harbor-vv-'+name);delete document.documentElement.dataset.harborKeyboard;}};
}
