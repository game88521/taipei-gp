// Rex <game88521@gmail.com>. Sequential localhost/pure regression orchestration; never touches production.
import {spawn,execFileSync} from 'node:child_process';
import {open,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const names=['frontier-friends','frontier-radar','frontier-room','expedition-social-client','frontier-city-replay','frontier-city-replay-capacity','frontier-replay-download','frontier-social-watch','frontier-duty-watch','frontier-duty-replay','frontier-city-reconnect','frontier-social-reconnect','frontier-duty-reconnect','frontier-performance-core','frontier-performance-history','frontier-performance-ui','frontier-incidents','frontier-incidents-service','frontier-convoy-models','frontier-convoy-service','frontier-crown-models','frontier-crown-cleanup','frontier-crown-service','frontier-rally','frontier-rally-road','frontier-duty-missions','frontier-duty-roads','frontier-tandem-practice','frontier-cup','frontier-integration','expedition-main-restore','expedition-duty','expedition-social','expedition-racing'];
const git=(...args)=>execFileSync('git.exe',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{encoding:'utf8',windowsHide:true});
const files=[...new Set([...git('ls-files','-z','--','src','shared','server').split('\0'),...git('ls-files','--others','--exclude-standard','-z','--','src','shared','server').split('\0')])].filter(Boolean);
const report={status:'RUNNING',localOnly:true,externalRequests:0,sequence:[],...await startAudit(root,new URL(import.meta.url),files)};
const reportPath=new URL('frontier-final-node-result.json',import.meta.url);
for(const name of names){
 console.log(JSON.stringify({suite:name,phase:'started'}));const log=path.join(root,'tools/dev-tests',name+'-final-log.txt'),fd=await open(log,'w');
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--experimental-transform-types',path.join(root,'tools/dev-tests',name+'-node.mjs')],{cwd:root,windowsHide:true,stdio:['ignore',fd.fd,fd.fd]});child.once('error',reject);child.once('exit',c=>resolve(c??1));}).finally(()=>fd.close());
 const entry={suite:name,exitCode:code,status:code===0?'PASS':'FAIL',log:path.relative(root,log).replaceAll('\\','/')};report.sequence.push(entry);await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(entry));
 if(code!==0){console.log((await readFile(log,'utf8')).slice(-5000));break;}
}
await finishAudit(root,new URL(import.meta.url),report);report.status=report.sequence.length===names.length&&report.sequence.every(s=>s.status==='PASS')&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests?'PASS':'FAIL';await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,suites:report.sequence.length,expected:names.length}));if(report.status!=='PASS')process.exitCode=1;
