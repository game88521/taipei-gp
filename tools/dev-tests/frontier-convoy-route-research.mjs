// Rex <game88521@gmail.com>. Read-only production city graph research; no car placement or product mutation.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {realCityWorld} from '../../server/summit-city-race-service.mjs';
import {ROAD_Y} from '../../server/summit-city-physics.mjs';
import {COOP_STATIONS} from '../../shared/nexus-coop.ts';

const world=realCityWorld(),roads=world.roads;
const anchors=COOP_STATIONS.map(station=>{
 const candidates=[...roads.nodes].map(([id,p])=>({id,p,distance:Math.hypot(p.x-station.x,p.z-station.z),heightError:Math.abs(p.y+ROAD_Y-station.y)})).filter(p=>p.distance<=150&&p.heightError<=2).sort((a,b)=>a.distance-b.distance);
 assert.ok(candidates.length,`${station.id} has no same-layer existing road anchor`);
 const a=candidates[0];return{stationId:station.id,name:station.name,x:station.x,z:station.z,stationY:station.y,id:a.id,nodeY:a.p.y+ROAD_Y,elevated:a.p.elevated,distance:a.distance,heightError:a.heightError};
});
const pairs=[];
for(const a of anchors)for(const b of anchors)if(a!==b){try{const route=roads.route([a.id,b.id]);pairs.push({from:a.stationId,to:b.stationId,valid:true,length:route.length,pathPoints:route.path.length,gates:route.gates.length,startY:route.ys[0]+ROAD_Y,endY:route.ys.at(-1)+ROAD_Y});}catch(e){pairs.push({from:a.stationId,to:b.stationId,valid:false,error:String(e.message)});}}
const options=[['station-0','station-6','station-1'],['station-0','station-5','station-3','station-2'],['station-0','station-4','station-2','station-5','station-3']];
const routes=options.map(stationIds=>{const ids=stationIds.map(s=>anchors.find(a=>a.stationId===s).id),route=roads.route(ids);return{stationIds,nodeIds:ids,length:route.length,pathPoints:route.path.length,gates:route.gates.length,legs:stationIds.slice(1).map((to,i)=>pairs.find(p=>p.from===stationIds[i]&&p.to===to))};});
const result={status:'PASS',readOnly:true,localOnly:true,externalRequests:0,stamp:roads.stamp,anchors,pairs,routes,limitations:['Routes are recomputed with the actual directed city graph and true elevations. This read-only research does not prove human playability or a complete car-driven circuit.']};
await writeFile(new URL('frontier-convoy-route-research-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
