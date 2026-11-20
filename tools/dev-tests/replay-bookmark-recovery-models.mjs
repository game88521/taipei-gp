import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {pureUrl} from './pure-module-loader.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {ReplayBookmarks,SUMMIT_BOOKMARKS_KEY}=await import(await pureUrl(root,'summit-replay-bookmarks.ts'));
const source=new URL('../../src/summit-replay-bookmarks.ts',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceSha256=sha(await readFile(source)),report={status:'RUNNING',localOnly:true,sourceSha256,cases:[]};
const existing=[{replayId:'previous-race',duration:5000,marks:[{id:'retained-mark',at:1250,label:'原有事件'}]}];
function storage(raw,{deniedRead=false}={}){const values=new Map([[SUMMIT_BOOKMARKS_KEY,raw]]),writes=[];return{values,writes,getItem(key){if(deniedRead)throw Error('storage getItem denied');return values.get(key)??null;},setItem(key,value){writes.push({key,value});values.set(key,value);}};}
function pageOnly(raw,options){
  const store=storage(raw,options),bookmarks=new ReplayBookmarks(store);assert.ok(bookmarks.error,'初始讀取失敗須有警告');
  const mark=bookmarks.add('new-race',10000,2000,'本頁新增');assert.deepEqual(bookmarks.list('new-race'),[mark],'損壞原文時仍可在本頁使用新書籤');
  assert.equal(store.values.get(SUMMIT_BOOKMARKS_KEY),raw,'新增不得覆寫原文');assert.equal(store.writes.length,0);assert.ok(bookmarks.error,'新增後仍須保留僅本頁的警告');
  bookmarks.remove('new-race',mark.id);assert.deepEqual(bookmarks.list('new-race'),[]);assert.equal(store.values.get(SUMMIT_BOOKMARKS_KEY),raw,'本頁刪除也不得覆寫原文');assert.equal(store.writes.length,0);
  return{originalPreserved:true,storageWrites:store.writes.length,warning:bookmarks.error};
}
async function check(name,run){try{report.cases.push({name,status:'PASS',details:await run()});}catch(error){report.cases.push({name,status:'FAIL',error:String(error.stack)});process.exitCode=1;}console.log(JSON.stringify(report.cases.at(-1)));}
await check('損壞JSON保留原文，新書籤可於本頁新增刪除',()=>pageOnly(JSON.stringify(existing).slice(0,-1)));
await check('getItem丟例外時停止覆寫未知原資料',()=>pageOnly(JSON.stringify(existing),{deniedRead:true}));
await check('可解析但結構錯誤的原資料維持保護',()=>pageOnly(JSON.stringify({unexpected:existing})));
await check('正常資料仍可保存，原有及新書籤皆可重載',()=>{
  const store=storage(JSON.stringify(existing)),bookmarks=new ReplayBookmarks(store);assert.equal(bookmarks.error,'');
  const mark=bookmarks.add('new-race',10000,2000,'正常新增');assert.equal(store.writes.length,1);assert.equal(bookmarks.error,'');
  const reloaded=new ReplayBookmarks(store);assert.deepEqual(reloaded.list('previous-race'),existing[0].marks);assert.deepEqual(reloaded.list('new-race'),[mark]);
  reloaded.remove('new-race',mark.id);assert.equal(store.writes.length,2);assert.deepEqual(new ReplayBookmarks(store).list('new-race'),[]);assert.deepEqual(new ReplayBookmarks(store).list('previous-race'),existing[0].marks);
  return{originalMarksPreserved:1,newMarkReloaded:true,storageWrites:store.writes.length};
});
report.sourceUnchanged=sha(await readFile(source))===sourceSha256;
report.summary={PASS:report.cases.filter(row=>row.status==='PASS').length,FAIL:report.cases.filter(row=>row.status==='FAIL').length};
report.status=!report.sourceUnchanged||report.summary.FAIL?'FAIL':'PASS';if(report.status==='FAIL')process.exitCode=1;
await writeFile(new URL('replay-bookmark-recovery-models-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary,sourceUnchanged:report.sourceUnchanged}));
