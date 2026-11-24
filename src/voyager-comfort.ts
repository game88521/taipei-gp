import {mountHarborReading} from './harbor-accessibility';
export const VOYAGER_COMFORT_KEY='taipei-gp-voyager-comfort-v1';
export interface VoyagerComfort {v:1;hudScale:100|125|150;highContrast:boolean;fixedFov:boolean;staticMenu:boolean}
export const DEFAULT_VOYAGER_COMFORT:VoyagerComfort={v:1,hudScale:100,highContrast:false,fixedFov:false,staticMenu:false};
export function parseVoyagerComfort(v:unknown):VoyagerComfort|null {
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const o=v as Record<string,unknown>;
  if(Object.keys(o).length!==5||o.v!==1||![100,125,150].includes(o.hudScale as number)||['highContrast','fixedFov','staticMenu'].some(k=>typeof o[k]!=='boolean'))return null;
  return {v:1,hudScale:o.hudScale as VoyagerComfort['hudScale'],highContrast:o.highContrast as boolean,fixedFov:o.fixedFov as boolean,staticMenu:o.staticMenu as boolean};
}
let current:VoyagerComfort|null=null,expectedRaw:string|null=null,blocked=false,warning='';
export function getVoyagerComfort():VoyagerComfort {
  if(!current){blocked=false;warning='';try{expectedRaw=localStorage.getItem(VOYAGER_COMFORT_KEY);if(expectedRaw!==null){current=expectedRaw.length<=4096?parseVoyagerComfort(JSON.parse(expectedRaw)):null;if(!current){blocked=true;warning='舒適設定格式無法讀取，原文保留；停止寫入直到重新載入。';}}}catch{blocked=true;warning='無法讀取舒適設定；原資料保留。';}current??={...DEFAULT_VOYAGER_COMFORT};}
  return {...current};
}
export function applyVoyagerComfort(value=getVoyagerComfort()) {
  document.documentElement.style.setProperty('--voyager-hud-scale',String(value.hudScale/100));
  document.documentElement.dataset.voyagerContrast=String(value.highContrast);
}
export function mountVoyagerComfort(host:HTMLElement) {
  if(host.querySelector('#voyager-comfort'))return;
  const box=document.createElement('fieldset');box.id='voyager-comfort';const title=document.createElement('legend');title.textContent='HUD 與畫面舒適度';box.append(title);
  const status=document.createElement('p');status.setAttribute('role','status');
  const scale=document.createElement('select');scale.id='voyager-hud-scale';for(const n of[100,125,150]){const o=document.createElement('option');o.value=String(n);o.textContent=`${n}%`;scale.append(o);}
  const label=document.createElement('label');label.textContent='HUD 字級 ';label.append(scale);box.append(label);
  const checks=new Map<keyof VoyagerComfort,HTMLInputElement>();
  for(const [key,text]of[['highContrast','高對比 HUD 底板'],['fixedFov','固定視野（取消車速變焦）'],['staticMenu','關閉選單運鏡']] as const){const l=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.id=`voyager-${key}`;l.append(i,document.createTextNode(text));box.append(l);checks.set(key,i);}
  const help=document.createElement('p');help.textContent='立即生效並保存在本機；HUD 字級不改變觸控按鈕大小。';box.append(help,status);host.append(box);mountHarborReading(box);
  const sync=()=>{const v=getVoyagerComfort();scale.value=String(v.hudScale);for(const[k,i]of checks)i.checked=v[k] as boolean;status.textContent=warning;applyVoyagerComfort(v);};
  box.addEventListener('change',event=>{if(event.target!==scale&&![...checks.values()].includes(event.target as HTMLInputElement))return;const v:VoyagerComfort={v:1,hudScale:Number(scale.value) as VoyagerComfort['hudScale'],highContrast:checks.get('highContrast')!.checked,fixedFov:checks.get('fixedFov')!.checked,staticMenu:checks.get('staticMenu')!.checked};if(blocked){sync();return;}try{if(localStorage.getItem(VOYAGER_COMFORT_KEY)!==expectedRaw){blocked=true;warning='舒適設定已在其他頁面變更，已停止寫入；請重新載入。';sync();return;}const raw=JSON.stringify(v);localStorage.setItem(VOYAGER_COMFORT_KEY,raw);if(localStorage.getItem(VOYAGER_COMFORT_KEY)!==raw){blocked=true;warning='舒適設定保存核對失敗，請重新載入。';sync();return;}expectedRaw=raw;current=v;applyVoyagerComfort(v);status.textContent='已保存畫面舒適設定。';}catch{status.textContent='瀏覽器無法保存設定；原資料未主動覆寫。';}});
  addEventListener('storage',e=>{if(e.key!==VOYAGER_COMFORT_KEY&&e.key!==null)return;current=null;sync();});sync();
}
