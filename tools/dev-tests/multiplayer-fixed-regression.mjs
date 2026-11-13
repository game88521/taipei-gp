// 沿用原 chain-stab 三項數值，歸檔本次輸出並還原歷史文字。
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(dir, '../..');
const readOptional = async file => { try { return await readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const hash = data => createHash('sha256').update(data).digest('hex');
const files = ['src/main.ts','src/car.ts','src/track.ts','src/rivals.ts','src/pitlane.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(root,file)))])));
const build = (await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const evidence = path.join(dir, `multiplayer-fixed-evidence-${Date.now()}-${randomUUID().slice(0,8)}`);
await mkdir(evidence);
const chainPath = path.join(dir, 'chain-stab-out.txt'), previous = await readOptional(chainPath);
if (previous) await writeFile(path.join(evidence,'chain-stab.previous.txt'),previous);
let stdout='', stderr='', code=null, signal=null, output=null;
try {
  const executable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const child = spawn(executable, ['tools/dev-tests/chain-stab.sh'], { cwd:root,windowsHide:true,env:{...process.env,GP_CDP_PORT:process.env.GP_CDP_PORT??'9333'} });
  child.stdout.on('data',bytes=>{stdout+=bytes;process.stdout.write(bytes);});
  child.stderr.on('data',bytes=>{stderr+=bytes;process.stderr.write(bytes);});
  ({code,signal}=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}));
} finally {
  output=await readOptional(chainPath);
  if(output)await writeFile(path.join(evidence,'chain-stab-out.txt'),output);
  if(previous)await writeFile(chainPath,previous);else if(output)await unlink(chainPath);
  await writeFile(path.join(evidence,'stdout.txt'),stdout);await writeFile(path.join(evidence,'stderr.txt'),stderr);
}
const text=output?.toString('utf8')??'';
const sourceUnchangedDuringTests=(await Promise.all(files.map(async file=>hash(await readFile(path.join(root,file)))===sourceHashes[file]))).every(Boolean);
const history=await readOptional(chainPath),historyPreserved=previous?history?.equals(previous)===true:history===null;
const passed=code===0&&sourceUnchangedDuringTests&&historyPreserved&&['BOT lap2 54.425 hits=0','陳冠宇:162.0','陳冠宇:175.7','=== done: 3/3 PASS'].every(value=>text.includes(value))&&!text.includes('FAIL:');
const report={completedAt:new Date().toISOString(),build,status:passed?'PASS':'FAIL',summary:{passed:passed?3:(text.match(/^PASS: baseline/gm)??[]).length,failed:passed?0:1},code,signal,sourceHashes,sourceUnchangedDuringTests,historyPreserved,output:text,evidence:path.relative(root,evidence).split(path.sep).join('/'),playerStorageTouched:false,productionUsed:false};
await writeFile(path.join(evidence,'multiplayer-fixed-summary.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(dir,'multiplayer-fixed-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,...report.summary,historyPreserved,evidence:report.evidence}));
if(!passed)process.exitCode=1;
