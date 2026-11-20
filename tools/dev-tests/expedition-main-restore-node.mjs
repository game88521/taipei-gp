// Exact production restore function, isolated from WebGL and asynchronous asset loading.
// --before preserves the actual pre-fix failure; it does not change or replace product code.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const sourceUrl=new URL('../../src/main.ts',import.meta.url),source=await readFile(sourceUrl,'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const start=source.indexOf('function restoreExpedition(){'),end=source.indexOf('\nconst canEnterExpedition=',start);
assert.ok(start>=0&&end>start,'extract exact production restoreExpedition function');
const fn=source.slice(start,end),navigation={x:12,z:34,y:5,nm:'原導航',path:[[1,2],[12,34]],ys:[5,5],t:3};
const report={status:'FAIL',startedAt:new Date().toISOString(),localOnly:true,externalRequests:0,sourceHashes:{'src/main.ts':sha(source),restoreFunction:sha(fn)},fixture:'Exact production restoreExpedition only; mock rendering/audio/vehicle methods, no replacement of restoration logic.',cases:[]};
function fixture(snapshot=null){
 const events=[],state={state:'free',pausedFrom:'race',timeSel:{value:'rain'},expeditionReturn:snapshot,expeditionVehicleId:'sedan',nav:structuredClone(navigation),camSnap:false,timeKind:'rain',camView:'hood',
  input:{release(){events.push('release');}},fcar:{spec:{vmax:22},geometry:{length:8},place(...args){events.push(['place',...args]);}},
  weather:{pick(...args){events.push(['weather',...args]);}},applyWeather(){events.push('applyWeather');},
  navArrows:{update(...args){events.push(['navArrows',...args]);}},sound:{engine(...args){events.push(['engine',...args]);}},clock:{getDelta(){events.push('clock');}},events};
 const context=vm.createContext(state);vm.runInContext(fn,context);return{state,restore:()=>vm.runInContext('restoreExpedition()',context)};
}
function check(name,run){try{report.cases.push({name,status:'PASS',details:run()});}catch(error){report.cases.push({name,status:'FAIL',error:String(error.stack)});}console.log(JSON.stringify(report.cases.at(-1)));}
check('取消或失敗發生於userStart／ensureStreetSystems未完成，沒有借車快照時保留原導航',()=>{
 const f=fixture(),raw=JSON.stringify(f.state.nav),spec=f.state.fcar.spec,geometry=f.state.fcar.geometry;f.restore();
 assert.equal(JSON.stringify(f.state.nav),raw,'no snapshot must preserve navigation');assert.equal(f.state.fcar.spec,spec);assert.equal(f.state.fcar.geometry,geometry);assert.equal(f.state.timeKind,'rain');assert.equal(f.state.camView,'hood');
 assert.equal(f.state.events.some(e=>Array.isArray(e)&&e[0]==='place'),false);return{navigationPreserved:true,noBorrowedStateWritten:true};
});
check('鎖房拒絕或被移出後先暫停原駕駛，面板背後不繼續累積單人時間',()=>{
 const f=fixture({pose:{x:8,z:9,y:4,h:.5},spec:{vmax:44},geometry:{length:4},weather:'day',camera:'chase',navigation:null});
 f.restore();assert.equal(f.state.state,'paused','returning a loaned car must require an explicit resume');
 assert.ok(f.state.events.includes('release'));return{state:f.state.state,explicitResumeRequired:true};
});
check('第一次從選單借車還車後繼續應回城市駕駛，不能沿預設pausedFrom進race',()=>{const f=fixture({pose:{x:0,z:0,y:0,h:0},spec:{vmax:44},geometry:undefined,weather:'day',camera:'chase',navigation:null});f.restore();assert.equal(f.state.pausedFrom,'free');return{resumeTarget:f.state.pausedFrom};});
check('真正借車退出還原pose／車規／天候／鏡頭／導航，重複清理仍保留已還原導航',()=>{
 const original={pose:{x:8,z:9,y:4,h:.5},spec:{vmax:44},geometry:{length:4},weather:'night',camera:'chase',navigation:structuredClone(navigation)},f=fixture(original);
 f.state.nav={...navigation,nm:'勤務路線'};f.restore();assert.equal(f.state.fcar.spec,original.spec);assert.equal(f.state.fcar.geometry,original.geometry);assert.equal(f.state.timeKind,'night');assert.equal(f.state.camView,'chase');assert.equal(JSON.stringify(f.state.nav),JSON.stringify(original.navigation));assert.equal(f.state.expeditionReturn,null);
 const places=f.state.events.filter(e=>Array.isArray(e)&&e[0]==='place');assert.equal(JSON.stringify(places),JSON.stringify([['place',8,9,.5,4]]));
 const raw=JSON.stringify(f.state.nav);f.restore();assert.equal(JSON.stringify(f.state.nav),raw,'second stop must not erase restored navigation');return{restored:true,repeatedStopPreservedNavigation:true};
});
check('借車前沒有導航的正常退出仍清除勤務暫時導航',()=>{
 const f=fixture({pose:{x:0,z:0,y:0,h:0},spec:{vmax:44},geometry:undefined,weather:'day',camera:'chase',navigation:null});f.restore();assert.equal(f.state.nav,null);return{temporaryNavigationCleared:true};
});
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.sourceUnchangedDuringTests=sha(await readFile(sourceUrl,'utf8'))===report.sourceHashes['src/main.ts'];report.status=!report.summary.FAIL&&report.sourceUnchangedDuringTests?'PASS':'FAIL';report.completedAt=new Date().toISOString();
const output=process.argv.includes('--resume-before')?'frontier-main-resume-before-result.json':process.argv.includes('--before')?'expedition-main-restore-before-result.json':'expedition-main-restore-node-result.json';await writeFile(new URL(output,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary,output}));if(report.status!=='PASS')process.exitCode=1;
