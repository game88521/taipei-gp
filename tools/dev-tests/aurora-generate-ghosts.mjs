// Rex <game88521@gmail.com>. Offline asset authoring: genuine FreeCar controls/collider; no pose edits after placement.
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {realCityWorld} from '../../server/summit-city-race-service.mjs';
import {FreeCar,ROAD_Y} from '../../server/summit-city-physics.mjs';
import {COOP_STATIONS,COOP_CITY_STAMP} from '../../shared/nexus-coop.ts';
import {PracticeRecorder} from '../../src/frontier-tandem-practice.ts';
import {ConvoyRoadBot} from './frontier-convoy-bot.mjs';
const w=realCityWorld(),a=w.roads.nearest(COOP_STATIONS[0].x,COOP_STATIONS[0].z,'ground',150),b=w.roads.nearest(COOP_STATIONS[2].x,COOP_STATIONS[2].z,'ground',150),route=w.roads.route([a.id,b.id]);
const leg={...route,target:route.gates.at(-1)},ghosts=[],evidence=[];
for(const[index,duration]of[20,35,50].entries()){
 const car=new FreeCar();FreeCar.surface=w.surfaceAt;car.spec=w.spec('muscle',false);car.place(route.start.x,route.start.z,route.start.h,route.start.y+ROAD_Y);
 const recorder=new PracticeRecorder(car,(index+1).toString(16).padStart(24,'0'),0),bot=new ConvoyRoadBot({speed:[8,9,10][index]});let hits=0;
 for(let tick=0;tick<duration*120;tick++){const input=bot.input(car,leg,0,tick*1000/120);car.drift=false;hits+=car.update(1/120,input.steer,input.throttle,input.brake,w.collider)>0?1:0;recorder.step(1/120,car);}
 const ghost=recorder.finish();assert.ok(ghost,recorder.reason);assert.equal(hits,0,'authored lesson must avoid static collisions');ghosts.push(ghost);evidence.push({lesson:index+1,seconds:duration,distanceM:ghost.distanceM,frames:ghost.frames.length,hits,trueFreeCar:true,controlsOnly:true});
}
const sourceFiles=['src/freecar.ts','public/data/city.json','tools/dev-tests/frontier-convoy-bot.mjs'];const sources=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await readFile(new URL('../../'+f,import.meta.url))).digest('hex')])));
await writeFile(new URL('../../src/aurora-ghosts.json',import.meta.url),JSON.stringify({map:COOP_CITY_STAMP,physics:'aurora-freecar-20261123-v1',ghosts})+'\n');
await writeFile(new URL('aurora-ghost-authoring-result.json',import.meta.url),JSON.stringify({status:'PASS',localOnly:true,externalRequests:0,generated:true,sources,evidence},null,2)+'\n');console.log(JSON.stringify({status:'PASS',evidence}));
