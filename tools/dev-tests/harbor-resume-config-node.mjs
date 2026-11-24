// Rex <game88521@gmail.com>. Configuration boundaries and CLI redaction, offline only.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkResumeConfig} from '../check-resume-config.mjs';
const report = {status:'FAIL', localOnly:true, externalRequests:0, cases:[]};
function test(name, fn) { try { fn(); report.cases.push({name,status:'PASS'}); } catch(error) { report.cases.push({name,status:'FAIL',error:String(error.stack)}); } console.log(JSON.stringify(report.cases.at(-1))); }
test('兩個金鑰各自檢查，缺省不宣稱能跨重啟續局', () => {
  assert.equal(checkResumeConfig({}).status, 'ACTION_REQUIRED');
  assert.deepEqual(checkResumeConfig({}).checks, {MERIDIAN_CHECKPOINT_SECRET:'MISSING',SERIES_RESUME_SECRET:'MISSING'});
  assert.equal(checkResumeConfig({MERIDIAN_CHECKPOINT_SECRET:'a'.repeat(64)}).checks.SERIES_RESUME_SECRET, 'MISSING');
});
test('Meridian只收64小寫hex；空值與前後空白不能偷偷修正', () => {
  for(const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), ' '+ 'a'.repeat(64), null]) assert.equal(checkResumeConfig({MERIDIAN_CHECKPOINT_SECRET:value}).checks.MERIDIAN_CHECKPOINT_SECRET, 'INVALID');
});
test('舊系列金鑰依UTF8 bytes驗32到4096邊界', () => {
  for(const [value,expected] of [['a'.repeat(31),'INVALID'],['a'.repeat(32),'CONFIGURED'],['a'.repeat(4096),'CONFIGURED'],['a'.repeat(4097),'INVALID'],['甲'.repeat(11),'CONFIGURED']]) assert.equal(checkResumeConfig({SERIES_RESUME_SECRET:value}).checks.SERIES_RESUME_SECRET, expected);
});
const tool=fileURLToPath(new URL('../check-resume-config.mjs',import.meta.url));
test('真CLI由環境讀取兩個獨立金鑰；stdout/stderr不含值', () => {
  const one=randomBytes(32).toString('hex'),two=randomBytes(32).toString('hex');
  const result=spawnSync(process.execPath,[tool],{encoding:'utf8',windowsHide:true,env:{...process.env,MERIDIAN_CHECKPOINT_SECRET:one,SERIES_RESUME_SECRET:two}});
  assert.equal(result.status,0);const data=JSON.parse(result.stdout);assert.equal(data.status,'READY');assert.equal(data.liveRacePersistence,false);
  for(const value of[one,two])assert.ok(!(result.stdout+result.stderr).includes(value));
});
test('無效金鑰及命令列誤傳皆失敗且不回顯金鑰', () => {
  const invalid='sensitive-invalid-'+randomBytes(20).toString('hex');
  const result=spawnSync(process.execPath,[tool],{encoding:'utf8',windowsHide:true,env:{...process.env,MERIDIAN_CHECKPOINT_SECRET:invalid,SERIES_RESUME_SECRET:''}});
  assert.equal(result.status,1);assert.ok(!(result.stdout+result.stderr).includes(invalid));
  const args=spawnSync(process.execPath,[tool,invalid],{encoding:'utf8',windowsHide:true});assert.equal(args.status,2);assert.ok(!(args.stdout+args.stderr).includes(invalid));
});
report.summary={PASS:report.cases.filter(row=>row.status==='PASS').length,FAIL:report.cases.filter(row=>row.status==='FAIL').length};report.status=report.summary.FAIL?'FAIL':'PASS';await writeFile(new URL('harbor-resume-config-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.summary.FAIL)process.exitCode=1;
