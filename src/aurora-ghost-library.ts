/** Rex <game88521@gmail.com>. Versioned local teaching ghosts; imports never carry scores or private seats. */
import city from '../shared/nexus-coop-city.json' with {type:'json'};
import library from './aurora-ghosts.json' with {type:'json'};
import {parsePracticeGhost,TANDEM_GHOST_BYTES,type PracticeGhost} from './frontier-tandem-practice.ts';
export const AURORA_GHOST_PHYSICS='aurora-freecar-20261123-v1';
export const AURORA_GHOST_MAX_BYTES=TANDEM_GHOST_BYTES+1024;
export interface GhostLesson {id:string;title:string;help:string;minSlip:number;goodSeconds:number;ghost:PracticeGhost}
export interface GhostShare {type:'taipei-gp-aurora-ghost';v:1;map:string;physics:typeof AURORA_GHOST_PHYSICS;lesson:string|null;ghost:PracticeGhost}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseGhostShare(raw:string):GhostShare|null{
 if(new TextEncoder().encode(raw).length>AURORA_GHOST_MAX_BYTES)return null;
 try{const v:unknown=JSON.parse(raw);if(!object(v)||Object.keys(v).sort().join(',')!=='ghost,lesson,map,physics,type,v'||v.type!=='taipei-gp-aurora-ghost'||v.v!==1||v.map!==city.stamp||v.physics!==AURORA_GHOST_PHYSICS||!(v.lesson===null||['gap','corners','drift'].includes(String(v.lesson))))return null;
  const ghost=parsePracticeGhost(v.ghost);if(!ghost)return null;
  for(let i=1;i<ghost.frames.length;i++){const a=ghost.frames[i-1],b=ghost.frames[i],dt=(b[0]-a[0])/1000,expectedX=(a[5]+b[5])*.5*dt,expectedZ=(a[6]+b[6])*.5*dt,angle=Math.abs(Math.atan2(Math.sin(b[4]-a[4]),Math.cos(b[4]-a[4])));if(Math.hypot(b[1]-a[1]-expectedX,b[2]-a[2]-expectedZ)>.3+30*dt*dt||Math.hypot(b[5]-a[5],b[6]-a[6])>200*dt+3||angle>8*dt+.08)return null;}
  if(v.lesson!==null){const index=['gap','corners','drift'].indexOf(String(v.lesson));if(JSON.stringify(ghost)!==JSON.stringify(library.ghosts[index]))return null;}
  return{type:'taipei-gp-aurora-ghost',v:1,map:city.stamp,physics:AURORA_GHOST_PHYSICS,lesson:v.lesson as string|null,ghost};
 }catch{return null;}
}
export function shareGhost(ghost:PracticeGhost,lesson:string|null=null):GhostShare{
 const value={type:'taipei-gp-aurora-ghost' as const,v:1 as const,map:city.stamp,physics:AURORA_GHOST_PHYSICS,lesson,ghost};
 const parsed=parseGhostShare(JSON.stringify(value));if(!parsed)throw Error('鬼車版本、大小或軌跡不符，未匯出。');return parsed;
}
const descriptions=[
 {id:'gap',title:'第1課：穩定跟車',help:'保持後方3～25m、同路層與同方向，先累積6秒有效跟車；這一課不要求滑角。',minSlip:0,goodSeconds:6},
 {id:'corners',title:'第2課：彎道銜接',help:'跟隨真道路領跑，保持速度與橫向距離，滑角至少4度，累積10秒有效跟車。',minSlip:Math.PI/45,goodSeconds:10},
 {id:'drift',title:'第3課：完整追走',help:'使用原本8～60度滑角規則，累積12秒有效追走；碰撞會斷連段。',minSlip:.14,goodSeconds:12},
];
export function ghostLessons():GhostLesson[]{
 if(library.map!==city.stamp||library.physics!==AURORA_GHOST_PHYSICS)return[];
 return descriptions.flatMap((lesson,index)=>{const ghost=parsePracticeGhost(library.ghosts[index]);return ghost?[{...lesson,ghost}]:[];});
}
