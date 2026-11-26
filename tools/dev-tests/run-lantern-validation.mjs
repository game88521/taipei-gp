// Rex <game88521@gmail.com>. Serial, local-only, immutable logs; no deploy or Git mutation.
import {spawn} from 'node:child_process';import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'tools/dev-tests/lantern-validation-'+Date.now());await mkdir(dir);
const sha=b=>createHash('sha256').update(b).digest('hex');
async function sources(){const out={};async function walk(rel){for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){if(e.name==='node_modules')continue;const name=path.posix.join(rel,e.name);if(e.isDirectory())await walk(name);else if(/\.(ts|css|js|mjs|json)$/.test(name))out[name]=sha(await readFile(path.join(root,name)));}}for(const d of['src','shared','server','api','public'])await walk(d);for(const n of['index.html','multiplayer.html','splitscreen.html','package.json','vite.config.ts'])out[n]=sha(await readFile(path.join(root,n)));return out;}
const suites=[
 ['build','npm',null],
 ['lantern-ui','node',null],
 ['lantern-performance-node','node','lantern-performance-node-result.json'],
 ['lantern-api-node','node','lantern-api-node-result.json'],
 ['lantern-api-deadline-node','node','lantern-api-deadline-node-result.json'],
 ['lantern-ctf-node','node','lantern-ctf-result.json'],
 ['lantern-story-node','node','lantern-story-result.json'],
 ['beacon-modes-node','node',null],
 ['leaderboard-regression','vm','shots-leaderboard-regression.json'],
 ['lantern-ui-browser','node','lantern-ui-browser-result.json'],
 ['lantern-performance-browser','node','lantern-performance-browser-result.json'],
 ['lantern-modes-browser','node','lantern-modes-browser-result.json'],
 ['lantern-online-browser','node','lantern-online-browser-result.json'],
 ['harbor-reading-browser','node','harbor-reading-browser-result.json'],
 ['harbor-quick-room-browser','node','harbor-quick-room-browser-result.json'],
 ['chain-stab','bash',null],
];
if(process.argv.slice(2).some(a=>a!=='--resume')||process.argv.slice(2).length>1)throw Error('Usage: node tools/dev-tests/run-lantern-validation.mjs [--resume]');
const report={status:'RUNNING',startedAt:new Date().toISOString(),localOnly:true,committed:false,pushed:false,deployed:false,realPhoneUsed:false,suites:[],evidence:path.relative(root,dir).replaceAll('\\','/')};
if(process.argv.includes('--resume')){
 const prior=JSON.parse(await readFile(path.join(root,'tools/dev-tests/lantern-validation-result.json'),'utf8')),build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([a-f0-9]{12})'/)?.[1];
 if(prior.build!==build||!prior.sourceUnchangedDuringValidation||JSON.stringify(prior.sourceHashes)!==JSON.stringify(await sources()))throw Error('Cannot resume: product sources or build changed. Run a fresh validation.');
 report.build=build;report.sourceHashes=prior.sourceHashes;report.resumedFrom=prior.evidence;
 for(const row of prior.suites){if(row.status!=='PASS')break;report.suites.push({...row,carriedFrom:row.carriedFrom??prior.evidence});}
}
const write=async()=>{const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(dir,'report.json'),bytes);await writeFile(path.join(root,'tools/dev-tests/lantern-validation-result.json'),bytes);};
for(const[name,kind,result]of suites.slice(report.suites.length)){
 console.log(JSON.stringify({suite:name,phase:'started'}));
 const command=kind==='npm'?(process.env.ComSpec??'C:\\Windows\\System32\\cmd.exe'):kind==='bash'?'C:\\Program Files\\Git\\bin\\bash.exe':process.execPath;
 const args=kind==='npm'?['/d','/s','/c','npm.cmd run build']:kind==='bash'?['tools/dev-tests/chain-stab.sh']:[...(kind==='vm'?['--experimental-vm-modules']:[]),'tools/dev-tests/'+name+'.mjs'];
 const started=Date.now(),child=spawn(command,args,{cwd:root,windowsHide:true,env:{...process.env,GP_MULTIPLAYER_CDP_PORT:'9336',GP_CDP_PORT:'9336',npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false'}});let stdout='',stderr='',error;
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const timer=setTimeout(()=>child.kill(),name==='chain-stab'?1500000:600000);
 const code=await new Promise(resolve=>{child.on('error',e=>{error=String(e);resolve(-1);});child.on('close',resolve);});clearTimeout(timer);
 await writeFile(path.join(dir,name+'.stdout.txt'),stdout);await writeFile(path.join(dir,name+'.stderr.txt'),stderr);
 let data;if(result)try{data=JSON.parse(await readFile(path.join(root,'tools/dev-tests',result),'utf8'));}catch(e){error=String(e);}
 const explicitFail=data?.status==='FAIL'||data?.summary?.FAIL>0||data?.FAIL>0;
 const row={name,status:code===0&&!error&&!explicitFail?'PASS':'FAIL',exitCode:code,milliseconds:Date.now()-started,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),...(result?{result,summary:data?.summary??{PASS:data?.PASS??data?.passed,FAIL:data?.FAIL??0},build:data?.build}:{}),error};
 report.suites.push(row);
 if(name==='build'&&row.status==='PASS'){report.build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([a-f0-9]{12})'/)?.[1];report.sourceHashes=await sources();}
 if(result&&data)await writeFile(path.join(dir,result),JSON.stringify(data,null,2)+'\n');
 if(name==='chain-stab'){const output=await readFile(path.join(root,'tools/dev-tests/chain-stab-out.txt'),'utf8');await writeFile(path.join(dir,'chain-stab-out.txt'),output);if(!output.includes('=== done: 3/3 PASS'))row.status='FAIL';}
 console.log(JSON.stringify({suite:name,status:row.status,exitCode:code,summary:row.summary,error,...row.status==='FAIL'?{tail:(stdout+'\n'+stderr).slice(-2200)}:{}}));await write();if(row.status!=='PASS')break;
}
if(report.sourceHashes)report.sourceUnchangedDuringValidation=JSON.stringify(report.sourceHashes)===JSON.stringify(await sources());
report.status=report.suites.length===suites.length&&report.suites.every(s=>s.status==='PASS')&&report.sourceUnchangedDuringValidation?'PASS':'FAIL';report.finishedAt=new Date().toISOString();await write();console.log(JSON.stringify({status:report.status,build:report.build,suites:report.suites.length,sourceUnchangedDuringValidation:report.sourceUnchangedDuringValidation,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;
