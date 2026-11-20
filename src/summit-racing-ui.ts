import {VoyagerRacingPanel} from './voyager-racing-ui';
import {OdysseyRacingPanel} from './odyssey-racing-ui';
import {AtlasRacingPanel} from './atlas-racing-ui';
import {atlasPitMs,type AtlasPitService} from '../shared/atlas-racing';
import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import {SUMMIT_TYRES,type SummitTyre} from '../shared/summit-racing';
import type {MultiplayerClient} from './multiplayer-client';
import {getMultiplayerTrack} from '../shared/multiplayer-tracks';
import './summit-racing.css';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const text=(e:HTMLElement,s:string)=>{if(e.textContent!==s)e.textContent=s;};
const clock=(ms:number)=>{const sec=Math.ceil(Math.max(0,ms)/1000);return`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};
export const summitTyreName=(t:SummitTyre)=>({soft:'軟胎',medium:'中性胎',hard:'硬胎',wet:'雨胎'}[t]);
export const summitLabel=(r:RoomSnapshot)=>r.summit?.stage==='qualifying'?'週末三分鐘排位':r.summit?.stage==='sprint'?'週末一圈衝刺':r.summit?.settings.endurance?`${r.summit.settings.endurance/60}分鐘耐久${r.summit.settings.weekend?'正賽':''}`:r.summit?.settings.weekend?'週末正賽':'圈數競速';
export class SummitRacingPanel{
 private odysseyPanel:OdysseyRacingPanel;private voyagerPanel:VoyagerRacingPanel;private atlasPanel:AtlasRacingPanel;private service=make('select');private serviceLabel=make('label','維修項目');private tyreLabel=make('label','下一停胎種');
 private menu=make('section');private weekend=make('input');private ai=make('select');private endurance=make('select');private apply=make('button','套用進階賽事');private help=make('p');
 private live=make('section');private status=make('p');private tyre=make('select');private pit=make('button','預約換胎');private cancel=make('button','取消進站');private strategy=make('div');
 private result=make('section');private resultText=make('p');private next=make('button','依排位進入正賽大廳');private key='';private pitKey='';
 constructor(private getClient:()=>MultiplayerClient|null){
  this.menu.id='mp-summit-settings';this.menu.className='mp-series-section';const title=make('h3','排位週末、AI 與耐久'),weekendLabel=make('label','三分鐘排位 → 同圖正賽'),aiLabel=make('label','AI 補位'),enduranceLabel=make('label','正賽長度');
  this.weekend.type='checkbox';this.weekend.id='mp-summit-weekend';weekendLabel.prepend(this.weekend);weekendLabel.className='summit-check';this.ai.id='mp-summit-ai';this.endurance.id='mp-summit-endurance';
  for(let i=0;i<=3;i++){const o=make('option',i?`${i} 台 AI`:'只限真人');o.value=String(i);this.ai.append(o);}for(const [value,label]of[['0','依房間圈數'],['480','8分鐘耐久'],['600','10分鐘耐久']]){const o=make('option',label);o.value=value;this.endurance.append(o);}
  aiLabel.append(this.ai);enduranceLabel.append(this.endurance);aiLabel.className=enduranceLabel.className='mp-field';this.apply.id='mp-summit-apply';this.help.className='mp-hint';this.menu.append(title,weekendLabel,aiLabel,enduranceLabel,this.apply,this.help);document.getElementById('mp-room')?.append(this.menu);
  this.live.id='mp-summit-live';this.live.className='summit-live';this.status.id='mp-summit-status';this.status.setAttribute('role','status');const tyreLabel=this.tyreLabel;this.tyre.id='mp-summit-tyre';for(const t of SUMMIT_TYRES){const o=make('option',summitTyreName(t));o.value=t;this.tyre.append(o);}tyreLabel.append(this.tyre);this.pit.id='mp-summit-pit';this.cancel.id='mp-summit-pit-cancel';this.strategy.className='summit-strategy';this.service.id='mp-atlas-pit-service';for(const [value,label]of[['tyres','只換胎'],['repair','只修復'],['both','換胎＋修復']]){const o=make('option',label);o.value=value;this.service.append(o);}this.serviceLabel.append(this.service);this.strategy.append(this.serviceLabel,tyreLabel,this.pit,this.cancel);this.live.append(this.status,this.strategy);document.getElementById('mp-hud')?.append(this.live);
  this.result.id='mp-summit-result';this.next.id='mp-summit-next';this.result.append(this.resultText,this.next);document.getElementById('mp-results')?.append(this.result);
  this.apply.onclick=()=>this.getClient()?.setSummit({weekend:this.weekend.checked,ai:Number(this.ai.value),endurance:Number(this.endurance.value) as 0|480|600});this.next.onclick=()=>this.getClient()?.nextWeekend();
  this.pit.onclick=()=>{this.getClient()?.setPitStrategy(true,this.tyre.value as SummitTyre,this.service.value as AtlasPitService);this.pit.blur();};this.cancel.onclick=()=>this.getClient()?.setPitStrategy(false,this.tyre.value as SummitTyre,this.service.value as AtlasPitService);
  this.menu.hidden=this.live.hidden=this.result.hidden=true;this.atlasPanel=new AtlasRacingPanel(getClient);this.voyagerPanel=new VoyagerRacingPanel(getClient);this.odysseyPanel=new OdysseyRacingPanel(getClient);
 }
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean,now:number){
  this.atlasPanel.render(room,selfId,connected,busy);
  const customWeather=!!room?.voyager&&room.voyager.settings.weather!=='legacy';
  const atlas=room?.atlas,atlasActive=!!atlas&&(atlas.settings.damage||atlas.settings.flags||atlas.settings.aiLevel!=='standard');
  const s=room?.summit,me=room?.players.find(p=>p.id===selfId),p=me?.summit,host=room?.hostId===selfId,qual=s?.stage==='qualifying',endurance=!!s?.settings.endurance&&!qual;
  this.menu.hidden=!room?.capabilities?.summit||room.phase!=='lobby';this.live.hidden=!room||!s||!['countdown','racing'].includes(room.phase)||!(s.settings.weekend||s.settings.endurance||s.mixed||atlasActive||customWeather);this.result.hidden=!room||room.phase!=='results'||!s||!(s.settings.weekend||s.settings.endurance||s.mixed||atlasActive||customWeather);
  const key=JSON.stringify([room?.code,room?.hostManagement?.lobbyRevision,s?.settings]);if(key!==this.key){this.key=key;this.weekend.checked=!!s?.settings.weekend;this.ai.value=String(s?.settings.ai??0);this.endurance.value=String(s?.settings.endurance??0);}
  const compatible=!room?.series&&room?.evolution?.mode==='race'&&!Object.values(room?.horizon??{}).some(Boolean)&&(room?.arena?.mode??'off')==='off';
  for(const e of[this.weekend,this.ai,this.endurance,this.apply])e.disabled=!host||!connected||busy||!compatible||!!room?.odyssey;
  const humans=room?.players.filter(v=>!v.summit?.ai).length??0;for(const o of this.ai.options)o.disabled=Number(o.value)+humans>4;
  text(this.help,!compatible?'先關閉系列與其他特殊玩法，即可啟用。':'最多四車，AI 由伺服器駕駛。排位只計三分鐘內有效完圈，擦牆／車輛接觸使本圈無效，沒有有效圈從後排出發；正賽沿用同圖。正賽大廳有人離席、被移除或續接逾時，會清除整份排位並重新準備排位，保留其餘 AI 設定。耐久共享乾→雨→乾天候、實際里程胎耗；截止後過線完賽，最長寬限兩分鐘。朋友加入前請先減少 AI，騰出席位。');
  const pitRemaining=Math.max(0,(p?.pitUntil??0)-now),elapsed=room?.startAt===null?0:Math.max(0,now-(room?.startAt??now));
  text(this.status,qual?`排位剩餘 ${clock(180000-elapsed)} · ${p?.lapValid?'本圈有效':'本圈無效，下一圈重新計時'} · ${me?.bestLapMs==null?'尚無有效圈':`有效最快 ${(me.bestLapMs/1000).toFixed(3)}秒`}`:endurance?`${summitLabel(room!)} · ${elapsed<(s?.settings.endurance??0)*1000?`剩餘 ${clock((s?.settings.endurance??0)*1000-elapsed)}`:'時間到，完成這圈'} · ${s?.weather===0?'乾地':`雨勢 ${Math.round((s?.weather??0)*100)}%`} · ${p?`${summitTyreName(p.compound)} 磨耗 ${Math.round(p.wear*100)}% · ${p.pitStops}停`: '觀戰'}${pitRemaining?` · 換胎中 ${(pitRemaining/1000).toFixed(1)}秒`:p?.pitArmed?' · 已預約，起終線後80m青色維修區，靠右、18km/h以下停車6秒':''}`:s?.mixed?'真人與 AI 混合競速 · 成績另有 AI 標籤':'');
  const tyres=endurance||customWeather;this.strategy.hidden=!(tyres||atlas?.settings.damage&&!qual)||!p||me?.dnf||me?.finishMs!==null;this.serviceLabel.hidden=!atlas?.settings.damage;for(const option of this.service.options)option.disabled=option.value==='tyres'?!tyres:option.value==='both'?!tyres||!atlas?.settings.damage:!atlas?.settings.damage;if(this.service.selectedOptions[0]?.disabled)this.service.value=tyres?'tyres':'repair';this.service.disabled=!connected||busy||pitRemaining>0||room?.phase!=='racing';this.tyreLabel.hidden=this.service.value==='repair';const pitKey=JSON.stringify([room?.matchId,p?.nextCompound,p?.pitArmed,p?.pitUntil,me?.atlas?.pitService]);if(this.pitKey!==pitKey){this.pitKey=pitKey;this.tyre.value=p?.nextCompound??'medium';this.service.value=me?.atlas?.pitService??'tyres';if(this.service.selectedOptions[0]?.disabled)this.service.value=tyres?'tyres':'repair';}
  this.tyre.disabled=this.pit.disabled=!connected||busy||pitRemaining>0||room?.phase!=='racing';this.cancel.disabled=this.pit.disabled||!p?.pitArmed;const repair=this.service.value!=='tyres',estimate=atlasPitMs(this.service.value as AtlasPitService,me?.atlas?.damage??0);text(this.pit,pitRemaining>0?`維修 ${(pitRemaining/1000).toFixed(1)}秒`:p?.pitArmed?'更新進站項目':repair?`預約維修（約${(estimate/1000).toFixed(1)}秒）`:'預約換胎');if(!tyres&&atlas?.settings.damage&&!qual)text(this.status,pitRemaining>0?`維修中 ${(pitRemaining/1000).toFixed(1)}秒`:p?.pitArmed?'已預約維修：起終線後80m青色區靠右，以18km/h以下停穩；維修期間暫時無碰撞。':'可預約維修，實際駛入起終線後80m青色區靠右停車。');
  this.next.hidden=!qual||!s?.settings.weekend||!!room?.odyssey;this.next.disabled=!host||!connected||busy;text(this.resultText,qual?`排位結束，按有效最快圈發車：${s?.qualifying.map(q=>`P${q.grid} ${q.name}${q.ai?' [AI]':''} ${q.bestMs===null?'無有效圈':`${(q.bestMs/1000).toFixed(3)}秒`}`).join(' ｜ ')}。${host?'請保存本場回放後進入正賽，或重設整個週末。':'等待房主進入正賽。'}`:`${room?summitLabel(room):''}${s?.mixed?' · 真人／AI 混合成績':''}；${endurance?'胎況與天候已同步錄入回放。':'本場成績由伺服器判定。'}`);
  if(customWeather&&!endurance&&p)text(this.status,`自選天候 · ${summitTyreName(p.compound)} 磨耗 ${Math.round(p.wear*100)}% · ${p.pitStops}停${pitRemaining?` · 維修 ${(pitRemaining/1000).toFixed(1)}秒`:p.pitArmed?' · 已預約：起終線後80m青色區靠右，18km/h以下停穩':''}`);
  if(room&&s&&(s.settings.weekend||s.settings.endurance||s.mixed)){
   const label=summitLabel(room),mixed=s.mixed?' · 含 AI':'';for(const id of['mp-room-description','mp-result-track']){const el=document.getElementById(id);if(el)text(el,`${getMultiplayerTrack(room.trackId)?.name??room.trackId} · ${label}${mixed} · ${room.players.length} / 4 車`);}
   const laps=document.getElementById('mp-lap');if(laps&&me&&(qual||endurance))text(laps,`已完成 ${me.completedLaps} 圈`);
   const rematch=document.getElementById('mp-rematch');if(rematch&&s.settings.weekend)text(rematch,'重設完整週末');
   const track=document.getElementById('mp-room-track') as HTMLSelectElement|null;if(track&&s.settings.weekend&&s.stage==='race')track.disabled=true;
   const transfer=document.getElementById('mp-host-transfer') as HTMLButtonElement|null,target=(document.getElementById('mp-host-target') as HTMLSelectElement|null)?.value;if(transfer&&room.players.find(v=>v.id===target)?.summit?.ai)transfer.disabled=true;
  }
  if(room?.odyssey?.settings.sprintWeekend){text(this.help,'目前使用衝刺週末：三分鐘排位 → 一圈衝刺 → 原圈數正賽。固定真人名單、分站積分與下一階段按鈕請見下方 Odyssey 區；先關閉 Odyssey 房規才能改一般賽事設定。');if(qual)text(this.resultText,`排位完成：${s?.qualifying.map(q=>`P${q.grid} ${q.name} ${q.bestMs===null?'無有效圈':`${(q.bestMs/1000).toFixed(3)}秒`}`).join(' ｜ ')}。請保存回放，再由房主進入一圈衝刺。`);}
  this.voyagerPanel.render(room,selfId,connected,busy,now);this.odysseyPanel.render(room,selfId,connected,busy,now);
 }
}
