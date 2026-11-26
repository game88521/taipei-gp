import {mountMeridianLazyDirector as mountAuroraDirector} from './meridian-lazy-tools';
/** Rex <game88521@gmail.com>. Isolated presentation on the existing real city scene; no WebSocket, FreeCar update, or progress writes. */
import * as THREE from 'three';
import {CITY_REPLAY_MAX_CHARS,parseCityReplay,decodeCityReplay,cityReplayFrameAt,cityReplayCrownAt,type CityReplayArchive,type CityReplayWeather,type CityReplayPose} from '../shared/frontier-city-replay';
import {vehicleById} from './vehicles';
import type {CarModel} from './carModel';
import {buildDutyVehicle} from './summit-duty-vehicle';
import {createFriendName,FRIEND_SLOT_COLORS,type FriendNameVisual} from './frontier-friends';
import {createCrownVisual} from './frontier-crown-visual';
import './frontier-city-replay.css';

export interface FrontierCityReplayOptions{
 canvas?:HTMLCanvasElement;capture?():HTMLCanvasElement;scene:THREE.Scene;host:HTMLElement;canOpen():boolean;prepare(isCurrent:()=>boolean):Promise<boolean>;
 begin(archive:CityReplayArchive):void;end():void;notify(text:string):void;
}
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
const button=(id:string,text:string,fn:()=>void)=>{const node=make('button',text);node.type='button';node.id=id;node.onclick=fn;return node;};
const time=(at:number)=>Math.floor(at/60000)+':'+(at%60000/1000).toFixed(1).padStart(4,'0');
const MODES:Record<CityReplayArchive['mode'],string>={cruise:'自由巡航',chase:'警匪追逐',tandem:'雙人追走',convoy:'車隊巡遊',ctf:'2對2城市搶旗',crown:'王冠爭奪',rescue:'合作救援',rally:'定速拉力'};
const EVENTS:Record<string,string>={contact:'車輛接觸',capture:'攔截完成',stage:'作業階段',operation:'已接受作業',disconnect:'斷線',reconnect:'續接',finish:'結束',round:'換段',weather:'天候變更',recover:'返集合區',join:'加入',leave:'離席',crown:'王冠歸屬'};
const DETAILS:Record<string,string>={'safety-front':'前方警示區完成','safety-rear':'後方警示區完成','safety-clear':'警戒員確認淨空','dispatch-brief':'調度確認事故簡報','dispatch-depot':'調度確認返站接收','crew-cover':'斷線職責暫代',approach:'前往現場',warning:'警示',positioning:'平台定位',winch:'絞盤',securing:'固定',returning:'返站',unloading:'卸載',complete:'完成',position:'確認定位',wind:'收絞盤',unwind:'放絞盤',secure:'確認固定',unload:'卸載',stop:'停止',driver:'司機',technician:'協助者',dry:'晴天',rain:'雨天',night:'夜間',first:'第一段',second:'第二段',captured:'被捕',escaped:'逃脫',left:'離席',timeout:'時間到',removed:'移出', 'server-stall':'服務停頓','crown-start':'本場起始持冠','crown-transfer':'真車碰撞轉移','crown-return':'退出後重新發還'};
function releaseCar(root:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();root.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(m);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.removeFromParent();}
interface ActorVisual{vehicle:string;root:THREE.Group;model:CarModel|null;truck:ReturnType<typeof buildDutyVehicle>|null;name:FriendNameVisual|null;dispose():void}

export function mountFrontierCityReplay(o:FrontierCityReplayOptions){
 let disposed=false,active=false,busy=false,begun=false,generation=0,archive:CityReplayArchive|null=null,at=0,playing=false,speed=1,follow=0,overhead=false,side=false,snapCamera=true,lastAt=0,segmentEnd:number|null=null,currentWeather:CityReplayWeather='dry',priorFocus:HTMLElement|null=null,lastText=-Infinity;
 const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.5,5000),graphics=new THREE.Group();graphics.name='frontier-city-replay-actors';graphics.visible=false;o.scene.add(graphics);
 const visuals=new Map<number,ActorVisual>();let incident:CarModel|null=null;
 const crownVisual=createCrownVisual();graphics.add(crownVisual.root);
 const file=make('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.id='frontier-city-replay-file';
 const launch=button('frontier-city-replay-import','匯入城市匿名回放',()=>{if(!o.canOpen()){o.notify('請先離開目前房間或結束玩法，再播放城市回放。');return;}file.click();});o.host.append(launch,file);
 const overlay=make('section');overlay.id='frontier-city-replay-viewer';overlay.className='frontier-city-replay hidden';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','frontier-city-replay-title');
 const sceneLabel=make('p','真城市場景 · 匿名權威軌跡');sceneLabel.className='frontier-city-replay-scene-label';
 const controls=make('div');controls.className='frontier-city-replay-controls';const title=make('h2','城市匿名回放');title.id='frontier-city-replay-title';const status=make('p');status.id='frontier-city-replay-status';status.setAttribute('role','status');
 const note=make('p','每200毫秒權威採樣，以插值重現。未記錄姓名、玩家識別碼、房碼或續接憑證；接觸事件不判定肇責。');note.className='frontier-city-replay-note';
 const timeline=make('input');timeline.type='range';timeline.min='0';timeline.max='0';timeline.step='1';timeline.value='0';timeline.id='frontier-city-replay-timeline';timeline.setAttribute('aria-label','城市回放播放位置');const stamp=make('output');stamp.id='frontier-city-replay-time';const timelineLabel=make('label','播放位置 ');timelineLabel.append(timeline,stamp);
 const speedControl=make('select');speedControl.id='frontier-city-replay-speed';for(const n of[.25,.5,1,2]){const option=make('option',n+'倍');option.value=String(n);speedControl.append(option);}speedControl.value='1';const speedLabel=make('label','速度 ');speedLabel.append(speedControl);
 const actorControl=make('select');actorControl.id='frontier-city-replay-actor';const actorLabel=make('label','跟隨車手 ');actorLabel.append(actorControl);
 const toggle=button('frontier-city-replay-toggle','播放',()=>{if(!active||!archive)return;if(at>=archive.recordedMs)seek(0);segmentEnd=null;playing=!playing;updateText(true);});
 const back=button('frontier-city-replay-back','−5秒',()=>{playing=false;segmentEnd=null;seek(at-5000);}),forward=button('frontier-city-replay-forward','＋5秒',()=>{playing=false;segmentEnd=null;seek(at+5000);});
 const cameraButton=button('frontier-city-replay-camera','切換俯視／跟車',()=>{director.stop();side=false;overhead=!overhead;snapCamera=true;});
 const download=button('frontier-city-replay-export','匯出匿名回放',()=>{if(!archive)return;const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'})),a=make('a');a.href=url;a.download='taipei-city-anonymous-replay.json';document.body.append(a);a.click();a.remove();const timer=setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);timers.delete(timer);},1000);urls.add(url);timers.add(timer);});
 const close=button('frontier-city-replay-close','關閉回放',stop),actions=make('div');actions.className='frontier-city-replay-actions';actions.append(toggle,back,forward,speedLabel,actorLabel,cameraButton,download,close);
 const review=make('details');review.id='frontier-city-replay-events';review.append(make('summary','已錄製事件'));const eventList=make('ol');review.append(eventList);controls.append(title,status,note,timelineLabel,actions,review);overlay.append(sceneLabel,controls);document.body.append(overlay);
 const director=mountAuroraDirector({capture:o.capture,pause:()=>{playing=false;segmentEnd=null;lastDirectorClip=-1;},now:()=>at});controls.append(director.panel);overlay.append(director.caption);let lastDirectorClip=-1;
 const urls=new Set<string>(),timers=new Set<ReturnType<typeof setTimeout>>();
 function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);
 function clear(){crownVisual.root.visible=false;for(const v of visuals.values())v.dispose();visuals.clear();if(incident){releaseCar(incident.root);incident=null;}}
 function stop(){if(disposed)return;director.setArchive(0,0);const hadSession=active||busy||begun;++generation;playing=false;busy=false;active=false;segmentEnd=null;archive=null;graphics.visible=false;clear();overlay.classList.add('hidden');if(begun){begun=false;o.end();}if(hadSession){if(priorFocus?.isConnected)priorFocus.focus({preventScroll:true});else launch.focus({preventScroll:true});}priorFocus=null;}
 function seek(value:number){if(!archive)return;director.stop();at=Math.max(0,Math.min(archive.recordedMs,Number.isFinite(value)?value:0));lastAt=at;snapCamera=true;if(at>=archive.recordedMs)playing=false;updateText(true);}
 function updateText(force=false){if(!archive)return;const now=performance.now();if(!force&&now-lastText<100)return;lastText=now;timeline.value=String(at);stamp.value=time(at)+' / '+time(archive.recordedMs);toggle.textContent=at>=archive.recordedMs?'重播':playing?'暫停':'播放';const frame=cityReplayFrameAt(archive,at);status.textContent=MODES[archive.mode]+' · '+(archive.truncated?'部分回放；部分尾段或事件未包含':'完整錄製區間')+' · '+archive.frames.length+'筆採樣'+(frame.duty?' · 完整度'+Math.round(frame.duty.integrity)+'% · '+(DETAILS[frame.duty.stage]??'作業'):'');}
 function createVisual(p:CityReplayPose):ActorVisual{
  const truck=p.vehicle==='rescue'?buildDutyVehicle('rescue'):null,model=truck?null:vehicleById(p.vehicle).build(),root=truck?.root??model!.root;root.name='frontier-city-replay-actor-'+p.actor;graphics.add(root);
  const slot=archive!.actors[p.actor].slot,name=createFriendName({label:p.vehicle==='rescue'?'救援平板車':'車手'+(p.actor+1),slot,color:FRIEND_SLOT_COLORS[slot]});if(name)graphics.add(name.sprite);
  let released=false;return{vehicle:p.vehicle,root,model,truck,name,dispose(){if(released)return;released=true;name?.dispose();if(truck)truck.dispose();else releaseCar(root);}};
 }
 function frame(dt:number){
  if(!active||!archive||disposed)return;const delta=document.hidden?0:Math.min(.1,Math.max(0,Number.isFinite(dt)?dt:0));if(playing){at=Math.min(segmentEnd??archive.recordedMs,at+delta*1000*speed);if(at>=archive.recordedMs||segmentEnd!==null&&at>=segmentEnd){playing=false;segmentEnd=null;}}
  const directed=director.frame(delta);if(directed){at=directed.at;follow=directed.clip.actor;overhead=directed.clip.camera==='overhead';side=directed.clip.camera==='side';if(lastDirectorClip!==directed.index){snapCamera=true;lastDirectorClip=directed.index;}}
  const view=cityReplayFrameAt(archive,at);currentWeather=view.weather;const wanted=new Set(view.cars.map(p=>p.actor));for(const[id,v]of visuals)if(!wanted.has(id)){v.dispose();visuals.delete(id);}
  const travel=Math.abs(at-lastAt)>1000?0:(at-lastAt)/1000;lastAt=at;
  const crownActor=cityReplayCrownAt(archive,at),holder=view.cars.find(p=>p.actor===crownActor&&p.visible);crownVisual.root.visible=!!holder;if(holder){crownVisual.root.position.set(holder.x,holder.y+3.25,holder.z);crownVisual.root.rotation.y+=delta*.8;}
  for(const p of view.cars){let visual=visuals.get(p.actor);if(visual?.vehicle!==p.vehicle){visual?.dispose();visual=createVisual(p);visuals.set(p.actor,visual);}const root=visual.root;root.position.set(p.x,p.y,p.z);root.rotation.set(-p.pitch,p.h,p.roll,'YXZ');root.visible=p.visible;const velocity=Math.hypot(p.vx,p.vz);if(visual.truck){visual.truck.load.visible=!!view.duty?.loaded;visual.truck.frame(travel,velocity,p.steer,false);}else if(visual.model){for(const wheel of visual.model.steer)wheel.rotation.y=-p.steer*.48;for(const wheel of visual.model.spin)wheel.rotation.x+=travel*velocity/.32;}
   if(visual.name){visual.name.sprite.visible=p.visible;visual.name.sprite.position.set(p.x,p.y+(visual.truck?3.8:3.1),p.z);}}
  const duty=view.duty;if(duty?.incident&&!duty.loaded){if(!incident){incident=vehicleById('sedan').build();incident.root.name='frontier-city-replay-incident';graphics.add(incident.root);}incident.root.position.set(duty.incident.x,duty.incident.y,duty.incident.z);incident.root.rotation.y=duty.incident.h;incident.root.visible=true;}else if(incident)incident.root.visible=false;
  const target=view.cars.find(p=>p.actor===follow&&p.visible)??view.cars.find(p=>p.visible)??view.cars[0];if(target){const position=overhead?new THREE.Vector3(target.x,target.y+65,target.z+.1):side?new THREE.Vector3(target.x+Math.cos(target.h)*17,target.y+4,target.z-Math.sin(target.h)*17):new THREE.Vector3(target.x-Math.sin(target.h)*14,target.y+6,target.z-Math.cos(target.h)*14),look=new THREE.Vector3(target.x+Math.sin(target.h)*4,target.y+1.4,target.z+Math.cos(target.h)*4);camera.position.lerp(position,snapCamera?1:Math.min(1,delta*7));camera.lookAt(look);snapCamera=false;}
  updateText();director.capture();
 }
 async function open(value:CityReplayArchive):Promise<boolean>{
  if(disposed||busy)return false;if(active)stop();if(!o.canOpen()){o.notify('請先離開目前房間或結束玩法，再播放城市回放。');return false;}
  const parsed=parseCityReplay(value);if(!parsed){o.notify('城市回放內容或版本不相容，未開始播放。');return false;}
  const ticket=++generation,current=()=>!disposed&&ticket===generation;busy=true;priorFocus=document.activeElement as HTMLElement;overlay.classList.remove('hidden');status.textContent='正在準備真城市場景…';close.textContent='取消載入';for(const e of[toggle,back,forward,speedControl,actorControl,cameraButton,download,timeline])e.disabled=true;close.focus();
  try{if(!await o.prepare(current)||!current()){if(current()){stop();o.notify('城市尚未就緒，請稍後重試。');}return false;}archive=parsed;director.setArchive(parsed.recordedMs,parsed.actors.length,parsed.events);lastDirectorClip=-1;side=false;at=0;lastAt=0;playing=false;speed=1;speedControl.value='1';follow=parsed.frames[0].cars[0].actor;overhead=false;snapCamera=true;segmentEnd=null;currentWeather=parsed.weather;timeline.max=String(parsed.recordedMs);actorControl.replaceChildren();for(let i=0;i<parsed.actors.length;i++){const option=make('option',(parsed.source==='duty'?'救援平板車':'車手'+(i+1))+' · 席位'+(parsed.actors[i].slot+1));option.value=String(i);actorControl.append(option);}actorControl.value=String(follow);
   eventList.replaceChildren();for(const event of parsed.events){const row=make('li'),go=button('',time(event.at)+' · '+EVENTS[event.type]+(event.actors.length?' · '+event.actors.map(a=>'車手'+(a+1)).join('／'):'')+(event.detail?' · '+(DETAILS[event.detail]??event.detail):''),()=>{seek(Math.max(0,event.at-3000));segmentEnd=Math.min(parsed.recordedMs,event.at+3000);playing=true;updateText(true);});row.append(go,button('','加入導演剪輯',()=>director.add(event.at)));eventList.append(row);}if(!parsed.events.length)eventList.append(make('li','這段錄製區間沒有事件。'));
   busy=false;active=true;begun=true;graphics.visible=true;close.textContent='關閉回放';for(const e of[toggle,back,forward,speedControl,actorControl,cameraButton,download,timeline])e.disabled=false;resize();o.begin(parsed);frame(0);updateText(true);close.focus();return true;
  }catch(e){if(current()){stop();o.notify(e instanceof Error?e.message:'城市回放無法開啟。');}return false;}
 }
 timeline.oninput=()=>{playing=false;segmentEnd=null;seek(Number(timeline.value));};speedControl.onchange=()=>speed=Number(speedControl.value);actorControl.onchange=()=>{follow=Number(actorControl.value);snapCamera=true;};
 overlay.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stop();return;}if(event.key==='Tab'){const list=[...controls.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(e=>e.getClientRects().length),index=list.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&index<=0){event.preventDefault();list.at(-1)?.focus();}else if(!event.shiftKey&&index===list.length-1){event.preventDefault();list[0]?.focus();}}};
 file.onchange=()=>{const selected=file.files?.[0];file.value='';if(!selected)return;const ticket=generation;void(async()=>{try{if(selected.size>CITY_REPLAY_MAX_CHARS)throw Error('城市回放檔太大，上限為8 MB。');const parsed=decodeCityReplay(await selected.text());if(!disposed&&ticket===generation)await open(parsed);}catch(e){o.notify(e instanceof Error?e.message:'無法讀取城市回放檔。');}})();};
 return{get active(){return active;},get busy(){return busy;},get weather(){return currentWeather;},get at(){return at;},get playing(){return playing;},get archive(){return archive;},director,camera,open,frame,seek,stop,dispose(){if(disposed)return;stop();director.dispose();disposed=true;removeEventListener('resize',resize);for(const timer of timers)clearTimeout(timer);timers.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();crownVisual.dispose();graphics.removeFromParent();overlay.remove();launch.remove();file.remove();}};
}
