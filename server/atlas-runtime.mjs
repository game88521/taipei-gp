import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
const integer=(v,name,fallback,max)=>{if(v===undefined)return fallback;const n=typeof v==='number'?v:/^[1-9]\d*$/.test(String(v))?Number(v):NaN;if(!Number.isSafeInteger(n)||n<1||n>max)throw Error(`${name} must be an integer from 1 to ${max}.`);return n;};
export function atlasCapacity(env=process.env) {
  return {gpRooms:integer(env.ATLAS_GP_ROOMS,'ATLAS_GP_ROOMS',12,100),coopRooms:integer(env.ATLAS_COOP_ROOMS,'ATLAS_COOP_ROOMS',4,24),cityRooms:integer(env.ATLAS_CITY_ROOMS,'ATLAS_CITY_ROOMS',4,24),connections:integer(env.ATLAS_MAX_CONNECTIONS,'ATLAS_MAX_CONNECTIONS',64,256)};
}
const summary=rows=>{const sorted=[...rows].sort((a,b)=>a-b);return{samples:rows.length,p50Ms:sorted.length?+sorted[Math.floor((sorted.length-1)*.5)].toFixed(3):null,p95Ms:sorted.length?+sorted[Math.floor((sorted.length-1)*.95)].toFixed(3):null,maxMs:sorted.length?+sorted.at(-1).toFixed(3):null};};
export class AtlasRuntime {
  constructor(){this.started=performance.now();this.cpu=process.cpuUsage();this.ticks=new Map();this.rssHigh=process.memoryUsage().rss;this.warmupMs=null;this.loop=monitorEventLoopDelay({resolution:20});this.loop.enable();}
  run(name,fn){const begin=performance.now();try{return fn();}finally{const rows=this.ticks.get(name)??[];rows.push(performance.now()-begin);if(rows.length>600)rows.shift();this.ticks.set(name,rows);}}
  snapshot(){const memory=process.memoryUsage(),elapsed=Math.max(1,performance.now()-this.started),cpu=process.cpuUsage(this.cpu);this.rssHigh=Math.max(this.rssHigh,memory.rss);return{window:'last600-active-ticks',uptimeMs:Math.round(elapsed),warmupMs:this.warmupMs,rssBytes:memory.rss,rssHighBytes:this.rssHigh,heapUsedBytes:memory.heapUsed,cpuMs:+((cpu.user+cpu.system)/1000).toFixed(2),cpuOneCorePercent:+((cpu.user+cpu.system)/10/elapsed).toFixed(2),eventLoop:this.loop.count?{samples:Number(this.loop.count),p95Ms:+(this.loop.percentile(95)/1e6).toFixed(3),maxMs:+(this.loop.max/1e6).toFixed(3)}:{samples:0,p95Ms:null,maxMs:null},ticks:Object.fromEntries([...this.ticks].map(([key,rows])=>[key,summary(rows)]))};}
  close(){this.loop.disable();}
}
