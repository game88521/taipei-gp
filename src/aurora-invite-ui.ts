import {roomInviteUrl,deliverRoomInvite,type RoomInvite} from './aurora-invite';
import {drawInviteQr} from './aurora-qr';
import './aurora-platform.css';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',id='')=>{const e=document.createElement(tag);e.textContent=text;if(id)e.id=id;return e;};
export function mountRoomInvite(host:HTMLElement,getRoom:()=>RoomInvite|null,id:string){
 const box=el('section','',id);box.className='aurora-invite';box.hidden=true;const title=el('strong'),input=el('input','',id+'-url');input.readOnly=true;input.setAttribute('aria-label','可分享的乾淨邀請網址');input.onclick=()=>input.select();
 const actions=el('div');actions.className='aurora-invite-actions';const copy=el('button','複製連結',id+'-copy'),share=el('button','手機分享',id+'-share'),qr=el('button','顯示QR',id+'-qr');for(const b of[copy,share,qr])b.type='button';actions.append(copy,share,qr);
 const canvas=el('canvas','',id+'-canvas');canvas.hidden=true;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','私人房邀請QR Code');const status=el('p','',id+'-status');status.setAttribute('role','status');box.append(title,actions,input,canvas,status);host.append(box);
 let busy=false,currentUrl='',showQr=false;
 function update(){const r=getRoom(),url=r&&roomInviteUrl(location.href,r);box.hidden=!url;if(!r||!url){currentUrl='';input.value='';canvas.hidden=true;showQr=false;return;}title.textContent=`${r.label} · ${r.code} · ${r.players}/${r.capacity}人`;if(url!==currentUrl){currentUrl=url;input.value=url;canvas.hidden=true;showQr=false;status.textContent='朋友開啟後確認暱稱，再按加入。連結不含登入參數或席位憑證。';}copy.disabled=share.disabled=busy;}
 async function send(kind:'share'|'copy'){if(busy)return;const room=getRoom(),url=room&&roomInviteUrl(location.href,room);if(!room||!url){update();return;}busy=true;update();const result=await deliverRoomInvite(url,room.label,kind,{share:navigator.share?data=>navigator.share(data):undefined,copy:navigator.clipboard?.writeText?text=>navigator.clipboard.writeText(text):undefined});busy=false;update();if(url!==currentUrl)return;status.textContent=result.message;if(result.status==='manual'){input.focus();input.select();}}
 copy.onclick=()=>void send('copy');share.onclick=()=>void send('share');qr.onclick=()=>{update();if(!currentUrl)return;if(showQr){showQr=false;canvas.hidden=true;qr.textContent='顯示QR';return;}try{drawInviteQr(canvas,currentUrl);showQr=true;canvas.hidden=false;qr.textContent='收起QR';status.textContent='請朋友用相機掃描；仍需確認加入。';}catch(e){status.textContent=String(e);}};update();return {update,dispose(){box.remove();},element:box};
}
