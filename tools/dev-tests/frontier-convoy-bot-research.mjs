// Rex <game88521@gmail.com>. Actual FreeCar/collider/stepConvoy controller prototype, not a WebSocket integration claim.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {realCityWorld} from '../../server/summit-city-race-service.mjs';
import {FreeCar} from '../../server/summit-city-physics.mjs';
import {createConvoy,resetConvoyPlayer,stepConvoy} from '../../server/frontier-convoy-service.mjs';
import {ConvoyRoadBot} from './frontier-convoy-bot.mjs';
const world=realCityWorld();FreeCar.surface=world.surfaceAt;const routeId=process.argv[2]??'south-loop',debug=process.argv.includes('--debug'),convoy=createConvoy(world.roads,routeId),room={phase:'running',convoy,players:new Map()},bots=new Map(),marks=[],trace=[],contacts=[];let finished=null,hits=0,tick=0;
for(let slot=0;slot<2;slot++){const car=new FreeCar(),s=convoy.legs[0].start,side=slot?1.7:-1.7;car.spec=world.spec('sedan');car.place(s.x+Math.cos(s.h)*side,s.z-Math.sin(s.h)*side,s.h,s.y);const p={id:`bot-${slot}`,slot,client:true,car,outcome:''};resetConvoyPlayer(p);room.players.set(p.id,p);bots.set(p.id,new ConvoyRoadBot({speed:slot?7:8,delay:slot?600:0}));}
for(;tick<60*(debug?200:1500)&&room.phase==='running';tick++){
 const old=new Map([...room.players.values()].map(p=>[p.id,{x:p.car.x,y:p.car.y,z:p.car.z}]));
 for(const p of room.players.values()){const input=bots.get(p.id).input(p.car,convoy.legs[convoy.stop],p.convoyNext,tick*1000/60),impact=p.car.update(1/60,input.steer,input.throttle,input.brake,world.collider);if(impact>0){hits++;contacts.push({tick,slot:p.slot,impact,x:p.car.x,z:p.car.z,y:p.car.y,progress:bots.get(p.id).progress,next:p.convoyNext});}if(!input.active){p.car.vx*=.8;p.car.vz*=.8;p.car.w*=.8;if(Math.hypot(p.car.vx,p.car.vz)<.2)p.car.vx=p.car.vz=p.car.w=0;}}
 stepConvoy(room,old,tick*1000/60,(reason,at)=>{room.phase='finished';finished={reason,at};},at=>marks.push({at,completed:convoy.completed,poses:[...room.players.values()].map(p=>({x:p.car.x,z:p.car.z,y:p.car.y,next:p.convoyNext,arrived:p.convoyArrived}))}));
 if(tick%(debug?60:600)===0)trace.push({tick,stop:convoy.stop,players:[...room.players.values()].map(p=>({slot:p.slot,x:p.car.x,z:p.car.z,y:p.car.y,h:p.car.h,speed:p.car.v,next:p.convoyNext,target:convoy.legs[convoy.stop].target,progress:bots.get(p.id).progress}))});
 if(tick%6000===0)console.log(JSON.stringify(trace.at(-1)));
}
const result={status:finished?.reason==='complete'?'PASS':'FAIL',prototypeOnly:true,realFreeCar:true,trueCollider:true,networkTested:false,noRelocationAfterInitialSpawn:true,routeId,finished,hits,ticks:tick,marks,trace,contacts};await writeFile(new URL(`frontier-convoy-bot-research-${routeId}${debug?'-debug':''}-result.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,routeId,finished,hits,ticks:tick,marks:marks.map(m=>({at:m.at,completed:m.completed})),last:trace.at(-1),contacts}));assert.equal(result.status,'PASS');
