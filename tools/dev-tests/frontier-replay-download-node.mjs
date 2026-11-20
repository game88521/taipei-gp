// Real production TypeScript downloader and codec; deterministic in-process transport only.
// Timers are shortened only in explicit timeout fixtures. No HTTP, WS, browser or storage.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CityReplayRecorder} from '../../server/frontier-city-replay-service.mjs';
import {CITY_REPLAY_CHUNK_CHARS,CITY_REPLAY_MAX_CHARS} from '../../shared/frontier-city-replay.ts';
import {pureUrl} from './pure-module-loader.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const files=['src/frontier-city-replay-client.ts','shared/frontier-city-replay.ts','server/frontier-city-replay-service.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')])));
const report={status:'FAIL',localOnly:true,externalRequests:0,fixture:'Real downloader, codec and recorder; injected in-process send and bounded timeout clocks, no network or storage.',cases:[],sourceHashes:await hashes()};
const {CityReplayDownload}=await import(await pureUrl(root,'frontier-city-replay-client.ts'));
function recording(count=1){const r=new CityReplayRecorder({source:'social',mode:'cruise'});for(let i=0;i<count;i++)r.sample(1000+i*200,[{key:'private-driver-key',slot:0,vehicle:'sedan',pose:{x:i/10,y:0,z:0,h:0,vx:1,vz:0}}]);r.finish(1000+(count-1)*200,'complete');assert.ok(r.descriptor().ready);return r;}
const small=recording(),large=recording(220);
async function test(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack)});}console.log(JSON.stringify(report.cases.at(-1)));}
await test('多塊真匿名回放依序拉取並嚴格解碼，一次僅一個請求且不保存憑證',async()=>{
 const requests=[];let d;d=new CityReplayDownload(m=>{requests.push(m);queueMicrotask(()=>d.receive(large.part(m.key,m.offset)));return true;});
 const archive=await d.start(large.descriptor());assert.equal(archive.frames.length,220);assert.ok(requests.length>1);assert.deepEqual(requests.map(m=>m.offset),requests.map((_,i)=>i*CITY_REPLAY_CHUNK_CHARS));assert.equal(JSON.stringify(archive).includes('private-driver-key'),false);assert.equal(d.busy,false);return{chunks:requests.length,frames:archive.frames.length};
});
await test('尚未ready與額外descriptor欄位在送出之前拒絕',async()=>{
 let sent=0;const d=new CityReplayDownload(()=>{sent++;return true;});await assert.rejects(d.start({...small.descriptor(),ready:false}));await assert.rejects(d.start({...small.descriptor(),token:'secret'}));assert.equal(sent,0);assert.equal(d.busy,false);
});
await test('同時第二個下載被拒，取消立即清資料且不重試',async()=>{
 let sent=0;const d=new CityReplayDownload(()=>{sent++;return true;}),p=d.start(small.descriptor()),rejected=assert.rejects(p,/取消/);await assert.rejects(d.start(small.descriptor()),/正在/);d.cancel();await rejected;assert.equal(sent,1);assert.equal(d.busy,false);
});
await test('換場、失去ready及離房會取消舊回放；穩定descriptor不取消',async()=>{
 for(const change of[null,{...small.descriptor(),ready:false},{...small.descriptor(),key:'f'.repeat(24)}]){
  const d=new CityReplayDownload(()=>true),p=d.start(small.descriptor()),rejected=assert.rejects(p,/更新/);d.observe(small.descriptor());assert.equal(d.busy,true);d.observe(change);await rejected;assert.equal(d.busy,false);
 }
});
await test('斷線送出失敗與send例外皆停止且清timer',async()=>{
 for(const send of[()=>false,()=>{throw Error('closed');}]){const d=new CityReplayDownload(send);await assert.rejects(d.start(small.descriptor()),/連線/);assert.equal(d.busy,false);}
});
for(const [name,mutate]of[
 ['片段額外欄位',p=>({...p,token:'bad'})],['錯序offset',p=>({...p,offset:CITY_REPLAY_CHUNK_CHARS})],
 ['超大總長度',p=>({...p,totalChars:CITY_REPLAY_MAX_CHARS+1})],['空片段',p=>({...p,text:''})],
 ['非末段提早截斷',p=>({...p,totalChars:p.text.length+1})],['無效JSON',p=>({...p,text:'!',totalChars:1})],
])await test(name+'不留未驗證資料',async()=>{const d=new CityReplayDownload(()=>true),p=d.start(small.descriptor()),rejected=assert.rejects(p);assert.equal(d.receive(mutate(small.part(small.key,0))),true);await rejected;assert.equal(d.busy,false);});
await test('舊下載的不同key片段不影響目前transfer，取消後片段不復活',async()=>{
 const d=new CityReplayDownload(()=>true),p=d.start(small.descriptor());assert.equal(d.receive({...small.part(small.key,0),key:'e'.repeat(24)}),true);assert.equal(d.busy,true);d.receive(small.part(small.key,0));assert.equal((await p).frames.length,1);d.receive(small.part(small.key,0));assert.equal(d.busy,false);assert.equal(d.receive({type:'room'}),false);
});
await test('合法檔案若與握手摘要不符也拒絕',async()=>{
 const d=new CityReplayDownload(()=>true),p=d.start({...small.descriptor(),frames:2}),rejected=assert.rejects(p,/無效/);d.receive(small.part(small.key,0));await rejected;assert.equal(d.busy,false);
});
await test('後續塊有節流，排程等待期間取消不再送出',async()=>{
 let sent=0;const d=new CityReplayDownload(()=>{sent++;return true;}),p=d.start(large.descriptor()),rejected=assert.rejects(p,/取消/);d.receive(large.part(large.key,0));assert.equal(sent,1);d.cancel();await rejected;await delay(40);assert.equal(sent,1);assert.equal(d.busy,false);
});
await test('取消後立即重取同key，晚到的相同舊片不會誤殺新下載或重複pull',async()=>{
 const requests=[];let d,respond=false;d=new CityReplayDownload(m=>{requests.push(m);if(respond)queueMicrotask(()=>d.receive(large.part(m.key,m.offset)));return true;});
 const first=d.start(large.descriptor()),rejected=assert.rejects(first,/取消/);d.cancel();await rejected;
 const second=d.start(large.descriptor());d.receive(large.part(large.key,0));d.receive(large.part(large.key,0));assert.equal(requests.length,2);respond=true;
 const archive=await second;assert.equal(archive.frames.length,220);assert.equal(requests.filter(m=>m.offset===0).length,2);assert.equal(new Set(requests.slice(1).map(m=>m.offset)).size,requests.length-1);assert.equal(d.busy,false);
});
await test('相同offset但不同內容的重複片仍拒絕，不當成合法舊回應',async()=>{
 const d=new CityReplayDownload(()=>true),p=d.start(large.descriptor()),rejected=assert.rejects(p,/順序/),part=large.part(large.key,0);d.receive(part);d.receive({...part,text:'!'+part.text.slice(1)});await rejected;assert.equal(d.busy,false);
});
await test('閒置與總期限到期各自停止，不自動再送請求',async()=>{
 for(const timing of[{idleMs:10,totalMs:100},{idleMs:100,totalMs:10}]){let sent=0;const d=new CityReplayDownload(()=>{sent++;return true;},()=>{},timing);await assert.rejects(d.start(small.descriptor()),/逾時|期限/);assert.equal(d.busy,false);assert.equal(sent,1);}
});
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.sourceUnchangedDuringTests=JSON.stringify(report.sourceHashes)===JSON.stringify(await hashes());report.status=!report.summary.FAIL&&report.sourceUnchangedDuringTests?'PASS':'FAIL';report.completedAt=new Date().toISOString();await writeFile(new URL('frontier-replay-download-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.status!=='PASS')process.exitCode=1;
