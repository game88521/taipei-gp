import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { loadGameModules } from './racing-test-env.mjs';
import { pureUrl } from './pure-module-loader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),before=path.resolve(root,'../taipei-gp-evolution-before-d251460c360c');
const ai=await import(await pureUrl(root,'evolution-ai.ts')),cases=[];
async function test(name,fn){const details=await fn();cases.push({name,status:'PASS',details});console.log('PASS',name);}
async function fixture(base){let calls=0;const env=await loadGameModules(base,{random:()=>{calls++;return .5;}}),track=env.track.buildTrack(),field=new env.rivals.RaceField(new THREE.Scene(),track,new env.car.Car());field.setup(9);return{env,track,field,calls:()=>calls};}
function setupConflict(field,track,distance=0){const r=field.racers[0],incoming=field.racers[1],i=300;
  for(const [k,o]of field.racers.entries()){o.car.placeAt(track,(i+200+k*15)%track.N);o.car.x+=10000;}
  r.car.placeAt(track,i);r.car.x-=track.tz[i]*6;r.car.z+=track.tx[i]*6;r.car.pos.lat=6;r.stuck=3.1;r.car.v=0;
  incoming.car.placeAt(track,(i-Math.round(distance/track.ds)+track.N)%track.N);incoming.car.v=55;
  return{r,incoming,original:[r.car.x,r.car.z]};
}
await test('真 before 私有 drive：卡住三秒後直接扶正，與來車重疊',async()=>{const{track,field}=await fixture(before),{r,incoming,original}=setupConflict(field,track);field.drive(r,false,1/120);assert.equal(r.stuck,0);const distance=Math.hypot(r.car.x-incoming.car.x,r.car.z-incoming.car.z);assert.ok(distance<.01);assert.ok(Math.hypot(r.car.x-original[0],r.car.z-original[1])>5);return{distance,sourceSha256:createHash('sha256').update(await readFile(path.join(before,'src/rivals.ts'))).digest('hex')};});
await test('safe-v1 真 drive：有重疊／後方55m/s來車時停住等待，車流清空才扶正',async()=>{for(const approach of[0,50]){const{track,field}=await fixture(root),{r,original}=setupConflict(field,track,approach);field.aiPolicy='safe-v1';const input=field.drive(r,false,1/120);assert.deepEqual([r.car.x,r.car.z],original);assert.equal(input.brake,true);assert.ok(r.stuck>3);for(const o of field.racers)if(o!==r){o.car.pos.s=(r.car.pos.s+500)%track.length;o.car.x+=10000;}field.drive(r,false,1/120);assert.equal(r.stuck,0);assert.ok(Math.hypot(r.car.x-track.px[300],r.car.z-track.pz[300])<.01);}return{approaches:[0,50]};});
await test('回場走廊包含跨起跑線、前車、快車在兩frame之間穿過與立交近距離',()=>{const target={s:3,lat:0,v:0,x:0,z:0},other={s:980,lat:0,v:80,x:100,z:100};assert.equal(ai.canRejoin(target,[other],1000),false);assert.equal(ai.canRejoin(target,[{...other,s:12,v:0}],1000),false);assert.equal(ai.canRejoin(target,[{...other,s:500,x:2,z:2}],1000),false);assert.equal(ai.canRejoin(target,[{...other,s:500}],1000),true);});
await test('並排留2.8m且不能防守切入；路緣無空間先煞車；無觸發時保留原目標',()=>{const other={s:104,lat:0,v:45,x:0,z:0},a=ai.safeLane(-3,3,45,[other],100,1000,5.7,.1);assert.ok(a.target<=-2.8);assert.equal(a.constrained,true);const edge=ai.safeLane(-5,-5,45,[{...other,lat:-3}],100,1000,5.7,.1);assert.equal(edge.brake,true);const empty=ai.safeLane(-2,3.14159,45,[],100,1000,5.7,.1);assert.equal(empty.target,3.14159);assert.equal(empty.constrained,false);});
await test('legacy真before/after逐步模擬snapshot及一般亂數呼叫完全一致；restore舊checkpoint鎖legacy',async()=>{const a=await fixture(before),b=await fixture(root);assert.equal(b.field.aiPolicy,'legacy');for(let i=0;i<5000;i++){a.field.update(1/120,true);b.field.update(1/120,true);}assert.deepEqual(JSON.parse(JSON.stringify(b.field.snapshot())),JSON.parse(JSON.stringify(a.field.snapshot())));assert.equal(a.calls(),b.calls());b.field.aiPolicy='safe-v1';assert.equal(b.field.restore(b.field.snapshot()),true);assert.equal(b.field.aiPolicy,'legacy');return{seconds:5000/120,randomCalls:a.calls(),aiHits:b.field.aiHits};});
await writeFile(path.join(root,'tools/dev-tests/evolution-racing-ai-result.json'),JSON.stringify({status:'PASS',before,cases},null,2)+'\n');
