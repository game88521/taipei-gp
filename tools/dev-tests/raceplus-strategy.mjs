// 真strategy來源前後對照；只取公開TYRES資料，不執行車輛/天氣模擬。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { parseAst } from 'rolldown/parseAst';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const before=path.resolve(process.argv[2]??path.join(project,'../taipei-gp-raceplus-before-38335611f205'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const currentSource=await readFile(path.join(project,'src/strategy.ts'),'utf8');
const oldSource=await readFile(path.join(before,'src/strategy.ts'),'utf8');
const load=source=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const after=await load(currentSource),old=await load(oldSource);
const publicSource=stripTypeScriptTypes(await readFile(path.join(project,'src/rivals.ts'),'utf8'),{mode:'transform'});
const ast=parseAst(publicSource),tyreDeclaration=ast.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'&&n.declaration.declarations.some(d=>d.id.name==='TYRES'));
const tyreInit=tyreDeclaration.declaration.declarations.find(d=>d.id.name==='TYRES').init;
const tyres=vm.runInNewContext(publicSource.slice(tyreInit.start,tyreInit.end));
const tyre=index=>({label:tyres[index].name,grip:tyres[index].grip,wearPerLap:tyres[index].wear,rain:index===3});
const input={laneLength:300,limit:80/3.6,racingTime:5,lapTime:60,wear:.6,lapsRemaining:5,rivals:[{gap:-2},{gap:14},{gap:25},{gap:null}]};
const plan=(current,next,extra={})=>({...input,tyres:{current:tyre(current),next:tyre(next)},wetness:0,previousWetness:0,...extra});
const mid=range=>(range.min+range.max)/2;
const report={createdAt:new Date().toISOString(),project,before,cases:[],sourceHashes:{'src/strategy.ts':hash(currentSource),'before/src/strategy.ts':hash(oldSource),'src/rivals.ts':hash(await readFile(path.join(project,'src/rivals.ts'))),'tools/dev-tests/raceplus-strategy.mjs':hash(await readFile(fileURLToPath(import.meta.url)))},localOnly:true,externalRequests:0,limitations:['真策略函式與公開胎種資料；未量測實際進站估值誤差、區間涵蓋率、手機或瀏覽器。','維持當下已觀察濕度，雨勢趨勢只擴大不確定區間；不預測未來天氣。','舊呼叫無胎種資料時保留原退化模型。']};
async function check(name,action){try{report.cases.push({name,status:'PASS',details:await action()});}catch(error){report.cases.push({name,status:'FAIL',error:error.stack});}}

await check('未提供胎種資料：原本本圈/下圈/排隊/安全車/出站名次數字完全不變',()=>{
  for(const extra of [{},{wear:0,lapsRemaining:1},{wear:1,lapsRemaining:8},{queueSeconds:4},{safetyCar:true},{wearPerLap:.22}]){
    const data={...input,...extra},a=after.estimatePitStrategy(data),b=old.estimatePitStrategy(data);
    assert.deepEqual(a.currentLap,b.currentLap);assert.deepEqual(a.nextLap,b.nextLap);
  }
  return{variants:6};
});
await check('下一套胎影響估計：舊版忽略軟/硬選擇，新版單圈新軟胎有較低淨代價',()=>{
  const soft=plan(1,0,{wear:.1,lapsRemaining:1}),hard=plan(1,2,{wear:.1,lapsRemaining:1});
  const beforeSoft=old.estimatePitStrategy(soft),beforeHard=old.estimatePitStrategy(hard);
  const afterSoft=after.estimatePitStrategy(soft),afterHard=after.estimatePitStrategy(hard);
  assert.deepEqual(beforeSoft,beforeHard);assert.ok(mid(afterSoft.currentLap.net)<mid(afterHard.currentLap.net));
  return{before:{soft:beforeSoft.currentLap.net,hard:beforeHard.currentLap.net},after:{soft:afterSoft.currentLap.net,hard:afterHard.currentLap.net}};
});
await check('已觀察80%濕度：換雨胎優於繼續換乾胎，舊版兩者無差異',()=>{
  const rain=plan(1,3,{wetness:.8,previousWetness:.8,wear:.1,lapsRemaining:3});
  const dry={...rain,tyres:{...rain.tyres,next:tyre(1)}};
  assert.deepEqual(old.estimatePitStrategy(rain),old.estimatePitStrategy(dry));
  const a=after.estimatePitStrategy(rain),b=after.estimatePitStrategy(dry);
  assert.ok(mid(a.currentLap.net)<mid(b.currentLap.net));
  return{rain:a.currentLap.net,dry:b.currentLap.net};
});
await check('乾地新雨胎可有負收益：不把錯胎當成免費收益或裁為零',()=>{
  const a=after.estimatePitStrategy(plan(1,3,{wear:0,lapsRemaining:3}));
  const b=after.estimatePitStrategy(plan(1,1,{wear:0,lapsRemaining:3}));
  assert.ok(mid(a.currentLap.net)>mid(a.currentLap.loss));assert.ok(mid(a.currentLap.net)>mid(b.currentLap.net));
  return{wrongTyreNet:a.currentLap.net,pitLoss:a.currentLap.loss,dryTyreNet:b.currentLap.net};
});
await check('兩套胎各自退化：相同新胎抓地下，低耗損胎的多圈代價較低',()=>{
  const base=plan(0,1,{wear:.3,lapsRemaining:6});
  const fastWear={...base,tyres:{...base.tyres,next:{...tyre(1),wearPerLap:.16}}};
  const slowWear={...base,tyres:{...base.tyres,next:{...tyre(1),wearPerLap:.065}}};
  const a=after.estimatePitStrategy(fastWear),b=after.estimatePitStrategy(slowWear);
  assert.ok(mid(b.currentLap.net)<mid(a.currentLap.net));
  return{fastWear:a.currentLap.net,slowWear:b.currentLap.net};
});
await check('近期真實胎耗會調整當前與下一套退化，缺樣本明確標示假設',()=>{
  const base=plan(0,2,{wear:.1,lapsRemaining:3}),unobserved=after.estimatePitStrategy(base);
  const observed=after.estimatePitStrategy({...base,observedWearPerLap:.3});
  assert.notDeepEqual(observed.currentLap.net,unobserved.currentLap.net);
  assert.ok(observed.assumptions.some(s=>s.includes('近期實際胎耗')));
  assert.ok(unobserved.assumptions.some(s=>s.includes('樣本不足')));
  return{unobserved:unobserved.currentLap.net,observed:observed.currentLap.net};
});
await check('趨勢只放寬收益範圍：當下濕度相同則中心值相同，不暗自預測未來',()=>{
  const base=plan(1,3,{wetness:.5,previousWetness:.5}),steady=after.estimatePitStrategy(base);
  const wetter=after.estimatePitStrategy({...base,previousWetness:.4}),drier=after.estimatePitStrategy({...base,previousWetness:.6});
  assert.ok(Math.abs(mid(steady.currentLap.net)-mid(wetter.currentLap.net))<1e-10);
  assert.deepEqual(wetter.currentLap,drier.currentLap);
  assert.ok(wetter.currentLap.net.min<steady.currentLap.net.min);assert.ok(wetter.currentLap.net.max>steady.currentLap.net.max);
  assert.ok(wetter.assumptions.some(s=>s.includes('未預測未來雨勢')));
  return{steady:steady.currentLap.net,changing:wetter.currentLap.net};
});
await check('排隊/安全車/出站名次保留，最後一圈無下圈選項',()=>{
  const base=plan(1,2),a=after.estimatePitStrategy(base),queued=after.estimatePitStrategy({...base,queueSeconds:4});
  assert.equal(queued.currentLap.loss.min,a.currentLap.loss.min+4);assert.equal(queued.currentLap.net.min,a.currentLap.net.min+4);
  assert.ok(a.currentLap.rejoin.worst>=a.currentLap.rejoin.best);
  assert.ok(after.estimatePitStrategy({...base,safetyCar:true}).currentLap.loss.min<a.currentLap.loss.min);
  assert.equal(after.estimatePitStrategy({...base,lapsRemaining:1}).nextLap,null);
  return{rejoin:a.currentLap.rejoin};
});
await check('有效胎種/濕度/觀測邊界皆有限且範圍有序，錯誤新資料不靜默猜測',()=>{
  let variants=0;
  for(let current=0;current<4;current++)for(let next=0;next<4;next++)for(const wetness of[0,.3,1])for(const wear of[0,.6,1])for(const observedWearPerLap of[undefined,0,1]){
    const a=after.estimatePitStrategy(plan(current,next,{wetness,wear,observedWearPerLap,lapsRemaining:100}));
    assert.ok(a);for(const scenario of[a.currentLap,a.nextLap])for(const range of[scenario.loss,scenario.net]){assert.ok(Number.isFinite(range.min)&&Number.isFinite(range.max));assert.ok(range.min<=range.max);}variants++;
  }
  for(const extra of[{wetness:NaN},{wetness:-.1},{wetness:1.1},{wetness:undefined},{previousWetness:Infinity},{observedWearPerLap:-1},{observedWearPerLap:NaN},{tyres:{current:tyre(0),next:{...tyre(2),grip:0}}},{tyres:{current:tyre(0),next:{...tyre(2),grip:Number.MIN_VALUE}}},{tyres:{current:tyre(0),next:{...tyre(2),wearPerLap:NaN}}},{tyres:{current:tyre(0),next:undefined}}])assert.equal(after.estimatePitStrategy({...plan(1,2),...extra}),null);
  return{validVariants:variants,invalidVariants:11};
});
await check('不改輸入、車輛核心或未來狀態；仍只讀公開觀察欄位',async()=>{
  const a=plan(1,3,{wetness:.8,previousWetness:.7,observedWearPerLap:.12}),beforeInput=JSON.stringify(a);
  for(const name of['rainAt','futureWeather','predrawnPitTime'])Object.defineProperty(a,name,{get(){throw Error(`不得讀取${name}`);}});
  assert.ok(after.estimatePitStrategy(a));assert.equal(JSON.stringify(a),beforeInput);
  for(const name of['car.ts','track.ts','rivals.ts','pitlane.ts'])assert.equal(hash(await readFile(path.join(project,'src',name))),hash(await readFile(path.join(before,'src',name))));
  return{coreFilesUnchanged:4,futureStateReads:0};
});
report.summary={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length};
report.status=report.summary.failed?'FAIL':'PASS';
await writeFile(path.join(project,'tools/dev-tests/raceplus-strategy-result.json'),JSON.stringify(report,null,2)+'\n');
for(const c of report.cases)console.log(`${c.status} ${c.name}${c.error?'\n'+c.error:''}`);
console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
