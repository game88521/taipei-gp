/** Rex <game88521@gmail.com>. Recorded facts only: no interpolation, reconstruction, responsibility or sanctions. */
import {REPLAY_STEP_MS,REPLAY_MAX_FRAMES,type MultiplayerReplay,type ReplayFrame,type ReplayEvent} from './nexus-replay.ts';

export const INCIDENT_WINDOW_MS=3000,INCIDENT_NEAREST_MS=200,INCIDENT_GAP_MS=400,INCIDENT_MAX_JSON_BYTES=16_384;
export type IncidentIssue='missing-actors'|'unexpected-actors'|'outside-recording'|'sample-too-far'|'frame-gap'|'recording-truncated'|'recording-start'|'recording-end'|'invalid-frame';
export interface ReplayIncident{eventIndex:number;at:number;type:'collision'|'wall';actors:string[];detail:string}
export interface IncidentActor{id:string;name:string;color:string}
export interface IncidentCar{id:string;x:number;z:number;h:number;signedSpeedMps:number;speedKph:number}
export interface IncidentRelative{referenceActorId:string;otherActorId:string;distanceM:number;forwardM:number;rightM:number;headingDeltaRad:number;headingDeltaDeg:number}
export interface IncidentPoint{role:'before'|'event'|'after';targetAt:number;sampleAt:number|null;offsetMs:number|null;status:'available'|'partial'|'unavailable';issues:IncidentIssue[];cars:IncidentCar[];relative:IncidentRelative|null}
export interface IncidentGap{fromAt:number;toAt:number;gapMs:number}
export interface IncidentAnalysis{
 v:1;
 source:{replayId:string;schema:MultiplayerReplay['schema'];trackId:string;recordedMs:number;durationMs:number;truncated:boolean;samplingStepMs:200};
 event:ReplayIncident;actors:IncidentActor[];points:IncidentPoint[];gaps:IncidentGap[];issues:IncidentIssue[];complete:boolean;
 unknown:{height:'unknown';connection:'unknown';brake:'unknown';throttle:'unknown';contactNormal:'unknown';contactStep:'unknown'};
 disclaimer:string;
}
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const unique=(issues:IncidentIssue[])=>[...new Set(issues)];
/** The caller normally owns a strict parsed replay. These bounded guards also prevent bad UI arguments from escaping as errors. */
function usable(replay:MultiplayerReplay):boolean{
 if(!replay||![1,2,3,4,5,6].includes(replay.schema)||!text(replay.id,64)||!text(replay.trackId,80)||!finite(replay.recordedMs,0,720000)||!finite(replay.durationMs,replay.recordedMs,86400000)||typeof replay.truncated!=='boolean'||!Array.isArray(replay.drivers)||replay.drivers.length<1||replay.drivers.length>4||!Array.isArray(replay.frames)||!replay.frames.length||replay.frames.length>REPLAY_MAX_FRAMES)return false;
 if(replay.drivers.some(d=>!d||!text(d.id,64)||!text(d.name,32)||!text(d.color,7))||new Set(replay.drivers.map(d=>d.id)).size!==replay.drivers.length)return false;
 let prior=-1;for(const frame of replay.frames){if(!frame||!finite(frame.at,0,replay.recordedMs)||frame.at<=prior||!Array.isArray(frame.cars)||frame.cars.length!==replay.drivers.length)return false;prior=frame.at;}
 return replay.frames[0].at===0&&Math.abs(prior-replay.recordedMs)<=.01&&(replay.schema===1||Array.isArray(replay.events)&&replay.events.length<=512);
}
function contactEvent(event:ReplayEvent|undefined,index:number):ReplayIncident|null{
 if(!event||!['collision','wall'].includes(event.type)||!finite(event.at,0,720000)||!Array.isArray(event.actors)||event.actors.length>2||event.actors.some(id=>!text(id,64))||!text(event.detail,80))return null;
 return{eventIndex:index,at:event.at,type:event.type as 'collision'|'wall',actors:[...event.actors],detail:event.detail};
}
/** Original event indices stay stable when the UI filters other event types. Schema 1 has no event stream. */
export function listReplayIncidents(replay:MultiplayerReplay):ReplayIncident[]{
 if(!usable(replay)||replay.schema===1)return[];const rows:ReplayIncident[]=[];
 for(let index=0;index<replay.events!.length;index++){const event=contactEvent(replay.events![index],index);if(event&&event.at<=replay.recordedMs)rows.push(event);}return rows;
}
function nearestFrame(frames:ReplayFrame[],target:number):ReplayFrame{
 let lo=0,hi=frames.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].at<target)lo=mid+1;else hi=mid;}const after=frames[lo],before=frames[Math.max(0,lo-1)];
 return target-before.at<=after.at-target?before:after;
}
function point(replay:MultiplayerReplay,event:ReplayIncident,role:IncidentPoint['role'],targetAt:number,actorIssues:IncidentIssue[],gaps:IncidentGap[]):IncidentPoint{
 const result:IncidentPoint={role,targetAt,sampleAt:null,offsetMs:null,status:'unavailable',issues:[...actorIssues],cars:[],relative:null};
 if(targetAt<0||targetAt>replay.recordedMs){result.issues.push('outside-recording',targetAt<0?'recording-start':'recording-end');if(targetAt>replay.recordedMs&&replay.truncated)result.issues.push('recording-truncated');result.issues=unique(result.issues);return result;}
 const frame=nearestFrame(replay.frames,targetAt);result.sampleAt=frame.at;result.offsetMs=frame.at-targetAt;
 if(gaps.some(g=>targetAt>g.fromAt&&targetAt<g.toAt))result.issues.push('frame-gap');
 if(Math.abs(result.offsetMs)>INCIDENT_NEAREST_MS){result.issues.push('sample-too-far');result.issues=unique(result.issues);return result;}
 const ids=event.actors.slice(0,event.type==='wall'?1:2);
 for(const id of ids){const index=replay.drivers.findIndex(d=>d.id===id),p=index<0?null:frame.cars[index];if(!p){result.issues.push('missing-actors');continue;}if(!Array.isArray(p)||p.length!==14||!finite(p[0],-1e6,1e6)||!finite(p[1],-1e6,1e6)||!finite(p[2],-1e5,1e5)||!finite(p[3],-200,500)){result.issues.push('invalid-frame');continue;}result.cars.push({id,x:p[0],z:p[1],h:p[2],signedSpeedMps:p[3],speedKph:p[3]*3.6});}
 if(!result.cars.length){result.issues=unique(result.issues);return result;}
 if(event.type==='collision'&&result.cars.length===2&&!actorIssues.length){const[a,b]=result.cars,dx=b.x-a.x,dz=b.z-a.z,headingDeltaRad=Math.atan2(Math.sin(b.h-a.h),Math.cos(b.h-a.h));result.relative={referenceActorId:a.id,otherActorId:b.id,distanceM:Math.hypot(dx,dz),forwardM:dx*Math.sin(a.h)+dz*Math.cos(a.h),rightM:dx*Math.cos(a.h)-dz*Math.sin(a.h),headingDeltaRad,headingDeltaDeg:headingDeltaRad*180/Math.PI};}
 result.issues=unique(result.issues);result.status=result.issues.length?'partial':'available';return result;
}
/** Returns null for non-contact or invalid event indices; it never changes replay, events, scores or playback state. */
export function analyzeReplayIncident(replay:MultiplayerReplay,eventIndex:number):IncidentAnalysis|null{
 if(!usable(replay)||replay.schema===1||!Number.isSafeInteger(eventIndex)||eventIndex<0||eventIndex>=replay.events!.length)return null;
 const event=contactEvent(replay.events![eventIndex],eventIndex);if(!event||event.at>replay.recordedMs)return null;
 const expected=event.type==='collision'?2:1,actorIssues:IncidentIssue[]=[];
 if(event.actors.length<expected||event.actors.some(id=>!replay.drivers.some(d=>d.id===id))||new Set(event.actors).size!==event.actors.length)actorIssues.push('missing-actors');if(event.actors.length>expected)actorIssues.push('unexpected-actors');
 const actors=event.actors.flatMap(id=>{const d=replay.drivers.find(d=>d.id===id);return d?[{id:d.id,name:d.name,color:d.color}]:[];}),gaps:IncidentGap[]=[],from=event.at-INCIDENT_WINDOW_MS,to=event.at+INCIDENT_WINDOW_MS;
 for(let i=1;i<replay.frames.length;i++){const a=replay.frames[i-1].at,b=replay.frames[i].at;if(b-a>INCIDENT_GAP_MS&&b>from&&a<to)gaps.push({fromAt:a,toAt:b,gapMs:b-a});}
 // More than sixteen disjoint >400ms gaps cannot fit a six-second interval, including the two edges.
 if(gaps.length>16)return null;
 const points=[point(replay,event,'before',from,actorIssues,gaps),point(replay,event,'event',event.at,actorIssues,gaps),point(replay,event,'after',to,actorIssues,gaps)],issues=unique([...actorIssues,...points.flatMap(p=>p.issues),...(gaps.length?['frame-gap' as const]:[]),...(replay.truncated?['recording-truncated' as const]:[])]);
 return{v:1,source:{replayId:replay.id,schema:replay.schema,trackId:replay.trackId,recordedMs:replay.recordedMs,durationMs:replay.durationMs,truncated:replay.truncated,samplingStepMs:REPLAY_STEP_MS},event,actors,points,gaps,issues,complete:!issues.length&&points.every(p=>p.status==='available'),unknown:{height:'unknown',connection:'unknown',brake:'unknown',throttle:'unknown',contactNormal:'unknown',contactStep:'unknown'},disclaimer:'僅列原始權威錄製樣本；200ms取樣不是實際接觸步。資料不足會明示，不判定肇責，也不新增處罰。'};
}
