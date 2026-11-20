import './nexus-replay.css';
import {VoyagerPhoto} from './voyager-photo';
import {decodeMultiplayerReplay,parseMultiplayerReplay,replayRoomAt,REPLAY_MAX_CHARS,type MultiplayerReplay} from '../shared/nexus-replay';
import {getMultiplayerTrack} from '../shared/multiplayer-tracks';
import {ReplayLibrary} from './nexus-replay-library';
import type {MultiplayerClient} from './multiplayer-client';
import type {MultiplayerScene} from './multiplayer-scene';
import {ReplayBookmarks} from './summit-replay-bookmarks';
import {mountReplayNotes} from './odyssey-replay-notes-ui';
import {advanceReplayLoop} from './odyssey-replay-notes';
import type {ReplayReplacement} from './nexus-replay-library';
import './odyssey-workshop.css';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const button=(text:string,id?:string)=>{const node=el('button',text);node.type='button';if(id)node.id=id;return node;};
const time=(ms:number)=>`${Math.floor(ms/60000)}:${(ms%60000/1000).toFixed(1).padStart(4,'0')}`;
const describe=(r:MultiplayerReplay)=>`${getMultiplayerTrack(r.trackId)?.name??r.trackId} · ${r.drivers.map(d=>d.name).join('、')} · ${time(r.recordedMs)}${r.truncated?'（部分回放）':''}`;

/** Explicit downloads and isolated playback; this never sends inputs or writes race history. */
export function mountMultiplayerReplay(getClient:()=>MultiplayerClient|null){
  let bookmarkStorage:Storage|null=null;try{bookmarkStorage=localStorage;}catch{/* Bookmarks remain available in this page. */}const bookmarks=new ReplayBookmarks(bookmarkStorage);
  const library=new ReplayLibrary(),result=el('section'),resultTitle=el('h3','多人賽事回放'),fetchButton=button('取得本場回放','mp-replay-fetch'),resultHelp=el('p');
  result.className='nexus-replay-result';resultHelp.className='mp-hint';result.append(resultTitle,resultHelp,fetchButton);
  document.getElementById('mp-results')?.append(result);
  const panel=el('details'),summary=el('summary','多人回放庫'),help=el('p','只保存在這個瀏覽器，最多 5 場；滿額時先選擇要替換的場次，也可先下載或取消。檔案含車手暱稱，不含房間碼或續接憑證。'),status=el('p'),file=el('input'),importButton=button('匯入回放檔','mp-replay-import'),list=el('ol'),currentPanel=el('div'),currentText=el('p');
  panel.id='mp-replay-library';panel.className='nexus-replay-library';help.className='mp-hint';status.id='mp-replay-status';status.setAttribute('role','status');file.type='file';file.accept='.json,application/json';file.hidden=true;list.className='nexus-replay-list';list.id='mp-replay-list';currentPanel.className='nexus-replay-current';currentPanel.hidden=true;
  const playButton=button('播放目前回放','mp-replay-play'),saveButton=button('保存到回放庫','mp-replay-save'),downloadButton=button('下載目前回放','mp-replay-download');
  currentPanel.append(currentText,playButton,saveButton,downloadButton);panel.append(summary,help,importButton,file,status,currentPanel,list);
  const history=document.getElementById('mp-history');if(history)history.before(panel);else document.getElementById('mp-menu')?.append(panel);
  let current:MultiplayerReplay|null=null,working=false,listGeneration=0,viewer:{close:()=>void;seek:(at:number)=>void;get at():number;get ready():boolean}|null=null;
  let cancelReplacement:(()=>void)|null=null;
  async function chooseReplacement(value:MultiplayerReplay):Promise<ReplayReplacement|null>{
    const rows=await library.list(),candidates=new Map<string,MultiplayerReplay>();for(const row of rows){const saved=await library.get(row.id);if(saved)candidates.set(row.id,saved);}if(!candidates.size)throw Error('回放庫已變更，請重新按保存。');
    return new Promise(resolve=>{const prior=document.activeElement as HTMLElement|null,overlay=el('section'),card=el('div'),title=el('h2','選擇要替換的回放'),select=el('select'),note=el('p','沒有自動刪除任何回放。可先下載選取場次，再明確替換；取消會完整保留。'),replace=button('確認替換選取場次','odyssey-replay-replace'),backup=button('先下載選取場次','odyssey-replay-backup-old'),cancel=button('取消保存','odyssey-replay-save-cancel');overlay.id='odyssey-replay-replacement';overlay.className='odyssey-replay-replace';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');title.id='odyssey-replay-replacement-title';overlay.setAttribute('aria-labelledby',title.id);select.id='odyssey-replay-replace-id';select.setAttribute('aria-label','要替換的回放');const empty=el('option','請明確選擇場次');empty.value='';select.append(empty);for(const saved of candidates.values()){const option=el('option',describe(saved));option.value=saved.id;select.append(option);}replace.disabled=backup.disabled=true;select.onchange=()=>replace.disabled=backup.disabled=!candidates.has(select.value);
      let ended=false;const finish=(choice:ReplayReplacement|null)=>{if(ended)return;ended=true;cancelReplacement=null;overlay.remove();prior?.focus();resolve(choice);};cancelReplacement=()=>finish(null);replace.onclick=()=>{const expected=candidates.get(select.value);if(expected)finish({id:expected.id,expected});};backup.onclick=()=>{const saved=candidates.get(select.value);if(saved){download(saved);note.textContent='已送出舊回放下載；請確認瀏覽器已下載成功，再選擇是否替換。';}};cancel.onclick=()=>finish(null);overlay.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(null);}if(event.key==='Tab'){const focusable=[select,backup,replace,cancel].filter(e=>!e.disabled),index=focusable.indexOf(document.activeElement as HTMLButtonElement);if(event.shiftKey&&index<=0){event.preventDefault();focusable.at(-1)?.focus();}else if(!event.shiftKey&&index===focusable.length-1){event.preventDefault();focusable[0]?.focus();}}};card.append(title,el('p',`要保存：${describe(value)}`),select,note,backup,replace,cancel);overlay.append(card);document.body.append(overlay);cancel.focus();});
  }
  function setCurrent(replay:MultiplayerReplay){current=replay;currentPanel.hidden=false;currentText.textContent=describe(replay);panel.open=true;}
  function download(replay:MultiplayerReplay){
    const url=URL.createObjectURL(new Blob([JSON.stringify(replay)],{type:'application/json'})),a=el('a');a.href=url;a.download=`taipei-gp-replay-${replay.id}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='已送出回放下載；檔案含車手暱稱，分享前請確認。';
  }
  async function refresh(){
    const generation=++listGeneration,rows=await library.list();if(generation!==listGeneration)return;list.replaceChildren();
    for(const r of rows){const li=el('li'),label=el('p',`${getMultiplayerTrack(r.trackId)?.name??r.trackId} · ${r.drivers.join('、')} · ${time(r.durationMs)}${r.truncated?'（部分回放）':''}`),play=button('播放'),exportButton=button('下載'),remove=button('刪除');
      play.addEventListener('click',()=>void run(async()=>{const data=await library.get(r.id);if(!data)throw Error('這筆回放已不存在或版本不相容。');setCurrent(data);await openReplay(data);}));
      exportButton.addEventListener('click',()=>void run(async()=>{const data=await library.get(r.id);if(!data)throw Error('無法讀取這筆回放。');download(data);}));
      remove.addEventListener('click',()=>void run(async()=>{if(!confirm('刪除這筆本機回放？已下載的檔案會保留。'))return;if(!await library.remove(r.id))throw Error('無法刪除回放，請稍後重試。');await refresh();status.textContent='已刪除這筆本機回放。';}));
      li.append(label,play,exportButton,remove);list.append(li);
    }
    if(!rows.length)list.append(el('li','尚未保存回放；可在本場結算後取得，或匯入已下載的檔案。'));
  }
  async function run(fn:()=>Promise<void>|void){if(working)return;working=true;sync();try{await fn();}catch(e){status.textContent=e instanceof Error?e.message:'回放操作失敗。';panel.open=true;}finally{working=false;sync();}}
  function sync(){
    const room=getClient()?.room,meta=room?.replay;
    resultHelp.textContent=!room?.capabilities?.replay?'目前服務未提供賽事回放；已下載的回放仍可從下方匯入。':meta?.ready?`伺服器已保存 ${time(meta.recordedMs)} 軌跡${meta.truncated?'，超過錄製上限的尾段未包含':''}。請在再戰或離房前取得。`:'比賽結束後才可取得回放。';
    fetchButton.disabled=working||getClient()?.status!=='connected'||room?.phase!=='results'||!room.capabilities?.replay||!meta?.ready;
    const active=!!room&&['racing','countdown'].includes(room.phase);playButton.disabled=working||!current||active;saveButton.disabled=working||!current||active;downloadButton.disabled=working||!current;importButton.disabled=working;if(active)cancelReplacement?.();
    if(active&&viewer){viewer.close();status.textContent='房間已準備起跑，回放已關閉。';}
  }
  fetchButton.addEventListener('click',()=>void run(async()=>{status.textContent='正在從伺服器取得本場回放…';panel.open=true;const client=getClient();if(!client)throw Error('尚未連線。');const replay=await client.downloadReplay();setCurrent(replay);status.textContent='回放已取得，可播放、保存或下載；尚未自動保存。';}));
  playButton.addEventListener('click',()=>void run(async()=>{if(current)await openReplay(current);}));
  saveButton.addEventListener('click',()=>void run(async()=>{if(!current)return;const value=current;let saved=await library.saveSelected(value);if(saved==='full'||saved==='changed'){const choice=await chooseReplacement(value);if(!choice){status.textContent='已取消保存，既有回放完整保留。';return;}saved=await library.saveSelected(value,choice);}if(saved==='changed'||saved==='full')throw Error('另一個頁面已變更回放庫，未替換任何場次；請重新按保存並確認。');if(saved!=='saved')throw Error('無法保存到瀏覽器，可能是空間不足或儲存被封鎖；既有回放保留，仍可下載目前回放。');await refresh();status.textContent='已保存到本機回放庫。';}));
  downloadButton.addEventListener('click',()=>void run(()=>{if(current)download(current);}));
  importButton.addEventListener('click',()=>file.click());
  file.addEventListener('change',()=>void run(async()=>{const chosen=file.files?.[0];file.value='';if(!chosen)return;if(chosen.size>REPLAY_MAX_CHARS)throw Error('回放檔太大，上限為 8 MB。');setCurrent(decodeMultiplayerReplay(await chosen.text()));status.textContent='回放檔驗證通過，可播放或保存；尚未寫入本機回放庫。';}));
  async function openReplay(value:MultiplayerReplay){
    const replay=parseMultiplayerReplay(value);if(!replay)throw Error('回放資料不相容。');
    if(['racing','countdown'].includes(getClient()?.room?.phase??''))throw Error('請先完成或離開目前比賽，再播放回放。');
    viewer?.close();const priorFocus=document.activeElement as HTMLElement|null,overlay=el('section'),canvas=el('div'),controls=el('div'),title=el('h2','多人賽事回放'),loadStatus=el('p','正在準備回放賽道…'),timeline=el('input'),timelineLabel=el('label','播放位置'),timestamp=el('output'),actions=el('div'),toggle=button('播放','mp-replay-toggle'),back=button('−5 秒','mp-replay-back'),forward=button('＋5 秒','mp-replay-forward'),close=button('關閉回放','mp-replay-close'),camera=button('切換鏡頭','mp-replay-camera'),speed=el('select'),driver=el('select'),speedLabel=el('label','播放速度'),driverLabel=el('label','跟隨車手');
    overlay.className='nexus-replay-overlay';overlay.id='mp-replay-viewer';overlay.tabIndex=-1;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','mp-replay-viewer-title');title.id='mp-replay-viewer-title';canvas.className='nexus-replay-canvas';controls.className='nexus-replay-controls';actions.className='nexus-replay-actions';loadStatus.setAttribute('role','status');timeline.type='range';timeline.id='mp-replay-timeline';timeline.min='0';timeline.max=String(replay.recordedMs);timeline.step='1';timeline.value='0';timeline.setAttribute('aria-label','回放播放位置');speed.id='mp-replay-speed';driver.id='mp-replay-driver';
    for(const s of[.25,.5,1,2,4]){const o=el('option',`${s} 倍`);o.value=String(s);speed.append(o);}speed.value='1';
    for(const d of replay.drivers){const o=el('option',d.name);o.value=d.id;driver.append(o);}
    timelineLabel.append(timeline,timestamp);speedLabel.append(speed);driverLabel.append(driver);actions.append(toggle,back,forward,speedLabel,driverLabel,camera,close);controls.append(title,el('p',describe(replay)),loadStatus,timelineLabel,actions);overlay.append(canvas,controls);document.body.append(overlay);close.focus();
    const review=el('details'),reviewTitle=el('summary','事件檢討與本機書籤'),reviewHelp=el('p',replay.schema>=2?'接觸、超車、交棒、道具與新版車損／旗號來自伺服器實際事件；點選播放事件前後3秒。接觸紀錄未判定肇責。':'這是 v1 回放，未錄製事件；仍可自由播放與加入本機書籤。'),eventList=el('ol'),bookmarkList=el('ol'),bookmarkLabel=el('label','書籤名稱（可留白）'),bookmarkName=el('input'),addBookmark=button('在此加入書籤','mp-replay-bookmark'),bookmarkStatus=el('p'),eventFilter=el('select'),filterLabel=el('label','事件類型');
    review.id='mp-replay-review';review.className='summit-replay-review';eventList.id='mp-replay-events';bookmarkList.id='mp-replay-bookmarks';bookmarkName.maxLength=40;bookmarkName.id='mp-replay-bookmark-name';bookmarkLabel.append(bookmarkName);bookmarkStatus.setAttribute('role','status');const labels:Record<string,string>={damage:'車損',flag:'黃旗／藍旗',boundary:'界線警告',collision:'車輛接觸',wall:'護牆接觸',overtake:'超車',handoff:'交棒',item:'道具',pit:'進站',weather:'天候',lap:'有效圈',finish:'完賽',session:'賽事階段'};for(const [value,label]of[['all','全部事件'],...Object.entries(labels)]){const o=el('option',label);o.value=value;eventFilter.append(o);}eventFilter.id='mp-replay-event-filter';filterLabel.append(eventFilter);review.append(reviewTitle,reviewHelp,filterLabel,eventList,bookmarkLabel,addBookmark,bookmarkStatus,bookmarkList);controls.append(review);
    let photo:VoyagerPhoto|null=null;let closed=false,scene:MultiplayerScene|null=null,playing=false,at=0,ready=false,lastAt=performance.now(),segmentEnd:number|null=null;
    const closeView=()=>{if(closed)return;closed=true;playing=false;notes?.dispose();photo?.close();scene?.dispose();overlay.remove();if(viewer?.close===closeView)viewer=null;priorFocus?.focus();};
    const seek=(value:number)=>{at=Math.max(0,Math.min(replay.recordedMs,value));timeline.value=String(at);timestamp.value=`${time(at)} / ${time(replay.recordedMs)}`;if(at>=replay.recordedMs){playing=false;toggle.textContent='重播';}};
    const renderBookmarks=()=>{bookmarkList.replaceChildren();for(const mark of bookmarks.list(replay.id)){const li=el('li'),go=button(`${time(mark.at)} · ${mark.label}`),remove=button('刪除');go.onclick=()=>{notes.stop();segmentEnd=null;playing=false;toggle.textContent='播放';seek(mark.at);};remove.onclick=()=>{bookmarks.remove(replay.id,mark.id);renderBookmarks();};li.append(go,remove);bookmarkList.append(li);}if(!bookmarkList.children.length)bookmarkList.append(el('li','尚無本機書籤。'));bookmarkStatus.textContent=bookmarks.error||'書籤只存於這個瀏覽器，最多20場、每場64筆，不會寫入回放檔。';};
    const renderEvents=()=>{eventList.replaceChildren();for(const event of replay.events??[]){if(eventFilter.value!=='all'&&event.type!==eventFilter.value)continue;const li=el('li'),go=button(`${time(event.at)} · ${labels[event.type]}${event.actors.length?` · ${event.actors.map(id=>replay.drivers.find(d=>d.id===id)?.name??'車手').join('／')}`:''} · ${event.detail}`);go.onclick=()=>{if(!ready)return;notes?.stop();seek(Math.max(0,event.at-3000));segmentEnd=Math.min(replay.recordedMs,event.at+3000);playing=true;toggle.textContent='暫停';};li.append(go);eventList.append(li);}if(!eventList.children.length)eventList.append(el('li','這個篩選沒有已錄製事件。'));};
    eventFilter.onchange=renderEvents;addBookmark.onclick=()=>{try{bookmarks.add(replay.id,replay.recordedMs,at,bookmarkName.value);bookmarkName.value='';renderBookmarks();}catch(e){bookmarkStatus.textContent=e instanceof Error?e.message:'無法加入書籤。';}};renderEvents();renderBookmarks();
    const notes=mountReplayNotes({host:controls,replay,bookmarks,at:()=>at,seek,play:()=>{if(!ready)return;segmentEnd=null;playing=true;toggle.textContent='暫停';},refresh:renderBookmarks,alive:()=>!closed,ready:()=>ready});
    viewer={close:closeView,seek,get at(){return at;},get ready(){return ready;}};
    close.addEventListener('click',closeView);timeline.addEventListener('input',()=>{notes.stop();segmentEnd=null;seek(Number(timeline.value));});back.addEventListener('click',()=>{notes.stop();segmentEnd=null;seek(at-5000);});forward.addEventListener('click',()=>{notes.stop();segmentEnd=null;seek(at+5000);});camera.addEventListener('click',()=>scene?.toggleCamera());
    toggle.addEventListener('click',()=>{if(!ready)return;if(at>=replay.recordedMs)seek(0);playing=!playing;toggle.textContent=playing?'暫停':'播放';});
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();closeView();}if(event.key==='Tab'){const focusable=[...controls.querySelectorAll<HTMLElement>('button,select,input')].filter(n=>!n.hasAttribute('disabled'));const index=focusable.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&index<=0){event.preventDefault();focusable.at(-1)?.focus();}else if(!event.shiftKey&&index===focusable.length-1){event.preventDefault();focusable[0]?.focus();}}});
    try{
      const {MultiplayerScene}=await import('./multiplayer-scene');if(closed)return;
      scene=new MultiplayerScene(canvas);scene.setQuality('economy');
      photo=new VoyagerPhoto({camera:scene.camera,subject:()=>scene!.replayPhotoSubject(),canOpen:()=>ready&&!closed,begin:()=>{const was=playing;playing=false;toggle.textContent='播放';return()=>{if(!closed){playing=was;lastAt=performance.now();toggle.textContent=playing?'暫停':'播放';}};},capture:()=>{scene!.renderer.render(scene!.scene,scene!.camera);return scene!.renderer.domElement;}});
      scene.replayPhotoFrame=()=>photo?.frame();
      const photoButton=button('照片模式','voyager-mp-replay-photo');actions.insertBefore(photoButton,close);photoButton.onclick=()=>photo?.open();scene.onContextLost=()=>{playing=false;ready=false;loadStatus.textContent='3D 畫面已中斷，請關閉回放後重新播放。';};
      const loaded=await scene.prepareMap({trackId:replay.trackId,trackStamp:replay.trackStamp,trackRevision:0},text=>{if(!closed)loadStatus.textContent=text;});
      if(closed)return;if(!loaded)throw Error('回放賽道尚未就緒，請關閉後重試。');
      if(Math.abs(scene.track.length-replay.trackLength)>.01||replay.frames.some(f=>f.cars.some(c=>c[5]>=scene!.track.N)))throw Error('回放路線資料與目前賽道不一致。');
      ready=true;loadStatus.textContent=`5 Hz 權威軌跡，畫面以插值播放${replay.truncated?'；這是前 12 分鐘的部分回放，未包含尾段':''}。`;seek(0);
      scene.renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min(.1,Math.max(0,(now-lastAt)/1000));lastAt=now;if(closed||document.hidden)return;if(playing){seek(Math.min(segmentEnd??replay.recordedMs,advanceReplayLoop(at,dt*1000*Number(speed.value),notes.loop,replay.recordedMs)));if(segmentEnd!==null&&at>=segmentEnd){playing=false;segmentEnd=null;toggle.textContent='播放';}}scene!.presentReplay(replayRoomAt(replay,at),driver.value,dt);});
    }catch(e){closeView();throw e;}
  }
  getClient()?.subscribe(sync);panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});sync();void refresh();
  return{get current(){return current;},get active(){return!!viewer;},get ready(){return viewer?.ready??false;},get at(){return viewer?.at??0;},seek(at:number){viewer?.seek(at);},play:openReplay};
}
