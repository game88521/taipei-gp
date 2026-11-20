// Rex <game88521@gmail.com>.
import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import {odysseyStopWindow} from '../shared/odyssey-racing';
import type {MultiplayerClient} from './multiplayer-client';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const clock=(ms:number)=>{const s=Math.ceil(Math.max(0,ms)/1000);return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const set=(e:HTMLElement,v:string)=>{if(e.textContent!==v)e.textContent=v;};
export class OdysseyRacingPanel {
 private panel=make('section');private select=make('select');private apply=make('button','套用 Odyssey 房規');private help=make('p');private live=make('section');private status=make('p');private result=make('p');private next=make('button');private scores=make('ol');private key='';private scoreKey='';
 constructor(private client:()=>MultiplayerClient|null){
  this.panel.id='mp-odyssey-settings';this.panel.className='mp-series-section';const label=make('label','Odyssey 房規');label.className='mp-field';this.select.id='mp-odyssey-mode';
  for(const[value,name]of[['off','關閉'],['sprint','真人衝刺週末：排位 → 1圈衝刺 → 正賽'],['pit','真人耐久：中段至少完成一次有效換胎']]){const option=make('option',name);option.value=value;this.select.append(option);}label.append(this.select);this.apply.id='mp-odyssey-apply';this.help.className='mp-hint';this.panel.append(make('h3','衝刺週末與耐久策略'),label,this.apply,this.help);document.getElementById('mp-room')?.append(this.panel);
  this.live.id='mp-odyssey-live';this.live.className='odyssey-racing-live';this.status.id='mp-odyssey-status';this.status.setAttribute('role','status');this.live.append(this.status);(document.getElementById('mp-summit-live')??document.getElementById('mp-race-information')??document.getElementById('mp-hud'))?.append(this.live);
  const results=make('section');results.id='mp-odyssey-results';this.next.id='mp-odyssey-next';this.scores.id='mp-odyssey-standings';results.append(this.result,this.scores,this.next);document.getElementById('mp-results')?.append(results);
  this.apply.onclick=()=>{this.client()?.setOdyssey({sprintWeekend:this.select.value==='sprint',mandatoryStop:this.select.value==='pit'});this.apply.blur();};this.next.onclick=()=>{this.client()?.nextOdysseyStage();this.next.blur();};this.panel.hidden=this.live.hidden=this.next.hidden=true;
 }
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean,now:number){
  const o=room?.odyssey,w=o?.weekend,host=room?.hostId===selfId,stage=room?.summit?.stage,p=room?.players.find(p=>p.id===selfId),key=JSON.stringify([room?.code,room?.hostManagement?.lobbyRevision,o?.settings]);
  this.panel.hidden=!room?.capabilities?.odysseyRacing||room.phase!=='lobby';if(this.key!==key){this.key=key;this.select.value=o?.settings.sprintWeekend?'sprint':o?.settings.mandatoryStop?'pit':'off';}this.select.disabled=this.apply.disabled=!host||!connected||busy;
  set(this.help,w?`同張 GP 圖、2～4 真人固定名單。衝刺依排位發車，${w.raceLaps}圈正賽依衝刺結果。衝刺4／3／2／1分、正賽10／6／4／3分、DNF0分；同分先比正賽名次。下一階段需原車手全員回來，明確離席或續接逾期須重設完整週末。`:o?.settings.mandatoryStop?'作業必須在比賽20%～80%期間開始且完成；純修復不算。八分鐘為1:36～6:24、十分鐘為2:00～8:00。未完成列為房規未完成、不列有效名次；斷線DNF另列。':'衝刺週末需GP圖與真人，保留目前正賽圈數。強制一停請先在上方套用八／十分鐘耐久、關閉排位與AI。不能混用系列、道具、VSC、自選天候；啟用後先在此關閉，再改其他設定。');
  this.live.hidden=!o||!['countdown','racing'].includes(room?.phase??'');
  if(w)set(this.status,`${stage==='qualifying'?'衝刺週末 · 三分鐘排位':stage==='sprint'?'衝刺週末 · 一圈衝刺':'衝刺週末 · 正賽'} · 固定名單${w.entrants.length}/4。取消倒數保留階段，不能換人續賽。`);
  else if(o?.settings.mandatoryStop){const window=odysseyStopWindow(room!.summit!.settings.endurance),elapsed=Math.max(0,now-(room!.startAt??now)),v=p?.odyssey;set(this.status,v?.qualifiedStopMs!=null?`✓ 中段有效換胎已完成（${clock(v.qualifiedStopMs)}）`:v?.stopMissed||elapsed>window.closeMs?'房規未完成：換胎時窗已結束；仍可完成比賽，結果另列。':elapsed<window.openMs?`強制一停：${clock(window.openMs-elapsed)}後開窗，須於${clock(window.openMs)}～${clock(window.closeMs)}開始並完成換胎。`:`強制一停：開窗剩${clock(window.closeMs-elapsed)}；完成換胎才算，純修復不算。`);}
  const results=!!o&&room?.phase==='results';this.result.hidden=this.scores.hidden=!results;this.next.hidden=!results||!w||w.complete;set(this.next,stage==='qualifying'?'依排位進入一圈衝刺大廳':'依衝刺結果進入正賽大廳');this.next.disabled=!host||!connected||busy||room?.players.some(p=>!p.connected)||!w?.locked;
  if(results)set(this.result,w?w.complete?'週末完成：以下為衝刺＋正賽總積分，可按「重設完整週末」再玩。':stage==='qualifying'?'排位完成，無有效圈的原車手從後排參加衝刺。請先保存本場回放，再進下一階段。':'衝刺完成，正賽依本場順序發車。請先保存回放，再進下一階段。':'依伺服器裁定中段有效換胎；未完成不列有效名次，DNF另列。');
  const scoreKey=JSON.stringify(results&&w?[w.entrants,w.standings]:null);if(this.scoreKey!==scoreKey){this.scoreKey=scoreKey;this.scores.replaceChildren();if(results)for(const row of w?.standings??[])this.scores.append(make('li',`${row.rank}. ${w!.entrants.find(e=>e.id===row.id)?.name??'車手'} · ${row.points}分（衝刺${row.sprintPoints}＋正賽${row.racePoints}）`));}
 }
}
