// Rex <game88521@gmail.com>. Read-only path inspection for controller debugging.
import {realCityWorld} from '../../server/summit-city-race-service.mjs';
import {createConvoy} from '../../server/frontier-convoy-service.mjs';
const world=realCityWorld(),route=createConvoy(world.roads,'north-loop').legs[0],points=[];let s=0;
for(let i=0;i<route.path.length;i++){if(i)s+=Math.hypot(route.path[i][0]-route.path[i-1][0],route.path[i][1]-route.path[i-1][1]);if(s>=800&&s<=1150)points.push({i,s,x:route.path[i][0],z:route.path[i][1],y:route.ys[i]});}
const samples=[];for(let x=10;x<=42;x+=2){const row=[];for(let z=-15;z<=5;z+=2){const out=[];world.collider.contacts(x,z,.95,out,-.25);if(out.length)row.push({z,contacts:out});}if(row.length)samples.push({x,row});}console.log(JSON.stringify({points,gates:route.gates.slice(26,37),samples,edges:world.collider.edges.query(28,-5.5,30,[])},null,2));
