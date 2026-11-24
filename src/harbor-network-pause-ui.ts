import './harbor-network-pause.css';
import {HARBOR_NETWORK_VERSION,harborNetworkFrozen} from '../shared/harbor-network-pause';
import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import type {MultiplayerClient} from './multiplayer-client';
/** Self-contained mount: no main page or legacy panel markup changes. */
export function mountHarborNetworkPause(client:()=>MultiplayerClient|null,notice:(text:string)=>void){
 const config=document.createElement('section');config.className='harbor-network-config';config.id='harbor-network-config';
 const title=document.createElement('h3');title.textContent='私人房短斷線保護';
 const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.id='harbor-network-enabled';
 label.append(toggle,document.createTextNode('啟用短斷線同步暫停（預設關閉）'));
 const description=document.createElement('p');description.textContent='一般單場、2～4位同版真人且無觀眾。每人每場最多兩次，每次10秒內原席回來並確認，再同步倒數3秒；逾期或用完保護即DNF。切換進階玩法前請先關閉。';
 const status=document.createElement('p');status.id='harbor-network-setting-status';config.append(title,label,description,status);document.getElementById('mp-room')!.append(config);
 const overlay=document.createElement('section');overlay.className='harbor-network-overlay';overlay.id='harbor-network-overlay';overlay.setAttribute('aria-label','短斷線同步暫停');overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');overlay.hidden=true;
 const heading=document.createElement('h2'),message=document.createElement('p'),confirm=document.createElement('button');confirm.id='harbor-network-confirm';confirm.textContent='我已回來，確認繼續';overlay.append(heading,message,confirm);document.body.append(overlay);
 toggle.addEventListener('change',()=>{if(!client()?.setHarborNetwork(toggle.checked))notice('目前無法設定，請確認房主、最新大廳及相容玩法。');});
 confirm.addEventListener('click',()=>{if(!client()?.confirmHarborNetwork())notice('確認尚未送出，請等待原席連線與地圖就緒。');});
 return {render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean,now:number){
  config.hidden=!room||room.phase!=='lobby'||room.capabilities?.harborNetworkPause!==HARBOR_NETWORK_VERSION;
  toggle.checked=room?.harborNetwork?.enabled??false;toggle.disabled=!connected||busy||room?.hostId!==selfId||room.phase!=='lobby';
  status.textContent=room?.harborNetwork?.enabled?'房主已開啟，全員重新載入並準備後開始。':'目前關閉，沿用原本斷線車煞停、其他車繼續的規則。';
  overlay.hidden=!room||!harborNetworkFrozen(room)||room.phase!=='racing';if(overlay.hidden)return;
  const n=room!.harborNetwork!,own=n.incidents.find(i=>i.playerId===selfId),me=room!.players.find(p=>p.id===selfId);
  heading.textContent=n.phase==='resuming'?`同步恢復倒數 ${Math.max(0,Math.ceil(((n.resumeAt??now)-now)/1000))} 秒`:'短斷線保護：全房暫停';
  message.textContent=n.phase==='resuming'?'車輛與賽鐘維持凍結；倒數結束後恢復，請重新操作。':n.incidents.map(i=>`${room!.players.find(p=>p.id===i.playerId)?.name??'原席車手'}：${i.confirmed?'已確認':`${Math.max(0,Math.ceil((i.deadlineAt-now)/1000))}秒內回線並確認`}`).join('；')+'。其他車手請等待，暫停不計入圈速。';
  confirm.hidden=!own||own.confirmed||n.phase!=='waiting';confirm.disabled=!connected||busy||!me?.loaded||!!me.dnf||!!own&&now>=own.deadlineAt;
 },dispose(){config.remove();overlay.remove();}};
}
