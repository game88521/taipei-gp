import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import type {ArenaMode} from '../shared/multiplayer-arena';
import type {MultiplayerClient} from './multiplayer-client';
import {controlCodeLabel, type Input} from './input';
import './multiplayer-arena.css';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const el=document.createElement(tag);el.textContent=text;return el;};
const name=(room:RoomSnapshot,id:string)=>room.players.find(p=>p.id===id)?.name??'離線車手';
const clock=(ms:number)=>`${Math.floor(ms/60000)}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}`;
const text=(el:HTMLElement,value:string)=>{if(el.textContent!==value)el.textContent=value;};
export const arenaLabel=(mode:string|undefined)=>mode==='relay'?'雙人接力賽':mode==='items'?'補給道具賽':'一般圈數競速';
export class MultiplayerArenaPanel{
 private menu=make('section');private mode=make('select');private apply=make('button','套用接力／道具玩法');private teams=make('div');
 private red=make('button','加入紅隊');private blue=make('button','加入藍隊');private members=make('p');private help=make('p');
 private live=make('section');private status=make('p');private action=make('button');private results=make('p');private lastConfig='';private held=true;
 private shortcut='';
 constructor(private getClient:()=>MultiplayerClient|null,private input:Input){
  this.menu.id='mp-arena-settings';this.menu.className='mp-series-section';this.menu.setAttribute('aria-label','接力與道具玩法');this.menu.hidden=true;
  const title=make('h3','接力與道具賽'),label=make('label','額外玩法');label.className='mp-field';this.mode.id='mp-arena-mode';
  for(const [value,title]of[['off','一般競速'],['relay','四人雙隊接力'],['items','補給道具賽']]){const o=make('option',title);o.value=value;this.mode.append(o);}
  label.append(this.mode);this.apply.id='mp-arena-apply';this.help.className='mp-hint';this.members.className='mp-hint';this.teams.className='mp-actions';
  this.red.id='mp-arena-red';this.blue.id='mp-arena-blue';this.teams.append(this.red,this.blue);this.menu.append(title,label,this.apply,this.help,this.teams,this.members);
  document.getElementById('mp-room')?.append(this.menu);
  this.live.id='mp-arena-live';this.live.className='mp-arena-live';this.live.hidden=true;this.live.setAttribute('aria-label','接力／道具操作');this.status.id='mp-arena-status';this.action.id='mp-arena-action';this.action.className='mp-primary';this.live.append(this.status,this.action);document.getElementById('mp-hud')?.append(this.live);
  this.results.id='mp-arena-results';this.results.className='mp-hint';document.getElementById('mp-results')?.append(this.results);
  this.apply.onclick=()=>this.getClient()?.setArena(this.mode.value as ArenaMode);this.red.onclick=()=>this.getClient()?.arenaTeam('red');this.blue.onclick=()=>this.getClient()?.arenaTeam('blue');this.action.onclick=()=>{this.getClient()?.arenaAction();this.action.blur();};
  const hints=()=>{this.shortcut=this.input.getControls().keys.handbrake.map(controlCodeLabel).join('／');};hints();window.addEventListener('gp-controls-updated',hints);window.addEventListener('storage',hints);
 }
 sample(held:boolean,driving:boolean){if(!driving){this.held=true;return;}if(held&&!this.held&&!this.action.disabled&&!this.live.hidden)this.getClient()?.arenaAction();this.held=held;}
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean,now:number){
  const a=room?.arena,me=room?.players.find(p=>p.id===selfId),host=room?.hostId===selfId,mode=a?.mode??'off';
  this.menu.hidden=!room?.capabilities?.nexusArena||room.phase!=='lobby';this.live.hidden=!room||!['racing','countdown'].includes(room.phase)||mode==='off';
  this.results.hidden=!room||room.phase!=='results'||mode==='off';this.teams.hidden=mode!=='relay';
  const config=JSON.stringify([room?.code,room?.hostManagement?.lobbyRevision,mode]);if(config!==this.lastConfig){this.lastConfig=config;this.mode.value=mode;}
  this.mode.disabled=this.apply.disabled=!host||!connected||busy;this.red.disabled=this.blue.disabled=!me||!connected||busy;
  text(this.help,mode==='items'?'每圈三個補給點：通過後取得加速或護盾。加速2.5秒；護盾4秒免車輛碰撞（撞牆仍減速）。一次持有一個，效果期間不能再拾取／使用；不影響一般競速。':'僅搭配單場圈數競速；切換前請關閉系列、淘汰、防堵路與倒序。接力固定四人、每隊兩位，隊伍共跑3或5圈。首棒至少1圈後，在起終線後80公尺內減速交棒；第二棒跑完其餘圈數。任何隊員斷線逾期／離賽，全隊DNF。');
  text(this.members,mode==='relay'&&room?['red','blue'].map(t=>`${t==='red'?'紅':'藍'}隊：${room.players.filter(p=>a?.teams[p.id]===t).map(p=>p.name).join('、')||'尚無隊員'}`).join(' ｜ '):'');
  const hint=`甩尾鍵 ${this.shortcut}／手把 X，或按此按鈕`;
  this.action.disabled=!connected||!me?.arena?.active||!me.loaded||me.dnf||me.finishMs!==null||room?.phase!=='racing'||busy;
  if(mode==='relay'&&room){const t=a?.relayTeams.find(t=>t.memberIds.includes(selfId??''));const driver=t?name(room,t.driverId):'準備中';
   text(this.status,t?`${t.team==='red'?'紅':'藍'}隊 · 當值 ${driver} · ${t.completedLaps}/${room.laps}圈 · ${t.handoffs?'已交棒，第二棒跑至終點':t.completedLaps>=1?'進入起終線後青色交棒區，18 km/h以下交棒':'首棒先完成一圈'}${!me?.arena?.active?' · 你在候場，可切換觀戰':''}`:'接力準備中');
   text(this.action,`交棒給隊友 · ${hint}`);this.action.disabled||=!t||t.handoffs>0||(me?.completedLaps??0)<1||(me?.car.pos.s??Infinity)>80||(me?.car.v??Infinity)>5.1;
   const standing=[...(a?.relayTeams??[])].sort((x,y)=>x.dnf!==y.dnf?x.dnf?1:-1:(x.finishMs??Infinity)-(y.finishMs??Infinity)||y.progress-x.progress||(x.team==='red'?-1:1));
   text(this.results,standing.map((t,i)=>`${i+1}. ${t.team==='red'?'紅':'藍'}隊 ${t.memberIds.map(id=>name(room,id)).join('／')}：${t.dnf?'DNF':t.finishMs!==null?clock(t.finishMs):'未完賽'} · 交棒${t.handoffs}次`).join(' ｜ '));
  }else if(mode==='items'){
   const v=me?.arena,boost=Math.max(0,(v?.boostUntil??0)-now),shield=Math.max(0,(v?.shieldUntil??0)-now);text(this.status,boost?`加速中 ${(boost/1000).toFixed(1)}秒`:shield?`護盾中 ${(shield/1000).toFixed(1)}秒 · 免車輛碰撞`:v?.item?`已取得${v.item==='boost'?'加速':'護盾'} · 每圈3個補給點`:'通過彩色補給點取得道具；一次持有一個');
   text(this.action,`使用${v?.item==='boost'?'加速':v?.item==='shield'?'護盾':'道具'} · ${hint}`);this.action.disabled||=!v?.item||boost>0||shield>0;text(this.results,'補給道具賽：名次由伺服器判定，成績與一般競速分開辨識。');
  }
 }
}
