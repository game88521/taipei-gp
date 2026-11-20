// Exact build resource sizes, not a simulated claim about device load speed.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),workspace=path.dirname(root),original=path.resolve(workspace,'../Rex/taipei-gp');
const hash=b=>createHash('sha256').update(b).digest('hex'),evidence=path.join(root,'tools/dev-tests',`atlas-loading-metrics-evidence-${Date.now()}-${randomUUID().slice(0,8)}`);await mkdir(evidence);
const scriptSha256=hash(await readFile(new URL(import.meta.url))),files=['vite.config.ts','src/main.ts','src/multiplayer-game.ts','src/summit-lazy-city.ts','src/summit-lazy-replay.ts'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(path.join(root,f)))])));
const initial=await sourceHashes();
async function measure(project){
const sw=await readFile(path.join(project,'dist/sw.js'),'utf8'),rows=[];
for(const entry of ['index.html','multiplayer.html']){
const html=await readFile(path.join(project,'dist',entry),'utf8');
const resources=[...new Set([...html.matchAll(/<(?:script|link)\b[^>]*>/g)].flatMap(([tag])=>{if(tag.startsWith('<link')&&!/rel="(?:modulepreload|stylesheet)"/.test(tag))return[];const name=tag.match(/(?:src|href)="([^"]+)"/)?.[1];return name?.startsWith('/assets/')?[name]:[];}))].sort();
const records=[];for(const file of resources){const body=await readFile(path.join(project,'dist',file.slice(1)));records.push({file,bytes:body.length,gzipBytes:gzipSync(body).length,sha256:hash(body)});}
rows.push({entry,resources:records,bytes:records.reduce((n,r)=>n+r.bytes,0),gzipBytes:records.reduce((n,r)=>n+r.gzipBytes,0)});
}
const precache=JSON.parse(sw.match(/const PRECACHE = (\[[^\n]+\]);/)[1]);let precacheBytes=0;for(const file of precache)precacheBytes+=(await readFile(path.join(project,'dist',file==='/'?'index.html':file.slice(1)))).length;
return{build:sw.match(/const VERSION = '([^']+)'/)[1],swSha256:hash(sw),entries:rows,precacheFiles:precache.length,precacheBytes};
}
const report={status:'FAIL',localOnly:true,externalRequests:0,originalModified:false,scriptSha256,sourceHashes:initial,evidence:path.relative(root,evidence).replaceAll('\\','/'),limitations:['HTML entry中script/modulepreload/stylesheet逐檔計量，不含進入模式後的城市資料、執行時間或裝置速度。','gzipBytes是各檔獨立gzip後總和，不代表實際CDN傳輸協定。','原專案dist為任務開始時已交付的Summit；不執行或修改原專案。']};
try{
report.before=await measure(original);assert.equal(report.before.build,'8447a11b8964');report.after=await measure(root);
report.comparison=report.after.entries.map(after=>{const before=report.before.entries.find(r=>r.entry===after.entry);return{entry:after.entry,beforeBytes:before.bytes,afterBytes:after.bytes,deltaBytes:after.bytes-before.bytes,beforeGzipBytes:before.gzipBytes,afterGzipBytes:after.gzipBytes,deltaGzipBytes:after.gzipBytes-before.gzipBytes};});
for(const row of report.after.entries)assert.ok(!row.resources.some(r=>/nexus-(?:workshop|coop|replay)-ui-/.test(r.file)));
assert.equal(hash(await readFile(path.join(original,'dist/sw.js'))),report.before.swSha256);
report.status='PASS';
}catch(error){report.error=String(error.stack);}finally{report.sourceUnchangedDuringTests=JSON.stringify(initial)===JSON.stringify(await sourceHashes());report.scriptUnchangedDuringTests=scriptSha256===hash(await readFile(new URL(import.meta.url)));if(!report.sourceUnchangedDuringTests||!report.scriptUnchangedDuringTests)report.status='FAIL';const body=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'report.json'),body);await writeFile(path.join(root,'tools/dev-tests/atlas-loading-metrics-result.json'),body);console.log(JSON.stringify({status:report.status,comparison:report.comparison,error:report.error,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;}
