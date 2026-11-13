import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pureUrl } from './pure-module-loader.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const p=await import(await pureUrl(root,'player-progress.ts')), a=await import(await pureUrl(root,'achievements.ts'));
const report={cases:[],browserUsed:false,playerStorageTouched:false};
async function test(name,fn){try{await fn();report.cases.push({name,status:'PASS'});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).slice(0,2500)});}}
await test('探索以真同層判定，重訪不重複，各區完成度正確',()=>{
  const save=p.newPlayerProgress(), marks=[{nm:'東城景點',x:0,z:0,r:50},{nm:'西城景點',x:-4000,z:0,r:50}];
  assert.equal(p.visitLandmarks(save,marks,{x:0,z:0,y:8}).length,0);
  assert.equal(p.visitLandmarks(save,marks,{x:0,z:0,y:-0.25}).length,1);
  assert.equal(p.visitLandmarks(save,marks,{x:0,z:0,y:-0.25}).length,0);
  const s=p.explorationSummary(save,marks);assert.equal(s.count,1);assert.equal(s.total,2);assert.equal(s.regions.get('東區').visited,1);
});
await test('最多三個置頂、取消後能換目標、統計進度與成就對齊',()=>{
  const save=p.newPlayerProgress();for(const id of ['trip1','rich','km100'])assert.equal(p.togglePinned(save,id),true);
  assert.equal(p.togglePinned(save,'gp'),false);assert.equal(p.togglePinned(save,'trip1'),true);assert.equal(p.togglePinned(save,'gp'),true);
  const stats={...a.emptyStats(),earned:5000,dist:50000,gpWins:1};const targets=p.pinnedTargets(save,stats,['gp']);
  assert.equal(targets.find((t)=>t.id==='rich').fraction,0.5);assert.equal(targets.find((t)=>t.id==='gp').done,true);
});
await test('稱號解鎖條件不可直接靠選取繞過，已解鎖可裝備',()=>{
  const save=p.newPlayerProgress();save.title='guide';assert.equal(p.equippedTitle(save,[]),'新手車手');
  save.visited=Array.from({length:20},(_,i)=>`mark${i}`);assert.equal(p.equippedTitle(save,[]),'台北領航員');
  save.title='racer';assert.equal(p.equippedTitle(save,['gp']),'賽道新星');
});
await test('進度parser完整往返、去重、拒絕壞欄位與非法置頂',()=>{
  const s=p.newPlayerProgress();s.visited=['a','a'];s.pinned=['gp','gp'];const clean=p.parsePlayerProgress(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(clean.visited,['a']);assert.deepEqual(clean.pinned,['gp']);
  assert.equal(p.parsePlayerProgress({...s,pinned:['unknown']}),null);assert.equal(p.parsePlayerProgress({...s,visited:42}),null);
});
await test('真城市全部地標可保存重載，不受舊2000筆限制而觸發損壞救援',async()=>{
  const city=JSON.parse(await readFile(resolve(root,'public/data/city.json'),'utf8'));
  const save=p.newPlayerProgress();save.visited=[...new Set(city.places.map(l=>p.landmarkId({nm:l.nm.trim(),x:l.x,z:l.z})))];
  assert.ok(save.visited.length>2000);assert.ok(save.visited.length<10000);
  const clean=p.parsePlayerProgress(JSON.parse(JSON.stringify(save)));assert.ok(clean);assert.deepEqual(clean.visited,save.visited);
});
report.passed=report.cases.filter((c)=>c.status==='PASS').length;report.failed=report.cases.length-report.passed;
await writeFile(resolve(root,'tools/dev-tests/shots-all-progress.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
