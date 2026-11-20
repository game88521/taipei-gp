// Rex <game88521@gmail.com>. Real directed roads; arrivals never relocate a car.
import {CONVOY_VERSION,CONVOY_DWELL_MS,CONVOY_MIN_PLAYERS,convoyDefinition,convoyCrossed,convoyDocked} from '../shared/frontier-convoy.ts';
import {COOP_STATIONS} from '../shared/nexus-coop.ts';
import {ROAD_Y} from './summit-city-physics.mjs';
export function createConvoy(roads,routeId){
 const def=convoyDefinition(routeId);if(!def)throw Error('請選擇三條車隊巡遊路線之一');
 const stations=[COOP_STATIONS[0],...def.stations.map(id=>COOP_STATIONS.find(s=>s.id===id))],legs=[];
 for(let i=1;i<stations.length;i++){
  const a=stations[i-1],b=stations[i],from=roads.nearest(a.x,a.z,'ground',150),to=roads.nearest(b.x,b.z,'ground',150);
  if(!from||!to)throw Error('巡遊站點無法連接真實道路');
  const route=roads.route([from.id,to.id]),last=route.path.at(-1),prev=route.path.at(-2);
  legs.push({path:route.path.map(p=>[...p]),ys:route.ys.map(y=>y+ROAD_Y),gates:route.gates.map(g=>({...g,y:g.y+ROAD_Y})),length:route.length,start:{...route.start,y:route.start.y+ROAD_Y,name:a.name},target:{x:last[0],z:last[1],y:route.ys.at(-1)+ROAD_Y,h:Math.atan2(last[0]-prev[0],last[1]-prev[1]),name:b.name}});
 }
 return{routeId:def.id,stop:0,completed:0,totalLength:legs.reduce((n,l)=>n+l.length,0),legs};
}
export function resetConvoy(r){if(!r.convoy)return;r.convoy.stop=r.convoy.completed=0;for(const p of r.players.values())resetConvoyPlayer(p);}
export function resetConvoyPlayer(p){p.convoyNext=0;p.convoyDwell=0;p.convoyArrived=false;}
export function convoySnapshot(r){const c=r.convoy;if(!c)return undefined;return{v:CONVOY_VERSION,routeId:c.routeId,stop:c.stop,completed:c.completed,totalLength:c.totalLength,leg:c.legs[c.stop],participants:[...r.players.values()].map(p=>({slot:p.slot,next:p.outcome?0:p.convoyNext??0,arrived:!p.outcome&&!!p.convoyArrived,dwellMs:p.outcome?0:Math.min(CONVOY_DWELL_MS,Math.round(p.convoyDwell??0)),withdrawn:p.outcome==='left'}))};}
export function stepConvoy(r,old,at,finish,stage){
 const c=r.convoy;if(!c||r.phase!=='running')return;
 const active=[...r.players.values()].filter(p=>!p.outcome),leg=c.legs[c.stop];
 if(active.length<CONVOY_MIN_PLAYERS){finish('left',at);return;}
 for(const p of active){
  if(!p.client){p.convoyDwell=0;p.convoyArrived=false;continue;}
  const before=old.get(p.id)??p.car;
  while(p.convoyNext<leg.gates.length&&convoyCrossed(before,p.car,leg.gates[p.convoyNext]))p.convoyNext++;
  const docked=p.convoyNext===leg.gates.length&&convoyDocked(p.car,leg.target);
  p.convoyDwell=docked?Math.min(CONVOY_DWELL_MS,(p.convoyDwell??0)+1000/60):0;
  p.convoyArrived=p.convoyDwell>=CONVOY_DWELL_MS-.0001;
  if(p.convoyArrived)p.convoyDwell=CONVOY_DWELL_MS;
 }
 if(!active.every(p=>p.client&&p.convoyArrived))return;
 c.completed++;stage(at,active.map(p=>p.id));
 if(c.completed===c.legs.length){finish('complete',at);return;}
 c.stop=c.completed;for(const p of active)resetConvoyPlayer(p);
}
