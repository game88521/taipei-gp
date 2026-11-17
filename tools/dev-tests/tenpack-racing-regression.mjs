// 真模型／存檔 parser，資料全部記憶體隔離；不建立瀏覽器或連外。
// node --experimental-vm-modules tools/dev-tests/tenpack-racing-regression.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { pureUrl } from './pure-module-loader.mjs';
import { loadGameModules } from './racing-test-env.mjs';
import { verifyRacingCore } from './racing-core-evidence.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.join(project, '../taipei-gp-tenpack-before-c220d98a7f5c');
const copy = x => JSON.parse(JSON.stringify(x));
const data = new Map(), writes = [];
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => {data.set(k,String(v));writes.push(k);}, removeItem: k => data.delete(k) };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
const { RaceAnalysis } = await import(await pureUrl(project, 'race-analysis.ts'));
const { TtCoach, interpolateCoach } = await import(await pureUrl(project, 'tt-coach.ts'));
const season = await import(await pureUrl(project, 'season.ts'));
const { CIRCUITS } = await import(await pureUrl(project, 'circuits.ts'));
const { validateCustomCalendar } = await import(await pureUrl(project, 'season-editor.ts'));
const save = await import(await pureUrl(project, 'save.ts'));
const report = { cases: [], hashes: {}, sourceHashes: {}, scriptSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'), limitations: ['真模型與真保存parser，UI／真Chrome由另組驗證。', '安排車手狀態測邊界；另以真RaceField.playerLap驗證觀察器計圈。', '不宣稱圈速、耗電、手機或外網改善。'] };
for(const file of ['src/race-analysis.ts','src/tt-coach.ts','src/racing-tools-ui.ts','src/season-editor.ts','src/season.ts','src/save.ts','src/city-jobs-state.ts'])report.sourceHashes[file]=createHash('sha256').update(await readFile(path.join(project,file))).digest('hex');
report.coreProtection = await verifyRacingCore(project, before);
for (const [file, hashes] of Object.entries(report.coreProtection.hashes)) report.hashes[file.replace(/^src\//,'')] = hashes.after;
async function test(name, action) { try { await action(); report.cases.push({name,status:'PASS'}); } catch(error) {report.cases.push({name,status:'FAIL',error:error.stack});} }
function fixture() {
  const model = new RaceAnalysis(3000), me = {name:'你',isPlayer:true,laps:0,lapStart:0,compound:0,wear:0,pits:0,finish:null,dnf:false,pit:null};
  const field = {raceTime:0,wet:0,sc:{phase:'off'},racers:[me]}; model.observe(field);
  const advance = (time,lap,extra={}) => { for(let t=field.raceTime+1;t<time;t++){field.raceTime=t;model.observe(field);}field.raceTime=time;Object.assign(me,extra,{laps:lap,lapStart:time});model.observe(field); };
  advance(2,1);return{model,me,field,advance};
}
await test('全車：兩台不同過線時刻分開記錄，不改輸入',()=>{
  const {model,me,field,advance}=fixture();field.racers.push({...me,name:'對手',isPlayer:false,lapStart:1});model.observe(field);
  advance(62,2);field.raceTime=64;Object.assign(field.racers[1],{laps:2,lapStart:64});const snapshot=copy(field);model.observe(field);
  assert.deepEqual(field,snapshot);const all=model.all();assert.equal(all[0].laps[0].time,60);assert.equal(all[1].laps[0].time,null);assert.equal(all[1].laps[0].partial,true);
});
await test('胎段：乾地完整圈均值與平均時速',()=>{
  const{model,advance}=fixture();advance(62,2);advance(126,3);const stint=model.stints(model.all()[0])[0];
  assert.equal(stint.average,62);assert.equal(stint.comparable,2);assert.equal(stint.averageSpeed,3000/62*3.6);
});
await test('胎段：同胎種換新胎也開新段，不每步重複增加',()=>{
  const{model,me,field,advance}=fixture();advance(62,2);field.raceTime=70;me.pit={ph:'box'};model.observe(field);
  field.raceTime=73;me.pits=1;me.pit=null;model.observe(field);for(let i=0;i<50;i++){field.raceTime+=.01;model.observe(field);}
  advance(130,3);advance(188,4);const d=model.all()[0],stints=model.stints(d);
  assert.equal(d.stops.length,1);assert.equal(stints.length,2);assert.equal(stints[0].comparable,1);assert.equal(stints[1].average,58);
});
await test('胎段：不同胎種中途換胎只記一次，保留起圈胎',()=>{
  const{model,field,me,advance}=fixture();field.raceTime=25;me.compound=1;me.pits=1;model.observe(field);
  for(let i=0;i<20;i++){field.raceTime+=.1;model.observe(field);}advance(65,2);advance(126,3);
  const d=model.all()[0];assert.equal(d.laps[0].compound,0);assert.equal(d.laps[0].endCompound,1);assert.equal(d.stops.length,1);
  assert.equal(model.stints(d)[1].stint,2);
});
for(const flag of ['wet','sc','invalid','pit'])await test(`胎段：${flag}圈有標示、不污染乾地可比平均`,()=>{
  const{model,field,me,advance}=fixture();field.raceTime=20;
  if(flag==='wet')field.wet=.2;if(flag==='sc')field.sc.phase='out';if(flag==='pit')me.pit={ph:'in'};
  model.observe(field,flag!=='invalid');advance(65,2);const row=model.all()[0].laps[0];
  assert.equal(row[flag==='sc'?'safetyCar':flag==='invalid'?'invalid':flag],true);assert.equal(model.stints(model.all()[0])[0].average,null);
});
await test('續賽：缺少前半圈不捏造完整圈，下一圈可記錄',()=>{
  const{model,me,field}=fixture();model.reset(true);Object.assign(me,{laps:2,lapStart:50});field.raceTime=80;model.observe(field);
  Object.assign(me,{laps:3,lapStart:115});field.raceTime=115;model.observe(field);Object.assign(me,{laps:4,lapStart:176});field.raceTime=176;model.observe(field);
  const d=model.all()[0];assert.equal(d.incomplete,true);assert.equal(d.laps[0].time,null);assert.equal(d.laps[1].time,61);
});
await test('無效GP圈過線後，下個有效圈不沿用無效標記',()=>{
  const{model,me,field,advance}=fixture();field.raceTime=3;model.observe(field,false);advance(65,2);
  field.raceTime=66;model.observe(field,true);advance(126,3);
  const rows=model.all()[0].laps;assert.equal(rows[0].invalid,true);assert.equal(rows[1].invalid,false);assert.equal(model.stints(model.all()[0])[0].comparable,1);
});
await test('背景結算間隔大但僅過一圈：圈速可知、環境未知，不宣稱乾地可比',()=>{
  const{model,me,field}=fixture();field.raceTime=62;Object.assign(me,{laps:2,lapStart:62});model.observe(field);
  const d=model.all()[0];assert.equal(d.laps[0].time,60);assert.equal(d.laps[0].conditionsUnknown,true);assert.equal(model.stints(d)[0].average,null);
});
await test('背景一次跨多次停站只保留可知末胎，換胎圈與時間標未知',()=>{
  const{model,me,field}=fixture();field.raceTime=150;Object.assign(me,{pits:2,compound:2});model.observe(field);
  const d=model.all()[0];assert.equal(d.stops.length,1);assert.equal(d.stops[0].count,2);assert.equal(d.stops[0].uncertain,true);assert.equal(d.stops[0].compound,2);assert.equal(d.incomplete,true);
});
await test('背景結算一次觀察跨多圈：缺圈明示，不平均分配時間',()=>{
  const{model,advance}=fixture();advance(182,4);const d=model.all()[0];assert.equal(d.laps.length,1);assert.equal(d.laps[0].partial,true);assert.equal(d.laps[0].time,null);
});
await test('分析有界且snapshot不共用陣列',()=>{
  const{model,advance}=fixture();for(let i=2;i<160;i++)advance(i*60,i);const d=model.all()[0];assert.equal(d.laps.length,100);assert.equal(d.truncated,true);
  d.laps[0].time=1;assert.notEqual(model.all()[0].laps[0].time,1);
});
await test('真RaceField計圈：觀察器讀取實際lapStart，不介入物理',async()=>{
  const env=await loadGameModules(project),track=env.track.buildTrack(),car=new env.car.Car(),field=new env.rivals.RaceField(new THREE.Scene(),track,car);field.setup(9);
  const model=new RaceAnalysis(track.length);model.observe(field);car.pos.s=1;field.raceTime=2;field.playerLap(track.length-1,true,true);model.observe(field);
  field.raceTime=62;field.playerLap(track.length-1,true,true);model.observe(field);const me=model.all().find(d=>d.name===field.me.name);
  assert.equal(me.laps[0].time,60);assert.equal(field.me.bestLap,60);
});
function trace(model,time=20,newBest=true,invalid=false){for(let i=0;i<=200;i++)model.sample({time:i*time/200,s:i*5,speed:1000/time,brake:i>100&&i<120,valid:!invalid});return model.finish(time,!invalid,newBest);}
await test('TT首次有效PB建立速度/煞車trace並可同距離比較',()=>{
  const m=new TtCoach(1000);m.startSession('a:classic',null);assert.equal(trace(m),true);assert.equal(m.reference('pb').time,20);
  assert.equal(interpolateCoach(m.reference('pb'),550).brake,true);m.resetLap();for(let i=0;i<=100;i++)m.sample({time:i*.12,s:i*5,speed:40,brake:false,valid:true});
  const c=m.compare('pb',500);assert.ok(Math.abs(c.delta-2)<1e-9);assert.equal(c.speedDifference,-36);
});
await test('TT無效圈不覆蓋PB或上個有效圈',()=>{const m=new TtCoach(1000);m.startSession('a:classic',null);trace(m);const best=m.reference('pb');m.resetLap();assert.equal(trace(m,18,true,true),false);assert.deepEqual(m.reference('last'),best);assert.deepEqual(m.reference('pb'),best);});
await test('TT非PB有效圈只更新last',()=>{const m=new TtCoach(1000);m.startSession('a:classic',null);trace(m);m.resetLap();trace(m,23,false);assert.equal(m.reference('last').time,23);assert.equal(m.reference('pb').time,20);});
await test('TT歷史PB無trace保持未知，不從ghost捏造煞車',()=>{const m=new TtCoach(1000);m.startSession('a:classic',18);trace(m,20,false);assert.equal(m.historicalPb,18);assert.equal(m.reference('pb'),null);assert.equal(m.reference('last').time,20);});
await test('TT切換賽道/規則清除跨類別參考',()=>{const m=new TtCoach(1000);m.startSession('a:classic',null);trace(m);m.startSession('a:2026',20);assert.equal(m.reference('pb'),null);assert.equal(m.reference('last'),null);});
await test('TT相同分類開始新場保留已知PB，但不採用已失配PB',()=>{const m=new TtCoach(1000);m.startSession('a:classic',null);trace(m);m.startSession('a:classic',20);assert.equal(m.reference('pb').time,20);m.startSession('a:classic',19);assert.equal(m.reference('pb'),null);});
for(const mode of ['teleport','reverse','partial','nonfinite'])await test(`TT ${mode}資料不能提交為參考`,()=>{
  const m=new TtCoach(1000);m.startSession('a:classic',null);if(mode==='partial')m.sample({time:0,s:500,speed:50,brake:false,valid:true});
  else{m.sample({time:0,s:0,speed:50,brake:false,valid:true});m.sample({time:.1,s:mode==='teleport'?600:mode==='nonfinite'?NaN:5,speed:50,brake:false,valid:true});if(mode==='reverse')m.sample({time:.2,s:1,speed:50,brake:false,valid:true});}
  assert.equal(trace(m),false);assert.equal(m.reference('pb'),null);
});
await test('TT長圈自動降採樣有界，不改已保存trace',()=>{
  const m=new TtCoach(1000,64);m.startSession('a:classic',null);assert.equal(trace(m),true);assert.ok(m.reference('pb').points.length<=64);
  const detached=m.reference('pb');detached.points[0].v=999;assert.notEqual(m.reference('pb').points[0].v,999);
});
await test('自訂賽曆允許1/4/23站及順序，完成條件不混入完整季成就',()=>{
  for(const n of [1,4,23]){const ids=CIRCUITS.slice(0,n).map(c=>c.id).reverse(),s=season.defaultSeason(3,'normal','classic',1,ids);assert.equal(s.custom,true);assert.deepEqual(season.parseSeasonSave(s).calendar,ids);assert.equal(season.isFullSeason(s),false);assert.equal(validateCustomCalendar(ids),null);}
});
await test('舊預設3/6/12/23站、完整季成就與獎金維持',()=>{
  for(const n of [3,6,12,23]){const s=season.defaultSeason(3,'normal','classic',1,n);assert.equal(s.custom,undefined);assert.equal(season.parseSeasonSave(s).calendar.length,n);assert.equal(season.isFullSeason(s),n===23);assert.equal(season.seasonPrize(1,1,n).cash,n===23?60000:Math.floor(60000*n/23));}
});
for(const ids of [[],['unknown'],[CIRCUITS[0].id,CIRCUITS[0].id],CIRCUITS.map(c=>c.id).concat(CIRCUITS[0].id)])await test(`非法自訂賽曆拒絕/${JSON.stringify(ids).slice(0,45)}`,()=>{assert.ok(validateCustomCalendar(ids));assert.equal(season.parseSeasonSave({...season.defaultSeason(),custom:true,calendar:ids}),null);});
await test('非自訂4站/無calendar的custom/錯誤旗標不通過parser',()=>{for(const extra of [{calendar:CIRCUITS.slice(0,4).map(c=>c.id)},{custom:true},{custom:'true',calendar:CIRCUITS.slice(0,3).map(c=>c.id)}])assert.equal(season.parseSeasonSave({...season.defaultSeason(),...extra}),null);});
await test('自訂獎金按實際1/4/23站比例，歷史保留自訂資格',()=>{
  for(const n of [1,4,23]){assert.equal(season.seasonPrize(1,1,n,true).cash,Math.floor(60000*n/23));const h={no:1,rank:1,pts:26*n,wins:n,champion:'你',team:'車隊',teamRank:1,laps:3,rounds:n,custom:true};assert.deepEqual(season.parseSeasonHistory([h]),[h]);}
});
await test('存檔policeCareer：缺少相容，合法保留，損壞進critical救援',()=>{
  const base={best:null,sectors:[null,null,null],ghost:null,opts:{}},career={v:1,difficulty:'standard',completed:5,failed:2,consecutive:2,bestConsecutive:3};
  assert.deepEqual(save.parseSaveFile(JSON.stringify(base)).dropped,[]);const good=save.parseSaveFile(JSON.stringify({...base,policeCareer:career}));assert.deepEqual(good.save.policeCareer,career);assert.deepEqual(good.dropped,[]);
  for(const broken of [null,{...career,consecutive:8},{...career,completed:-1},{...career,difficulty:'__proto__'}]){const parsed=save.parseSaveFile(JSON.stringify({...base,policeCareer:broken}));assert.ok(parsed.dropped.includes('policeCareer'));assert.ok(save.criticalSaveDrops(parsed.dropped).includes('policeCareer'));}
});
await test('舊備份匯入保留警察生涯，明確合法新資料可取代',()=>{
  save.save.policeCareer={v:1,difficulty:'hard',completed:3,failed:1,consecutive:1,bestConsecutive:2};
  const base=save.parseSaveFile(JSON.stringify({best:null,opts:{}}));const prepared=save.prepareImportedSave(base.save,base.dropped);assert.ok(prepared.preserved.includes('policeCareer'));assert.deepEqual(prepared.save.policeCareer,save.save.policeCareer);
  const fresh={v:1,difficulty:'easy',completed:0,failed:0,consecutive:0,bestConsecutive:0};assert.deepEqual(save.prepareImportedSave({...base.save,policeCareer:fresh}).save.policeCareer,fresh);
});
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};
await writeFile(new URL('./tenpack-racing-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
for(const c of report.cases.filter(c=>c.status==='FAIL'))console.error(c.name,c.error);console.log(JSON.stringify(report.summary));if(report.summary.FAIL)process.exitCode=1;
