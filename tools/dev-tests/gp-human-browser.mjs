// 非 BOT 的真 main／DOM／WebGL 整合。末圈與天氣／停站由測試準備，並非完整實際駕駛。
// node external-browser.mjs 9333 gp-human-browser.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = process.argv[2], pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
const pending = new Map(); let seq = 0;
const report = { url: 'http://127.0.0.1:4317/?q=low&notraffic', cases: [], exceptions: [],
  limitations: ['測試準備末圈車位、圈數與天氣／停站樣本，不代表完整實際駕駛', '隔離CDP context；使用真main動畫／WebGL但canvas降解析度，不量FPS或視覺品質', '未涵蓋賽季重載；該流程另有真main AST整合測試'] };
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data), job = pending.get(m.id);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (!job) return;
  pending.delete(m.id); clearTimeout(job.timer); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} 逾時`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, ms = 180000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await ev(expression)) return; await delay(250); }
  throw Error(`等待逾時：${expression}`);
}
async function check(name, action) {
  const details = await action(); report.cases.push({ name, status: 'PASS', details }); console.log(JSON.stringify(report.cases.at(-1)));
}
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,playerId:'11111111-1111-4111-8111-111111111111',best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:false},taxi:{money:1000,trips:0},tutDone:true,quality:'low'}));
    const nativeRequest=requestAnimationFrame.bind(window);
    window.__gpTestManual=false;
    window.requestAnimationFrame=(callback)=>{window.__gpTestFrame=callback;if(window.__gpTestManual)return 0;window.__gpTestFrameId=nativeRequest(callback);return window.__gpTestFrameId;};
  ` });
  await send('Page.navigate', { url: report.url });
  await until('!!window.__gp');
  await ev('__gp.renderer.setPixelRatio(0.15);__gp.renderer.setSize(160,90,false)');
  await until('__gp.state === "menu" && !document.querySelector("#btn-gp").disabled');
  await check('UI關排位啟動非BOT GP，正常倒數進入race', async () => {
    await ev(`(() => {const q=document.querySelector('#opt-quali');q.checked=false;q.dispatchEvent(new Event('change'));document.querySelector('#opt-sc').value='off';document.querySelector('#btn-gp').click();document.querySelector('.cp-go:not(:disabled)').click();})()`);
    await until('__gp.state === "countdown" || __gp.state === "race"');
    await until('__gp.state === "race"', 180000);
    const result = await ev(`({state:__gp.state,quali:__gp.qualiRun,query:location.search,kind:document.querySelector('#hud').dataset.kind,tyres:__gp.field.racers.length})`);
    assert.equal(result.state, 'race'); assert.equal(result.quali, false); assert.equal(result.kind, 'gp'); assert.equal(result.tyres, 22); assert.ok(!result.query.includes('bot'));
    // 保留真 Three.js／main callback，以手動幀避免自動loop和人工step互相推進。
    await ev('window.__gpTestManual=true;cancelAnimationFrame(window.__gpTestFrameId);__gp.sound.started=false');
    return result;
  });
  await check('真step衝線走human背景結算；後方車手真完賽，僅發一次獎金', async () => {
    const prepared = await ev(`(() => {
      const g=__gp,f=g.field,t=g.track;window.__gpTestSettlement={calls:0,progress:[],done:false};
      const complete=f.finishRemainderAsync.bind(f);
      f.finishRemainderAsync=async(options)=>{window.__gpTestSettlement.calls++;const result=await complete({...options,onProgress(p){window.__gpTestSettlement.progress.push(p);options.onProgress?.(p)}});window.__gpTestSettlement.done=true;return result};
      // 真物理樣本：先乾地，再濕地維修。沒有改replayStates或replayAt。
      g.input.read=()=>({steer:0,brake:false,throttle:true});
      for(let i=0;i<36;i++)g.step(1/120);
      f.wet=.7;f.rainAt=0;f.me.pit={ph:'box',sd:0,v:0,entry:4,exit:4,t:1,T:3,slow:-1,next:3,box:0,team:0};
      for(let i=0;i<36;i++)g.step(1/120);
      f.me.pit=null;f.me.compound=2;f.raceTime=150;
      const rivals=f.racers.filter(r=>!r.isPlayer);
      rivals.forEach((r,k)=>{r.pit=null;r.pitReq=false;r.finish=null;r.dnf=false;r.laps=f.laps;r.lapStart=100;r.car.placeAt(t,t.N-35-k*4);r.car.v=28});
      f.me.laps=f.laps;f.me.lapStart=100;g.car.placeAt(t,t.N-2);g.car.v=45;
      const before=rivals.map(r=>({name:r.name,finish:r.finish,s:r.car.pos.s}));
      let steps=0;while(g.state==='race'&&steps++<120)g.step(1/120);
      return {state:g.state,steps,before,playerFinish:f.me.finish,money:JSON.parse(localStorage.getItem('taipei-gp-v2')).taxi.money};
    })()`);
    assert.equal(prepared.state, 'settling'); assert.ok(prepared.playerFinish > 150); assert.ok(prepared.before.every((r) => r.finish === null));
    await until('__gp.state === "podium"', 120000);
    const result = await ev(`(() => {const f=__gp.field,s=JSON.parse(localStorage.getItem('taipei-gp-v2'));return {state:__gp.state,settlement:window.__gpTestSettlement,completed:f.racers.map(r=>({name:r.name,finish:r.finish,dnf:r.dnf})),money:s.taxi.money,ledger:s.ledger,stats:s.stats,podiumNames:document.querySelector('#podium-names').textContent,replayLength:f.replayLength}})()`);
    assert.equal(result.settlement.calls, 1); assert.equal(result.settlement.done, true);
    assert.ok(result.completed.every((r) => r.finish !== null || r.dnf)); assert.ok(result.completed.filter((r) => r.finish !== null).length >= 2);
    assert.equal(result.money, 2500); assert.equal(result.ledger.filter((r) => r.reason === '正賽第 1 名').length, 1); assert.equal(result.stats.gpWins, 1);
    assert.ok(result.replayLength > .6); assert.match(result.podiumNames, /你/);
    return { prepared, ...result };
  });
  await check('頒獎跳至結果；真回放幀還原乾地／濕地胎與停站，不改最終物理', async () => {
    await ev(`document.querySelector('#podium-skip').click();window.__gpTestFinal=JSON.stringify(__gp.field.snapshot());window.__gpTestFinalMoney=JSON.parse(localStorage.getItem('taipei-gp-v2')).taxi.money;document.querySelector('#btn-replay').click()`);
    assert.equal(await ev('__gp.state'), 'replay');
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await delay(120);
      samples.push(await ev(`(() => {window.__gpTestFrame(performance.now());const f=__gp.field;return {state:__gp.state,time:document.querySelector('#replay-time').textContent,rain:__gp.weather.rainLevel,tyre:f.playerModel.root.userData.tyre,wheelScale:f.playerModel.spin.map(w=>w.scale.x),unchanged:JSON.stringify(f.snapshot())===window.__gpTestFinal}})()`));
    }
    assert.ok(samples.every((s) => s.state === 'replay' && s.unchanged));
    assert.ok(samples.some((s) => s.rain < .1)); assert.ok(samples.some((s) => s.rain > .7));
    assert.ok(new Set(samples.map((s) => s.tyre)).size >= 2); assert.ok(samples.some((s) => s.wheelScale.some((v) => v < 1)));
    const result = await ev(`(() => {document.querySelector('#replay-end').click();const f=__gp.field,s=JSON.parse(localStorage.getItem('taipei-gp-v2'));return {state:__gp.state,money:s.taxi.money,ledger:s.ledger,unchanged:JSON.stringify(f.snapshot())===window.__gpTestFinal,wheelScale:f.playerModel.spin.map(w=>w.scale.x),rows:document.querySelectorAll('#res-table tr').length}})()`);
    assert.equal(result.state, 'results'); assert.equal(result.money, 2500); assert.equal(result.ledger.filter((r) => r.reason === '正賽第 1 名').length, 1);
    assert.equal(result.unchanged, true); assert.ok(result.wheelScale.every((v) => v === 1)); assert.equal(result.rows, 23);
    return { samples, ...result };
  });
  assert.equal(report.exceptions.length, 0); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error.stack); }
finally { ws.close(); await writeFile(path.join(project, 'tools/dev-tests/gp-human-browser-result.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ build: report.build, ok: report.ok, cases: report.cases.length, exceptions: report.exceptions.length }));
if (!report.ok) process.exitCode = 1;
