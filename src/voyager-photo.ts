import type {PerspectiveCamera} from 'three';
export interface PhotoSubject {x:number;y:number;z:number;h:number}
export interface ResultCardData {title:string;map:string;lines:string[];at?:string}
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export function downloadPng(canvas:HTMLCanvasElement,name:string):Promise<void> {
  return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>{if(!blob){reject(Error('無法產生 PNG，請降低畫質後重試。'));return;}const url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);resolve();},'image/png');}catch{reject(Error('無法讀取遊戲畫面，請重新載入後重試。'));}});
}
export function createResultCard(data:ResultCardData):HTMLCanvasElement {
  const canvas=make('canvas');canvas.width=1080;canvas.height=1080;const c=canvas.getContext('2d');if(!c)throw Error('此瀏覽器無法建立成績卡。');
  const clean=(s:string,n=60)=>String(s).replace(/[\u0000-\u001f]/g,' ').slice(0,n);
  c.fillStyle='#0b1120';c.fillRect(0,0,1080,1080);c.fillStyle='#e33c43';c.fillRect(64,64,952,12);c.fillStyle='#90acd0';c.font='600 28px sans-serif';c.fillText('TAIPEI STREET GP',68,132);
  const line=(s:string,y:number,size:number,color='#f4f7ff')=>{c.fillStyle=color;c.font=`600 ${size}px sans-serif`;let text=clean(s);while(text.length&&c.measureText(text).width>936)text=text.slice(0,-1);if(text!==clean(s))text=text.slice(0,-1)+'…';c.fillText(text,72,y);};
  line(data.title,218,48);line(data.map,276,30,'#b8c9e5');let y=365;
  for(const row of data.lines.slice(0,8)){line(row,y,30);y+=68;}
  c.fillStyle='#31415b';c.fillRect(72,960,936,2);line('本機成績分享卡 · Rex',1008,24,'#b8c9e5');return canvas;
}
export function mountResultCard(host:HTMLElement,data:()=>ResultCardData|null,id='voyager-result-card') {
  const button=make('button','下載 PNG 成績卡'),status=make('p');button.type='button';button.className='ghost-btn';button.id=id;status.setAttribute('role','status');host.append(button,status);let busy=false;
  button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;try{const v=data();if(!v)throw Error('目前沒有可分享的成績。');await downloadPng(createResultCard(v),'taipei-gp-result.png');status.textContent='已產生成績卡下載，請確認檔案已保存。';}catch(e){status.textContent=e instanceof Error?e.message:String(e);}finally{busy=false;button.disabled=false;}};return button;
}
/** Camera-only composition. The caller owns pausing; no simulation state is written here. */
export class VoyagerPhoto {
  private overlay:HTMLElement|null=null;
  private values={yaw:145,pitch:16,distance:12,fov:55};
  private prior:HTMLElement|null=null;
  private restore:(()=>void)|null=null;
  constructor(private h:{camera:PerspectiveCamera;subject:()=>PhotoSubject;canOpen:()=>boolean;begin:()=>()=>void;capture:()=>HTMLCanvasElement;notify?:(s:string)=>void}){}
  get active(){return this.overlay!==null;}
  open() {
    if(this.active||!this.h.canOpen()){this.h.notify?.('請先暫停單人遊戲，或開啟已保存的回放。');return false;}
    this.prior=document.activeElement as HTMLElement|null;
    this.restore=this.h.begin();const camera=this.h.camera,p=camera.position.clone(),q=camera.quaternion.clone(),f=camera.fov,restore=this.restore;
    this.restore=()=>{camera.position.copy(p);camera.quaternion.copy(q);camera.fov=f;camera.updateProjectionMatrix();restore();};
    const overlay=make('section'),box=make('div'),title=make('h2','照片模式'),help=make('p','調整構圖後下載 PNG。畫面只存到本機。'),status=make('p'),hide=make('button','隱藏控制面板'),close=make('button','返回遊戲'),save=make('button','下載 PNG'),reveal=make('button','顯示控制面板');
    overlay.className='voyager-photo';overlay.id='voyager-photo';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','voyager-photo-title');title.id='voyager-photo-title';box.className='voyager-photo-controls';status.setAttribute('role','status');box.append(title,help);
    for(const[key,label,min,max]of[['yaw','環繞角度',-180,180],['pitch','俯仰角度',-10,75],['distance','鏡頭距離',3,80],['fov','視野角度',25,90]] as const){const l=make('label',label),i=make('input'),o=make('output');i.type='range';i.id=`voyager-photo-${key}`;i.min=String(min);i.max=String(max);i.step='1';i.value=String(this.values[key]);o.value=i.value;l.append(i,o);i.oninput=()=>{this.values[key]=Number(i.value);o.value=i.value;this.frame();};box.append(l);}
    for(const b of[hide,close,save,reveal])b.type='button';save.id='voyager-photo-save';close.id='voyager-photo-close';reveal.className='voyager-photo-reveal';reveal.hidden=true;box.append(status,save,hide,close,reveal);overlay.append(box);document.body.append(overlay);this.overlay=overlay;document.body.classList.add('voyager-photo-open');
    hide.onclick=()=>{box.classList.add('voyager-photo-minimal');reveal.hidden=false;reveal.focus();};reveal.onclick=()=>{box.classList.remove('voyager-photo-minimal');reveal.hidden=true;hide.focus();};close.onclick=()=>this.close();
    save.onclick=async()=>{if(save.disabled)return;save.disabled=true;try{this.frame();const canvas=this.h.capture();await downloadPng(canvas,'taipei-gp-photo.png');status.textContent='已產生照片下載，請確認檔案已保存。';}catch(e){status.textContent=e instanceof Error?e.message:String(e);}finally{save.disabled=false;}};
    document.addEventListener('keydown',this.key,true);this.frame();close.focus();return true;
  }
  private key=(e:KeyboardEvent)=>{if(!this.active)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close();}else if(e.key==='Tab'){const nodes=[...this.overlay!.querySelectorAll<HTMLElement>('button,input')].filter(n=>!n.hidden&&!n.hasAttribute('disabled')&&n.getClientRects().length),i=nodes.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus();}}};
  frame(){if(!this.active)return;const s=this.h.subject(),a=s.h+this.values.yaw*Math.PI/180,p=this.values.pitch*Math.PI/180,d=this.values.distance,c=this.h.camera;c.position.set(s.x+Math.sin(a)*Math.cos(p)*d,s.y+1+Math.sin(p)*d,s.z+Math.cos(a)*Math.cos(p)*d);c.lookAt(s.x,s.y+1,s.z);c.fov=this.values.fov;c.updateProjectionMatrix();}
  close(){if(!this.active)return;this.overlay!.remove();this.overlay=null;document.body.classList.remove('voyager-photo-open');document.removeEventListener('keydown',this.key,true);this.restore?.();this.restore=null;this.prior?.focus();}
}
