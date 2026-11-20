export interface PerformanceSample { ms:number; drawn:boolean; calls:number; triangles:number; geometries:number; textures:number; heapBytes?:number }
export class ExpeditionPerformance {
  recording=false; private window:PerformanceSample[]=[]; rows:Record<string,number>[]=[]; private elapsed=0;
  start(){this.recording=true;this.window=[];this.rows=[];this.elapsed=0;}
  stop(){this.flush();this.recording=false;}
  sample(s:PerformanceSample,active:boolean){if(!this.recording||!active||!Number.isFinite(s.ms)||s.ms<=0||s.ms>2000)return;this.window.push({...s});this.elapsed+=s.ms;if(this.elapsed>=1000)this.flush();}
  private flush(){if(!this.window.length)return;const a=this.window,sorted=a.map(s=>s.ms).sort((x,y)=>x-y),total=a.reduce((n,s)=>n+s.ms,0),last=a.at(-1)!;this.rows.push({seconds:+(total/1000).toFixed(3),callbackFps:+(a.length*1000/total).toFixed(2),renderFps:+(a.filter(s=>s.drawn).length*1000/total).toFixed(2),p95Ms:sorted[Math.floor((a.length-1)*.95)],longFrames:a.filter(s=>s.ms>50).length,calls:last.calls,triangles:last.triangles,geometries:last.geometries,textures:last.textures,...(last.heapBytes===undefined?{}:{heapBytes:last.heapBytes})});this.rows=this.rows.slice(-900);this.window=[];this.elapsed=0;}
  report(){return {v:1,recording:this.recording,samples:this.rows.map(r=>({...r})),note:'只代表本頁裝置與實際採樣情境；背景／選單不計入，最多保留900個約一秒視窗。GPU計數不是實際顯示記憶體，未量測溫度或耗電。'};}
}
/** Only render resolution changes; the simulation and input clocks stay untouched. */
export class ExpeditionResolution {
  scale=1;private time=0;private count=0;private slow=0;private fast=0;
  reset(){this.time=this.count=this.slow=this.fast=0;this.scale=1;}
  sample(seconds:number,active:boolean){if(!active||!Number.isFinite(seconds)||seconds<=0||seconds>.5){this.time=this.count=0;return false;}this.time+=seconds;this.count++;if(this.time<3)return false;const ms=this.time/this.count*1000;this.time=this.count=0;this.slow=ms>29?this.slow+1:0;this.fast=ms<19?this.fast+1:0;const before=this.scale;if(this.slow>=2){this.scale=Math.max(.65,+(this.scale-.1).toFixed(2));this.slow=0;}else if(this.fast>=5){this.scale=Math.min(1,+(this.scale+.05).toFixed(2));this.fast=0;}return before!==this.scale;}
}
