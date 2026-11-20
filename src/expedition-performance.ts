/** Rex <game88521@gmail.com>. Local measurement only; never advances simulation or consumes its random stream. */
export type PerformanceExclusion='hidden'|'menu'|'map'|'inactive'|'invalidDelta';
export interface PerformanceContext{mode:string;track:string;quality:string;fpsCap:number;viewportWidth:number;viewportHeight:number;dpr:number;bufferWidth:number;bufferHeight:number;effectiveScale:number;players:number;streamLoaded:number;streamPending:number}
export interface PerformanceMeta{scope:'main'|'multiplayer';sourceEntry:string;label:string;context:PerformanceContext}
export interface PerformanceSample{ms:number;drawn:boolean;calls:number;triangles:number;geometries:number;textures:number;heapBytes?:number;renderCpuMs?:number}
export interface PerformanceMetrics{acceptedMs:number;callbacks:number;draws:number;callbackFps:number;renderFps:number;p95Ms:number|null;longFrames50:number;longFrames100:number;maxDeltaMs:number;renderCpuSamples:number;renderCpuTotalMs:number;renderCpuMeanMs:number|null;renderCpuMaxMs:number|null;calls:number;triangles:number;geometries:number;textures:number;heapBytes:number|null}
export interface PerformanceTotals extends PerformanceMetrics{wallMs:number;activeWallMs:number;excludedMs:Record<PerformanceExclusion,number>;rejectedSamples:number;boundarySkipped:number}
export interface PerformanceSegment{index:number;startActiveMs:number;endActiveMs:number;metrics:PerformanceMetrics}
export interface PerformanceRow extends PerformanceMetrics{seconds:number;activeStartMs:number;activeEndMs:number;longFrames:number}
export type PerformanceStopReason='recording'|'manual'|'limit'|'restart'|'dispose';
export interface PerformanceSummary{v:2;id:string;at:string;atMs:number;meta:PerformanceMeta;startContext:PerformanceContext;endContext:PerformanceContext;contextChanged:boolean;totals:PerformanceTotals;segments:PerformanceSegment[];rowsTruncated:boolean;stopReason:PerformanceStopReason}
export interface PerformanceReport{v:2;recording:boolean;samples:PerformanceRow[];summary:PerformanceSummary|null;note:string;p95Method:'histogram-1ms-upper-bound';renderCpuMethod:'draw-submission-cpu';limits:{wallMs:number;rows:number;segments:number}}
export const PERFORMANCE_WALL_LIMIT_MS=3_600_000,PERFORMANCE_ROW_LIMIT=3600,PERFORMANCE_SEGMENT_MS=300_000,PERFORMANCE_SEGMENT_LIMIT=12;
const MAX_DELTA_MS=2000,MAX_CPU_MS=60_000,EXCLUSIONS:readonly PerformanceExclusion[]=['hidden','menu','map','inactive','invalidDelta'];
const CONTEXT_STRINGS=['mode','track','quality']as const,CONTEXT_NUMBERS=['fpsCap','viewportWidth','viewportHeight','dpr','bufferWidth','bufferHeight','effectiveScale','players','streamLoaded','streamPending']as const;
const contextMax:Record<typeof CONTEXT_NUMBERS[number],number>={fpsCap:1000,viewportWidth:65536,viewportHeight:65536,dpr:16,bufferWidth:65536,bufferHeight:65536,effectiveScale:16,players:1024,streamLoaded:1_000_000,streamPending:1_000_000};
const excluded=():Record<PerformanceExclusion,number>=>({hidden:0,menu:0,map:0,inactive:0,invalidDelta:0});
const finite=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const count=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>finite(v,max)&&Number.isInteger(v);
const cleanText=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max):'';
const cleanNumber=(value:unknown,max=Number.MAX_SAFE_INTEGER)=>finite(value)?Math.min(max,value):0;
const cleanCount=(value:unknown)=>Math.floor(cleanNumber(value));
function defaultContext():PerformanceContext{return{mode:'',track:'',quality:'',fpsCap:0,viewportWidth:0,viewportHeight:0,dpr:0,bufferWidth:0,bufferHeight:0,effectiveScale:0,players:0,streamLoaded:0,streamPending:0};}
function normalizeContext(value:Partial<PerformanceContext>|undefined):PerformanceContext{const c=defaultContext();for(const k of CONTEXT_STRINGS)c[k]=cleanText(value?.[k],80);for(const k of CONTEXT_NUMBERS)c[k]=cleanNumber(value?.[k],contextMax[k]);return c;}
const sameContext=(a:PerformanceContext,b:PerformanceContext)=>[...CONTEXT_STRINGS,...CONTEXT_NUMBERS].every(k=>a[k]===b[k]);
const validEntry=(s:unknown):s is string=>typeof s==='string'&&(s===''||/^\/assets\/[A-Za-z0-9._-]{1,180}\.js$/.test(s));
let localId=0;
function measurementId(){const bytes=new Uint8Array(12);try{globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}catch{return Math.floor(Date.now()).toString(16).padStart(16,'0').slice(-16)+(++localId).toString(16).padStart(8,'0').slice(-8);}}
class MetricWindow{
 acceptedMs=0;callbacks=0;draws=0;longFrames50=0;longFrames100=0;maxDeltaMs=0;renderCpuSamples=0;renderCpuTotalMs=0;renderCpuMaxMs=0;calls=0;triangles=0;geometries=0;textures=0;heapBytes:number|null=null;
 private histogram=new Float64Array(MAX_DELTA_MS+1);
 add(s:PerformanceSample){this.acceptedMs+=s.ms;this.callbacks++;if(s.ms>50)this.longFrames50++;if(s.ms>100)this.longFrames100++;this.maxDeltaMs=Math.max(this.maxDeltaMs,s.ms);this.histogram[Math.max(1,Math.ceil(s.ms))]++;if(s.drawn){this.draws++;this.calls=cleanCount(s.calls);this.triangles=cleanCount(s.triangles);if(finite(s.renderCpuMs,MAX_CPU_MS)){this.renderCpuSamples++;this.renderCpuTotalMs+=s.renderCpuMs;this.renderCpuMaxMs=Math.max(this.renderCpuMaxMs,s.renderCpuMs);}}this.geometries=cleanCount(s.geometries);this.textures=cleanCount(s.textures);this.heapBytes=finite(s.heapBytes)?s.heapBytes:null;}
 snapshot():PerformanceMetrics{let p95Ms:number|null=null;if(this.callbacks){const target=Math.ceil(this.callbacks*.95);let n=0;for(let i=1;i<this.histogram.length;i++){n+=this.histogram[i];if(n>=target){p95Ms=i;break;}}}return{acceptedMs:this.acceptedMs,callbacks:this.callbacks,draws:this.draws,callbackFps:this.acceptedMs?this.callbacks*1000/this.acceptedMs:0,renderFps:this.acceptedMs?this.draws*1000/this.acceptedMs:0,p95Ms,longFrames50:this.longFrames50,longFrames100:this.longFrames100,maxDeltaMs:this.maxDeltaMs,renderCpuSamples:this.renderCpuSamples,renderCpuTotalMs:this.renderCpuTotalMs,renderCpuMeanMs:this.renderCpuSamples?this.renderCpuTotalMs/this.renderCpuSamples:null,renderCpuMaxMs:this.renderCpuSamples?this.renderCpuMaxMs:null,calls:this.calls,triangles:this.triangles,geometries:this.geometries,textures:this.textures,heapBytes:this.heapBytes};}
}
export class ExpeditionPerformance{
 private running=false;private currentWindow=new MetricWindow();private all=new MetricWindow();private segmentWindows=new Map<number,MetricWindow>();private storedRows:PerformanceRow[]=[];private rowStart=0;private truncated=false;
 private reason:PerformanceExclusion|null=null;private skipBoundary=false;private lastClock=-Infinity;private startAt=0;private lastAt=0;private lastSampleAt:number|null=null;private wallMs=0;private activeWallMs=0;private excludedMs=excluded();private rejectedSamples=0;private boundarySkipped=0;
 private meta:PerformanceMeta={scope:'main',sourceEntry:'',label:'',context:defaultContext()};private context=defaultContext();private startContext=defaultContext();private changedContext=false;private id='';private atMs=0;private stopReason:PerformanceStopReason='manual';private finished:PerformanceSummary|null=null;
 constructor(private readonly clock:()=>number=()=>typeof performance==='undefined'?Date.now():performance.now()){}
 get recording(){return this.running;}
 get rows(){return this.storedRows.map(r=>({...r}));}
 private now(){let value:number;try{value=this.clock();}catch{value=this.lastClock;}if(Number.isFinite(value))this.lastClock=Math.max(this.lastClock,value);if(!Number.isFinite(this.lastClock))this.lastClock=0;return this.lastClock;}
 start(meta?:PerformanceMeta){if(this.running)this.finish('restart');const t=this.now();this.running=true;this.currentWindow=new MetricWindow();this.all=new MetricWindow();this.segmentWindows.clear();this.storedRows=[];this.rowStart=0;this.truncated=false;this.reason=null;this.skipBoundary=false;this.startAt=this.lastAt=t;this.lastSampleAt=null;this.wallMs=this.activeWallMs=this.rejectedSamples=this.boundarySkipped=0;this.excludedMs=excluded();this.context=normalizeContext(meta?.context??this.context);this.startContext={...this.context};this.meta={scope:meta?.scope==='multiplayer'?'multiplayer':'main',sourceEntry:validEntry(meta?.sourceEntry)?meta.sourceEntry:'',label:cleanText(meta?.label,40),context:{...this.context}};this.changedContext=false;this.id=measurementId();this.atMs=Date.now();this.stopReason='recording';this.finished=null;}
 /** Wall intervals are accounted once, independently from accepted callback deltas. */
 private advance(t:number,override?:PerformanceExclusion){const end=Math.min(t,this.startAt+PERFORMANCE_WALL_LIMIT_MS),delta=Math.max(0,end-this.lastAt);if(override??this.reason)this.excludedMs[(override??this.reason)!]+=delta;else this.activeWallMs+=delta;this.wallMs+=delta;this.lastAt=end;return t>=this.startAt+PERFORMANCE_WALL_LIMIT_MS;}
 activity(reason:PerformanceExclusion|null){if(!this.running)return;const limit=this.advance(this.now());if(limit){this.finish('limit',false);return;}if(reason!==this.reason){this.reason=reason;this.skipBoundary=true;}}
 setContext(context:PerformanceContext){const next=normalizeContext(context);if(this.running&&!sameContext(next,this.context))this.changedContext=true;this.context=next;}
 sample(s:PerformanceSample,active:boolean|PerformanceExclusion){
  if(!this.running)return;const t=this.now(),desired:PerformanceExclusion|null=active===true?null:active===false?'inactive':active,changed=desired!==this.reason,valid=Number.isFinite(s.ms)&&s.ms>0&&s.ms<=MAX_DELTA_MS,gap=this.lastSampleAt===null?0:t-this.lastSampleAt;
  const invalid=desired===null&&!changed&&!this.skipBoundary&&(!valid||gap>MAX_DELTA_MS),limit=this.advance(t,invalid?'invalidDelta':undefined);this.lastSampleAt=t;
  if(changed){this.reason=desired;this.skipBoundary=true;}if(desired!==null){if(limit)this.finish('limit',false);return;}
  if(this.skipBoundary){this.boundarySkipped++;this.skipBoundary=false;if(limit)this.finish('limit',false);return;}
  if(invalid||!valid){this.rejectedSamples++;if(limit)this.finish('limit',false);return;}
  // A late callback at/after the one-hour wall edge cannot contribute time beyond it.
  if(limit&&t>this.startAt+PERFORMANCE_WALL_LIMIT_MS){this.rejectedSamples++;this.finish('limit',false);return;}
  this.all.add(s);this.currentWindow.add(s);const index=Math.min(PERFORMANCE_SEGMENT_LIMIT-1,Math.max(0,Math.ceil(this.activeWallMs/PERFORMANCE_SEGMENT_MS)-1));let segment=this.segmentWindows.get(index);if(!segment){segment=new MetricWindow();this.segmentWindows.set(index,segment);}segment.add(s);if(this.currentWindow.acceptedMs>=1000)this.flush();if(limit)this.finish('limit',false);
 }
 private flush(){if(!this.currentWindow.callbacks)return;const m=this.currentWindow.snapshot(),end=this.rowStart+m.acceptedMs;if(this.storedRows.length<PERFORMANCE_ROW_LIMIT)this.storedRows.push({...m,seconds:m.acceptedMs/1000,activeStartMs:this.rowStart,activeEndMs:end,longFrames:m.longFrames50});else this.truncated=true;this.rowStart=end;this.currentWindow=new MetricWindow();}
 stop(reason:'manual'|'dispose'='manual'){if(!this.running)return;this.finish(reason);}
 private finish(reason:PerformanceStopReason,sync=true){if(!this.running)return;if(sync&&this.advance(this.now()))reason='limit';this.flush();this.running=false;this.stopReason=reason;this.finished=this.snapshot();}
 private snapshot():PerformanceSummary{const segments:PerformanceSegment[]=[],length=Math.min(PERFORMANCE_SEGMENT_LIMIT,Math.ceil(this.activeWallMs/PERFORMANCE_SEGMENT_MS));for(let index=0;index<length;index++)segments.push({index,startActiveMs:index*PERFORMANCE_SEGMENT_MS,endActiveMs:Math.min(this.activeWallMs,(index+1)*PERFORMANCE_SEGMENT_MS),metrics:(this.segmentWindows.get(index)??new MetricWindow()).snapshot()});if(!length&&this.all.callbacks)segments.push({index:0,startActiveMs:0,endActiveMs:0,metrics:(this.segmentWindows.get(0)??new MetricWindow()).snapshot()});return{v:2,id:this.id,at:new Date(this.atMs).toISOString(),atMs:this.atMs,meta:{...this.meta,context:{...this.meta.context}},startContext:{...this.startContext},endContext:{...this.context},contextChanged:this.changedContext,totals:{...this.all.snapshot(),wallMs:this.wallMs,activeWallMs:this.activeWallMs,excludedMs:{...this.excludedMs},rejectedSamples:this.rejectedSamples,boundarySkipped:this.boundarySkipped},segments,rowsTruncated:this.truncated,stopReason:this.stopReason};}
 summary():PerformanceSummary|null{if(!this.id)return null;if(this.running&&this.advance(this.now()))this.finish('limit',false);const value=this.finished??this.snapshot();return structuredClone(value);}
 report():PerformanceReport{const summary=this.summary();return{v:2,recording:this.running,samples:this.rows,summary,note:'最多60分鐘 wall與3600個約一秒視窗。wall／排除時間依單調時鐘，FPS只涵蓋acceptedMs；須同看採樣覆蓋與跳過次數。5分鐘段依activeWall落點，邊界可差一格callback。p95為全程／分段各自1ms桶的上界估計，不平均視窗p95。renderCpuMs只量實際draw提交CPU，非GPU；GPU計數不是顯示記憶體，未量溫度或耗電。',p95Method:'histogram-1ms-upper-bound',renderCpuMethod:'draw-submission-cpu',limits:{wallMs:PERFORMANCE_WALL_LIMIT_MS,rows:PERFORMANCE_ROW_LIMIT,segments:PERFORMANCE_SEGMENT_LIMIT}};}
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
function validContext(v:unknown):v is PerformanceContext{return object(v)&&exact(v,[...CONTEXT_STRINGS,...CONTEXT_NUMBERS])&&CONTEXT_STRINGS.every(k=>text(v[k],80))&&CONTEXT_NUMBERS.every(k=>finite(v[k],contextMax[k]));}
const METRIC_KEYS=['acceptedMs','callbacks','draws','callbackFps','renderFps','p95Ms','longFrames50','longFrames100','maxDeltaMs','renderCpuSamples','renderCpuTotalMs','renderCpuMeanMs','renderCpuMaxMs','calls','triangles','geometries','textures','heapBytes']as const;
const closeNumber=(actual:number,expected:number)=>Math.abs(actual-expected)<=Math.max(.000001,Math.abs(expected)*1e-9);
function validMetrics(v:unknown,extra:readonly string[]=[]):v is PerformanceMetrics{
 if(!object(v)||!exact(v,[...METRIC_KEYS,...extra]))return false;
 for(const k of ['acceptedMs','callbackFps','renderFps','renderCpuTotalMs']as const)if(!finite(v[k]))return false;
 for(const k of ['callbacks','draws','longFrames50','longFrames100','renderCpuSamples']as const)if(!count(v[k],1_000_000_000))return false;
 for(const k of ['calls','triangles','geometries','textures']as const)if(!count(v[k]))return false;
 if(!finite(v.maxDeltaMs,MAX_DELTA_MS)||v.p95Ms!==null&&!count(v.p95Ms,MAX_DELTA_MS)||v.heapBytes!==null&&!finite(v.heapBytes)||v.renderCpuMeanMs!==null&&!finite(v.renderCpuMeanMs,MAX_CPU_MS)||v.renderCpuMaxMs!==null&&!finite(v.renderCpuMaxMs,MAX_CPU_MS))return false;
 const q=v as unknown as PerformanceMetrics;
 if(q.draws>q.callbacks||q.longFrames100>q.longFrames50||q.longFrames50>q.callbacks||q.renderCpuSamples>q.draws||q.acceptedMs>q.callbacks*MAX_DELTA_MS+.000001||q.maxDeltaMs>q.acceptedMs+.000001)return false;
 if(q.callbacks){if(!q.acceptedMs||!q.maxDeltaMs||q.p95Ms===null||q.p95Ms<1||q.p95Ms>Math.ceil(q.maxDeltaMs)||!closeNumber(q.callbackFps,q.callbacks*1000/q.acceptedMs)||!closeNumber(q.renderFps,q.draws*1000/q.acceptedMs))return false;}
 else if(q.acceptedMs!==0||q.p95Ms!==null||q.maxDeltaMs!==0||q.callbackFps!==0||q.renderFps!==0)return false;
 if((q.longFrames50>0)!==(q.maxDeltaMs>50)||(q.longFrames100>0)!==(q.maxDeltaMs>100))return false;
 if(q.renderCpuSamples){if(q.renderCpuMeanMs===null||q.renderCpuMaxMs===null||q.renderCpuMeanMs>q.renderCpuMaxMs+.000001||q.renderCpuMaxMs>q.renderCpuTotalMs+.000001||q.renderCpuTotalMs>q.renderCpuSamples*MAX_CPU_MS+.000001||!closeNumber(q.renderCpuMeanMs,q.renderCpuTotalMs/q.renderCpuSamples))return false;}
 else if(q.renderCpuTotalMs!==0||q.renderCpuMeanMs!==null||q.renderCpuMaxMs!==null)return false;
 return true;
}
/** Shared strict parser for bounded local history and backup imports; returns an independent copy. */
export function parsePerformanceSummary(value:unknown):PerformanceSummary|null{
 if(!object(value)||!exact(value,['v','id','at','atMs','meta','startContext','endContext','contextChanged','totals','segments','rowsTruncated','stopReason'])||value.v!==2||typeof value.id!=='string'||!/^([a-f0-9]{24})$/.test(value.id)||!count(value.atMs,8.64e15)||typeof value.at!=='string'||value.at!==new Date(value.atMs).toISOString()||typeof value.contextChanged!=='boolean'||typeof value.rowsTruncated!=='boolean'||!['recording','manual','limit','restart','dispose'].includes(String(value.stopReason)))return null;
 const meta=value.meta,t=value.totals;if(!object(meta)||!exact(meta,['scope','sourceEntry','label','context'])||!['main','multiplayer'].includes(String(meta.scope))||!validEntry(meta.sourceEntry)||!text(meta.label,40)||!validContext(meta.context)||!validContext(value.startContext)||!validContext(value.endContext)||!sameContext(meta.context,value.startContext)||!value.contextChanged&&!sameContext(value.startContext,value.endContext))return null;
 if(!validMetrics(t,['wallMs','activeWallMs','excludedMs','rejectedSamples','boundarySkipped'])||!object(t)||!finite(t.wallMs,PERFORMANCE_WALL_LIMIT_MS)||!finite(t.activeWallMs,t.wallMs)||!count(t.rejectedSamples)||!count(t.boundarySkipped)||!object(t.excludedMs)||!exact(t.excludedMs,EXCLUSIONS)||!EXCLUSIONS.every(k=>finite((t.excludedMs as Record<string,unknown>)[k],PERFORMANCE_WALL_LIMIT_MS)))return null;
 if(Math.abs(t.wallMs-t.activeWallMs-EXCLUSIONS.reduce((n,k)=>n+(t.excludedMs as Record<PerformanceExclusion,number>)[k],0))>.001||!Array.isArray(value.segments)||value.segments.length>PERFORMANCE_SEGMENT_LIMIT)return null;
 const length=Math.min(PERFORMANCE_SEGMENT_LIMIT,Math.ceil(t.activeWallMs/PERFORMANCE_SEGMENT_MS))||(t.callbacks?1:0);if(value.segments.length!==length)return null;
 const sums={acceptedMs:0,callbacks:0,draws:0,longFrames50:0,longFrames100:0,renderCpuSamples:0,renderCpuTotalMs:0};let maxDelta=0,maxCpu:number|null=null;
 for(let i=0;i<value.segments.length;i++){const s=value.segments[i];if(!object(s)||!exact(s,['index','startActiveMs','endActiveMs','metrics'])||s.index!==i||s.startActiveMs!==i*PERFORMANCE_SEGMENT_MS||!finite(s.endActiveMs,PERFORMANCE_WALL_LIMIT_MS)||!closeNumber(s.endActiveMs,Math.min(t.activeWallMs,(i+1)*PERFORMANCE_SEGMENT_MS))||!validMetrics(s.metrics))return null;for(const k of Object.keys(sums)as(keyof typeof sums)[])sums[k]+=s.metrics[k];maxDelta=Math.max(maxDelta,s.metrics.maxDeltaMs);if(s.metrics.renderCpuMaxMs!==null)maxCpu=Math.max(maxCpu??0,s.metrics.renderCpuMaxMs);}
 for(const k of Object.keys(sums)as(keyof typeof sums)[])if(!closeNumber(sums[k],t[k]))return null;
 if(!closeNumber(maxDelta,t.maxDeltaMs)||maxCpu!==t.renderCpuMaxMs||value.stopReason==='limit'&&t.wallMs!==PERFORMANCE_WALL_LIMIT_MS)return null;
 return structuredClone(value)as unknown as PerformanceSummary;
}
/** Only render resolution changes; the simulation and input clocks stay untouched. */
export class ExpeditionResolution {
  scale=1;private time=0;private count=0;private slow=0;private fast=0;
  reset(){this.time=this.count=this.slow=this.fast=0;this.scale=1;}
  sample(seconds:number,active:boolean){if(!active||!Number.isFinite(seconds)||seconds<=0||seconds>.5){this.time=this.count=0;return false;}this.time+=seconds;this.count++;if(this.time<3)return false;const ms=this.time/this.count*1000;this.time=this.count=0;this.slow=ms>29?this.slow+1:0;this.fast=ms<19?this.fast+1:0;const before=this.scale;if(this.slow>=2){this.scale=Math.max(.65,+(this.scale-.1).toFixed(2));this.slow=0;}else if(this.fast>=5){this.scale=Math.min(1,+(this.scale+.05).toFixed(2));this.fast=0;}return before!==this.scale;}
}
