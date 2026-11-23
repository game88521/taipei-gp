// Rex <game88521@gmail.com>. Reuse existing regression assertions, preserving exact raw output and results.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
assert.equal(process.argv.length,2);
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const evidence=`beacon-multiplayer-regressions-evidence-${Date.now()}-${randomBytes(3).toString('hex')}`;await mkdir(path.join(dir,evidence));
const sources=['server/index.mjs','server/room-service.mjs','server/meridian-racing-service.mjs','server/physics.mjs','src/multiplayer-client.ts','src/car.ts','src/track.ts','src/rivals.ts','src/pitlane.ts','tools/dev-tests/meridian-racing-node.mjs','tools/dev-tests/multiplayer-server-regression.mjs'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await readFile(path.join(root,p)))])));
const report={startedAt:new Date().toISOString(),status:'RUNNING',evidence:'tools/dev-tests/'+evidence,sourceHashes:await sourceHashes(),scriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),externalRequests:[],cases:[],suites:[]};
for(const suite of[{name:'meridian-racing-node',result:'meridian-racing-node-result.json'},{name:'multiplayer-server-regression',result:'multiplayer-server-summary.json'}]){
 const begun=Date.now(),run=spawnSync(process.execPath,['--experimental-transform-types','tools/dev-tests/'+suite.name+'.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
 await writeFile(path.join(dir,evidence,suite.name+'.stdout.txt'),run.stdout??'');await writeFile(path.join(dir,evidence,suite.name+'.stderr.txt'),run.stderr??'');
 let result=null,error=run.error?String(run.error):null;try{const bytes=await readFile(path.join(dir,suite.result));result=JSON.parse(bytes);assert.ok(Date.parse(result.startedAt)>=begun-2000,'stale result receipt');await writeFile(path.join(dir,evidence,suite.result),bytes);}catch(e){error=String(e);}
 const passed=run.status===0&&result?.status==='PASS'&&result.cases.every(c=>c.status==='PASS')&&!error;const row={name:suite.name,status:passed?'PASS':'FAIL',exitCode:run.status,passed:result?.cases?.filter(c=>c.status==='PASS').length??0,failed:result?.cases?.filter(c=>c.status==='FAIL').length??0,error,rawResult:report.evidence+'/'+suite.result,stdout:report.evidence+'/'+suite.name+'.stdout.txt',stderr:report.evidence+'/'+suite.name+'.stderr.txt'};
 report.suites.push(row);report.cases.push({name:suite.name,status:row.status,details:{passed:row.passed,failed:row.failed,exitCode:row.exitCode,error}});console.log(JSON.stringify(row));
}
report.finishedAt=new Date().toISOString();report.sourceUnchangedDuringTests=JSON.stringify(report.sourceHashes)===JSON.stringify(await sourceHashes());report.scriptUnchangedDuringTests=report.scriptSha256===hash(await readFile(fileURLToPath(import.meta.url)));report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.summary.FAIL&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests?'PASS':'FAIL';report.existingRegressionCases=report.suites.reduce((n,s)=>n+s.passed,0);const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(dir,evidence,'report.json'),bytes);await writeFile(path.join(dir,'beacon-multiplayer-regressions-result.json'),bytes);console.log(JSON.stringify({status:report.status,...report.summary,existingRegressionCases:report.existingRegressionCases,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;
