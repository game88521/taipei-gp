/** Rex <game88521@gmail.com>. Cooperative route progress is owned by the social authority. */
export const CONVOY_VERSION='frontier-convoy-v1';
export const CONVOY_DWELL_MS=2000;
export const CONVOY_MIN_PLAYERS=2;
export const CONVOY_ROUTES=[
 {id:'south-loop',name:'南城倉庫巡遊',stations:['station-6','station-1','station-0']},
 {id:'north-loop',name:'北城大道巡遊',stations:['station-5','station-3','station-2','station-0']},
 {id:'city-loop',name:'城市五站巡遊',stations:['station-6','station-1','station-3','station-5','station-0']},
] as const;
export type ConvoyRouteId=typeof CONVOY_ROUTES[number]['id'];
export interface ConvoyPoint{x:number;y:number;z:number}
export interface ConvoyStop extends ConvoyPoint{h:number;name:string}
export interface ConvoyLeg{path:[number,number][];ys:number[];gates:ConvoyPoint[];start:ConvoyStop;target:ConvoyStop;length:number}
export interface ConvoyParticipant{slot:number;next:number;arrived:boolean;dwellMs:number;withdrawn:boolean}
export interface ConvoyState{v:typeof CONVOY_VERSION;routeId:ConvoyRouteId;stop:number;completed:number;totalLength:number;leg:ConvoyLeg;participants:ConvoyParticipant[]}
export interface ConvoySummary{routeId:ConvoyRouteId;completed:number;total:number;participants:number;finished:number}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const num=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const int=(v:unknown,lo:number,hi:number):v is number=>num(v,lo,hi)&&Number.isSafeInteger(v);
const point=(v:unknown):v is ConvoyPoint=>object(v)&&exact(v,['x','y','z'])&&num(v.x,-12000,12000)&&num(v.z,-12000,12000)&&num(v.y,-80,500);
const stop=(v:unknown):v is ConvoyStop=>object(v)&&exact(v,['x','y','z','h','name'])&&num(v.x,-12000,12000)&&num(v.z,-12000,12000)&&num(v.y,-80,500)&&num(v.h,-Math.PI,Math.PI)&&typeof v.name==='string'&&v.name.length>0&&v.name.length<=60&&!/[\x00-\x1f\x7f<>]/.test(v.name);
export const convoyDefinition=(id:unknown)=>CONVOY_ROUTES.find(r=>r.id===id)??null;
export function validConvoyLeg(v:unknown):v is ConvoyLeg{
 if(!object(v)||!exact(v,['path','ys','gates','start','target','length'])||!num(v.length,100,20000)||!stop(v.start)||!stop(v.target)||!Array.isArray(v.path)||v.path.length<2||v.path.length>1500||!Array.isArray(v.ys)||v.ys.length!==v.path.length||!v.ys.every(y=>num(y,-80,500))||!v.path.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>num(n,-12000,12000)))||!Array.isArray(v.gates)||!v.gates.length||v.gates.length>700||!v.gates.every(point))return false;
 const first=v.path[0],last=v.path.at(-1)!;
 return Math.hypot(first[0]-v.start.x,first[1]-v.start.z)<.01&&Math.abs(Number(v.ys[0])-v.start.y)<.01&&Math.hypot(last[0]-v.target.x,last[1]-v.target.z)<.01&&Math.abs(Number(v.ys.at(-1))-v.target.y)<.01;
}
export function parseConvoyState(v:unknown):ConvoyState|null{
 if(!object(v)||!exact(v,['v','routeId','stop','completed','totalLength','leg','participants'])||v.v!==CONVOY_VERSION||!validConvoyLeg(v.leg)||!num(v.totalLength,v.leg.length,60000)||!Array.isArray(v.participants)||v.participants.length<1||v.participants.length>4)return null;
 const def=convoyDefinition(v.routeId);if(!def||!int(v.stop,0,def.stations.length-1)||!int(v.completed,0,def.stations.length)||v.stop!==Math.min(v.completed,def.stations.length-1))return null;
 const slots=new Set<number>();for(const p of v.participants){if(!object(p)||!exact(p,['slot','next','arrived','dwellMs','withdrawn'])||!int(p.slot,0,3)||slots.has(p.slot)||!int(p.next,0,v.leg.gates.length)||typeof p.arrived!=='boolean'||typeof p.withdrawn!=='boolean'||!int(p.dwellMs,0,CONVOY_DWELL_MS)||p.arrived&&(p.next!==v.leg.gates.length||p.dwellMs!==CONVOY_DWELL_MS||p.withdrawn)||p.withdrawn&&(p.arrived||p.dwellMs!==0))return null;slots.add(p.slot);}
 return structuredClone(v) as unknown as ConvoyState;
}
export function parseConvoySummary(v:unknown):ConvoySummary|null{
 if(!object(v)||!exact(v,['routeId','completed','total','participants','finished']))return null;const def=convoyDefinition(v.routeId);
 return def&&v.total===def.stations.length&&int(v.completed,0,def.stations.length)&&int(v.participants,2,4)&&int(v.finished,0,v.participants)?{...v} as unknown as ConvoySummary:null;
}
/** Ordered same-layer gates. No client pose, route skip or teleport command exists. */
export function convoyCrossed(a:ConvoyPoint,b:ConvoyPoint,gate:ConvoyPoint){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((gate.x-a.x)*dx+(gate.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(a.x+t*dx-gate.x,a.z+t*dz-gate.z)<=10&&Math.abs(a.y+t*(b.y-a.y)-gate.y)<1.8;}
export function convoyDocked(p:ConvoyPoint&{vx:number;vz:number},target:ConvoyPoint){return Math.hypot(p.x-target.x,p.z-target.z)<=12&&Math.abs(p.y-target.y)<1.8&&Math.hypot(p.vx,p.vz)<=2;}
