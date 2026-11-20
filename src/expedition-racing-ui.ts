import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import type {MultiplayerClient} from './multiplayer-client';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
export class ExpeditionRacingPanel{
 private panel=el('section');private boundary=el('input');private vsc=el('input');private apply=el('button','套用正式賽規');private status=el('p');private live=el('p');private key='';
 constructor(private client:()=>MultiplayerClient|null){
  this.panel.id='mp-expedition-rules';this.panel.className='mp-series-section';this.boundary.type=this.vsc.type='checkbox';this.boundary.id='mp-expedition-boundary';this.vsc.id='mp-expedition-vsc';this.apply.type='button';this.apply.id='mp-expedition-apply';
  const boundary=el('label',' 賽道界線：持續出界1秒記警告，第三次起每次加5秒'),vsc=el('label',' VSC超車：排除低速／維修／凍結車，每次加5秒');boundary.prepend(this.boundary);vsc.prepend(this.vsc);
  boundary.className=vsc.className='summit-check';
  const help=el('p','限一般固定圈數單場，可搭配AI與天候。所有車手與觀眾需更新版本。界線以車輛中心橫距6.2m判定，回正1秒才可重記。總罰秒最多60秒；原始跑時與逐圈保留，名次按調整後跑時。系統判定遊戲規則，不判碰撞肇責。');help.className='mp-hint';
  this.status.id='mp-expedition-rule-status';this.status.setAttribute('role','status');this.panel.append(el('h3','正式賽規（自選）'),boundary,vsc,this.apply,help,this.status);document.getElementById('mp-room')?.append(this.panel);
  this.live.id='mp-expedition-penalty';this.live.setAttribute('role','status');document.getElementById('mp-summit-live')?.append(this.live);this.panel.hidden=this.live.hidden=true;
  this.apply.onclick=()=>{if(!this.client()?.setExpedition({boundary:this.boundary.checked,vsc:this.vsc.checked}))this.status.textContent='目前無法送出，請確認連線與房主權限。';};
 }
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean){
  const state=room?.expedition,key=JSON.stringify([room?.code,room?.hostManagement?.lobbyRevision,state]);this.panel.hidden=!room?.capabilities?.expeditionRacing||room.phase!=='lobby';
  if(key!==this.key){this.key=key;this.boundary.checked=!!state?.settings.boundary;this.vsc.checked=!!state?.settings.vsc;this.status.textContent=state?'本場已啟用正式賽規。':'本場沿用原房規，尚未啟用加秒。';}
  const compatible=!room?.series&&room?.evolution?.mode==='race'&&!Object.values(room?.horizon??{}).some(Boolean)&&(room?.arena?.mode??'off')==='off'&&!room?.odyssey&&!room?.summit?.settings.weekend&&!room?.summit?.settings.endurance&&!room?.voyager?.settings.practiceSeconds;
  for(const control of[this.boundary,this.vsc,this.apply])control.disabled=!connected||busy||room?.hostId!==selfId||!compatible;
  if(!compatible&&!this.panel.hidden)this.status.textContent='先切回一般固定圈數單場，再啟用正式賽規。';
  const p=room?.players.find(p=>p.id===selfId)?.expedition;this.live.hidden=!room||!state||!p||!['countdown','racing','results'].includes(room.phase);
  const text=p?`正式賽規｜界線 ${p.warnings} 次／VSC超車 ${p.vscPasses} 次｜累計 +${p.penaltyMs/1000}秒${p.lastReason?`｜最近：${p.lastReason==='boundary'?'持續出界':'VSC超車'}`:''}`:'';if(text!==this.live.textContent)this.live.textContent=text;
 }
}
