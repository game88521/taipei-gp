/** Rex <game88521@gmail.com>. Shared reading and modal ownership across lazy UI mounts. */
import './lantern-reading';
import {HarborReadingStore,HARBOR_READING_KEY,HARBOR_READING_SCALES,harborIsolationBranches,harborFocusTarget,type HarborReading} from './harbor-accessibility-model';
export {parseHarborReading,HARBOR_READING_KEY} from './harbor-accessibility-model';
const focusable='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]';
const modalSelector='[aria-modal="true"],dialog[open]';
const navigationSelector='#menu,.mp-panel,.split-card,#results,#quali-res';
function shown(node:HTMLElement){if(!node.isConnected||node.closest('[hidden],.hidden'))return false;const style=getComputedStyle(node);return style.display!=='none'&&style.visibility!=='hidden'&&node.getClientRects().length>0;}
function usable(node:HTMLElement){return shown(node)&&!node.closest('[inert],[aria-hidden="true"]')&&!node.matches(':disabled');}
const first=(root:HTMLElement)=>[...root.querySelectorAll<HTMLElement>(focusable)].find(node=>usable(node)&&node.tabIndex>=0)??null;
function zIndex(node:HTMLElement,root:HTMLElement){let z=0;for(let current:HTMLElement|null=node;current&&current!==root;current=current.parentElement){const value=Number.parseInt(getComputedStyle(current).zIndex);if(Number.isFinite(value))z=Math.max(z,value);}return z;}
type ModalRecord={previous:HTMLElement|null;order:number};
export class HarborModalIsolation {
 private records=new Map<HTMLElement,ModalRecord>();private isolated=new Map<HTMLElement,{inert:boolean;aria:string|null}>();private history:HTMLElement[]=[];private tabindex=new Map<HTMLElement,string|null>();private sequence=0;top:HTMLElement|null=null;
 constructor(private root:HTMLElement,private fallback:()=>HTMLElement|null=()=>null){}
 remember(node:HTMLElement){this.history=this.history.filter(value=>value!==node);this.history.push(node);if(this.history.length>64)this.history.shift();}
 private focus(node:HTMLElement|null){if(!node)return;if(!node.hasAttribute('tabindex')&&!node.matches(focusable)){this.tabindex.set(node,null);node.tabIndex=-1;}node.focus({preventScroll:true});}
 private restoreNode(node:HTMLElement,value:{inert:boolean;aria:string|null}){node.inert=value.inert;if(value.aria===null)node.removeAttribute('aria-hidden');else node.setAttribute('aria-hidden',value.aria);}
 private restoreTab(node:HTMLElement){if(!this.tabindex.has(node))return;const value=this.tabindex.get(node);if(value===null)node.removeAttribute('tabindex');else if(value!==undefined)node.setAttribute('tabindex',value);this.tabindex.delete(node);}
 sync(visible:readonly HTMLElement[]){
  const oldTop=this.top,closed=oldTop&&!visible.includes(oldTop)?this.records.get(oldTop):null,active=this.root.ownerDocument.activeElement;
  for(const[node]of this.records)if(!visible.includes(node)){this.records.delete(node);node.removeAttribute('data-harbor-modal-top');node.removeAttribute('data-harbor-modal-fixed');this.restoreTab(node);}
  const added=new Set<HTMLElement>();for(const node of visible)if(!this.records.has(node)){const previous=active instanceof HTMLElement&&!node.contains(active)&&active!==this.root?active:[...this.history].reverse().find(value=>!node.contains(value))??null;this.records.set(node,{previous,order:++this.sequence});added.add(node);}
  this.top=[...visible].sort((a,b)=>zIndex(a,this.root)-zIndex(b,this.root)||(this.records.get(a)?.order??0)-(this.records.get(b)?.order??0)).at(-1)??null;
  for(const node of visible){if(node===this.top){if(!node.hasAttribute('data-harbor-modal-top'))node.setAttribute('data-harbor-modal-top','');if(getComputedStyle(node).position==='fixed'&&!node.hasAttribute('data-harbor-modal-fixed'))node.setAttribute('data-harbor-modal-fixed','');}else{node.removeAttribute('data-harbor-modal-top');node.removeAttribute('data-harbor-modal-fixed');}}
  const desired=new Set(this.top?harborIsolationBranches(this.top,this.root,node=>node.parentElement,node=>[...node.children].filter((child):child is HTMLElement=>child instanceof HTMLElement)):[]);
  for(const[node,value]of this.isolated)if(!desired.has(node)){this.restoreNode(node,value);this.isolated.delete(node);}
  for(const node of desired){if(!this.isolated.has(node))this.isolated.set(node,{inert:node.inert,aria:node.getAttribute('aria-hidden')});if(!node.inert)node.inert=true;if(node.getAttribute('aria-hidden')!=='true')node.setAttribute('aria-hidden','true');}
  if(this.top!==oldTop){
   const current=this.root.ownerDocument.activeElement;
   // Respect the UI's own explicit restoration (including focusDriving on a canvas).
   if(current instanceof HTMLElement&&current!==this.root&&usable(current)&&(!this.top||this.top.contains(current)))return;
   if(this.top&&added.has(this.top)){this.focus(first(this.top)??this.top);return;}
   const restored=harborFocusTarget(closed?.previous??null,this.top,this.history,usable,(owner,node)=>owner.contains(node),()=>this.top?first(this.top)??this.top:this.fallback());this.focus(restored);
  }
 }
 guardFocus(){if(!this.top)return;const current=this.root.ownerDocument.activeElement;if(current instanceof HTMLElement&&this.top.contains(current))return;this.focus(first(this.top)??this.top);}
 guardPointer(event:Event){
  // Existing modal exports temporarily append an unfocusable download anchor to body.
  // Preserve that programmatic action while actual background controls remain isolated.
  if(event.type==='click'&&!event.isTrusted&&event.target instanceof HTMLElement){const target=event.target;if(target.matches('a[download]')&&/^(blob:|data:)/.test(target.getAttribute('href')??'')||target.tagName==='INPUT'&&target.getAttribute('type')==='file')return;}
  if(this.top&&event.target instanceof Node&&!this.top.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();this.guardFocus();}
 }
 guardKey(event:KeyboardEvent){const top=this.top;if(!top)return;if(event.target instanceof Node&&!top.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();this.guardFocus();return;}if(event.key!=='Tab')return;const nodes=[...top.querySelectorAll<HTMLElement>(focusable)].filter(node=>usable(node)&&node.tabIndex>=0),active=this.root.ownerDocument.activeElement;if(!nodes.length){event.preventDefault();event.stopPropagation();this.focus(top);}else if(event.shiftKey&&active===nodes[0]){event.preventDefault();event.stopPropagation();this.focus(nodes.at(-1)!);}else if(!event.shiftKey&&active===nodes.at(-1)){event.preventDefault();event.stopPropagation();this.focus(nodes[0]);}}
 dispose(){for(const[node,value]of this.isolated)this.restoreNode(node,value);this.isolated.clear();for(const node of this.records.keys()){node.removeAttribute('data-harbor-modal-top');node.removeAttribute('data-harbor-modal-fixed');}for(const node of this.tabindex.keys())this.restoreTab(node);this.records.clear();this.history=[];this.top=null;}
}
let installed:ReturnType<typeof createHarborAccessibility>|null=null;
function createHarborAccessibility(options:{fallbackFocus?:()=>HTMLElement|null}={}){
 const modal=new HarborModalIsolation(document.body,options.fallbackFocus??(()=>[...document.querySelectorAll<HTMLElement>('#menu button,#mp-home,#split-menu button,button,a[href]')].find(usable)??null));
 const surfaces=new Set<HTMLElement>();let queued=false,disposed=false;
 const scan=()=>{queued=false;if(disposed)return;for(const node of document.querySelectorAll<HTMLElement>(navigationSelector+',[aria-modal="true"]')){if(node.matches('#aurora-touch-editor,.expedition-hud-editor'))continue;if(!node.hasAttribute('data-harbor-reading-surface')){node.setAttribute('data-harbor-reading-surface','');surfaces.add(node);}}for(const node of surfaces)if(!node.isConnected)surfaces.delete(node);modal.sync([...document.querySelectorAll<HTMLElement>(modalSelector)].filter(shown));document.documentElement.dataset.harborNavigation=String(!!modal.top||[...document.querySelectorAll<HTMLElement>(navigationSelector)].some(shown));};
 const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(scan);}};
 const affectsModal=(node:Node)=>node instanceof HTMLElement&&(node.matches(modalSelector)||!!node.querySelector(modalSelector));
 const affectsNavigation=(node:Node)=>node instanceof HTMLElement&&(node.matches(navigationSelector)||!!node.querySelector(navigationSelector));
 const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='attributes'?affectsModal(record.target)||record.target instanceof HTMLElement&&record.target.matches(navigationSelector):[...record.addedNodes,...record.removedNodes].some(node=>affectsModal(node)||affectsNavigation(node))))schedule();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','style','open','aria-modal','inert']});
 const focus=(event:FocusEvent)=>{if(event.target instanceof HTMLElement)modal.remember(event.target);scan();modal.guardFocus();};
 const key=(event:KeyboardEvent)=>modal.guardKey(event),pointer=(event:Event)=>{scan();modal.guardPointer(event);};
 document.addEventListener('focusin',focus,true);document.addEventListener('keydown',key,true);for(const name of['pointerdown','mousedown','touchstart','click'])document.addEventListener(name,pointer,{capture:true,passive:false});
 if(document.activeElement instanceof HTMLElement)modal.remember(document.activeElement);scan();
 return{refresh:scan,dispose(){if(disposed)return;disposed=true;observer.disconnect();document.removeEventListener('focusin',focus,true);document.removeEventListener('keydown',key,true);for(const name of['pointerdown','mousedown','touchstart','click'])document.removeEventListener(name,pointer,true);modal.dispose();for(const node of surfaces)node.removeAttribute('data-harbor-reading-surface');surfaces.clear();delete document.documentElement.dataset.harborNavigation;installed=null;}};
}
export function installHarborAccessibility(options:{fallbackFocus?:()=>HTMLElement|null}={}){return installed??=createHarborAccessibility(options);}
let readingStore:HarborReadingStore|null=null;
function store(){if(!readingStore){let storage:Storage|null=null;try{storage=localStorage;}catch{}readingStore=new HarborReadingStore(storage);}return readingStore;}
export function applyHarborReading(value:HarborReading=store().value){document.documentElement.dataset.harborReading=String(value.scale);}
export function mountHarborReading(host:HTMLElement){
 installHarborAccessibility();applyHarborReading();if(host.querySelector('#harbor-reading-setting'))return;
 const label=document.createElement('label');label.id='harbor-reading-setting';label.textContent='選單・房規・成績閱讀字級 ';const select=document.createElement('select');select.id='harbor-reading-scale';for(const value of HARBOR_READING_SCALES){const option=document.createElement('option');option.value=String(value);option.textContent=value+'%';select.append(option);}label.append(select);
 const note=document.createElement('p');note.textContent='只放大閱讀介面；行車HUD及觸控按鈕維持原設定。';const status=document.createElement('p');status.id='harbor-reading-status';status.setAttribute('role','status');host.append(label,note,status);
 const sync=()=>{select.value=String(store().value.scale);status.textContent=store().warning;applyHarborReading();};
 select.onchange=()=>{const value:HarborReading={v:1,scale:Number(select.value) as HarborReading['scale']};if(store().save(value)){applyHarborReading(value);status.textContent='已保存閱讀字級。';}else{status.textContent=store().warning;select.value=String(store().value.scale);}};
 const changed=(event:StorageEvent)=>{if(event.key===HARBOR_READING_KEY||event.key===null){store().reload();sync();}},restored=()=>{store().reload();sync();};addEventListener('storage',changed);addEventListener('pageshow',restored);addEventListener('pagehide',event=>{if(!event.persisted){removeEventListener('storage',changed);removeEventListener('pageshow',restored);}});sync();
}
