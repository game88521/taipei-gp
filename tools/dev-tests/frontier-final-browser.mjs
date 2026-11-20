// Rex <game88521@gmail.com>. Serial CDP suites; each owns and closes only its isolated contexts.
import {spawn} from 'node:child_process';
import {open,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const suites=['frontier-friends','frontier-room','frontier-city-watch','frontier-city-replay-import','frontier-city-reconnect','frontier-performance','frontier-incidents','frontier-convoy','frontier-crown','frontier-rally','frontier-duty-missions','frontier-tandem-practice','frontier-cup','frontier-mode-switch'];
const build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([a-f0-9]{12})'/)[1];
const report={status:'RUNNING',build,localOnly:true,externalRequests:0,startedAt:new Date().toISOString(),sequence:[]},out=new URL('frontier-final-browser-result.json',import.meta.url);
if(process.argv.includes('--resume')){
 const sha=b=>createHash('sha256').update(b).digest('hex');let previous;
 try{previous=JSON.parse(await readFile(out,'utf8'));}catch{}
 if(previous?.build===build)for(let i=0;i<previous.sequence.length;i++){
  const entry=previous.sequence[i];if(entry.suite!==suites[i]||entry.status!=='PASS'||entry.exitCode!==0)break;
  try{
   const bytes=await readFile(path.join(root,'tools/dev-tests',entry.suite+'-browser-result.json')),result=JSON.parse(bytes);
   if(result.status!=='PASS'||result.build!==build||!result.sourceUnchangedDuringTests||!result.scriptUnchangedDuringTests||!result.cleanupComplete||result.externalRequests.length||result.exceptions.length)break;
   if(sha(await readFile(path.join(root,'tools/dev-tests',entry.suite+'-browser.mjs')))!==result.scriptSha256)break;
   let stable=true;for(const[file,hash]of Object.entries(result.sourceHashes))if(sha(await readFile(path.join(root,file)))!==hash){stable=false;break;}if(!stable)break;
   const reused={...entry,reused:true,sourceHashesRechecked:true,resultSha256:sha(bytes),originalFinishedAt:result.finishedAt};report.sequence.push(reused);console.log(JSON.stringify(reused));
  }catch{break;}
 }
}
for(const name of suites.slice(report.sequence.length)){console.log(JSON.stringify({suite:name,phase:'started'}));const fd=await open(path.join(root,'tools/dev-tests',name+'-final-log.txt'),'w');const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'tools/dev-tests',name+'-browser.mjs')],{cwd:root,windowsHide:true,stdio:['ignore',fd.fd,fd.fd]});child.once('error',reject);child.once('exit',c=>resolve(c??1));}).finally(()=>fd.close());let result;try{result=JSON.parse(await readFile(path.join(root,'tools/dev-tests',name+'-browser-result.json'),'utf8'));}catch{}const entry={suite:name,exitCode:code,status:code===0&&result?.status==='PASS'&&result.build===build?'PASS':'FAIL',summary:result?.summary};report.sequence.push(entry);await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(entry));if(entry.status!=='PASS'){console.log((await readFile(path.join(root,'tools/dev-tests',name+'-final-log.txt'),'utf8')).slice(-6000));break;}}
report.status=report.sequence.length===suites.length&&report.sequence.every(s=>s.status==='PASS')?'PASS':'FAIL';report.finishedAt=new Date().toISOString();await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,suites:report.sequence.length,expected:suites.length,build}));if(report.status!=='PASS')process.exitCode=1;
