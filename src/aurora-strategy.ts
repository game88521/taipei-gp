/** Rex <game88521@gmail.com>. Isolated hypothetical strategy calculations; never advances GP physics or random state. */
export const AURORA_COMPOUNDS=['soft','medium','hard','wet'] as const;
export type AuroraCompound=typeof AURORA_COMPOUNDS[number];
export const AURORA_TYRE_NAMES={soft:'軟胎',medium:'中性胎',hard:'硬胎',wet:'雨胎'};
export interface AuroraTyre {grip:number;wearPerLap:number;rain:boolean}
export interface AuroraStrategyContext {trackId:string;trackStamp:string;rules:string;laps:number;lapSeconds:number;wetness:number;startCompound:AuroraCompound;startWear:number;pitLoss:{min:number;max:number};tyres:Record<AuroraCompound,AuroraTyre>}
export interface AuroraStop {lap:number;compound:AuroraCompound}
export interface AuroraPlan {v:1;name:string;start:AuroraCompound;stops:AuroraStop[];assumedFinalWetness:number}
export interface AuroraLapEstimate {lap:number;compound:AuroraCompound;wear:number;wetness:number;min:number;max:number;pit:boolean;cumulative:{min:number;max:number}}
export interface AuroraStrategyEstimate {plan:AuroraPlan;rows:AuroraLapEstimate[];total:{min:number;max:number};assumptions:string[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,fields:string[])=>Object.keys(v).length===fields.length&&fields.every(f=>Object.hasOwn(v,f));
const num=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
const compound=(v:unknown):v is AuroraCompound=>AURORA_COMPOUNDS.includes(v as AuroraCompound);
export function parseAuroraPlan(v:unknown,laps:number):AuroraPlan|null {
 if(!Number.isInteger(laps)||laps<1||laps>100||!object(v)||!exact(v,['v','name','start','stops','assumedFinalWetness'])||v.v!==1||typeof v.name!=='string'||!v.name.trim()||v.name.length>30||/[\x00-\x1f<>]/.test(v.name)||!compound(v.start)||!num(v.assumedFinalWetness,0,1)||!Array.isArray(v.stops)||v.stops.length>8)return null;
 let previous=0;for(const stop of v.stops){if(!object(stop)||!exact(stop,['lap','compound'])||!Number.isInteger(stop.lap)||!num(stop.lap,1,laps-1)||stop.lap<=previous||!compound(stop.compound))return null;previous=stop.lap;}
 return structuredClone(v) as unknown as AuroraPlan;
}
export function validAuroraContext(v:unknown):v is AuroraStrategyContext {
 if(!object(v)||typeof v.trackId!=='string'||!v.trackId||v.trackId.length>100||typeof v.trackStamp!=='string'||!v.trackStamp||v.trackStamp.length>160||typeof v.rules!=='string'||!v.rules||!Number.isInteger(v.laps)||!num(v.laps,1,100)||!num(v.lapSeconds,10,1000)||!num(v.wetness,0,1)||!num(v.startWear,0,1)||!compound(v.startCompound)||!object(v.pitLoss)||!num(v.pitLoss.min,0,300)||!num(v.pitLoss.max,v.pitLoss.min,300)||!object(v.tyres))return false;
 return AURORA_COMPOUNDS.every(c=>{const t=(v.tyres as Record<string,unknown>)[c];return object(t)&&num(t.grip,.1,2)&&num(t.wearPerLap,0,1)&&typeof t.rain==='boolean';});
}
export function estimateAuroraPlan(context:AuroraStrategyContext,raw:unknown):AuroraStrategyEstimate|null {
 if(!validAuroraContext(context))return null;const plan=parseAuroraPlan(raw,context.laps);if(!plan)return null;
 const rows:AuroraLapEstimate[]=[];let selected=plan.start,wear=selected===context.startCompound?context.startWear:0,totalMin=0,totalMax=0;
 for(let lap=1;lap<=context.laps;lap++){
  const tyre=context.tyres[selected],wet=context.wetness+(plan.assumedFinalWetness-context.wetness)*(lap-.5)/context.laps;
  const rate=tyre.wearPerLap*(tyre.rain?1+2*(1-wet):1),midWear=Math.min(1,wear+rate*.5),wetGrip=tyre.rain?(1-.04*wet)*(1-.08*(1-wet)):1-.28*wet;
  const factor=1/Math.sqrt(tyre.grip*(1-.18*midWear**1.5)*wetGrip),base=context.lapSeconds*(.35+.65*factor),uncertainty=Math.max(.2,Math.abs(base-context.lapSeconds)*.4+context.lapSeconds*.015);
  const stop=plan.stops.find(s=>s.lap===lap),min=Math.max(0,base-uncertainty)+(stop?context.pitLoss.min:0),max=base+uncertainty+(stop?context.pitLoss.max:0);totalMin+=min;totalMax+=max;
  rows.push({lap,compound:selected,wear:midWear,wetness:wet,min,max,pit:!!stop,cumulative:{min:totalMin,max:totalMax}});wear=Math.min(1,wear+rate);if(stop){selected=stop.compound;wear=0;}
 }
 return{plan,rows,total:{min:totalMin,max:totalMax},assumptions:['獨立圈速模型，非真Car模擬；不保證實際圈速或進站安全。','停站圈指完成該圈後換胎；最多8停，最後一圈不可停。',`濕度由目前${Math.round(context.wetness*100)}%至你假設的${Math.round(plan.assumedFinalWetness*100)}%線性變化，不讀未來天候。`,'使用公開胎種／目前觀察圈速與停站區間；不讀AI決策、未來雨勢或尚未發生的停站失誤。','交通、安全車、駕駛失誤及未量測的暖胎差異可能超出估計區間。']};
}
export interface AuroraActualLap {lap:number;seconds:number;compound:AuroraCompound;pits:number}
export class AuroraStrategySession {
 private bound:{context:AuroraStrategyContext;estimate:AuroraStrategyEstimate}|null=null;private samples:AuroraActualLap[]=[];private done=false;
 get active(){return!!this.bound&&!this.done;}
 arm(context:AuroraStrategyContext,plan:AuroraPlan){const estimate=estimateAuroraPlan(context,plan);if(!estimate)throw Error('策略條件或停站計畫無效');this.bound={context:structuredClone(context),estimate};this.samples=[];this.done=false;}
 clear(){this.bound=null;this.samples=[];this.done=false;}
 observe(context:Pick<AuroraStrategyContext,'trackId'|'trackStamp'|'rules'|'laps'>,sample:AuroraActualLap){if(!this.bound||this.done)return false;const original=this.bound.context;
  if(['trackId','trackStamp','rules','laps'].some(k=>context[k as keyof typeof context]!==original[k as keyof typeof context]))return false;
  if(!Number.isInteger(sample.lap)||sample.lap!==this.samples.length+1||!num(sample.seconds,.001,3600)||!compound(sample.compound)||!Number.isSafeInteger(sample.pits)||sample.pits<(this.samples.at(-1)?.pits??0)||sample.pits>100||sample.lap>original.laps)return false;this.samples.push(structuredClone(sample));return true;
 }
 finish(){if(!this.bound)return null;this.done=true;return this.report();}
 report(){if(!this.bound)return null;const actual=this.samples.reduce((sum,row)=>sum+row.seconds,0),last=this.bound.estimate.rows[this.samples.length-1],expected=last?.cumulative??{min:0,max:0};return{v:1,context:structuredClone(this.bound.context),plan:structuredClone(this.bound.estimate.plan),finished:this.done,complete:this.samples.length===this.bound.context.laps,actual:structuredClone(this.samples),actualSeconds:actual,expectedSeconds:{...expected},differenceSeconds:{min:actual-expected.max,max:actual-expected.min},observedStops:this.samples.filter((sample,index)=>sample.pits>(this.samples[index-1]?.pits??0)).map(sample=>({observedDuringLap:sample.lap,totalStops:sample.pits})),note:'停站只標註此完圈觀察到次數增加，不冒稱精確進站時間；不寫入正式成績。'};}
}
