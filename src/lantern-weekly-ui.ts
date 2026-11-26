import {CUP_CODE,type WeeklyCup,type weeklyStandings} from '../shared/lantern-weekly';
import {lanternApi,lanternError,syncCredentials} from './lantern-cloud-client';
import {save} from './save';
import './lantern-online.css';
type Reply={serverTime:number;closed:boolean;cup:WeeklyCup;standings:ReturnType<typeof weeklyStandings>};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',id='')=>{const e=document.createElement(tag);e.textContent=text;if(id)e.id=id;return e;};
export function mountLanternWeekly(host:HTMLElement,openCloud:()=>void){if(host.childElementCount)return;
 host.classList.add('lantern-online');const intro=el('p','同一週、三張固定賽道、經典規則單人計時。朋友可不同時間參賽；先啟用挑戰，再完成有效圈。這是休閒合理性驗證榜，非權威防作弊。'),status=el('p','','lantern-weekly-status');status.setAttribute('role','status');
 const name=el('input','','lantern-weekly-name');name.maxLength=24;name.value=(save.name??'好友')+'盃';name.setAttribute('aria-label','新好友盃名稱');
 const code=el('input','','lantern-weekly-code');code.maxLength=8;code.autocapitalize='characters';code.autocomplete='off';code.placeholder='8碼好友盃邀請碼';code.setAttribute('aria-label','好友盃邀請碼');
 const account=el('button','設定個人同步帳戶','lantern-weekly-account'),create=el('button','建立本週三站好友盃','lantern-weekly-create'),join=el('button','加入這個好友盃','lantern-weekly-join'),read=el('button','讀取／重新整理','lantern-weekly-read'),share=el('button','複製好友盃邀請連結','lantern-weekly-share');for(const b of[account,create,join,read,share])b.type='button';const actions=el('div');actions.className='lantern-online-actions';actions.append(account,create,join,read,share);
 const content=el('div','','lantern-weekly-result');host.append(intro,name,code,actions,status,content);let busy=false,reply:Reply|null=null,generation=0;
 try{const v=new URL(location.href).searchParams.get('weekly')??localStorage.getItem('taipei-gp-lantern-last-cup');if(v&&CUP_CODE.test(v))code.value=v;}catch{}
 const controls=()=>{for(const b of[account,create,join,read,share])b.disabled=busy;create.disabled=join.disabled=busy||!syncCredentials();share.disabled=busy||!reply;};
 const render=(value:Reply)=>{if(!value?.cup||!CUP_CODE.test(value.cup.code)||!Array.isArray(value.standings))throw Error();reply=value;code.value=value.cup.code;try{localStorage.setItem('taipei-gp-lantern-last-cup',value.cup.code);}catch{}content.replaceChildren();const current=syncCredentials()?.accountId,isMember=value.cup.members.some(m=>m.id===current);
  content.append(el('h3',value.cup.name),el('p',`邀請碼 ${value.cup.code} · ${value.cup.members.length}/16人 · ${value.closed?'已截止，最終榜':'進行中'}`),el('p',`截止：${new Date(value.cup.endAt).toLocaleString()}（週一00:00 UTC）；以下依伺服器時間判定。`));
  const tracks=el('ol');for(const t of value.cup.tracks){const li=el('li',t.name+' '),a=el('a','前往本站挑戰');const q=new URLSearchParams({rules:'classic',weekly:value.cup.code});if(t.id!=='taipei')q.set('circuit',t.id);a.href='/?'+q;li.append(a);if(value.closed||!isMember){a.removeAttribute('href');a.setAttribute('aria-disabled','true');a.textContent=value.closed?'本週已截止':'先加入好友盃';}tracks.append(li);}content.append(tracks);
  const table=el('table'),caption=el('caption','三站總積分（未完成為0分）'),head=el('tr');for(const text of['名次','車手','積分','完成','三站秒數'])head.append(el('th',text));const thead=el('thead');thead.append(head);const tbody=el('tbody');value.standings.forEach((r,i)=>{const row=el('tr');for(const text of[String(i+1),r.name+(r.id===current?'（你）':''),String(r.points),r.completed+'/3',r.stages.map(s=>s.time?.toFixed(3)??'—').join(' / ')])row.append(el('td',text));tbody.append(row);});table.append(caption,thead,tbody);const scroll=el('div');scroll.className='lantern-table-scroll';scroll.append(table);content.append(scroll,el('p','各站25／18／15／12／10／8／6／4／2／1分；同秒並列，同積分依完成站數、總秒數排序。'));
 };
 const run=async(fn:(token:number)=>Promise<void>)=>{if(busy)return;const token=generation;busy=true;controls();try{await fn(token);}catch(e){if(token===generation)status.textContent=lanternError(e);}finally{busy=false;controls();}};
 const cupCode=()=>{const v=code.value.trim().toUpperCase();if(!CUP_CODE.test(v))throw Error('邀請碼格式');return v;};
 account.onclick=openCloud;
 create.onclick=()=>void run(async token=>{const value=await lanternApi<Reply>('/api/weekly','POST',{action:'create',name:name.value,driverName:save.name??'車手'});if(token!==generation)return;render(value);status.textContent='好友盃已建立。將邀請連結傳給朋友，再各自加入、啟用挑戰。';});
 read.onclick=()=>void run(async token=>{const value=await lanternApi<Reply>('/api/weekly?cup='+cupCode());if(token!==generation)return;render(value);status.textContent='榜單已讀取，本機進度未改動。';});
 join.onclick=()=>void run(async token=>{const value=await lanternApi<Reply>('/api/weekly','POST',{action:'join',cup:cupCode(),name:save.name??'車手'});if(token!==generation)return;render(value);status.textContent='已加入，請選擇本站並啟用本週挑戰。';});
 share.onclick=()=>void run(async()=>{if(!reply)return;const url=new URL('/',location.origin);url.searchParams.set('weekly',reply.cup.code);await navigator.clipboard.writeText(url.href);status.textContent='已複製好友盃邀請連結；不包含私人同步代碼。';});
 const accountChanged=()=>{generation++;reply=null;content.replaceChildren();status.textContent='同步帳戶已變更，請重新讀取好友盃。';controls();};addEventListener('lantern-sync-account',accountChanged);addEventListener('pagehide',()=>{generation++;removeEventListener('lantern-sync-account',accountChanged);},{once:true});controls();if(!syncCredentials())status.textContent='建立與參賽需先設定個人同步帳戶；同一帳戶可跨裝置參賽。';
}
