import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import type {MultiplayerClient} from './multiplayer-client';
import {voyagerForecast,type VoyagerWeather} from '../shared/voyager-racing';
import './voyager-racing.css';
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const update=(e:HTMLElement,text:string)=>{if(e.textContent!==text)e.textContent=text;};
const lapTime=(v:number|null)=>v===null?'—':`${(v/1000).toFixed(3)}秒`;
/** Keep one DOM and one reading order; compact screens scroll its information. */
function mountRaceInformation(){
 const hud=document.getElementById('mp-hud');if(!hud||document.getElementById('mp-race-information'))return;
 const info=element('section'),hint=element('p','比賽資訊 · 上下滑動查看全部');info.id='mp-race-information';info.tabIndex=0;info.setAttribute('role','region');info.setAttribute('aria-label','比賽資訊，可上下捲動');hint.className='voyager-race-info-hint';info.append(hint);
 for(const selector of ['#mp-network-warning','#mp-race-message','.mp-race-stats','#mp-board','#mp-voyager-live','#mp-summit-live','#mp-horizon-race','#mp-arena-live','#mp-awareness','#mp-spectator-field']){const panel=hud.querySelector(selector);if(panel)info.append(panel);}
 hud.prepend(info);
}
export class VoyagerRacingPanel{
 private menu=element('section');private practice=element('select');private weather=element('select');private vsc=element('input');private apply=element('button','套用練習／天候／VSC');private hint=element('p');
 private live=element('section');private forecast=element('p');private status=element('p');private start=element('button','房主啟動 VSC');private resume=element('button','三秒後恢復競速');private board=element('ol');private result=element('p');private key='';private boardKey='';
 constructor(private client:()=>MultiplayerClient|null){
  this.menu.id='mp-voyager-settings';this.menu.className='mp-series-section';this.practice.id='mp-voyager-practice';this.weather.id='mp-voyager-weather';this.vsc.id='mp-voyager-vsc';this.vsc.type='checkbox';this.apply.id='mp-voyager-apply';
  const title=element('h3','自由練習、自選天候與 VSC'),practiceLabel=element('label','場次'),weatherLabel=element('label','共享天候'),vscLabel=element('label','允許房主啟用 VSC');practiceLabel.className=weatherLabel.className='mp-field';vscLabel.className='summit-check';
  for(const [value,label] of [['0','沿用正賽'],['600','10分鐘自由練習'],['1200','20分鐘自由練習']]){const o=element('option',label);o.value=value;this.practice.append(o);}
  for(const [value,label] of [['legacy','原房規（耐久乾→雨→乾）'],['clear','全程晴天'],['rain','固定雨勢'],['dry-rain','乾地 → 2分鐘開始轉雨']]){const o=element('option',label);o.value=value;this.weather.append(o);}
  practiceLabel.append(this.practice);weatherLabel.append(this.weather);vscLabel.prepend(this.vsc);this.hint.className='mp-hint';this.menu.append(title,practiceLabel,weatherLabel,vscLabel,this.apply,this.hint);document.getElementById('mp-room')?.append(this.menu);
  this.live.id='mp-voyager-live';this.live.className='voyager-racing-live';this.forecast.id='mp-voyager-forecast';this.status.id='mp-voyager-status';this.status.setAttribute('role','status');this.start.id='mp-voyager-vsc-start';this.resume.id='mp-voyager-vsc-resume';this.board.id='mp-voyager-practice-board';this.live.append(this.forecast,this.status,this.start,this.resume,this.board);document.getElementById('mp-hud')?.append(this.live);this.result.id='mp-voyager-result';this.result.className='mp-hint';document.getElementById('mp-results')?.append(this.result);
  this.practice.onchange=()=>{if(Number(this.practice.value)){this.vsc.checked=false;this.vsc.disabled=true;}else this.vsc.disabled=false;};
  this.apply.onclick=()=>this.client()?.setVoyager({practiceSeconds:Number(this.practice.value) as 0|600|1200,weather:this.weather.value as VoyagerWeather,vsc:this.vsc.checked});this.start.onclick=()=>this.client()?.setVsc(true);this.resume.onclick=()=>this.client()?.setVsc(false);this.menu.hidden=this.live.hidden=this.result.hidden=true;
  mountRaceInformation();
 }
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean,now:number){
  const v=room?.voyager,settings=v?.settings,host=room?.hostId===selfId,practice=settings?.practiceSeconds??0,active=!!settings&&(!!practice||settings.weather!=='legacy'||settings.vsc),elapsed=room?.startAt===null?0:Math.max(0,now-(room?.startAt??now)),me=room?.players.find(p=>p.id===selfId);
  this.menu.hidden=!room?.capabilities?.voyagerRacing||room.phase!=='lobby';this.live.hidden=!room||!active||!['countdown','racing'].includes(room.phase);this.result.hidden=!room||!active||room.phase!=='results';
  const key=JSON.stringify([room?.code,room?.hostManagement?.lobbyRevision,settings]);if(key!==this.key){this.key=key;this.practice.value=String(practice);this.weather.value=settings?.weather??'legacy';this.vsc.checked=!!settings?.vsc;}
  const allowed=!!room&&!room.series&&room.evolution?.mode==='race'&&!Object.values(room.horizon??{}).some(Boolean)&&(room.arena?.mode??'off')==='off'&&!room.summit?.settings.weekend;
  for(const c of [this.practice,this.weather,this.vsc,this.apply])c.disabled=!host||!connected||busy||!allowed;this.vsc.disabled||=Number(this.practice.value)>0;
  update(this.hint,'練習需大獎賽地圖、2～4位真人開場；開始後可進出／短暫續接，友車穿透。到時立即結算有效最快圈與最佳分段，擦牆使本圈無效；中途加入第一圈為出場圈。練習另列戰績，沒有固定名單正賽回放。天候預報以共同起跑為基準，雨胎／磨耗／維修區與伺服器同步。VSC 全場80 km/h、恢復倒數3秒內仍限速禁超車；伺服器強制限速並記錄次序變動，此版不因超車自動加秒或判肇責。');
  update(this.forecast,settings?`共享預報：${voyagerForecast(settings.weather)} · 目前濕度 ${Math.round((v?.wet??0)*100)}%`:'');
  const ruleText=room?.expedition?.settings.vsc?'正式賽規每次有效超車加5秒，不判肇責':'僅記錄，不自動加秒或判肇責';
  if(room?.expedition?.settings.vsc)update(this.hint,'VSC全場80 km/h、恢復倒數3秒內仍限速禁超車；本房正式賽規啟用超車加秒，每次有效超車+5秒，排除低速／維修／凍結車。');
  const phase=v?.vsc.phase??'off';update(this.status,practice?`自由練習 · 剩餘 ${Math.ceil(Math.max(0,practice*1000-elapsed)/1000)}秒 · ${me?.voyager?.lapValid?'本圈有效':'出場圈／本圈無效'} · 有效最快 ${lapTime(me?.bestLapMs??null)}`:phase==='active'?`VSC 啟動 · 80 km/h · 禁止超車（${ruleText}）`:phase==='resuming'?`VSC 恢復倒數 ${Math.ceil(Math.max(0,(v?.vsc.resumeAt??now)-now)/1000)}秒 · 仍限速80 km/h、禁止超車`:'正常競速');
  this.start.hidden=this.resume.hidden=!settings?.vsc||!host;this.start.disabled=!connected||busy||room?.phase!=='racing'||phase!=='off';this.resume.disabled=!connected||busy||room?.phase!=='racing'||phase!=='active';this.board.hidden=!practice;
  const boardKey=JSON.stringify(practice?room?.players.map(p=>[p.name,p.bestLapMs,p.voyager?.bestSectorsMs]):[]);if(this.boardKey!==boardKey){this.boardKey=boardKey;this.board.replaceChildren();if(practice)for(const p of room?.players??[]){const row=element('li',`${p.name} · 有效最快 ${lapTime(p.bestLapMs??null)} · S1／S2／S3 ${(p.voyager?.bestSectorsMs??[null,null,null]).map(lapTime).join('／')}`);this.board.append(row);}}
  update(this.result,practice?`自由練習結束；只比較有效最快圈與各段最佳，分段可能來自不同圈。${room?.players.map(p=>`${p.name} ${lapTime(p.bestLapMs??null)} · 分段 ${(p.voyager?.bestSectorsMs??[]).map(lapTime).join('／')}`).join(' ｜ ')}。已另列練習戰績；本場不產生正賽回放。`:`${settings?voyagerForecast(settings.weather):''}；VSC ${v?.events.filter(e=>e.type==='start').length??0}次，事件已隨回放保存。${ruleText}。`);
  if(practice&&room){for(const id of ['mp-room-description','mp-result-track']){const e=document.getElementById(id);if(e)update(e,`${room.trackId} · ${practice/60}分鐘自由練習 · ${room.players.length}/4人`);}const rules=`${practice/60}分鐘自由練習 · 友車穿透 · 到時立即結算（無末圈寬限）`;for(const id of ['mp-race-rules','mp-rules-description','mp-result-rules']){const e=document.getElementById(id);if(e)update(e,rules);}for(const id of ['mp-collisions','mp-finish-grace']){const e=document.getElementById(id) as HTMLSelectElement|null;if(e)e.disabled=true;}const laps=document.getElementById('mp-lap');if(laps&&me)update(laps,`練習 ${me.completedLaps}圈／有效 ${me.voyager?.validLaps.length??0}圈`);const field=document.getElementById('mp-room-laps-field');if(field)field.hidden=true;}
 }
}
