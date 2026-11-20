import {FRONTIER_CUP_VERSION,CUP_MATCH_LABELS,cupCompatible,cupStandings,type CupCommand,type FrontierCupState} from '../shared/frontier-cup';
import {getMultiplayerTrack} from '../shared/multiplayer-tracks';
import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import type {MultiplayerClient} from './multiplayer-client';
import './frontier-cup.css';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
const text=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};
const replayReason=(c:FrontierCupState)=>({tie:'兩位完賽成績相同', 'both-dnf':'兩位都未完賽','server-stall':'伺服器停頓過久'}[c.matches[c.index].reason??'tie']);
const time=(ms:number)=>`${(ms/1000).toFixed(3)} 秒`;
export class FrontierCupPanel {
 private lobby=make('section');private result=make('section');private live=make('p');private create=make('button','鎖定四人，建立好友盃');
 private start=make('button','開始這一場');private next=make('button');private cancelLobby=make('button','取消整盃');private cancelResult=make('button','結束好友盃，回一般大廳');
 private cancelLive=make('button','取消整盃');
 private download=make('button','下載本盃結果');private lobbyNote=make('p');private resultNote=make('p');private lobbyBracket=make('ol');private resultBracket=make('ol');private standings=make('ol');private bracketKey='';
 private lastRoom:RoomSnapshot|null|undefined;private lastContext='';
 constructor(private getClient:()=>MultiplayerClient|null){
  this.lobby.id='mp-frontier-cup';this.result.id='mp-frontier-cup-results';this.live.id='mp-frontier-cup-live';this.cancelLive.id='mp-cup-cancel-race';this.cancelLive.className='frontier-cup-cancel-live';
  this.lobby.className=this.result.className='frontier-cup mp-series-section';this.live.className='frontier-cup-live';
  this.lobby.setAttribute('aria-label','四人好友盃');this.result.setAttribute('aria-label','好友盃賽程與結果');this.live.setAttribute('role','status');
  for(const el of[this.lobbyNote,this.resultNote]){el.className='mp-hint';el.setAttribute('role','status');}
  const help=make('p','四位真人依加入位置排種子：1 對 4、2 對 3，接著季軍賽與冠軍賽。同場只跑兩車，其餘兩人留在原席觀戰。賽道、圈數、房規固定，全員每場重新準備。');help.className='mp-hint';
  const persistence=make('p','斷線原席保留 15 秒；逾期無法替補，請房主明確取消整盃後重開。本盃僅保留在目前伺服器記憶體；不支援跨伺服器重啟續盃。');persistence.className='mp-note';
  this.create.id='mp-cup-create';this.start.id='mp-cup-start';this.next.id='mp-cup-next';this.download.id='mp-cup-download';this.cancelLobby.id='mp-cup-cancel';this.cancelResult.id='mp-cup-finish';
  this.start.className=this.next.className='mp-wide mp-primary';this.create.className='mp-wide';
  this.lobbyBracket.className=this.resultBracket.className='frontier-cup-bracket';this.standings.className='frontier-cup-standings';
  this.lobby.append(make('h3','四人好友盃'),help,this.lobbyNote,this.lobbyBracket,this.create,this.start,this.cancelLobby,persistence);
  this.result.append(make('h3','好友盃賽程'),this.resultNote,this.resultBracket,this.standings,this.next,this.download,this.cancelResult);
  document.getElementById('mp-room')?.append(this.lobby);document.getElementById('mp-results')?.append(this.result);document.getElementById('mp-hud')?.append(this.live,this.cancelLive);
  this.create.onclick=()=>this.send('cup-configure');this.start.onclick=()=>this.send('cup-start');this.next.onclick=()=>this.send(this.getClient()?.room?.cup?.status==='replay'?'cup-replay':'cup-next');
  this.cancelLobby.onclick=this.cancelResult.onclick=this.cancelLive.onclick=()=>{
   const client=this.getClient(),intent=client?.captureCupIntent();if(!client||!intent)return;
   if(confirm(client.room?.cup?.status==='complete'?'結束本盃並回到一般大廳？請先下載要保留的結果。':'取消整盃並放棄目前賽程？所有人會回到一般大廳。'))client.cupCommand('cup-cancel',intent);
  };
  this.download.onclick=()=>{const c=this.getClient()?.room?.cup;if(!c||c.status!=='complete')return;const data={schema:FRONTIER_CUP_VERSION,settings:c.locked,entrants:c.entrants,matches:c.matches,standings:cupStandings(c)},url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=make('a');a.href=url;a.download='taipei-friends-cup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
 }
 private send(command:CupCommand){this.getClient()?.cupCommand(command);}
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy=false){
  // Settings panels also render independently; inert remains effective when they update their controls.
  for(const node of document.querySelectorAll<HTMLElement>('#mp-series-setup, #mp-evolution, #mp-horizon-settings, #mp-arena-settings, #mp-summit-settings, #mp-atlas-settings, #mp-voyager-settings, #mp-odyssey-settings, #mp-expedition-rules')){node.inert=!!room?.cup;node.setAttribute('aria-disabled',String(!!room?.cup));}
  if(room?.cup)for(const node of document.querySelectorAll<HTMLSelectElement|HTMLButtonElement>('#mp-room-track, #mp-room-laps, #mp-collisions, #mp-finish-grace, #mp-host-kick'))if(!node.disabled)node.disabled=true;
  const context=`${selfId}:${connected}:${busy}`;if(room===this.lastRoom&&context===this.lastContext)return;this.lastRoom=room;this.lastContext=context;
  const cup=room?.cup,cap=room?.capabilities?.frontierCup===FRONTIER_CUP_VERSION,host=room?.hostId===selfId,me=room?.players.find(p=>p.id===selfId);
  this.lobby.hidden=!cap||room?.phase!=='lobby';this.result.hidden=!cup||room?.phase!=='results';this.live.hidden=!cup||!['countdown','racing'].includes(room?.phase??'');
  this.cancelLive.hidden=!cup||!host||!['countdown','racing'].includes(room?.phase??'');
  const can=!!room&&connected&&!busy&&host,loaded=!!room&&room.players.length===4&&room.players.every(p=>p.connected&&p.loaded&&!p.summit?.ai);
  this.create.hidden=!!cup;this.create.disabled=!can||!loaded||!cupCompatible(room??{})||!!room?.spectators?.length;
  this.start.hidden=!cup||!host;this.start.disabled=!can||!loaded||room!.players.some(p=>!p.ready)||cup?.status!=='ready';
  this.cancelLobby.hidden=!cup||!host;this.cancelResult.hidden=!host;this.cancelLobby.disabled=this.cancelResult.disabled=this.cancelLive.disabled=!can;
  this.next.hidden=!host||!cup||cup.status==='complete';this.next.disabled=!can||!cup||!['decided','replay'].includes(cup.status);
  this.download.hidden=cup?.status!=='complete';
  if(!cup){text(this.lobbyNote,!loaded?'需要四位新版真人都已連線並載入地圖。':!cupCompatible(room??{})?'請先關閉系列、AI 與其他特殊玩法。':room?.spectators?.length?'請外部觀眾先離房；這一盃由原四席輪流觀戰。':'先選好本盃的賽道、圈數與碰撞規則，再鎖定名單。');return;}
  const match=cup.matches[cup.index],label=CUP_MATCH_LABELS[match.key],track=getMultiplayerTrack(cup.locked.trackId)?.name??cup.locked.trackId;
  text(this.start,`全員準備後開始${label}`);
  text(this.lobbyNote,`${label} · 第 ${match.attempt} 次 · ${track}／${cup.locked.laps} 圈。${me?.cup?.active?'你是本場出賽車手。':'你留在原席觀戰，本場不列 DNF。'}${loaded?'請四位原車手都按準備。':'等待四個原席重新連線並載入；15 秒後仍失去席位時，請取消整盃重開。'}`);
  text(this.live,`${label} · ${me?.cup?.active?'你正在出賽':'原席觀戰，不列 DNF'} · 第 ${match.attempt} 次`);
  text(this.resultNote,cup.status==='complete'?'四場已完成，下方是本盃最終名次。下載結果後可結束好友盃。':cup.status==='replay'?`${replayReason(cup)}，這場沒有勝負與晉級。請重賽同一組，或明確取消整盃。`:`${label}已結算；房主前往下一場後，四位原車手都要重新準備。`);
  text(this.next,cup.status==='replay'?'重賽這一場':`前往${CUP_MATCH_LABELS[cup.matches[Math.min(3,cup.index+1)].key]}`);
  const key=JSON.stringify([cup.id,cup.revision]);if(key!==this.bracketKey){this.bracketKey=key;this.lobbyBracket.replaceChildren();this.resultBracket.replaceChildren();this.standings.replaceChildren();
   for(const m of cup.matches){const names=m.pair?.map(id=>cup.entrants.find(e=>e.playerId===id)?.name??'原車手').join(' 對 ')??(m.key==='bronze'?'兩場準決賽落敗者':'兩場準決賽勝出者'),status=m.status==='decided'?`勝出：${cup.entrants.find(e=>e.playerId===m.winnerId)?.name}`:m.status==='replay'?'需重賽':m.status==='running'?'進行中':'待出賽';
    for(const list of[this.lobbyBracket,this.resultBracket]){const li=make('li'),title=make('b',CUP_MATCH_LABELS[m.key]),body=make('span',`${names} · ${status}`);if(m.key===match.key)li.dataset.current='true';li.append(title,body);if(m.results.length)li.append(make('small',m.results.map(r=>`${cup.entrants.find(e=>e.playerId===r.playerId)?.name}：${r.dnf?'未完賽':r.finishMs===null?'未完成':time(r.finishMs)}`).join('／')));list.append(li);}
   }
   for(const row of cupStandings(cup))this.standings.append(make('li',`第 ${row.rank} 名：${row.name}`));
  }
 }
}
