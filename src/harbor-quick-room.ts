/** Rex <game88521@gmail.com>. Three deliberate steps, retaining the advanced UI. */
import {MULTIPLAYER_TRACKS} from '../shared/multiplayer-tracks.ts';
import {HARBOR_QUICK_MODES,HarborQuickRoomFlow,type HarborQuickDraft,type HarborQuickRoomDependencies} from '../shared/harbor-quick-room.ts';
import './harbor-quick-room.css';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const select=(id:string,rows:readonly(readonly[string,string])[])=>{const s=el('select');s.id=id;for(const[value,text]of rows){const o=el('option',text);o.value=value;s.append(o);}return s;};
const field=(text:string,input:HTMLElement)=>{const label=el('label');label.append(el('span',text),input);return label;};
export function mountHarborQuickRoom(host:HTMLElement,dependencies:HarborQuickRoomDependencies){
  const flow=new HarborQuickRoomFlow(dependencies),root=el('section');root.id='harbor-quick-room';root.className='harbor-quick-room';
  root.append(el('h2','三步快速開房'),el('p','先選玩法與地圖，核對房規後再建立。原本的建房與進階設定仍可使用。'));
  const launch=el('button','開始三步設定');launch.id='harbor-quick-open';launch.type='button';
  const wizard=el('section'),steps=el('ol'),heading=el('h3'),status=el('p'),availability=el('p');
  wizard.id='harbor-quick-wizard';steps.setAttribute('aria-label','開房步驟');heading.tabIndex=-1;heading.id='harbor-quick-heading';
  const stepItems=['選玩法','選地圖','核對房規'].map(t=>el('li',t));steps.append(...stepItems);wizard.append(steps,heading);
  availability.id='harbor-quick-availability';status.id='harbor-quick-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const panels=[el('fieldset'),el('fieldset'),el('fieldset')];panels.forEach((p,i)=>{p.id=`harbor-quick-step-${i+1}`;p.append(el('legend',['想玩什麼？','在哪一張地圖？','確認這次房間設定'][i]));wizard.append(p);});
  const mode=select('harbor-quick-mode',HARBOR_QUICK_MODES.map(m=>[m.id,m.name])),modeHelp=el('p');modeHelp.id='harbor-quick-mode-help';mode.setAttribute('aria-describedby',modeHelp.id);panels[0].append(field('玩法',mode),modeHelp);
  const track=select('harbor-quick-track',MULTIPLAYER_TRACKS.map(t=>[t.id,`${t.flag} ${t.name}`]));panels[1].append(field('比賽地圖',track),el('p','這一步只選擇草稿，不會切換目前賽道或建立房間。'));
  const humans=select('harbor-quick-humans',[['1','1 位真人'],['2','2 位真人'],['3','3 位真人'],['4','4 位真人']]),ai=select('harbor-quick-ai',[['0','不加入 AI'],['1','1 輛 AI'],['2','2 輛 AI'],['3','3 輛 AI']]);
  const laps=select('harbor-quick-laps',[['1','1 圈'],['3','3 圈'],['5','5 圈']]),duration=select('harbor-quick-duration',[['180','3 分鐘'],['300','5 分鐘']]),grace=select('harbor-quick-grace',[['30','30 秒'],['60','60 秒'],['120','120 秒']]);
  const weather=select('harbor-quick-weather',[['legacy','預設乾地'],['clear','固定晴天'],['rain','固定雨天'],['dry-rain','2 分鐘後轉雨']]),damage=el('input'),collisions=el('input');
  damage.type=collisions.type='checkbox';damage.id='harbor-quick-damage';collisions.id='harbor-quick-collisions';
  const grid=el('div');grid.className='harbor-quick-fields';const lapsField=field('比賽圈數',laps),durationField=field('限時長度',duration);
  grid.append(field('預計真人數',humans),field('AI 補位',ai),lapsField,durationField,field('完賽寬限',grace),field('天候',weather),field('開啟車損',damage),field('開啟車輛碰撞',collisions));
  const compatibility=el('p','AI、天候與車損僅搭配一般圈數競速。切換玩法會保留草稿，請先處理下方衝突。');compatibility.id='harbor-quick-compatibility';
  const reset=el('button','使用此玩法建議房規');reset.type='button';reset.id='harbor-quick-reset';
  const preview=el('div'),previewHeading=el('h4','建立前預覽'),lines=el('ul'),notes=el('div'),errors=el('ul');preview.id='harbor-quick-preview';errors.id='harbor-quick-errors';errors.setAttribute('aria-label','需要調整的設定');preview.append(previewHeading,lines,notes,errors);panels[2].append(grid,compatibility,reset,preview);
  const actions=el('div'),back=el('button','上一步'),next=el('button','下一步'),cancel=el('button','取消設定'),submit=el('button','確認建立房間');actions.className='harbor-quick-actions';
  for(const[b,id]of[[back,'back'],[next,'next'],[cancel,'cancel'],[submit,'create']]as const){b.type='button';b.id='harbor-quick-'+id;actions.append(b);}wizard.append(actions);root.append(launch,availability,wizard,status);host.append(root);
  const focusStep=()=>heading.focus();let renderKey='',previewKey='';
  function refresh(){
    const state=flow.state,d=flow.draft,draftKey=JSON.stringify(d),key=JSON.stringify([flow.opened,flow.step,flow.submitting,flow.message,state.hasRoom,state.busy,state.ready,draftKey]);
    // Snapshot traffic does not change a local draft. Preserve DOM nodes, focus
    // and screen-reader reading position until the visible view really changes.
    if(key===renderKey)return;renderKey=key;
    const p=flow.preview,locked=flow.submitting||state.busy;
    wizard.hidden=!flow.opened;launch.hidden=flow.opened;launch.disabled=state.hasRoom||state.busy||flow.submitting;
    availability.textContent=state.hasRoom?'你已在房間內，快速開房不會改動目前房規。':state.busy&&!flow.submitting?'正在處理其他房間操作。':!state.ready?'賽道準備中；可以先規劃，待就緒後再確認建立。':'';
    availability.hidden=!availability.textContent;if(status.textContent!==flow.message)status.textContent=flow.message;heading.textContent=`第 ${flow.step} 步：${['選玩法','選地圖','核對房規'][flow.step-1]}`;
    stepItems.forEach((e,i)=>{if(i+1===flow.step)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
    panels.forEach((e,i)=>{e.hidden=i+1!==flow.step;e.disabled=locked||state.hasRoom;});
    mode.value=d.mode;track.value=d.trackId;humans.value=String(d.plannedHumans);ai.value=String(d.ai);laps.value=String(d.laps);duration.value=String(d.durationSeconds);grace.value=String(d.finishGraceSeconds);weather.value=d.weather;damage.checked=d.damage;collisions.checked=d.mode==='time-trial'?false:d.collisions;
    modeHelp.textContent=HARBOR_QUICK_MODES.find(m=>m.id===d.mode)!.description;
    const special=d.mode!=='race';ai.disabled=weather.disabled=damage.disabled=locked||state.hasRoom||special;collisions.disabled=locked||state.hasRoom||d.mode==='time-trial';
    lapsField.hidden=d.mode==='time-trial';durationField.hidden=d.mode!=='time-trial';compatibility.hidden=!special;
    if(previewKey!==draftKey){previewKey=draftKey;lines.replaceChildren(...p.lines.map(t=>el('li',t)));notes.replaceChildren(...p.notes.map(t=>el('p',t)));errors.replaceChildren(...p.errors.map(t=>el('li',t)));}errors.hidden=!p.errors.length;
    reset.hidden=!p.errors.length;reset.disabled=locked||state.hasRoom;
    back.hidden=flow.step===1;next.hidden=flow.step===3;submit.hidden=flow.step!==3;
    back.disabled=next.disabled=locked||state.hasRoom;cancel.disabled=flow.submitting;
    submit.disabled=locked||state.hasRoom||!state.ready||!p.preset;submit.textContent=flow.submitting?'正在建立房間…':'確認建立房間';
  }
  function update(patch:Partial<HarborQuickDraft>){flow.update(patch);refresh();}
  launch.onclick=()=>{if(flow.open()){refresh();focusStep();}};back.onclick=()=>{if(flow.back()){refresh();focusStep();}};next.onclick=()=>{if(flow.next()){refresh();focusStep();}};cancel.onclick=()=>{if(flow.cancel()){refresh();launch.focus();}};
  mode.onchange=()=>update({mode:mode.value as HarborQuickDraft['mode']});track.onchange=()=>update({trackId:track.value});
  for(const[input,key]of[[humans,'plannedHumans'],[ai,'ai'],[laps,'laps'],[duration,'durationSeconds'],[grace,'finishGraceSeconds']]as const)input.onchange=()=>update({[key]:Number(input.value)}as Partial<HarborQuickDraft>);
  weather.onchange=()=>update({weather:weather.value as HarborQuickDraft['weather']});damage.onchange=()=>update({damage:damage.checked});collisions.onchange=()=>update({collisions:collisions.checked});reset.onclick=()=>{flow.resetRules();refresh();};
  submit.onclick=()=>{const pending=flow.submit();refresh();void pending.finally(()=>{refresh();if(flow.opened)status.focus();});};
  status.tabIndex=-1;root.addEventListener('keydown',event=>{if(event.key==='Escape'&&flow.opened&&!flow.submitting){event.preventDefault();event.stopPropagation();flow.cancel();refresh();launch.focus();}});
  refresh();
  return{refresh,dispose(){flow.dispose();root.remove();}};
}
