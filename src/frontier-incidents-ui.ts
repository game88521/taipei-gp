// Rex <game88521@gmail.com>. Original recorded samples; this tool never adjudicates a contact.
import type {MultiplayerReplay} from '../shared/nexus-replay';
import {analyzeReplayIncident,listReplayIncidents,INCIDENT_MAX_JSON_BYTES,type IncidentAnalysis,type IncidentIssue} from '../shared/frontier-incidents';
import './frontier-incidents.css';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const seconds=(ms:number)=>`${(ms/1000).toFixed(3)} 秒`;
const number=(value:number,digits=2)=>value.toFixed(digits);
const issueLabels:Record<IncidentIssue,string>={
 'missing-actors':'缺少接觸車手資料','unexpected-actors':'事件車手數量不符',
 'outside-recording':'目標時間超出錄製範圍','sample-too-far':'最近樣本距目標超過200ms',
 'frame-gap':'前後三秒內有超過400ms的採樣缺口','recording-truncated':'錄製已截短，尾段不在檔案中',
 'recording-start':'錄製起點前沒有資料','recording-end':'錄製終點後沒有資料','invalid-frame':'樣本資料無效',
};
export function mountFrontierIncidents(o:{host:HTMLElement;replay:MultiplayerReplay;ready():boolean;alive():boolean;playSegment(from:number,to:number):void}){
 const panel=node('details'),title=node('summary','接觸事實分析'),help=node('p','比較接觸前3秒、事件時刻與後3秒的最近原始權威樣本。不是畫面插值，也不是實際接觸步；不判定肇責，不新增處罰。'),label=node('label','接觸事件'),select=node('select'),facts=node('div'),status=node('p'),play=node('button','播放接觸前後3秒'),download=node('button','下載本事件事實 JSON');
 panel.id='frontier-incidents';panel.className='frontier-incidents';select.id='frontier-incident-event';label.htmlFor=select.id;play.id='frontier-incident-play';download.id='frontier-incident-download';facts.id='frontier-incident-facts';status.id='frontier-incident-status';status.setAttribute('role','status');play.type=download.type='button';
 const events=listReplayIncidents(o.replay);let disposed=false,current:IncidentAnalysis|null=null;
 for(const event of events){const option=node('option',`${seconds(event.at)} · ${event.type==='collision'?'車輛接觸':'護牆接觸'} · ${event.actors.map(id=>o.replay.drivers.find(d=>d.id===id)?.name??'未知車手').join('／')}`);option.value=String(event.eventIndex);select.append(option);}
 const actions=node('div');actions.className='frontier-incident-actions';actions.append(play,download);panel.append(title,help,label,select,facts,actions,status);o.host.append(panel);
 function sync(){const live=!disposed&&o.alive();select.disabled=!live||!events.length;download.disabled=!live||!current;play.disabled=!live||!current||!o.ready();}
 function render(){
  if(disposed||!o.alive())return;current=events.length?analyzeReplayIncident(o.replay,Number(select.value)):null;facts.replaceChildren();
  if(!current){status.textContent=o.replay.schema===1?'這是 v1 回放，沒有事件紀錄；不能由軌跡猜測接觸。':'這場回放沒有可分析的車輛或護牆接觸事件。';sync();return;}
  const value=current,names=new Map(value.actors.map(a=>[a.id,a.name]));
  facts.append(node('p',`事件原文：${value.event.detail}`),node('p',`採樣間隔200ms；錄製 ${seconds(value.source.recordedMs)}。${value.complete?'三個目標都有200ms內的原始樣本。':'資料不完整，請查看以下原因。'}`));
  for(const point of value.points){
   const card=node('section');card.className='frontier-incident-point';card.dataset.role=point.role;card.append(node('h4',`${{before:'接觸前3秒',event:'事件時刻',after:'接觸後3秒'}[point.role]} · 目標 ${seconds(point.targetAt)}`));
   card.append(node('p',point.sampleAt===null?'無可用樣本':`最近原始樣本 ${seconds(point.sampleAt)}；偏移 ${number(point.offsetMs!,0)}ms${point.status==='unavailable'?'，超出可用範圍，不列車輛數據':''}。`));
   for(const car of point.cars){
    const table=node('table'),caption=node('caption',names.get(car.id)??'未知車手'),body=node('tbody');
    for(const [key,value]of [['X／Z（公尺）',`${number(car.x)} ／ ${number(car.z)}`],['朝向（弧度）',number(car.h,4)],['帶方向速度（km/h）',number(car.speedKph)]]as const){const row=node('tr'),keyCell=node('th',key);keyCell.scope='row';row.append(keyCell,node('td',value));body.append(row);}table.append(caption,body);card.append(table);
   }
   if(point.relative){const r=point.relative;card.append(node('p',`以${names.get(r.referenceActorId)??'第一車'}朝向為基準，${names.get(r.otherActorId)??'第二車'}距離 ${number(r.distanceM)}m；前方 ${number(r.forwardM)}m，右方 ${number(r.rightM)}m，朝向差 ${number(r.headingDeltaDeg)}°。負值表示後方／左方；兩車資料來自同一原始樣本。`));}
   if(point.issues.length)card.append(node('p',`限制：${point.issues.map(i=>issueLabels[i]).join('；')}。`));facts.append(card);
  }
  if(value.gaps.length){const gaps=node('ul');for(const gap of value.gaps)gaps.append(node('li',`${seconds(gap.fromAt)} → ${seconds(gap.toAt)}：缺口 ${number(gap.gapMs,0)}ms`));facts.append(node('p','採樣缺口'),gaps);}
  if(value.issues.length)facts.append(node('p',`整體限制：${value.issues.map(i=>issueLabels[i]).join('；')}。`));
  facts.append(node('p','未知：高度、連線狀態、煞車、油門、接觸法線及真正接觸步。帶方向速度為負代表倒車；事件原文不作為肇責依據。'));
  status.textContent='可播放已錄製範圍內的片段，或明確下載事實報告；未寫入成績或本機儲存。';sync();
 }
 select.onchange=render;
 play.onclick=()=>{if(disposed||!o.alive()||!o.ready()||!current)return;o.playSegment(Math.max(0,current.event.at-3000),Math.min(o.replay.recordedMs,current.event.at+3000));status.textContent='正在播放錄製範圍內的接觸前後片段；畫面插值與上方原始數據分開。';};
 download.onclick=()=>{
  if(disposed||!o.alive()||!current)return;const text=JSON.stringify(current,null,2);
  if(new TextEncoder().encode(text).length>INCIDENT_MAX_JSON_BYTES){status.textContent='本事件報告超過16KB限制，未下載。';return;}
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=node('a');link.href=url;link.download=`taipei-gp-contact-${current.source.replayId}-${current.event.eventIndex}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='已送出事實 JSON 下載，含回放中的車手暱稱；未判責或新增處罰。';
 };
 render();return{sync,dispose(){disposed=true;select.onchange=play.onclick=download.onclick=null;current=null;panel.remove();}};
}
