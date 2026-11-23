import * as THREE from 'three';
import type {CityData,Collider} from './citydata';
import {Router} from './router';
import {FreeCar,type CarSpec,type FreeCarGeometry} from './freecar';
import {RESCUE_SPEC,RESCUE_GEOMETRY,RESCUE_LOADED_SPEC} from './summit-city-duty';
import {buildDutyVehicle} from './summit-duty-vehicle';
import {vehicleById} from './vehicles';
import {CREW_DEPOT,CREW_STAGE_LABEL,CREW_MAX_VIEWERS,type CrewInput,type CrewPoint,type CrewRoom} from '../shared/expedition-duty';
import {ExpeditionDutyClient,dutyEndpoint} from './expedition-duty-client';
import {buildRally,RegularityRun} from './expedition-duty-rally';
import {RALLY_KEY,CREW_RECORDS,DUTY_RECORD_BYTES,parseRallyRecords,parseCrewRecords,writeDutyRecords,type RallyResult,type CrewRecord} from './expedition-duty-records';
import type {CityReplayArchive} from '../shared/frontier-city-replay';
import {DUTY_INCIDENTS,DUTY_DIFFICULTIES,type DutyIncidentId} from '../shared/frontier-duty-missions';
import {DUTY_MISSION_RECORDS_KEY,parseDutyMissionRecords,dutyMissionRecord} from './frontier-duty-records';
import {FrontierRecords} from './frontier-records';
import {TEAM_ROLE_LABELS} from '../shared/aurora-duty';
import {mountAuroraDutyTeam} from './aurora-duty-ui';
import {AURORA_DUTY_RECORDS_KEY,parseAuroraDutyRecords,auroraDutyRecord} from './aurora-duty-records';
import {mountRoomInvite} from './aurora-invite-ui';
import './expedition-duty.css';
export interface ExpeditionDutyOptions{
 scene:THREE.Scene;host:HTMLElement;isCity:boolean;car:FreeCar;city():CityData|null;collider():Collider|null;
 input():CrewInput;canEnter():boolean;enter(pose:{x:number;z:number;y:number;h:number},current:()=>boolean):Promise<boolean>;
 open():void;close():void;left():void;relocate(pose:{x:number;z:number;y:number;h:number}):void;
 isDriving():boolean;navigate(point:{x:number;z:number;y:number;name:string}):void;notify(text:string):void;drive(dt:number):number;
 replay?(archive:CityReplayArchive):void|Promise<void>;
}
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const button=(id:string,text:string,fn:()=>void)=>{const b=make('button',text);b.type='button';b.id=id;b.className='ghost-btn';b.onclick=fn;return b;};
const idle=():CrewInput=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
export function mountExpeditionDuty(o:ExpeditionDutyOptions){
 let teamTools:ReturnType<typeof mountAuroraDutyTeam>|null=null,inviteTools:ReturnType<typeof mountRoomInvite>|null=null;
 const launch=button('btn-expedition-duty','🛟 2～4人合作救援／定速拉力',()=>{const selected=launch.dataset.dutyMode;delete launch.dataset.dutyMode;open(selected==='rally'?'rally':'crew');});o.host.append(launch);
 const overlay=make('div');overlay.id='expedition-duty-overlay';overlay.className='overlay hidden';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 const card=make('div');card.className='card wide expedition-duty-card';const title=make('h1','合作救援與定速拉力');title.id='expedition-duty-title';overlay.setAttribute('aria-labelledby',title.id);
 const info=make('p');info.id='expedition-duty-status';info.setAttribute('role','status');
 const lead=make('p','合作救援：2～4位玩家共用一輛平板車，司機駕駛定位、技師操作絞盤，第三位警戒員布置前後警示及確認淨空，第四位調度員負責事故簡報與返站接收；原雙人流程仍保留。定速拉力：按目標時間通過四個計時點，早到／晚到同樣計罰，超過50km/h另加罰分。');
 const name=make('input');name.id='expedition-duty-name';name.value='救援隊員';name.maxLength=20;name.setAttribute('autocomplete','nickname');const nameLabel=make('label','隊員暱稱 ');nameLabel.append(name);
 const code=make('input');code.id='expedition-duty-code';code.maxLength=6;code.autocapitalize='characters';const codeLabel=make('label','六碼救援房間 ');codeLabel.append(code);
 const create=button('expedition-duty-create','建立救援房（司機）',()=>void join('create'));
 const enter=button('expedition-duty-join','加入救援房（技師／警戒／調度）',()=>void join('join'));
 const watch=button('expedition-duty-watch','以觀眾加入（不占隊員席）',()=>void join('watch'));
 const checkService=button('expedition-duty-check-service','重新檢查觀戰／回放服務',()=>{if(entered||busy)return;client.disconnect();void client.connect().catch(e=>{message=String(e instanceof Error?e.message:e);render();});});
 const watchCount=make('p');watchCount.id='expedition-duty-watch-count';
 const resume=button('expedition-duty-resume','續接原救援席位',()=>void join('resume'));
 const reconnectStatus=make('p');reconnectStatus.id='expedition-duty-reconnect-status';reconnectStatus.setAttribute('role','status');
 const reconnectCancel=button('expedition-duty-reconnect-cancel','取消自動續接',()=>{release();client.cancelReconnect();});
 const reconnectConfirm=button('expedition-duty-reconnect-confirm','確認恢復操控／作業',()=>{release();o.open();if(client.confirmReconnect()){message='席位已恢復，請重新按下操控或作業按鈕。';closePanel();}});
 const ready=button('expedition-duty-ready','準備',()=>{const r=client.room,p=r?.players.find(p=>p.id===client.selfId);client.command('ready',{ready:!p?.ready});});
 const start=button('expedition-duty-start','全員準備後出勤',()=>client.command('start'));
 const again=button('expedition-duty-again','重新接班',()=>client.command('again'));
 const cancelMission=button('expedition-duty-cancel-mission','取消本次救援',()=>client.command('cancel'));
 const missionBox=make('fieldset'),missionTitle=make('legend','本場事故與難度（房主大廳設定）'),missionDifficulty=make('select'),missionChoices=new Map<DutyIncidentId,HTMLInputElement>(),missionNote=make('p');missionBox.id='frontier-duty-settings';missionDifficulty.id='frontier-duty-difficulty';
 const difficultyLabel=make('label','停靠難度 ');difficultyLabel.append(missionDifficulty);for(const [id,value]of Object.entries(DUTY_DIFFICULTIES)){const option=make('option',value.label);option.value=id;missionDifficulty.append(option);}missionDifficulty.value='standard';missionBox.append(missionTitle,difficultyLabel);
 for(const incident of DUTY_INCIDENTS){const input=make('input');input.type='checkbox';input.id='frontier-duty-case-'+incident.id;input.checked=incident.id==='xinan';const label=make('label');label.append(input,document.createTextNode(incident.name));missionBox.append(label);missionChoices.set(incident.id,input);}
 const applyMission=button('frontier-duty-apply','套用事故與難度',()=>{release();client.command('mission-settings',{settings:{incidents:[...missionChoices].filter(([,input])=>input.checked).map(([id])=>id),difficulty:missionDifficulty.value}});});
 const swapRoles=button('frontier-duty-swap','輪換下場全隊職責',()=>{release();client.command('swap-roles');});missionBox.append(missionNote,applyMission,swapRoles);
 let missionSelectionKey='';
 const replayDownload=button('expedition-duty-replay-download','下載本場匿名回放',()=>void getReplay(false));
 const replayPlay=button('expedition-duty-replay-play','離房並播放本場回放',()=>void getReplay(true));
 const replayCancel=button('expedition-duty-replay-cancel','取消回放下載',()=>client.cancelReplay());
 const replayInfo=make('p');replayInfo.id='expedition-duty-replay-info';
 const roster=make('p');roster.id='expedition-duty-roster';const invite=make('input');invite.id='expedition-duty-invite';invite.readOnly=true;invite.setAttribute('aria-label','合作救援邀請網址');
 const copy=button('expedition-duty-copy','複製邀請',()=>{if(!client.room)return;const u=new URL('/',location.href);u.searchParams.set('crew',client.room.code);invite.value=u.href;void navigator.clipboard?.writeText(u.href).catch(()=>{invite.focus();invite.select();});});
 const average=make('select');average.id='expedition-rally-average';for(const n of [28,36,42]){const opt=make('option',n+' km/h平均目標');opt.value=String(n);average.append(opt);}average.value='36';
 const rally=button('expedition-rally-start','開始單人定速拉力',()=>void startRally());
 const cancel=button('expedition-duty-cancel','取消等待／結束還車',stop);
 const closeButton=button('expedition-duty-close','返回駕駛／選單',closePanel);
 const records=make('details'),summary=make('summary','本機獨立紀錄（各30場）'),history=make('div');records.append(summary,history);
 const exportButton=button('expedition-duty-export','下載目前紀錄',()=>download());
 card.append(title,lead,nameLabel,codeLabel,create,enter,watch,checkService,watchCount,resume,reconnectStatus,reconnectCancel,reconnectConfirm,missionBox,ready,start,again,cancelMission,roster,invite,copy,replayInfo,replayDownload,replayPlay,replayCancel,make('h2','單人定速拉力'),average,rally,info,records,exportButton,cancel,closeButton);overlay.append(card);document.body.append(overlay);
 const hud=make('section');hud.id='expedition-duty-hud';hud.className='expedition-duty-hud';hud.hidden=true;
 const line=make('p');line.id='expedition-duty-hud-status';line.setAttribute('role','status');const detail=make('p');detail.id='expedition-duty-readout';
 const confirm=button('expedition-duty-confirm','司機確認定位／固定',()=>client.command('action'));
 let heldKind='stop',pull=0,side=0;
 function release(){heldKind='stop';pull=side=0;teamTools?.release();if(client.room){client.input(idle());client.operate('stop');}}
 function hold(id:string,text:string,kind:string,p=0,s=0){const b=button(id,text,()=>{});b.addEventListener('pointerdown',e=>{if(b.disabled)return;e.preventDefault();b.setPointerCapture?.(e.pointerId);heldKind=kind;pull=p;side=s;});for(const t of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(t,release);b.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();heldKind=kind;pull=p;side=s;}});b.addEventListener('keyup',release);return b;}
 const warning=hold('expedition-duty-warning','長按設置警示','warning'),unload=hold('expedition-duty-unload','長按卸載','unload');
 const left=hold('expedition-duty-winch-left','絞盤左修','winch',0,-1),right=hold('expedition-duty-winch-right','絞盤右修','winch',0,1),wind=hold('expedition-duty-winch-pull','收絞盤','winch',1,0),unwind=hold('expedition-duty-winch-release','放絞盤','winch',-1,0);
 const nav=button('expedition-duty-nav','導航目前目標',()=>{const n=target();if(n)o.navigate(n);});
 const follow=button('expedition-duty-follow','跟隨平板車',()=>{const pose=client.room?.pose;if(pose)o.relocate(pose);});follow.hidden=true;
 const inspect=button('expedition-duty-inspect','房間／紀錄',open),exit=button('expedition-duty-exit','結束還車',stop);
 hud.append(line,detail,confirm,warning,left,right,wind,unwind,unload,nav,follow,inspect,exit);document.body.append(hud);
 let storage:Storage|null=null;try{storage=sessionStorage;}catch{}
 const client=new ExpeditionDutyClient(dutyEndpoint(String(import.meta.env.VITE_MULTIPLAYER_URL??''),location),changed,storage);
 teamTools=mountAuroraDutyTeam(client);card.insertBefore(teamTools.root,missionBox);hud.insertBefore(teamTools.hud,nav);
 inviteTools=mountRoomInvite(card,()=>{const r=client.room;return r?{kind:'crew',code:r.code,label:'合作道路救援',players:r.players.length,capacity:r.team?4:2}:null;},'aurora-duty-invite');
 let missionStorage:Storage|null=null;try{missionStorage=localStorage;}catch{}const missionResults=new FrontierRecords(DUTY_MISSION_RECORDS_KEY,parseDutyMissionRecords,missionStorage);let missionSaved='';
 const teamResults=new FrontierRecords(AURORA_DUTY_RECORDS_KEY,parseAuroraDutyRecords,missionStorage);let teamSaved='';
 let entered=false,kind:'crew'|'watch'|'rally'|null=null,busy=false,generation=0,disposed=false,run:RegularityRun|null=null,accumulator=0,lastUi=0;
 let visualPose:{x:number;z:number;y:number;h:number}|null=null,visualRun='';
 let prior:{spec:CarSpec;geometry:FreeCarGeometry|undefined}|null=null;
 let truck:ReturnType<typeof buildDutyVehicle>|null=null,sedan:ReturnType<ReturnType<typeof vehicleById>['build']>|null=null,incident:ReturnType<ReturnType<typeof vehicleById>['build']>|null=null;
 let message='',lastFocus:HTMLElement|null=null,recordsKey='',rallyRecords:RallyResult[]=[],crewRecords:CrewRecord[]=[],rallyWritable=true,crewWritable=true;
 let replayArchive:CityReplayArchive|null=null,replayKey='',recoveryPanel=false;
 let rallyRaw:string|null=null,crewRaw:string|null=null;
 function decodeRaw(raw:string){if(raw.length>DUTY_RECORD_BYTES||new TextEncoder().encode(raw).length>DUTY_RECORD_BYTES)throw Error('紀錄超過上限');return JSON.parse(raw);}
 try{rallyRaw=localStorage.getItem(RALLY_KEY);if(rallyRaw!==null){const p=parseRallyRecords(decodeRaw(rallyRaw));if(p)rallyRecords=p;else rallyWritable=false;}}catch{rallyWritable=false;}
 try{crewRaw=localStorage.getItem(CREW_RECORDS);if(crewRaw!==null){const p=parseCrewRecords(decodeRaw(crewRaw));if(p)crewRecords=p;else crewWritable=false;}}catch{crewWritable=false;}
 const graphics=new THREE.Group();graphics.name='expedition-duty-only';o.scene.add(graphics);
 const marker=new THREE.Mesh(new THREE.ConeGeometry(.8,2,3).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({color:'#82eac4'}));graphics.add(marker);marker.visible=false;
 function isOpen(){return !overlay.classList.contains('hidden');}
 function open(selected?:'crew'|'rally'){if(!o.isCity){location.search=selected==='rally'?'?regularity=1':'?crew=1';return;}if(!entered&&!o.canEnter()){o.notify('先結束目前模式，再進入救援或拉力。');return;}release();lastFocus=document.activeElement as HTMLElement;o.open();overlay.classList.remove('hidden');render();(selected==='rally'?average:closeButton).focus();}
 function closePanel(){if(entered&&kind==='crew'&&client.controlGated){message='請先確認恢復操控，或結束還車。';render();return;}overlay.classList.add('hidden');release();o.close();lastFocus?.focus();}
 function disposeModel(root:THREE.Object3D|null){if(!root)return;const gs=new Set<THREE.BufferGeometry>(),ms=new Set<THREE.Material>();root.traverse(v=>{if(v instanceof THREE.Mesh){gs.add(v.geometry);for(const m of Array.isArray(v.material)?v.material:[v.material])ms.add(m);}});for(const g of gs)g.dispose();for(const m of ms)m.dispose();root.removeFromParent();}
 function clearModels(){visualPose=null;visualRun='';truck?.dispose();truck=null;disposeModel(sedan?.root??null);sedan=null;disposeModel(incident?.root??null);incident=null;}
 async function prepare(mode:'crew'|'watch'|'rally',pose:{x:number;z:number;y:number;h:number},g:number){
  if(!entered){if(!o.canEnter())throw Error('請先結束目前模式');prior={spec:o.car.spec,geometry:o.car.geometry};entered=true;kind=mode;if(!await o.enter(pose,()=>g===generation&&!disposed))throw Error('城市尚未就緒或已取消');}
  if(g!==generation||disposed)throw Error('已取消');kind=mode;clearModels();if(mode!=='rally'){truck=buildDutyVehicle('rescue');graphics.add(truck.root);incident=vehicleById('sedan').build();graphics.add(incident.root);o.car.spec={...RESCUE_SPEC};o.car.geometry={...RESCUE_GEOMETRY};}else{sedan=vehicleById('sedan').build();graphics.add(sedan.root);o.car.spec={...vehicleById('sedan').spec};o.car.geometry=undefined;}
 }
 async function join(action:'create'|'join'|'resume'|'watch'){
  if(busy||run||client.room||disposed)return;const g=++generation;busy=true;message='正在準備合作救援…';render();
  try{await prepare(action==='watch'?'watch':'crew',CREW_DEPOT,g);await client.join(action,name.value.trim(),code.value.trim().toUpperCase());if(g!==generation)return;const p=(client.room as CrewRoom|null)?.pose;if(p)o.relocate(p);message=action==='watch'?'觀眾唯讀跟隨平板車，不可操作勤務，也不保存隊員戰績。':action==='resume'?'席位已恢復，請確認後再操控或作業。':'司機與協助者各按準備；房主再出勤。';if(action!=='resume')closePanel();}
  catch(e){if(g===generation){message=String(e instanceof Error?e.message:e);if(action!=='resume')stop(false);}}finally{if(g===generation){busy=false;render();}}
 }
 async function startRally(){if(busy||entered||disposed)return;const g=++generation;busy=true;render();
  try{const data=o.city();if(!data)throw Error('城市尚未載入，請稍候再試');const plan=buildRally(new Router(data),Number(average.value) as 28|36|42);if(!plan)throw Error('無法建立定速拉力路線');await prepare('rally',plan.start,g);o.relocate(plan.start);run=new RegularityRun(plan,o.car);message='三秒後開始，目標是準時通過計時點。';closePanel();}
  catch(e){if(g===generation){message=String(e instanceof Error?e.message:e);stop(false);}}finally{if(g===generation){busy=false;render();}}
 }
 function stop(clearMessage=true){const wasEntered=entered;generation++;busy=false;entered=false;recoveryPanel=false;run=null;kind=null;release();client.leave();accumulator=0;clearModels();marker.visible=false;if(prior){o.car.spec=prior.spec;o.car.geometry=prior.geometry;prior=null;}if(wasEntered)o.left();if(clearMessage)message='已結束，原車輛與駕駛狀態已還原。';hud.hidden=true;render();}
 function target():CrewPoint|null{const r=client.room;if(r){const g=r.route.gates[r.next];return g?{...g,h:0,name:'救援沿路檢查點 '+(r.next+1)}:r.route.target;}if(run){const p=run.target;return {...p,h:0,name:'拉力檢查點 '+(run.next+1)};}return null;}
 function persist(which:'crew'|'rally'){try{if(which==='rally'&&rallyWritable){const result=writeDutyRecords(localStorage,RALLY_KEY,rallyRaw,rallyRecords,parseRallyRecords);if(result.ok)rallyRaw=result.raw;else rallyWritable=false;}if(which==='crew'&&crewWritable){const result=writeDutyRecords(localStorage,CREW_RECORDS,crewRaw,crewRecords,parseCrewRecords);if(result.ok)crewRaw=result.raw;else crewWritable=false;}}catch{if(which==='rally')rallyWritable=false;else crewWritable=false;}}
 function changed(){if(disposed)return;const r=client.room,key=client.replay?.ready?client.replay.key:'';if(replayKey!==key){replayArchive=null;replayKey=key;}
  if(kind==='crew'&&entered&&client.controlGated){recoveryPanel=true;release();if(!isOpen()){lastFocus=document.activeElement as HTMLElement;o.open();overlay.classList.remove('hidden');}}else if(recoveryPanel&&kind==='crew'&&entered&&r&&client.status==='connected'&&!busy){recoveryPanel=false;closePanel();}
  if(kind==='watch'&&entered&&!busy&&!r&&(client.watchEnded||client.status==='closed')){message=client.message||'觀戰已結束';stop(false);closePanel();return;}
  if(r){if(kind==='crew'&&!client.spectating&&r.players.some(p=>p.id===client.selfId)&&r.stage==='complete'){
    if(!r.team&&r.mission.settings.incidents.length===1&&!crewRecords.some(s=>s.id===r.runId)){crewRecords.unshift({id:r.runId,at:Date.now(),seconds:r.elapsed,integrity:r.integrity,crew:r.players.map(p=>p.name+' · '+TEAM_ROLE_LABELS[p.role]) as [string,string]});crewRecords=crewRecords.slice(0,30);persist('crew');}
    if(!r.team&&missionSaved!==r.runId){missionSaved=r.runId;const record=dutyMissionRecord(r);if(record)missionResults.add(record);}
    if(r.team&&teamSaved!==r.runId){teamSaved=r.runId;const record=auroraDutyRecord(r);if(record)teamResults.add(record);}
   }code.value=r.code;}render();
 }
 function render(){if(disposed)return;const r=client.room,p=r?.players.find(p=>p.id===client.selfId);info.textContent=client.message||message||'救援支援2～4位玩家；定速拉力可以單人離線遊玩。';teamTools?.render();inviteTools?.update();
  missionBox.hidden=!r;const editable=!!r&&r.phase==='lobby'&&r.hostId===client.selfId&&!client.spectating&&!client.controlGated;missionDifficulty.disabled=applyMission.disabled=!editable;for(const input of missionChoices.values())input.disabled=!editable;swapRoles.disabled=!editable||(r?.players.length??0)<2||!!r.players.some(p=>!p.connected);
  const selectionKey=r?`${r.runId}:${r.revision}`:'';if(selectionKey!==missionSelectionKey){missionSelectionKey=selectionKey;if(r){missionDifficulty.value=r.mission.settings.difficulty;for(const[id,input]of missionChoices)input.checked=r.mission.settings.incidents.includes(id);}}
  missionNote.textContent=r?`依選單順序完成 ${r.mission.settings.incidents.length} 件救援，每件均須沿路出勤、完整作業、返站卸載後再出發；不切案傳送。每件最多30分鐘，總勤務依件數最多30～90分鐘。\n${DUTY_DIFFICULTIES[r.mission.settings.difficulty].label}：停靠半徑 ${DUTY_DIFFICULTIES[r.mission.settings.difficulty].radius}m，角度差小於 ${(DUTY_DIFFICULTIES[r.mission.settings.difficulty].angle*180/Math.PI).toFixed(1)}°，停穩 ${DUTY_DIFFICULTIES[r.mission.settings.difficulty].dwell} 秒。輪換職責不更換房主，全隊須重新準備。`:'';
  create.disabled=enter.disabled=busy||entered;checkService.disabled=busy||entered||client.status==='connecting';watch.disabled=busy||entered||client.capabilitiesKnown&&!client.supportsWatching;watch.textContent=client.capabilitiesKnown&&!client.supportsWatching?'救援服務需更新才能觀戰':client.capabilitiesKnown?'以觀眾加入（不占隊員席）':'連線確認並以觀眾加入';name.disabled=code.disabled=busy||entered;resume.disabled=busy||!client.resumable||!!run||client.spectating;ready.disabled=!r||r.phase!=='lobby'||client.spectating;start.disabled=!r||r.hostId!==client.selfId||r.phase!=='lobby'||r.players.length<2||r.paused||r.players.some(p=>!p.ready||!p.connected);again.disabled=!r||r.hostId!==client.selfId||r.phase!=='finished';cancelMission.disabled=!r||r.hostId!==client.selfId||r.phase==='lobby';rally.disabled=average.disabled=busy||entered;watchCount.textContent='觀眾 '+client.watchCount+'/'+CREW_MAX_VIEWERS+(client.spectating?' · 唯讀跟車，不占隊員席':'');
  ready.textContent=p?.ready?'取消準備':'準備';roster.textContent=r?'房間 '+r.code+' ｜ '+r.players.map(p=>p.name+'（'+TEAM_ROLE_LABELS[p.role]+'／'+(!p.connected?'斷線':p.ready?'已準備':'未準備')+'）').join('、'):'無救援房間';copy.disabled=!r;
  const recovery=client.reconnectState,retrying=recovery.phase==='waiting'||recovery.phase==='connecting',gated=client.controlGated&&kind==='crew';reconnectStatus.hidden=!gated;reconnectStatus.dataset.phase=recovery.phase;reconnectStatus.textContent=gated?(client.confirmPending?'正在等待伺服器確認，操控保持停止。':r&&client.status==='connected'&&!retrying?'席位已恢復，尚未恢復操控；請確認並重新按下操作。':retrying?'自動續接 '+recovery.attempts+'/3 · 剩餘 '+Math.ceil(recovery.remainingMs/1000)+' 秒\n'+recovery.reason:recovery.reason||client.message):'';reconnectCancel.hidden=!gated||!retrying;reconnectConfirm.hidden=!gated||!r||client.status!=='connected'||retrying;reconnectConfirm.disabled=busy||client.confirmPending;resume.disabled=resume.disabled||retrying;closeButton.disabled=gated;closeButton.textContent=gated?'確認後才能返回駕駛':'返回駕駛／選單';if(gated)for(const b of [ready,start,again,cancelMission])b.disabled=true;
  const replayReady=client.supportsReplay&&r?.phase==='finished'&&client.replay?.ready;replayDownload.disabled=!replayReady||client.replayBusy;replayPlay.disabled=!replayReady||client.replayBusy||!o.replay;replayCancel.hidden=!client.replayBusy;
  replayInfo.textContent=client.capabilitiesKnown&&!client.supportsReplay?'救援服務需更新才能提供匿名回放。':client.replayBusy?'正在逐塊取得匿名回放，可取消；離房或換場會清除未完成下載。':replayReady?'本場可下載及離線播放；不含暱稱、房碼或席位憑證。'+(client.replay?.truncated?'僅保留有界錄製區間，並非全場。':''):'勤務結束後提供匿名車況、絞盤與作業階段回放。';
  const key=JSON.stringify([rallyRecords,crewRecords,rallyWritable,crewWritable,missionResults.records,missionResults.error,teamResults.records,teamResults.error]);if(recordsKey!==key){recordsKey=key;history.replaceChildren();if(!rallyWritable||!crewWritable)history.append(make('p','部分舊紀錄無法讀取或儲存，原資料未覆寫；新紀錄僅保留本頁，請下載保存。'));if(missionResults.error)history.append(make('p',missionResults.error));if(teamResults.error)history.append(make('p',teamResults.error));for(const v of teamResults.records)history.append(make('p',v.crew.length+'人救援 · '+v.seconds.toFixed(1)+'秒 · 完整度'+v.integrity.toFixed(0)+'% · '+v.work.map(w=>TEAM_ROLE_LABELS[w.role]+' '+w.actions+'次').join('／')));for(const v of missionResults.records)history.append(make('p',`${DUTY_DIFFICULTIES[v.mission.settings.difficulty].label} · ${v.mission.completed.length}件完成 · ${v.seconds.toFixed(1)}秒 · 完整度${v.integrity.toFixed(0)}% · ${v.mission.completed.map(c=>DUTY_INCIDENTS.find(i=>i.id===c.incidentId)!.name+' '+c.seconds.toFixed(1)+'秒').join('／')}`));for(const v of rallyRecords)history.append(make('p',v.route+' · '+v.penalty.toFixed(2)+'罰分（超速'+v.speedPenalty.toFixed(2)+'）'));for(const v of crewRecords)history.append(make('p','合作救援 '+Math.round(v.seconds)+'秒 · 完整度'+v.integrity.toFixed(0)+'% · '+v.crew.join('／')));}
 }
 function download(){const current=client.room&&!client.spectating?dutyMissionRecord(client.room):null;const blob=new Blob([JSON.stringify({v:2,type:'expedition-duty-records',rally:rallyRecords,crew:crewRecords,missions:missionResults.records,team:teamResults.records,currentTeam:client.room&&!client.spectating?auroraDutyRecord(client.room):null,current},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='taipei-expedition-duty.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function getReplay(play:boolean){const g=generation,key=client.replay?.key;if(client.replayBusy||!key)return;try{const archive=replayArchive??await client.downloadReplay();if(disposed||g!==generation||client.replay?.key!==key)return;replayArchive=archive;if(play){if(!o.replay)throw Error('城市回放播放器尚未就緒');stop();closePanel();await o.replay(archive);}else{const blob=new Blob([JSON.stringify(archive)],{type:'application/json'}),url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='taipei-city-rescue-replay.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message='已下載本場匿名城市回放。';}}catch(e){if(g===generation)message=String(e instanceof Error?e.message:e);}finally{render();}}
 function step(dt:number){if(!entered||disposed)return;if(kind==='rally'&&run){if(run.phase==='running')o.drive(dt);run.step(dt);const result=run.result();if(result){rallyRecords.unshift(result);rallyRecords=rallyRecords.slice(0,30);persist('rally');o.notify('定速拉力完成：'+result.penalty.toFixed(2)+'罰分');render();}return;}
  teamTools?.step(dt,kind==='crew'&&o.isDriving()&&!isOpen()&&!document.hidden&&document.hasFocus());if(kind==='watch'||client.controlGated)return;
  const r=client.room;if(!r||client.status!=='connected'){o.car.vx=o.car.vz=o.car.w=0;return;}accumulator+=Math.max(0,Math.min(dt,.1));if(accumulator<.1)return;accumulator%=.1;
  const p=r.players.find(p=>p.id===client.selfId),focused=!document.hidden&&document.hasFocus(),controls=focused&&o.isDriving()&&!isOpen()?o.input():idle();
  if(client.roles.includes('driver'))client.input({...controls,active:focused&&o.isDriving()&&!isOpen()});
  else if(client.roles.includes('technician')){let k=heldKind,a=pull,b=side;if(!focused){k='stop';a=b=0;}if(r.stage==='winch'&&focused&&o.isDriving()&&!isOpen()&&(controls.throttle||controls.brake||Math.abs(controls.steer)>.1)){k='winch';a=(controls.throttle?1:0)-(controls.brake?1:0);b=controls.steer;}client.operate(k,a,b);}
 }
 function frame(dt:number){if(disposed)return;const visible=entered&&o.isDriving();graphics.visible=visible;hud.hidden=!visible||isOpen();const r=client.room,c=o.car;
  if((kind==='crew'||kind==='watch')&&r){const p=r.pose,key=r.runId+':'+r.revision;
   if(!visualPose||visualRun!==key||Math.hypot(p.x-visualPose.x,p.z-visualPose.z)>20){visualPose={x:p.x,z:p.z,y:p.y,h:p.h};visualRun=key;}
   else{const a=1-Math.exp(-14*Math.min(.1,Math.max(0,dt)));visualPose.x+=(p.x-visualPose.x)*a;visualPose.z+=(p.z-visualPose.z)*a;visualPose.y+=(p.y-visualPose.y)*a;visualPose.h+=Math.atan2(Math.sin(p.h-visualPose.h),Math.cos(p.h-visualPose.h))*a;}
   const v=visualPose;c.place(v.x,v.z,v.h,v.y);Object.assign(c,{y:v.y,vx:p.vx,vz:p.vz,steer:p.steer,pitch:p.pitch,roll:p.roll});const loaded=['returning','unloading','complete'].includes(r.stage);c.spec={...(loaded?RESCUE_LOADED_SPEC:RESCUE_SPEC)};if(truck){truck.load.visible=loaded;truck.root.position.set(c.x,c.y,c.z);truck.root.rotation.set(-c.pitch,c.h,c.roll,'YXZ');truck.frame(dt,c.v,c.steer,false);}if(incident){incident.root.visible=!loaded;const working=['winch','securing'].includes(r.stage),base=working?c:r.outbound.target,w=r.winch,along=-7+(working?w.along:0);incident.root.position.set(base.x+Math.sin(base.h)*along+Math.cos(base.h)*w.lateral,base.y+(working?w.along/4.2:0),base.z+Math.cos(base.h)*along-Math.sin(base.h)*w.lateral);incident.root.rotation.y=base.h;}}
  if(sedan){sedan.root.position.set(c.x,c.y,c.z);sedan.root.rotation.set(-c.pitch,c.h,c.roll,'YXZ');}
  const t=target();marker.visible=!!t;if(t)marker.position.set(t.x,t.y+3,t.z);
  lastUi+=dt;if(lastUi<.15)return;lastUi=0;
  const me=r?.players.find(p=>p.id===client.selfId);if(r){line.textContent='🛟 '+(client.spectating?'觀眾・唯讀跟車':client.roles.map(role=>TEAM_ROLE_LABELS[role]).join('／')||'等候職責')+' · 第'+(r.mission.caseIndex+1)+'/'+r.mission.settings.incidents.length+'件 · '+CREW_STAGE_LABEL[r.stage]+' · '+Math.floor(r.elapsed)+'秒'+(r.paused?' · 隊員未齊，安全暫停':'');
   const angle=Math.abs(Math.atan2(Math.sin(r.pose.h-r.route.target.h),Math.cos(r.pose.h-r.route.target.h)))*180/Math.PI;
   detail.textContent='檢查點 '+r.next+'/'+r.route.gates.length+' · 停穩 '+r.dwell.toFixed(1)+'/'+DUTY_DIFFICULTIES[r.mission.settings.difficulty].dwell+'秒 · 角度差 '+angle.toFixed(1)+'° · 完整度 '+r.integrity.toFixed(0)+'% · 作業 '+r.operation.toFixed(1)+'秒\n絞盤：收進 '+r.winch.along.toFixed(2)+'/4.20m、左右 '+r.winch.lateral.toFixed(2)+'m'+(r.winch.blocked?'；先修到±0.35m內':'')+(r.reason?'\n'+r.reason:'')+(client.message?'\n'+client.message:'');
  }else if(run){line.textContent='⏱ '+run.plan.name+' · '+(run.phase==='countdown'?Math.ceil(run.countdown)+'秒倒數':run.phase==='running'?run.elapsed.toFixed(1)+'秒':run.reason);detail.textContent='檢查點 '+run.next+'/'+run.plan.gates.length+' · 下個目標 '+run.target.due.toFixed(1)+'秒 · 總罰分 '+(run.penalty+run.speedPenalty).toFixed(2)+'（超速 '+run.speedPenalty.toFixed(2)+'）';}
  else if(entered){line.textContent='合作救援連線已停止';detail.textContent=client.message+' 請開房間面板續接，或結束還車。';}
  confirm.hidden=!client.roles.includes('driver')||!['positioning','securing'].includes(r?.stage??'');warning.hidden=!client.roles.includes('technician')||r?.stage!=='warning';unload.hidden=!client.roles.includes('technician')||r?.stage!=='unloading';for(const b of [left,right,wind,unwind])b.hidden=!client.roles.includes('technician')||r?.stage!=='winch';
  follow.hidden=!client.spectating;
 }
 const blur=()=>release();addEventListener('blur',blur);const visibility=()=>{if(document.hidden)release();};document.addEventListener('visibilitychange',visibility);
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePanel();}if(e.key==='Tab'){const items=[...card.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(e=>e.getClientRects().length),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
 const invited=new URLSearchParams(location.search).get('crew');if(invited&&/^[A-HJ-NP-Z2-9]{6}$/.test(invited.toUpperCase()))code.value=invited.toUpperCase();else code.value=client.rememberedCode;
 render();
 return{client,get active(){return entered;},get busy(){return busy;},get opened(){return isOpen();},get online(){return entered&&(kind==='crew'||kind==='watch');},get run(){return run;},get vehicleOverride(){return entered;},
  open,close:closePanel,stop,step,frame,navInfo(){const r=client.room;if(r)return{path:r.route.path,ys:r.route.ys,next:[target()!.x,target()!.z] as [number,number]};if(run)return{path:run.plan.path,ys:run.plan.ys,next:[run.target.x,run.target.z] as [number,number]};return null;},
  invalidate(){if(run)run.invalidate();else if(client.room)client.command('cancel');},
  dispose(){if(disposed)return;stop();disposed=true;client.dispose();teamTools?.dispose();inviteTools?.dispose();removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);marker.geometry.dispose();marker.material.dispose();graphics.removeFromParent();overlay.remove();hud.remove();launch.remove();}};
}
