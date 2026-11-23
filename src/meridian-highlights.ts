/** Rex <game88521@gmail.com>. Deterministic event selection from recorded authority facts. */
import type {CityReplayEvent,CityReplayEventType} from '../shared/frontier-city-replay';
import type {DirectorClip} from './aurora-director';
const weights:Partial<Record<CityReplayEventType,number>>={capture:10,crown:9,finish:8,stage:6,contact:5,round:4,operation:3,recover:2};
const labels:Partial<Record<CityReplayEventType,string>>={capture:'攔截完成',crown:'王冠歸屬',finish:'本場結束',stage:'作業階段',contact:'車輛接觸',round:'換段',operation:'已接受作業',recover:'返集合區'};
export interface HighlightResult{clips:DirectorClip[];selectedEvents:number;availableEvents:number;durationMs:number;note:string}
export function selectMeridianHighlights(duration:number,actors:number,events:readonly CityReplayEvent[],target:15|30):HighlightResult{
 const empty:HighlightResult={clips:[],selectedEvents:0,availableEvents:0,durationMs:0,note:'錄製區間沒有可選的精彩事件，請手動加入片段。'};
 if(!Number.isFinite(duration)||duration<500||!Number.isInteger(actors)||actors<1||actors>16||![15,30].includes(target))return empty;
 const candidates=events.filter(e=>Number.isFinite(e.at)&&e.at>=0&&e.at<=duration&&weights[e.type]&&e.actors.every(a=>Number.isInteger(a)&&a>=0&&a<actors)).map((e,i)=>({e,i,weight:weights[e.type]!})).sort((a,b)=>b.weight-a.weight||a.e.at-b.e.at||a.i-b.i);
 const windows:{start:number;end:number;event:CityReplayEvent}[]=[],budget=Math.min(target*1000,duration),span=target===15?5000:6000;let used=0,selected=0;
 for(const {e} of candidates){if(windows.length>=8||budget-used<500)break;
  // Repeated contacts within an existing shot cannot consume the whole film.
  if(windows.some(w=>e.at>=w.start&&e.at<=w.end))continue;
  let start=Math.max(0,e.at-span*.65),end=Math.min(duration,start+span);start=Math.max(0,end-span);
  // Crop against already selected shots, preserving the actual event timestamp.
  for(const w of windows){if(start<w.end&&end>w.start){if(w.end<=e.at)start=w.end;else if(w.start>=e.at)end=w.start;}}
  const left=budget-used;if(end-start>left){start=Math.max(start,e.at-left*.65);end=Math.min(end,start+left);if(end<e.at){end=e.at;start=Math.max(0,end-left);}}
  if(end-start<500||e.at<start||e.at>end)continue;
  windows.push({start,end,event:e});used+=end-start;selected++;
 }
 const clips=windows.sort((a,b)=>a.start-b.start).map((w,i):DirectorClip=>({start:w.start,end:w.end,actor:w.event.actors.at(-1)??0,camera:i%3===1?'side':i%3===2?'overhead':'follow',speed:1,caption:labels[w.event.type]??'紀錄事件'}));
 return clips.length?{clips,selectedEvents:selected,availableEvents:candidates.length,durationMs:used,note:`由實際紀錄事件選出${selected}段，依時間排序；未補造超車、肇責或得分。可再調整後預覽／錄製。${used<budget?'事件不足時不會以空鏡補滿時長。':''}`}:{...empty,availableEvents:candidates.length};
}
