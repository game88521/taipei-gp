import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import { pureUrl } from './pure-module-loader.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),before=path.resolve(project,'../taipei-gp-raceplus-before-38335611f205');
const hash=b=>createHash('sha256').update(b).digest('hex'),reports=[];
const { PitCalibration } = await import(await pureUrl(project, 'pit-calibration.ts'));
const raw=await readFile(path.join(project,'src/main.ts'),'utf8'),old=await readFile(path.join(before,'src/main.ts'),'utf8');
const tyres=[{name:'軟胎',short:'軟',grip:1.03,wear:.16},{name:'中性胎',short:'中',grip:1,wear:.1},{name:'硬胎',short:'硬',grip:.975,wear:.065},{name:'雨胎',short:'雨',grip:.97,wear:.1}];
function fixture(source=raw){
 const code=stripTypeScriptTypes(source,{mode:'transform'}),ast=parseAst(code),node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='updateStrategy');assert.ok(node);
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{open:true,textContent:'',append(node){this.textContent+=node.textContent}});return elements.get(id)};
 const me={compound:0,pits:0,pit:null,pitTyre:2,laps:1,wear:.3,car:{pos:{s:100}},team:'虛構車隊',bestLap:60},calls=[];
 const field={me,wet:0,raceTime:10,laps:5,pitlane:{speed:20},racers:[me],sc:{phase:'off'},standings(){return[this.me]},suggestTyre:()=>1};
 Object.defineProperty(field,'rainAt',{get(){throw new Error('不得讀取未來雨勢')}});
 const context=vm.createContext({Number,Math,TYRES:tyres,RAIN:3,car:{r26:false},PIT:{LIM_IN:0,LIM_OUT:100},track:{length:1000,ds:10,N:2,vTarget:[50,50]},field,$,
  document:{createTextNode:text=>({textContent:text})},pitCalibration:new PitCalibration(),pitCalibrationKey:()=>`fixture:classic:${field.wet>.3?'wet':'dry'}`,
  wetTrend:(a,b)=>b>a?'路面持續變濕':'路面大致穩定',pitBaselineLoss:()=>1,estimatePitStrategy:input=>{calls.push(input);return null},strategyWet:0,strategyLoss:1,strategySample:null,strategyObservedWear:undefined});
 vm.runInContext(code.slice(node.start,node.end),context);return{context,field,me,calls,$,run(){context.updateStrategy();return calls.at(-1)}};
}
async function check(name,run){try{reports.push({name,status:'PASS',details:await run()})}catch(e){reports.push({name,status:'FAIL',error:e.stack})}}
await check('before未傳下一套胎；after使用玩家指定硬胎與當下濕度，切換雨胎立即反映',()=>{
 const previous=fixture(old),next=fixture();assert.equal(previous.run().tyres,undefined);
 let input=next.run();assert.equal(input.tyres.current.label,'軟胎');assert.equal(input.tyres.next.label,'硬胎');assert.equal(input.wetness,0);
 next.me.pitTyre=3;next.field.wet=.8;input=next.run();assert.equal(input.tyres.next.rain,true);assert.equal(input.wetness,.8);assert.ok(next.$('strategy-detail').textContent.includes('換上雨胎（你指定）'));
 return{beforeHasTyres:false,afterSelected:input.tyres.next.label,wetness:input.wetness};
});
await check('未指定時用車隊建議；三種進站階段顯示鎖定胎種並停止假設再進站，不回讀預抽結果',()=>{
 const h=fixture();h.me.pitTyre=-1;assert.equal(h.run().tyres.next.label,'中性胎');const calls=h.calls.length;
 for(const ph of['in','box','out']){h.me.pit={ph,next:3};Object.defineProperty(h.me.pit,'T',{get(){throw new Error('不得預知停站耗時')}});Object.defineProperty(h.me.pit,'slow',{get(){throw new Error('不得預知停站失誤')}});h.run();assert.equal(h.calls.length,calls);assert.ok(h.$('strategy-detail').textContent.includes('鎖定換上雨胎'));assert.ok(!h.$('strategy-detail').textContent.includes('本圈進站完整損失'));assert.ok(h.$('strategy-advice').textContent.includes('作業中'));}
 h.me.pit=null;h.run();assert.equal(h.calls.length,calls+1);
});
await check('短樣本不當實測；走過0.12圈後用近期實際胎耗，關閉策略面板仍取樣',()=>{
 const h=fixture();assert.equal(h.run().observedWearPerLap,undefined);h.$('gp-strategy').open=false;
 h.me.car.pos.s=220;h.me.wear=.324;h.field.raceTime=15;h.run();assert.equal(h.calls.length,1);
 h.$('gp-strategy').open=true;const value=h.run().observedWearPerLap;assert.ok(Math.abs(value-.2)<1e-10);return{observedWearPerLap:value};
});
await check('新場次/換胎/回溯/濕度明顯改變清掉舊樣本；跳躍和磨光不捏造零胎耗',()=>{
 const h=fixture();const sample=()=>{h.run();h.me.car.pos.s+=130;h.me.wear+=.026;h.field.raceTime+=3;assert.ok(h.run().observedWearPerLap>.1)};
 sample();h.me.pits++;assert.equal(h.run().observedWearPerLap,undefined);
 sample();h.field.raceTime=1;assert.equal(h.run().observedWearPerLap,undefined);
 sample();h.field.wet=.7;assert.equal(h.run().observedWearPerLap,undefined);
 h.me.laps+=2;assert.equal(h.run().observedWearPerLap,undefined);
 h.me.wear=.999;h.me.car.pos.s+=130;assert.equal(h.run().observedWearPerLap,undefined);
 h.field.me={...h.me,car:{pos:{s:100}},wear:.1};assert.equal(h.run().observedWearPerLap,undefined);
});
const result={status:reports.every(r=>r.status==='PASS')?'PASS':'FAIL',cases:reports,sourceHashes:{'src/main.ts':hash(raw)},beforeMainSha256:hash(old),limitations:['真updateStrategy函式；估計器用捕捉輸入替身，模型數值由raceplus-strategy.mjs另驗，不代表實際進站誤差或手機測試。']};
await writeFile(path.join(project,'tools/dev-tests/raceplus-strategy-main-result.json'),JSON.stringify(result,null,2)+'\n');for(const r of reports)console.log(JSON.stringify(r));if(result.status!=='PASS')process.exitCode=1;
