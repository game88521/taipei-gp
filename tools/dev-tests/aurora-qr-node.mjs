// Uses the independently maintained jsqr@1.4.0 decoder, installed only in an isolated test directory.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {pureUrl} from './pure-module-loader.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),decoderPath=process.env.AURORA_JSQR??path.resolve(root,'../taipei-gp-aurora-test-tools/node_modules/jsqr/dist/jsQR.js'),decode=createRequire(import.meta.url)(decoderPath),Q=await import(await pureUrl(root,'aurora-qr.ts'));
const report={status:'RUNNING',decoder:'jsqr@1.4.0',localOnly:true,externalRequests:0,cases:[],...await startAudit(root,new URL(import.meta.url),['src/aurora-qr.ts'])};
function pixels(matrix){const n=matrix.length,scale=8,size=(n+8)*scale,pixels=new Uint8ClampedArray(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const mx=Math.floor(x/scale)-4,my=Math.floor(y/scale)-4,black=mx>=0&&mx<n&&my>=0&&my<n&&matrix[my][mx],at=(y*size+x)*4;pixels[at]=pixels[at+1]=pixels[at+2]=black?0:255;pixels[at+3]=255;}return{pixels,size};}
for(const text of['ROOM',...Array.from({length:6},(_,i)=>'x'.repeat([10,25,50,75,100,130][i])),'https://taipei-gp.vercel.app/?crew=ABC234','https://taipei-p7316te67-rex-7837.vercel.app/?social=ABC234&socialMode=convoy']){
 try{const matrix=Q.makeInviteQr(text),p=pixels(matrix),value=decode(p.pixels,p.size,p.size);assert.equal(value?.data,text);const damaged=structuredClone(matrix);damaged[damaged.length-1][damaged.length-1]=!damaged.at(-1).at(-1);const d=pixels(damaged);assert.equal(decode(d.pixels,d.size,d.size)?.data,text);report.cases.push({status:'PASS',bytes:Buffer.byteLength(text),side:matrix.length,oneModuleDamageRecovered:true});}catch(e){report.cases.push({status:'FAIL',error:String(e.stack)});}}
await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.summary.FAIL&&report.sourceUnchangedDuringTests?'PASS':'FAIL';await writeFile(new URL('aurora-qr-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1;
