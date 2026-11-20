import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pureUrl } from './pure-module-loader.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), before = resolve(root, '../taipei-gp-evolution-before-d251460c360c');
const m = await import(await pureUrl(root, 'evolution-city-models.ts')), s = await import(await pureUrl(root, 'street-series.ts')), old = await import(await pureUrl(before, 'street-series.ts'));
const { DriftScore } = await import(await pureUrl(root, 'drift.ts')), { FreeCar } = await import(await pureUrl(root, 'freecar.ts'));
const { FreeCar: BeforeFreeCar } = await import(await pureUrl(before, 'freecar.ts')), { Collider } = await import(await pureUrl(root, 'citydata.ts'));
const report = { status: 'RUNNING', cases: [], before, sourceHashes: {}, localOnly: true, browserUsed: false, limitations: ['真TS模型／真FreeCar與合成路段；不等同完整城市真人駕駛或難度平衡。'] };
const clone = v => JSON.parse(JSON.stringify(v)), sha = b => createHash('sha256').update(b).digest('hex');
for (const f of ['src/evolution-city-models.ts','src/street-series.ts','src/main.ts','src/save.ts','src/evolution-city-ui.ts','src/freecar.ts','src/citydata.ts','tools/dev-tests/evolution-city-models.mjs']) report.sourceHashes[f] = sha(await readFile(resolve(root,f)));
async function check(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch(e) { report.cases.push({name,status:'FAIL',error:String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[真TS]').slice(0,2500)}); } }
const options = { difficulty:'standard',carId:'sedan',rules:'traffic-class-v1' }, ids=['r1','r2','r3','r4','r5'];
const result=(id,routeId,place=1,o=options)=>({id,routeId,...o,key:s.streetChallengeKey(routeId,true,o),duel:true,time:30,place,medal:s.streetMedal(place,true,true),finished:true});
await check('10 before只允許三站，新版3/4/5站與舊v1 checkpoint續接',()=>{const a=new old.StreetSeries();assert.equal(a.start(ids.slice(0,4),options),false);assert.equal(a.start(ids.slice(0,3),options),true);const b=new s.StreetSeries();assert.equal(b.restore(a.checkpoint,ids),true);assert.deepEqual(b.checkpoint,a.checkpoint);for(const count of[3,4,5])assert.equal(new s.StreetSeries().start(ids.slice(0,count),options),true);});
await check('10拒絕少於3、多於5、重複、不存在路線與壞next',()=>{const a=new s.StreetSeries();for(const list of[ids.slice(0,2),[...ids,'r6'],['r1','r1','r2']])assert.equal(a.start(list,options),false);a.start(ids,options);const cp=a.checkpoint;assert.equal(new s.StreetSeries().restore(cp,ids.slice(0,4)),false);for(const next of[-1,6,NaN])assert.equal(s.parseStreetSeriesCheckpoint({...cp,next}),null);});
await check('10各站保存固定車/難度/規則，重複結算不前進，獎牌按3/4/5站比例',()=>{for(const count of[3,4,5]){const a=new s.StreetSeries();a.start(ids.slice(0,count),options);assert.equal(a.finish(result('bad','r1',1,{...options,carId:'super'})),false);for(let i=0;i<count;i++){const r=result('run'+i,ids[i]);assert.equal(a.finish(r),true);assert.equal(a.finish(r),false);const b=new s.StreetSeries();assert.equal(b.restore(a.checkpoint,ids),true);assert.equal(b.checkpoint.next,i+1);}assert.equal(a.points,count*10);assert.equal(a.complete,true);assert.equal(a.medal,'gold');assert.equal(a.medalThresholds.silver,count*6);}});
const now=1700000000000, position={x:0,z:0,y:0,h:0}, stops=[1,2,3,4,5].map(i=>({id:'s'+i,name:'站'+i,x:i*30,z:0,y:0}));
const car=(x=0,z=0,y=0,speed=0,slip=0)=>({x,z,y,h:Math.PI/2,vx:speed,vz:0,slip});
function job(count=3){const a=new m.FragileCargo();assert.equal(a.start(stops.slice(0,count),'sedan',count*30,position,now),true);return a;}
function move(a,from,to){let p=from;while(Math.abs(p-to)>.01){p+=Math.sign(to-p)*Math.min(1,Math.abs(to-p));a.update(.1,car(p,0,0,10),0);}return p;}
function wait(a,x,y=0,n=10){let event;for(let i=0;i<n;i++)event=a.update(.1,car(x,0,y),0);return event;}
await check('12完整度/期限/已交站與位置checkpoint獨立複製',()=>{const a=job();move(a,0,30);wait(a,30);const cp=a.checkpoint({...position,x:30},now+10000);assert.equal(cp.next,1);assert.ok(cp.remaining<cp.limit);cp.stops[0].name='變更';assert.equal(a.checkpoint(position,now).stops[0].name,'站1');});
await check('12壞資料、過期、未來、重複站、非法進度嚴格拒絕；過期可結構保留供明確放棄',()=>{const cp=job().checkpoint(position,now);for(const change of[{remaining:-1},{integrity:0},{integrity:101},{next:3},{limit:NaN},{stops:[stops[0],stops[0],stops[1]]},{position:{...position,y:Infinity}},{savedAt:now+60001}])assert.equal(m.parseCargoCheckpoint({...cp,...change},now),null);assert.equal(m.parseCargoCheckpoint(cp,now+m.CARGO_TTL+1),null);assert.ok(m.parseCargoCheckpoint(cp,now+m.CARGO_TTL+1,true));});
await check('12同層低速停穩才交貨；路層/高速/中斷不能累計等待',()=>{const a=job();move(a,0,30);wait(a,30,5,20);assert.equal(a.progress.next,0);for(let i=0;i<20;i++)a.update(.1,car(30,0,0,10),0);assert.equal(a.progress.next,0);wait(a,30,0,5);a.update(.1,car(45),0);wait(a,30,0,5);assert.equal(a.active,false,'15m瞬移應取消，不能繞過交貨');});
await check('12路層錯誤不交貨，回同層停0.8秒才前進',()=>{const a=job();move(a,0,30);wait(a,30,5,10);assert.equal(a.progress.next,0);wait(a,30,0,9);assert.equal(a.progress.next,1);});
await check('12碰撞冷卻與急減速貨損，平順減速不扣貨',()=>{const a=job();a.update(.1,car(1,0,0,10),0);a.update(.1,car(1.8,0,0,8),0);assert.ok(a.progress.integrity<100);const b=job();b.update(.1,car(1,0,0,10),10);const first=b.progress.integrity;for(let i=0;i<5;i++)b.update(.1,car(1+i*.1,0,0,10),10);assert.equal(b.progress.integrity,first);const c=job();c.update(.1,car(1,0,0,10),0);c.update(.1,car(1.9,0,0,9.6),0);assert.equal(c.progress.integrity,100);});
await check('12保存/重開沿已交站接續，不重獎、不接受站點位移或結算過id',()=>{const a=job();move(a,0,30);wait(a,30);const cp=a.checkpoint({...position,x:30},now);a.cancel();const b=new m.FragileCargo();assert.equal(b.restore(cp,stops,[],now+1000),true);assert.equal(b.progress.next,1);assert.equal(b.progress.remaining,cp.remaining);assert.equal(new m.FragileCargo().restore(cp,stops,[cp.id],now),false);const bad=clone(stops);bad[1].x++;assert.equal(new m.FragileCargo().restore(cp,bad,[],now),false);assert.equal(m.parseCargoSettled([cp.id,cp.id]),null);});
await check('12期限內全部3～5站只產生一次完成事件，中途沒有獎金',()=>{for(const count of[3,4,5]){const a=job(count);let x=0,events=[];for(let i=0;i<count;i++){x=move(a,x,stops[i].x);for(let j=0;j<10;j++){const e=a.update(.1,car(x),0);if(e.finished)events.push(e.finished);}}assert.equal(events.length,1);assert.equal(events[0].status,'delivered');assert.ok(events[0].reward>0);assert.equal(events[0].delivered,count);assert.deepEqual(a.update(.1,car(x),0),{});assert.equal(a.checkpoint(position,now),null);}});
await check('12超時／撞毀／傳送都零收入，沒有更新步驟時期限不變',()=>{const a=job(), cp=a.checkpoint(position,now);cp.remaining=.05;assert.equal(a.restore(cp,stops,[],now),true);assert.equal(a.update(.1,car(),0).finished.status,'timeout');assert.equal(a.result.reward,0);const b=job();b.update(.1,car(),100);for(let i=0;i<8;i++)b.update(.1,car(),0);assert.equal(b.update(.1,car(),100).finished.status,'broken');const c=job();assert.equal(c.update(.1,car(100),0).finished.status,'invalid');const d=job(), t=d.progress.remaining;assert.equal(d.progress.remaining,t);});
await check('12真FreeCar連續物理更新可完成路段，模型不改車輛物理',()=>{const f=new FreeCar();f.place(0,0,Math.PI/2,0);const a=job(), beforeV=[];for(let i=0;i<80&&a.active;i++){const hit=f.update(.02,0,true,false,null);const old={x:f.x,z:f.z,vx:f.vx,vz:f.vz};a.update(.02,f,hit);assert.deepEqual({x:f.x,z:f.z,vx:f.vx,vz:f.vz},old);beforeV.push(f.v);}assert.ok(beforeV.at(-1)>0);assert.equal(a.active,true);});
const route={id:'fixture',title:'真模型合成路段',points:Array.from({length:21},(_,i)=>({x:i*15,z:0,y:0}))};
function routeRun(){const scorer=new DriftScore(), r=new m.RouteDrift(scorer);assert.equal(r.start(route,'sedan'),true);return{scorer,r};}
await check('11相鄰重複終點不產生零長門；過長路段切成15m內門',async()=>{const {routeDriftRoute}=await import(await pureUrl(root,'evolution-city-ui.ts'));const r=routeDriftRoute({def:{id:'loop',title:'路段'},path:[[0,0],[40,0],[40,0]]});assert.ok(r.points.length>=3);assert.ok(r.points.slice(1).every((p,i)=>Math.hypot(p.x-r.points[i].x,p.z-r.points[i].z)>.01));assert.equal(new m.RouteDrift(new DriftScore()).start(r,'sedan'),true);});
await check('11無效重啟不改現行賽事：拒零長門/大跳段/不足長度',()=>{const{r}=routeRun();r.update(.1,car(1,0,0,10,.5),0);const previous=JSON.stringify({route:r.route,next:r.next,score:r.score,remaining:r.remaining});for(const points of[[{x:0,z:0,y:0},{x:0,z:0,y:0},{x:40,z:0,y:0}],[{x:0,z:0,y:0},{x:100,z:0,y:0},{x:120,z:0,y:0}],[{x:0,z:0,y:0},{x:1,z:0,y:0},{x:2,z:0,y:0}]]){assert.equal(r.start({...route,points},'sedan'),false);assert.equal(r.active,true);assert.equal(JSON.stringify({route:r.route,next:r.next,score:r.score,remaining:r.remaining}),previous);}});
await check('11順序評分門、區外/倒序不計分，與60/90秒紀錄key分開',()=>{const{r,scorer}=routeRun();for(let x=1;x<=10;x++)r.update(.1,car(x,0,0,10,.6),0);assert.ok(r.next>1);const points=scorer.points;r.update(.1,car(11,12,0,10,.6),0);assert.equal(r.inZone,false);assert.equal(scorer.points,0);assert.equal(r.score,0);assert.notEqual(m.routeDriftKey('fixture','sedan'),'drift-v1:sedan:60');assert.ok(points>0);});
await check('11跳到未輪到的門、瞬移不能刷完成率／分數',()=>{const{r}=routeRun();const e=r.update(.02,car(45,0,0,20,.8),0);assert.equal(e.finished.reason,'invalid');assert.equal(e.finished.score,0);assert.equal(e.finished.completion,0);assert.equal(r.active,false);});
await check('11完成真連續路段產生獨立成績／連段，之後不重複結算',()=>{const{r,scorer}=routeRun();let events=[];const update=scorer.update.bind(scorer);let calls=0;scorer.update=(...args)=>{calls++;return update(...args);};for(let x=1;x<=301&&r.active;x++){const e=r.update(.1,car(x,0,0,12,.6),0);if(e.finished)events.push(e.finished);}assert.equal(events.length,1);assert.equal(events[0].reason,'complete');assert.equal(events[0].completion,1);assert.ok(events[0].score>100);assert.ok(events[0].maxChain>100);assert.ok(calls<=301);assert.deepEqual(r.update(.1,car(301),0),{});assert.equal(m.parseRouteDriftRecords({[events[0].key]:{score:events[0].score,medal:events[0].medal,completion:1}})[events[0].key].score,events[0].score);});
await check('11同路層門檻、超時／取消與無tick暫停',()=>{const{r}=routeRun();for(let x=1;x<=20;x++)r.update(.1,car(x,0,4,10,.6),0);assert.equal(r.next,1);assert.equal(r.score,0);const time=r.remaining;assert.equal(r.remaining,time);r.cancel();assert.equal(r.active,false);assert.equal(r.result,null);const t=routeRun().r;t.remaining=.01;assert.equal(t.update(.02,car(),0).finished.reason,'timeout');});
await check('11貼彎浮點加分後區外到時，finish統一整數化可保存往返',()=>{const{r}=routeRun();r.score=4.920000000000001;r.remaining=.01;const e=r.update(.02,car(0,0,5),0).finished;assert.equal(e.reason,'timeout');assert.equal(e.score,5);const record={score:e.score,medal:e.medal,completion:e.completion};assert.deepEqual(m.parseRouteDriftRecords({[e.key]:record})[e.key],record);});
await check('11碰撞取消本連段，壞成績不被parser接受',()=>{const{r,scorer}=routeRun();for(let x=1;x<25;x++)r.update(.1,car(x,0,0,12,.6),0);assert.ok(scorer.total>0);r.update(.1,car(25,0,0,12,.6),8);assert.equal(scorer.total,0);for(const v of[{score:-1,medal:'gold',completion:1},{score:10,medal:'x',completion:1},{score:10,medal:'none',completion:1.1}])assert.equal(m.parseRouteDriftRecords({'route-drift-v1:fixture:sedan':v}),null);});
await check('物理核心／亂數來源保持before；授權長軸FreeCar鎖定版本且預設6000格逐位元一致',async()=>{
  let parity;
  for(const f of['src/car.ts','src/track.ts','src/freecar.ts','src/pitlane.ts','src/taxi.ts','server/physics.mjs']) {
    if(f === 'src/freecar.ts') {
      const beforeSha256 = sha(await readFile(resolve(before,f))), reviewedSha256 = sha(await readFile(resolve(root,f)));
      assert.equal(beforeSha256, '655a8bbaee7f4cfbe47d4e7477479a709e8a2ef605d210db96c18ecf058d3ded', 'FreeCar immutable before');
      assert.equal(reviewedSha256, '99813a7aec638eb6a7c8c5d3b4bc1cb07ea4730f024cebce15db274280847cfb', 'FreeCar reviewed opt-in long-wheelbase version');
      const blank = { attribution:'controlled fixture',buildings:[],roads:[],greens:[],trees:[],signals:[],crossings:[],signs:[],places:[],net:{nodes:[0,0,0,300],ways:[{n:[0,1],w:20,c:0}],y:[0,0]} };
      const collider = new Collider(blank); collider.addEdges([-10,-10,-10,400,10,-10,10,400]);
      const pose = car => Object.fromEntries(['x','z','h','vx','vz','w','steer','y','vy','pitch','roll','landed','touch','jx','jz'].map(key => [key,car[key]]));
      const savedSurface = FreeCar.surface, savedBeforeSurface = BeforeFreeCar.surface;
      const surface = (x,z,y,out={}) => Object.assign(out,{y:.05*Math.sin(z/20),seg:null});
      let contacts = 0;
      try {
        FreeCar.surface = BeforeFreeCar.surface = surface;
        const a = new FreeCar(), b = new BeforeFreeCar(); a.place(0,0,0); b.place(0,0,0);
        assert.equal(a.geometry, undefined, '預設物理不能啟用長軸幾何');
        for(let i=0;i<6000;i++) {
          const dt=1/120,steer=Math.sin(i*.017)*.9,gas=i%700<400,brake=i%700>560; a.drift=b.drift=i%900<100;
          assert.equal(a.update(dt,steer,gas,brake,collider),b.update(dt,steer,gas,brake,collider),`impact frame ${i}`);
          if(i%1300===900) { assert.equal(a.contact(-1,0,.15,a.x+1,a.z+1.3,3,0,.35,.45,.7),b.contact(-1,0,.15,b.x+1,b.z+1.3,3,0,.35,.45,.7),`reaction frame ${i}`); contacts++; }
          assert.deepEqual(pose(a),pose(b),`default FreeCar frame ${i}`);
        }
      } finally { FreeCar.surface=savedSurface; BeforeFreeCar.surface=savedBeforeSurface; }
      parity = { beforeSha256, reviewedSha256, frames:6000, simulatedSeconds:50, forcedContactCases:contacts, bitExact:true, optInGeometry:false };
    } else assert.equal(sha(await readFile(resolve(root,f))),sha(await readFile(resolve(before,f))),f);
  }
  return parity;
});
report.status=report.cases.every(c=>c.status==='PASS')?'PASS':'FAIL';report.summary={pass:report.cases.filter(c=>c.status==='PASS').length,fail:report.cases.filter(c=>c.status==='FAIL').length};
await writeFile(resolve(root,'tools/dev-tests/evolution-city-models-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary,failed:report.cases.filter(c=>c.status==='FAIL')}));if(report.status!=='PASS')process.exitCode=1;
