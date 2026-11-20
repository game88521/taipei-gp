// Rex <game88521@gmail.com>. Real bounded recorder/schema, explicit event-capacity fixtures; no live-player claim.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CityReplayRecorder} from '../../server/frontier-city-replay-service.mjs';
import {CITY_REPLAY_MAX_EVENTS,parseCityReplay,decodeCityReplay,cityReplayCrownAt} from '../../shared/frontier-city-replay.ts';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),evidence=path.join(root,'tools/dev-tests',`frontier-city-replay-capacity-evidence-${Date.now()}`);await mkdir(evidence);
const report={status:'RUNNING',localOnly:true,externalRequests:0,browserUsed:false,realRecorder:true,realSchema:true,explicitCapacityFixture:true,evidence,cases:[],limitations:['These cases send synthetic samples/events through the actual CityReplayRecorder and strict archive parser. They prove bounded replay integrity and event/sample ordering; they do not claim live collision frequency, complete driving, WebSocket delivery or rendered pixels.'],...await startAudit(root,new URL(import.meta.url),['server/frontier-city-replay-service.mjs','shared/frontier-city-replay.ts'])};
const base=1_800_000_000_000,rows=[0,1].map(slot=>({key:'private-actor-'+slot,slot,vehicle:'sedan',role:'driver',epoch:0,connected:true,outcome:'',pose:{x:slot*5,y:.25,z:0,h:0,vx:0,vz:0,steer:0,pitch:0,roll:0}}));
function fixture(mode='crown'){
 const r=new CityReplayRecorder({source:'social',mode});assert.equal(r.sample(base,rows),true);if(mode==='crown')assert.equal(r.event(base,'crown',[rows[0].key],'crown-start'),true);return r;
}
function fill(r,{at=1}={}){while(r.data.events.length<CITY_REPLAY_MAX_EVENTS)assert.equal(r.event(base+at,'contact',rows.map(p=>p.key)),true);assert.equal(r.data.events.length,CITY_REPLAY_MAX_EVENTS);}
function sample(r,at){return r.sample(base+at,rows);}
function archive(r,at=2000){r.finish(base+at,'complete');assert.equal(r.descriptor().ready,true);const parsed=parseCityReplay(r.data);assert.ok(parsed);assert.deepEqual(decodeCityReplay(r.text),parsed);return parsed;}
const scenarios=[];function scenario(name,fn){scenarios.push({name,fn});}
scenario('滿512事件後轉移被拒時，同步停止後續軌跡，不能錯畫舊冠主',()=>{
 const r=fixture();fill(r);for(const at of[200,400,600,800,1000])sample(r,at);assert.equal(r.event(base+1200,'crown',rows.map(p=>p.key),'crown-transfer'),false);for(const at of[1200,1400,1600,1800])sample(r,at);const a=archive(r,2000),detail={events:a.events.length,frames:a.frames.length,recordedMs:a.recordedMs,durationMs:a.durationMs,truncated:a.truncated,actualTransferAt:1200,lastRetainedCrownActor:cityReplayCrownAt(a,a.recordedMs)};assert.ok(a.recordedMs<1200,JSON.stringify(detail));assert.equal(a.recordedMs,1000);assert.equal(a.truncated,true);assert.equal(a.durationMs,2000);assert.equal(cityReplayCrownAt(a,1000),0);return detail;
});
scenario('同step先sample後contact再缺crown，回收當步frame與同時事件',()=>{
 const r=fixture();while(r.data.events.length<CITY_REPLAY_MAX_EVENTS-1)assert.equal(r.event(base+1,'contact',rows.map(p=>p.key)),true);sample(r,200);sample(r,400);sample(r,600);sample(r,800);sample(r,1000);assert.equal(r.event(base+1000,'contact',rows.map(p=>p.key)),true);assert.equal(r.event(base+1000,'crown',rows.map(p=>p.key),'crown-transfer'),false);const a=archive(r,1400);assert.equal(a.recordedMs,800);assert.ok(a.frames.every(f=>f.at<1000));assert.ok(a.events.every(e=>e.at<1000));assert.equal(cityReplayCrownAt(a,800),0);return{recordedMs:a.recordedMs,eventCount:a.events.length,lastFrame:a.frames.at(-1).at};
});
scenario('未append的latest不得在finish時跨越第一個遺失事件',()=>{
 const r=fixture();fill(r);sample(r,200);sample(r,400);sample(r,600);sample(r,800);sample(r,1000);sample(r,1100);assert.equal(r.latest.at,1100);assert.equal(r.data.recordedMs,1000);assert.equal(r.event(base+1100,'crown',rows.map(p=>p.key),'crown-transfer'),false);const a=archive(r,2000);assert.equal(a.recordedMs,1000);assert.equal(a.frames.at(-1).at,1000);return{recordedMs:a.recordedMs,unappendedFrameAt:1100};
});
scenario('截斷後不能再補舊事件或追加frame，真正經過時間仍保留',()=>{
 const r=fixture();while(r.data.events.length<CITY_REPLAY_MAX_EVENTS-1)r.event(base+1,'contact',rows.map(p=>p.key));sample(r,200);sample(r,400);r.event(base+600,'contact',rows.map(p=>p.key));sample(r,600);assert.equal(r.event(base+600,'crown',rows.map(p=>p.key),'crown-transfer'),false);const count=r.data.events.length;assert.ok(count<CITY_REPLAY_MAX_EVENTS);assert.equal(r.event(base+100,'crown',[rows[1].key],'crown-return'),false);assert.equal(sample(r,2000),false);const a=archive(r,3000);assert.equal(a.events.length,count);assert.equal(a.recordedMs,400);assert.equal(a.durationMs,3000);return{recordedMs:a.recordedMs,durationMs:a.durationMs,eventCount:count};
});
scenario('恰好512而沒有遺失事件可保留完整後續軌跡與合法轉移',()=>{
 const r=fixture();while(r.data.events.length<CITY_REPLAY_MAX_EVENTS-1)r.event(base+1,'contact',rows.map(p=>p.key));assert.equal(r.event(base+600,'crown',rows.map(p=>p.key),'crown-transfer'),true);for(const at of[200,400,600,800,1000])sample(r,at);const a=archive(r,1000);assert.equal(a.events.length,512);assert.equal(a.recordedMs,1000);assert.equal(a.truncated,false);assert.equal(cityReplayCrownAt(a,599),0);assert.equal(cityReplayCrownAt(a,600),1);return{recordedMs:a.recordedMs,eventCount:a.events.length};
});
scenario('起始同時刻就缺王冠事件時，不發布零證據回放',()=>{
 const r=new CityReplayRecorder({source:'social',mode:'crown'});sample(r,0);fill(r,{at:0});assert.equal(r.event(base,'crown',[rows[0].key],'crown-start'),false);sample(r,200);sample(r,400);r.finish(base+1000,'complete');assert.equal(r.descriptor().ready,false);assert.equal(r.descriptor().frames,0);assert.equal(r.descriptor().truncated,true);assert.equal(r.text,null);return{descriptor:r.descriptor()};
});
scenario('截斷保留原始前綴及所有已知冠主，沒有刪前段事件或補造轉移',()=>{
 const r=fixture();assert.equal(r.event(base+200,'crown',rows.map(p=>p.key),'crown-transfer'),true);for(const at of[200,400,600,800])sample(r,at);fill(r,{at:801});const before=structuredClone(r.data),prefix=r.data.frames.filter(f=>f.at<1000);assert.equal(r.event(base+1000,'crown',[rows[1].key,rows[0].key],'crown-transfer'),false);sample(r,1200);const a=archive(r,2000);assert.deepEqual(a.frames,prefix);assert.deepEqual(a.events,before.events.filter(e=>e.at<=800));assert.equal(cityReplayCrownAt(a,199),0);assert.equal(cityReplayCrownAt(a,200),1);return{retainedFrames:a.frames.length,retainedEvents:a.events.length,recordedMs:a.recordedMs};
});
scenario('舊巡航／追捕／追走／車隊事件容量同樣只保留完整前綴',()=>{
 const results=[];for(const mode of['cruise','chase','tandem','convoy']){const r=fixture(mode);fill(r);sample(r,200);sample(r,400);assert.equal(r.event(base+500,'weather',[],'rain'),false);sample(r,600);const a=archive(r,1000);assert.equal(a.recordedMs,400);assert.equal(a.truncated,true);results.push({mode,recordedMs:a.recordedMs});}return results;
});
try{for(const {name,fn}of(process.argv.includes('--repro')?scenarios.slice(0,1):scenarios)){const c={name,status:'PASS'};try{c.details=await fn();}catch(e){c.status='FAIL';c.error=String(e.stack);}report.cases.push(c);console.log(JSON.stringify(c));}}
catch(e){report.fatal=String(e.stack);}
finally{await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&!report.summary.FAIL&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests?'PASS':'FAIL';const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'result.json'),bytes);await writeFile(new URL('frontier-city-replay-capacity-node-result.json',import.meta.url),bytes);console.log(JSON.stringify({status:report.status,...report.summary,evidence}));if(report.status!=='PASS')process.exitCode=1;}
