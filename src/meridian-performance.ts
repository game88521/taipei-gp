/** Rex <game88521@gmail.com>. Bounded, opt-in spatial measurements; no simulation writes. */
export interface MeridianPosition{x:number;z:number;along?:number;label?:string}
export interface MeridianHotspot{key:string;label:string;samples:number;draws:number;ms:number;long50:number;cpuSamples:number;cpuMs:number;maxMs:number}
export interface MeridianPerformanceReport{v:1;cellMetres:250;limit:256;overflow:number;rejected:number;hotspots:MeridianHotspot[];advice:string[];gpuMethod:'not-measured'}
export class MeridianPerformance{
 private cells=new Map<string,MeridianHotspot>();private overflow=0;private rejected=0;
 reset(){this.cells.clear();this.overflow=this.rejected=0;}
 sample(dt:number,drawn:boolean,active:boolean,position:MeridianPosition|null,track:string,cpu?:number){
  if(!active)return;
  if(!Number.isFinite(dt)||dt<=0||dt>2||!position||![position.x,position.z].every(Number.isFinite)||Math.max(Math.abs(position.x),Math.abs(position.z))>100000){this.rejected++;return;}
  const along=position.along,route=typeof along==='number'&&Number.isFinite(along)&&along>=0&&along<1e7?Math.floor(along/250):null,x=Math.floor(position.x/250),z=Math.floor(position.z/250),base=String(track).replace(/[\x00-\x1f\x7f<>]/g,'').slice(0,80),key=base+':'+(route===null?`${x},${z}`:'s'+route);
  let row=this.cells.get(key);if(!row){if(this.cells.size>=256){this.overflow++;return;}const label=route===null?`區塊 x ${x*250}～${(x+1)*250}、z ${z*250}～${(z+1)*250}m`:`沿圈 ${route*250}～${(route+1)*250}m`;row={key,label:base+' · '+label,samples:0,draws:0,ms:0,long50:0,cpuSamples:0,cpuMs:0,maxMs:0};this.cells.set(key,row);}
  const ms=dt*1000;row.samples++;row.draws+=Number(drawn);row.ms+=ms;row.long50+=Number(ms>50);row.maxMs=Math.max(row.maxMs,ms);if(drawn&&Number.isFinite(cpu)&&cpu!>=0&&cpu!<=60000){row.cpuSamples++;row.cpuMs+=cpu!;}
 }
 report(fpsCap=60,effectiveScale=1):MeridianPerformanceReport{
  const rows=[...this.cells.values()],samples=rows.reduce((n,r)=>n+r.samples,0),ms=rows.reduce((n,r)=>n+r.ms,0),draws=rows.reduce((n,r)=>n+r.draws,0),long=rows.reduce((n,r)=>n+r.long50,0),cpuN=rows.reduce((n,r)=>n+r.cpuSamples,0),cpu=rows.reduce((n,r)=>n+r.cpuMs,0),target=Number.isFinite(fpsCap)&&fpsCap>=15&&fpsCap<=240?fpsCap:60,advice:string[]=[];
  if(samples<180||ms<5000)advice.push('有效駕駛資料不足；先採樣至少5秒與180個回呼，再比較同一路段。');
  else{const fps=draws*1000/ms;if(fps<target*.8||long/samples>.05){advice.push(`目前繪製約${fps.toFixed(1)} FPS，目標${target} FPS。請用相同路線另採一份較低解析度或低畫質作比較。`);if(effectiveScale>.7)advice.push('可先試0.80解析度，再視結果試0.65；像素數減少不等於FPS按比例提升。');else advice.push('解析度已低；可比較低畫質或30 FPS上限，並關閉其他吃效能的分頁。');if(cpuN&&cpu/cpuN>1000/target*.65)advice.push('繪製提交CPU佔用偏高，可比較低畫質、視距與同房人數；此資料不能判定GPU瓶頸。');}else advice.push('這段採樣大致達到目前繪製目標；保留設定，另測較繁忙路段與雨天。');}
  advice.push('GPU時間、溫度與耗電未量測；本報告只能定位觀察到的路段，不能證明單一路段是卡頓成因。');
  return{v:1,cellMetres:250,limit:256,overflow:this.overflow,rejected:this.rejected,hotspots:rows.map(r=>({...r})).sort((a,b)=>b.long50/Math.max(1,b.samples)-a.long50/Math.max(1,a.samples)||b.maxMs-a.maxMs),advice,gpuMethod:'not-measured'};
 }
}
