/** Rex <game88521@gmail.com>. Coordinates describe the available travel of a control, not screen pixels. */
export const AURORA_TOUCH_KEY = 'taipei-gp-aurora-touch-v1';
export const TOUCH_KEYS = ['steer-btns','pad','brake','gas','drs','pit','btn-drift','btn-horn'] as const;
export type TouchKey = typeof TOUCH_KEYS[number];
export type TouchOrientation = 'portrait'|'landscape';
export interface TouchPlacement { x:number;y:number;size:number }
export interface TouchProfile { enabled:boolean;buttons:Record<TouchKey,TouchPlacement> }
export interface TouchLayouts { v:1;portrait:TouchProfile;landscape:TouchProfile }
export const TOUCH_LABELS:Record<TouchKey,string> = {'steer-btns':'左右轉向',pad:'轉向滑桿',brake:'煞車',gas:'油門',drs:'DRS',pit:'進站','btn-drift':'甩尾','btn-horn':'喇叭'};
const defaults:Record<TouchKey,TouchPlacement> = {'steer-btns':{x:0,y:1,size:1},pad:{x:0,y:1,size:1},brake:{x:1,y:1,size:1},gas:{x:1,y:.58,size:1},drs:{x:1,y:.32,size:1},pit:{x:.72,y:.32,size:1},'btn-drift':{x:.56,y:.83,size:1},'btn-horn':{x:.56,y:.56,size:1}};
export function defaultTouchLayouts():TouchLayouts {return {v:1,portrait:{enabled:false,buttons:structuredClone(defaults)},landscape:{enabled:false,buttons:structuredClone(defaults)}};}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:unknown,a:number,b:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
export function parseTouchLayouts(raw:unknown):TouchLayouts|null {
 try {const x=typeof raw==='string'?JSON.parse(raw):raw;if(!object(x)||x.v!==1||Object.keys(x).some(k=>!['v','portrait','landscape'].includes(k)))return null;
  for(const orientation of ['portrait','landscape']){const p=x[orientation];if(!object(p)||typeof p.enabled!=='boolean'||!object(p.buttons)||Object.keys(p).some(k=>!['enabled','buttons'].includes(k))||Object.keys(p.buttons).length!==TOUCH_KEYS.length)return null;
   for(const key of TOUCH_KEYS){const b=p.buttons[key];if(!object(b)||Object.keys(b).sort().join(',')!=='size,x,y'||!finite(b.x,0,1)||!finite(b.y,0,1)||!finite(b.size,.6,1.8))return null;}}
  return structuredClone(x) as unknown as TouchLayouts;
 }catch{return null;}
}
export const touchOrientation=(width:number,height:number):TouchOrientation=>width>height?'landscape':'portrait';
export function touchBox(key:TouchKey,p:TouchPlacement,width:number,height:number,inset={left:14,right:14,top:14,bottom:14}) {
 const base=key==='steer-btns'?[180,82]:key==='pad'?[200,78]:['brake','gas'].includes(key)?[94,94]:[58,58];
 const availableW=Math.max(44,width-inset.left-inset.right),availableH=Math.max(44,height-inset.top-inset.bottom);
 const w=Math.min(availableW,Math.max(key==='steer-btns'?100:44,base[0]*p.size)),h=Math.min(availableH,Math.max(44,base[1]*p.size));
 return {left:inset.left+(availableW-w)*p.x,top:inset.top+(availableH-h)*p.y,width:w,height:h};
}
export function touchOverlap(a:ReturnType<typeof touchBox>,b:ReturnType<typeof touchBox>){return Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));}
