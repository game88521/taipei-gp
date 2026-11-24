// Rex <game88521@gmail.com>. Reading preference restoration and historical backup isolation.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pureUrl} from './pure-module-loader.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),B=await import(await pureUrl(root,'atlas-backup.ts')),V=await import(await pureUrl(root,'atlas-backup-validators.ts'));
const key='taipei-gp-harbor-reading-v1',privateKey='taipei-gp-meridian-private-continuation-v1',map=new Map([[key,'{"v":1,"scale":150}'],[privateKey,'PRIVATE_PROOF_FIXTURE']]);
const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},port={read:async()=>[],replace:async()=>{},journal:async()=>{},clearJournal:async()=>{}},report={status:'FAIL',localOnly:true,externalRequests:0,cases:[]};
async function test(name,run){try{await run();report.cases.push({name,status:'PASS'});}catch(error){report.cases.push({name,status:'FAIL',error:String(error.stack)});}console.log(JSON.stringify(report.cases.at(-1)));}
await test('41分類公開閱讀設定可驗證並單獨還原，私席證明不進備份',async()=>{
 const before=await B.captureAtlasBackup(storage,port,'0123456789ab');assert.equal(before.slots.length,41);V.validateAtlasBackup(before,()=>({ok:true}));assert.ok(!JSON.stringify(before).includes('PRIVATE_PROOF_FIXTURE'));
 const next=structuredClone(before);next.slots.find(s=>s.key===key).raw='{"v":1,"scale":125}';V.validateAtlasBackup(next,()=>({ok:true}));await B.restoreAtlasBackup(storage,port,next,before,{selectedKeys:[key],replays:false});assert.equal(map.get(key),'{"v":1,"scale":125}');assert.equal(map.get(privateKey),'PRIVATE_PROOF_FIXTURE');
});
await test('舊40分類還原不刪新閱讀設定，15到35歷史格式仍讀得進',async()=>{
 const before=await B.captureAtlasBackup(storage,port,'0123456789ab');for(const count of[15,17,19,26,27,31,35,40]){const old=structuredClone(before);old.slots=old.slots.slice(0,count);const parsed=B.parseAtlasBackup(JSON.stringify(old));V.validateAtlasBackup(parsed,()=>({ok:true}));await B.restoreAtlasBackup(storage,port,parsed,before,{replays:false});assert.equal(map.get(key),before.slots.find(s=>s.key===key).raw);}
});
await test('錯字級、未知欄位、重複分類及私密key拒絕，原資料保持',async()=>{
 const snapshot=JSON.stringify([...map]),b=await B.captureAtlasBackup(storage,port,'0123456789ab');for(const value of[{v:1,scale:200},{v:1,scale:'150'},{v:1,scale:125,extra:true}]){const bad=structuredClone(b);bad.slots.find(s=>s.key===key).raw=JSON.stringify(value);assert.throws(()=>V.validateAtlasBackup(B.parseAtlasBackup(JSON.stringify(bad)),()=>({ok:true})));}
 const bad=structuredClone(b);bad.slots.at(-1).key=privateKey;assert.throws(()=>B.parseAtlasBackup(JSON.stringify(bad)));assert.equal(JSON.stringify([...map]),snapshot);
});
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=report.summary.FAIL?'FAIL':'PASS';await writeFile(new URL('harbor-backup-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.summary.FAIL)process.exitCode=1;
