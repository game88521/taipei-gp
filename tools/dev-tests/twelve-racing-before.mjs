import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pureUrl } from './pure-module-loader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'), before=path.resolve(root,'../taipei-gp-twelve-before-102e84eea8ea');
globalThis.location={search:''};const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
const oldSave=await import(await pureUrl(before,'save.ts')), oldSeason=await import(await pureUrl(before,'season.ts'));
const count=20001,ghost={t:[],s:[],x:[],z:[],h:[]};for(let i=0;i<count;i++){ghost.t.push(i*.05);ghost.s.push(i*.15);ghost.x.push(i*.1);ghost.z.push(0);ghost.h.push(0);}
const parsed=oldSave.parseSaveFile(JSON.stringify({schema:3,best:1000,sectors:[300,300,400],ghost,opts:{}}));
assert.equal(parsed.ok,true);assert.ok(parsed.dropped.some(p=>p==='ghost'));assert.ok(oldSave.criticalSaveDrops(parsed.dropped).includes('ghost'));
const season={round:2,results:[{id:'australia',order:['A','B']},{id:'china',order:['B','A']}]};
const rows=oldSeason.driverStandings(season,n=>n);assert.equal(rows[0].pts,43);assert.equal(rows[1].pts,43);assert.deepEqual(rows[0].positions,rows[1].positions);assert.equal(rows[0].name,'A');assert.equal(season.results.at(-1).order[0],'B');
const report={status:'REPRODUCED',before,cases:[{name:'20,001點有效慢圈遭真存檔parser列為critical drop，writeSave原有檢查會拒絕',status:'PASS',points:count,duration:1000,dropped:parsed.dropped},{name:'完全同分同名次次數，舊排名由第一次出現順序決定冠軍',status:'PASS',first:rows[0].name,latestWinner:'B',points:43}],sourceHashes:{},scriptSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')};
for(const file of ['src/main.ts','src/save.ts','src/season.ts'])report.sourceHashes[file]=createHash('sha256').update(await readFile(path.join(before,file))).digest('hex');
await writeFile(path.join(root,'tools/dev-tests/twelve-racing-before-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
