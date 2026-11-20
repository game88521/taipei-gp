import { Input, type ControlAction } from './input';
import { groundH } from './citydata';
import { ROAD_Y } from './surface';
import { landmarkId } from './player-progress';
import type { Landmark } from './decor';
import type { Router } from './router';
import type { Save } from './save';
import { DrivingSchool, SCHOOL, SCHOOL_IDS, newHorizonCity, recordSchool, unlockAppearance, explorationThemes, claimTheme, defaultAppearance, DECALS, RIMS, type SchoolId, type CarAppearance } from './horizon-city-models';

interface Options {
  cityHost: HTMLElement; passport: HTMLElement; garage: HTMLElement; save: Save;
  landmarks(): Landmark[]; router(): Router | null; selectedCar(): string;
  persist(): void; notify(s: string): void; schoolOpen(): void; schoolClose(): void;
  canOpen(): boolean; navigate(l: Landmark, current: () => boolean): Promise<boolean>; appearance(id: string, value: CarAppearance): void;
  challengeWon(): boolean; controlHint(action: ControlAction): string;
}
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text='') => {const e=document.createElement(tag);e.textContent=text;return e;};
const button=(id:string,text:string)=>{const b=make('button',text);b.id=id;b.type='button';b.className='ghost-btn';return b;};
const medalText={bronze:'🥉銅牌',silver:'🥈銀牌',gold:'🥇金牌'};
export function mountHorizonCity(o: Options) {
  const data=()=>o.save.horizonCity??=newHorizonCity();
  const school=new DrivingSchool(); let opened=false, paused=false, stopped=false, generation=0, last=0, accumulated=0;
  const section=make('section');section.id='horizon-school-entry';section.append(make('h2','互動駕校'),make('p','獨立練習場：真實駕駛、四課獎牌。使用統一轎車，不耗修車費，不改正式紀錄／錢包／賽季。成績只解鎖外觀。'));
  const schoolRecords=make('p');schoolRecords.id='school-records';section.append(schoolRecords);
  for(const id of SCHOOL_IDS){const b=button(`school-open-${id}`,SCHOOL[id].title);b.onclick=()=>openSchool(id);section.append(b);}o.cityHost.append(section);
  const overlay=make('div');overlay.id='horizon-school';overlay.className='overlay hidden';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','school-title');
  const card=make('div');card.className='card wide';const title=make('h1'),help=make('p'),status=make('p'),canvas=make('canvas');title.id='school-title';help.id='school-help';status.id='school-status';status.setAttribute('role','status');canvas.id='school-canvas';canvas.width=640;canvas.height=380;canvas.tabIndex=0;canvas.setAttribute('aria-label','駕校俯視練習場，使用目前駕駛按鍵或下方觸控按鈕');
  const controls=make('div');controls.className='school-controls';const left=button('school-left','左轉'),right=button('school-right','右轉'),gas=button('school-gas','油門'),brake=button('school-brake','煞車／倒車'),pad=make('div'),dot=make('span');pad.hidden=true;pad.append(dot);controls.append(left,right,brake,gas,pad);
  const pause=button('school-pause','暫停'),retry=button('school-retry','重新練習'),close=button('school-close','離開駕校');
  card.append(title,help,canvas,status,controls,pause,retry,close);overlay.append(card);document.body.append(overlay);
  const input=new Input(pad,dot,brake,gas,left,right);input.isDriving=()=>opened&&!paused&&school.active&&!document.hidden;
  function refreshRewards(persist=true){const added=unlockAppearance(data(),o.challengeWon());if(added.length&&persist)o.persist();return added;}
  function refreshSchool(){schoolRecords.textContent=SCHOOL_IDS.map(id=>`${SCHOOL[id].title}：${data().school[id]?`${medalText[data().school[id]!.medal]} ${data().school[id]!.score}分`:'未完成'}`).join('｜');}
  function openSchool(id:SchoolId){if(!o.canOpen()||!opened&&(!o.cityHost.getClientRects().length||!!o.cityHost.closest('.hidden')))return;generation++;o.schoolOpen();opened=true;paused=false;school.start(id);input.release();overlay.classList.remove('hidden');title.textContent=SCHOOL[id].title;pause.textContent='暫停';last=0;accumulated=0;refreshHelp();canvas.focus();}
  function closeSchool(){if(!opened)return false;generation++;opened=false;paused=false;school.stop();input.release();overlay.classList.add('hidden');last=0;accumulated=0;refreshSchool();o.schoolClose();return true;}
  function setPaused(value:boolean){if(!opened||!school.active)return;paused=value;input.release();last=0;accumulated=0;pause.textContent=value?'繼續練習':'暫停';if(!value)canvas.focus();}
  function refreshHelp(){const text=`${SCHOOL[school.id].text} 油門：${o.controlHint('throttle')}；煞車／倒車：${o.controlHint('brake')}；轉向：${o.controlHint('left')}／${o.controlHint('right')}。下方按鈕支援多指；真手把需先回中立。`;if(help.textContent!==text)help.textContent=text;}
  pause.onclick=()=>setPaused(!paused);retry.onclick=()=>{openSchool(school.id);pause.textContent='暫停';};close.onclick=closeSchool;
  function step(dt:number){if(!opened||paused||document.hidden||!school.active)return;school.step(dt,input.read());const result=school.consume();if(result){input.release();if(result.success){recordSchool(data(),school.id,result.score);const rewards=refreshRewards(false);o.persist();o.notify(`${SCHOOL[school.id].title} ${medalText[result.medal!]}${rewards.length?'，獲得新外觀':''}`);}refreshSchool();renderAppearance();}}
  function draw(){refreshHelp();const g=canvas.getContext('2d')!;g.fillStyle='#101a26';g.fillRect(0,0,640,380);const c=school.car,scale=school.id==='park'?7:school.id==='smooth'?2.2:3.2,originZ=school.id==='park'?-9:school.id==='smooth'?70:45;
    const x=(v:number)=>320+v*scale,z=(v:number)=>190-(v-originZ)*scale;
    g.fillStyle='#273644';g.fillRect(x(-14),0,28*scale,380);g.strokeStyle='#93a0ac';g.setLineDash([10,10]);g.beginPath();g.moveTo(x(0),0);g.lineTo(x(0),380);g.stroke();g.setLineDash([]);
    const box=(a:number,b:number,w:number,l:number,color:string)=>{g.fillStyle=color;g.fillRect(x(a-w/2),z(b+l/2),w*scale,l*scale);};
    if(school.id==='brake')box(0,55,7,10,'#248459');if(school.id==='park')box(0,-18,4,7,'#248459');if(school.id==='smooth'){box(0,65,10,70,'#18577b');box(0,130,8,20,'#248459');}
    for(const [i,gate]of school.gates.entries()){g.strokeStyle=i<school.next?'#647688':'#58f5a6';g.lineWidth=3;g.beginPath();g.moveTo(x(gate.x-2.2),z(gate.z));g.lineTo(x(gate.x+2.2),z(gate.z));g.stroke();g.fillStyle='#ff9b4e';for(const cx of[gate.x-3.3,gate.x+3.3]){g.beginPath();g.arc(x(cx),z(gate.z),4,0,Math.PI*2);g.fill();}g.fillStyle='white';g.fillText(String(i+1),x(gate.x),z(gate.z)-8);}
    g.save();g.translate(x(c.x),z(c.z));g.rotate(-c.h);g.fillStyle='#ffdc75';g.fillRect(-.9*scale,-2.3*scale,1.8*scale,4.6*scale);g.fillStyle='#0c2232';g.fillRect(-.6*scale,-1.6*scale,1.2*scale,.9*scale);g.restore();
    g.fillStyle='white';g.font='15px sans-serif';g.fillText(`↑ 前進方向　${Math.round(c.v*3.6)} km/h　${school.elapsed.toFixed(1)}秒`,16,24);
    const r=school.result;status.textContent=r?`${r.success?`${medalText[r.medal!]} ${r.score}分`:'尚未通過'}：${r.reason}（${r.elapsed.toFixed(1)}秒）。可立即重試。`:paused?'已暫停，按繼續才計時。':`${SCHOOL[school.id].text} ${school.id==='slalom'?`已過${school.next}/4門`:`位置${c.z.toFixed(1)}m`}／停穩${Math.min(1,school.hold).toFixed(1)}秒`;
  }
  function frame(time:number){if(stopped)return;if(opened){if(last&&school.active&&!paused&&!document.hidden){accumulated+=Math.min(.15,(time-last)/1000);while(accumulated>=1/120){step(1/120);accumulated-=1/120;}}last=time;draw();}else last=0;requestAnimationFrame(frame);}requestAnimationFrame(frame);
  const suspend=()=>{generation++;setPaused(true);};addEventListener('blur',suspend);document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});addEventListener('pagehide',e=>{suspend();if(!e.persisted){stopped=true;school.stop();}input.release();});addEventListener('gp-controls-updated',refreshHelp);

  const themesHost=make('section');themesHost.id='horizon-themes';o.passport.insertBefore(themesHost,o.passport.querySelector('#passport-list'));
  let themeBusy=false;
  let cachedMarks:Landmark[]|null=null,cachedRouter:Router|null=null,cachedThemes:ReturnType<typeof explorationThemes>=[];
  function themes(){const router=o.router(),marks=o.landmarks();if(router===cachedRouter&&marks===cachedMarks)return cachedThemes;cachedRouter=router;cachedMarks=marks;return cachedThemes=explorationThemes(marks,l=>{if(!router)return false;const y=groundH(l.x,l.z);const route=router.route(l.x,l.z,l.x,l.z,y,y);return!!route&&Math.hypot(route.path[0][0]-l.x,route.path[0][1]-l.z)<=Math.max(20,Math.min(l.r,65))&&Math.abs(route.ys[0]-y)<1.5;});}
  function renderThemes(){themesHost.replaceChildren(make('h2','主題探索與區域徽章'),make('p','沿用探索護照的已造訪地標；只列真道路可達、地面能認領的目標。不清除舊進度，完成後明確領取一次外觀徽章。'));
    const list=themes(),seen=new Set(o.save.progress?.visited??[]);if(!list.length)themesHost.append(make('p','城市道路尚未載入，或目前沒有足夠的可達地標。'));
    for(const theme of list){const row=make('details'),done=theme.marks.filter(l=>seen.has(landmarkId(l))).length;row.id=`horizon-${theme.id.replace(':','-')}`;row.append(make('summary',`${theme.title} ${done}/${theme.marks.length}${data().badges.includes(theme.id)?' ✓已領徽章':''}`));
      for(const l of theme.marks){const b=button('',`${seen.has(landmarkId(l))?'✓':'○'} ${l.nm} · 地面／導航`);b.disabled=themeBusy;b.onclick=async()=>{if(themeBusy)return;const token=++generation;themeBusy=true;const current=()=>token===generation&&!document.hidden&&o.passport.getClientRects().length>0;try{const ok=await o.navigate(l,current);if(!current())return;if(!ok)o.notify('請先完成或保存目前任務，再導航探索。');}finally{themeBusy=false;}};row.append(b);}
      const claim=button(`theme-claim-${theme.id.replace(':','-')}`,'領取主題徽章');claim.disabled=done!==theme.marks.length||data().badges.includes(theme.id);claim.onclick=()=>{if(claimTheme(data(),theme,o.save.progress?.visited??[])){o.persist();o.notify(`獲得${theme.title}徽章與探索外觀`);renderThemes();renderAppearance();}};row.append(claim);themesHost.append(row);
    }
  }
  const appearanceHost=make('section');appearanceHost.id='horizon-appearance';o.garage.append(appearanceHost);
  function renderAppearance(){refreshRewards();appearanceHost.replaceChildren(make('h3','車號、貼花與輪框'),make('p','全部車款保持免費，以下只改外觀。完成任一駕校解鎖條紋／銀框；四課金牌解鎖箭羽／金框；探索徽章解鎖波紋／青框；GP情境通關解鎖紫框。'));
    const id=o.selectedCar(),a=data().appearance[id]??defaultAppearance(),number=make('input');number.id='appearance-number';number.type='text';number.inputMode='numeric';number.maxLength=2;number.value=a.number;number.setAttribute('aria-label','車號，0至99或留白');
    const decal=make('select'),rim=make('select');decal.id='appearance-decal';rim.id='appearance-rim';decal.setAttribute('aria-label','車身貼花');rim.setAttribute('aria-label','輪框配色');const names:Record<string,string>={none:'無貼花',stripes:'雙線條紋',wave:'水岸波紋',chevron:'箭羽圖案',original:'原輪框',silver:'銀色',gold:'金色',cyan:'青色',violet:'紫色'};
    for(const [host,values,selected]of [[decal,DECALS,a.decal],[rim,RIMS,a.rim]] as const){for(const value of values){const opt=make('option',`${names[value]}${!['none','original'].includes(value)&&!data().unlocked.includes(value)?' 🔒':''}`);opt.value=value;opt.disabled=!['none','original'].includes(value)&&!data().unlocked.includes(value);host.append(opt);}host.value=selected;}
    const apply=button('appearance-apply','套用外觀'),reset=button('appearance-reset','恢復原外觀'),message=make('p');message.id='appearance-status';message.setAttribute('role','status');
    apply.onclick=()=>{if(id!==o.selectedCar()){renderAppearance();return;}if(!/^\d{0,2}$/.test(number.value)){message.textContent='車號只能輸入0～99或留白。';return;}const next={number:number.value,decal:decal.value as CarAppearance['decal'],rim:rim.value as CarAppearance['rim']};if(next.decal!=='none'&&!data().unlocked.includes(next.decal)||next.rim!=='original'&&!data().unlocked.includes(next.rim))return;data().appearance[id]=next;o.appearance(id,next);o.persist();message.textContent='已套用；性能與烤漆保持原設定。';};
    reset.onclick=()=>{if(id!==o.selectedCar())return;data().appearance[id]=defaultAppearance();o.appearance(id,data().appearance[id]);o.persist();renderAppearance();};appearanceHost.append(make('label','車號（留白可移除）'),number,decal,rim,apply,reset,message);
  }
  refreshSchool();renderThemes();renderAppearance();
  return{school,input,get opened(){return opened;},get paused(){return paused;},openSchool,closeSchool,step,refreshRewards,renderThemes,renderAppearance,themeLandmarks:()=>themes().flatMap(t=>t.marks.map(l=>({...l}))),refresh(){refreshSchool();renderThemes();renderAppearance();},invalidate(){generation++;if(opened)setPaused(true);}};
}
