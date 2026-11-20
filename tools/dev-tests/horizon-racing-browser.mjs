// Root schedules this against local dist and its existing CDP; no build or Chrome launch.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection, click as realClick, focus } from './multiplayer-ui-cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(here, '../..');
const port = Number(process.env.GP_HORIZON_RACING_PORT ?? 4396), origin = `http://127.0.0.1:${port}`;
const evidence = path.join(here, `horizon-racing-browser-evidence-${new Date().toISOString().replace(/\D/g, '')}`);
const report = { status: 'FAIL', cases: [], exceptions: [], externalRequests: [], cleanup: { contextDisposed: false, previewClosed: false, connectionsClosed: false, errors: [] }, screenshots: [], evidence: path.relative(project, evidence).replaceAll('\\', '/'), localOnly: true, sourceHashes: {} };
const hash = value => createHash('sha256').update(value).digest('hex');
let web, browser, page, context;
const evaluate = expression => page.evaluate(expression), click = id => realClick(page, id);
const protectedSave = `JSON.stringify({best:__gp.save.best,sectors:__gp.save.sectors,ghost:__gp.save.ghost,gpBest:__gp.save.gpBest,records:__gp.save.records,season:__gp.save.season,taxi:__gp.save.taxi,ledger:__gp.save.ledger,stats:__gp.save.stats,ach:__gp.save.ach})`;
const assertProtectedEqual = (actual, expected) => assert.deepEqual(JSON.parse(actual), JSON.parse(expected));
async function check(name, run) { try { const details = await run(); report.cases.push({ name, status: 'PASS', details }); } catch (error) { let diagnostics; try { diagnostics = await evaluate(`({state:__gp.state,stage:__gp.save.horizonRacing?.weekend?.stage,session:__gp.horizonSession,practice:__gp.practiceRun?.status,message:document.getElementById('horizon-weekend-status')?.textContent})`); } catch {} report.cases.push({ name, status: 'FAIL', error: error.stack, diagnostics }); throw error; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
async function select(id, value) { await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function clickSelector(selector) { const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return{x,y,reachable:!!h&&(h===e||e.contains(h))};})()`); assert.equal(p.reachable, true, selector); for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); }
async function freeze() { await evaluate(`window.__horizonManual=true;cancelAnimationFrame(window.__horizonRaf);__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);`); }
async function navigate(query = 'bot&sim=120&q=low&notraffic') { const prior = await evaluate('window.__horizonToken??null'); await page.send('Page.navigate', { url: `${origin}/?${query}` }); await page.until(`!!window.__horizonToken&&window.__horizonToken!==${JSON.stringify(prior)}&&!!window.__gp&&!document.getElementById('btn-start').disabled`, 180000); await freeze(); }
async function lightsOut() { if (await evaluate(`__gp.state==='countdown'`)) { await evaluate(`window.__horizonManual=false;requestAnimationFrame(window.__horizonLoop)`); await page.until(`__gp.state==='race'`, 180000); await freeze(); } }
async function driveTo(stage) { for (let batch = 0; batch < 90; batch++) { const result = await evaluate(`(()=>{for(let i=0;i<1200&&__gp.state==='race';i++)__gp.step(1/120);return{state:__gp.state,stage:__gp.save.horizonRacing?.weekend?.stage};})()`); if (result.state !== 'race') break; } await page.until(`__gp.save.horizonRacing?.weekend?.stage===${JSON.stringify(stage)}&&__gp.horizonSession===null`, 240000); }
async function shot(name) { const png = await page.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(evidence, name), Buffer.from(png.data, 'base64')); report.screenshots.push(name); }
async function menuPlay() { if (await evaluate(`__gp.state==='race'||__gp.state==='countdown'`)) await click('btn-pause'); await clickSelector('.m-tabs [data-tab="play"]'); }
try {
  await mkdir(evidence, { recursive: true }); report.scriptSha256 = hash(await readFile(new URL(import.meta.url)));
  const sw = await readFile(path.join(project, 'dist/sw.js')); report.build = sw.toString().match(/const VERSION = '([^']+)'/)?.[1]; assert.ok(report.build); report.swSha256 = hash(sw);
  for (const file of ['src/main.ts', 'src/save.ts', 'src/rivals.ts', 'src/tt-practice.ts', 'src/horizon-racing.ts', 'src/horizon-racing-ui.ts', 'src/horizon-racing.css', 'index.html']) report.sourceHashes[file] = hash(await readFile(path.join(project, file)));
  web = await preview({ root: project, preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  const cdp = process.env.GP_CDP_PORT ?? process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334, version = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'horizon-racing-browser', report); context = (await browser.send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context }), targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
  page = new CdpConnection(targets.find(t => t.id === targetId).webSocketDebuggerUrl, 'horizon-racing', report);
  page.on('Runtime.exceptionThrown', event => report.exceptions.push(event.exceptionDetails));
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true }));
  page.on('Fetch.requestPaused', async ({ requestId, request }) => { const url = new URL(request.url), allowed = url.origin === origin || ['about:', 'data:', 'blob:'].includes(url.protocol); if (!allowed) report.externalRequests.push(request.url); await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }); });
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable'); await page.send('Network.setBypassServiceWorker', { bypass: true }); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const seed = { schema: 3, best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, quali: false, 'opt-gpwx': 'dry' }, taxi: { money: 12345, trips: 0 }, quality: 'low', touch: 'off', tutDone: true };
  // Three's WebGLAnimation scheduler takes (time, frame); the independent
  // driving-school RAF takes only time. Capturing every self-scheduling RAF
  // would replace the real renderer loop with the unrelated school loop.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{if(location.origin!==${JSON.stringify(origin)})return;if(!sessionStorage.getItem('horizon-racing-seed')){localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('horizon-racing-seed','1');}window.__horizonToken=crypto.randomUUID();window.__horizonManual=false;const native=requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>{if(callback.length===2&&callback.toString().includes('requestAnimationFrame')){if(window.__horizonLoop&&window.__horizonLoop!==callback)throw Error('Unexpected additional WebGL animation scheduler');window.__horizonLoop=callback;if(window.__horizonManual)return 0;return window.__horizonRaf=native(callback);}return native(callback);};})()` });
  await navigate(); await page.until('__gp.save.best!==null', 180000);
  await check('真UI獨立練習3/5秒倒帶恢復車況/時間/無效標記，正式紀錄不變', async () => {
    const original = await evaluate(protectedSave); await click('btn-pause'); await clickSelector('.m-tabs [data-tab="records"]'); await clickSelector('#tt-practice summary'); await select('practice-segment', 'lap'); await click('practice-start'); await page.until('__gp.practiceRun.active&&__gp.state==="race"');
    await evaluate('for(let i=0;i<960;i++)__gp.step(1/120)'); const before = await evaluate('__gp.practiceRun.snapshot().elapsed'); await click('practice-rewind-5'); assert.ok(await evaluate(`Math.abs(__gp.practiceRun.snapshot().elapsed-(${before}-5))<.11`));
    await evaluate('for(let i=0;i<480;i++)__gp.step(1/120)'); await click('btn-reset'); await evaluate('for(let i=0;i<60;i++)__gp.step(1/120)'); assert.equal(await evaluate('__gp.lapValid'), false); await click('practice-rewind-3'); assert.equal(await evaluate('__gp.lapValid'), true); assert.equal(await evaluate('__gp.practiceRun.snapshot().valid'), true);
    assertProtectedEqual(await evaluate(protectedSave), original); await shot('practice-rewind.png'); return { protectedUnchanged: true, bufferedSeconds: await evaluate('__gp.practiceRewind.duration') };
  });
  await check('真UI自訂鍵位保護、Alt快捷鍵、暫停/重試/退出清倒帶', async () => {
    await focus(page); await evaluate('document.activeElement.blur()');
    await evaluate('for(let i=0;i<480;i++)__gp.step(1/120)'); await evaluate('window.__savedHorizonControls=__gp.input.getControls();const p=__gp.input.getControls();p.keys.left=["KeyZ"];__gp.input.setControls(p)');
    const elapsed = await evaluate('__gp.practiceRun.snapshot().elapsed'); await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyZ', key: 'z', modifiers: 1 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyZ', key: 'z', modifiers: 1 }); assert.equal(await evaluate('__gp.practiceRun.snapshot().elapsed'), elapsed);
    await evaluate('__gp.input.setControls(window.__savedHorizonControls)'); await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyZ', key: 'z', modifiers: 1 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyZ', key: 'z', modifiers: 1 }); assert.ok(await evaluate(`__gp.practiceRun.snapshot().elapsed<${elapsed}-2.9`));
    await click('btn-pause'); assert.equal(await evaluate('__gp.practiceRewind.size'), 0); await clickSelector('.m-tabs [data-tab="play"]'); await click('btn-resume'); await evaluate('for(let i=0;i<420;i++)__gp.step(1/120)'); await click('practice-retry'); assert.equal(await evaluate('__gp.practiceRewind.size'), 1); await click('practice-exit-button'); assert.equal(await evaluate('__gp.practiceRewind.size'), 0); assert.equal(await evaluate('__gp.practiceRun.active'), false);
  });
  let protectedBefore, qualifyingGrid;
  await check('真UI建立週末並跑玩家/21AI排位，兩場格序與獨立儲存明確', async () => {
    await menuPlay(); protectedBefore = await evaluate(protectedSave); await click('btn-horizon-weekend'); await select('horizon-weekend-sprint-laps', 1); await select('horizon-weekend-race-laps', 3); await click('horizon-weekend-create'); await page.until('__gp.horizonSession==="qualifying"'); await lightsOut(); await driveTo('sprint');
    qualifyingGrid = await evaluate('__gp.save.horizonRacing.weekend.qualifying.map(r=>r.name)'); assert.equal(qualifyingGrid.length, 22); assert.equal(await evaluate('__gp.save.horizonRacing.weekend.sprint'), undefined); assertProtectedEqual(await evaluate(protectedSave), protectedBefore); await shot('weekend-qualifying.png'); return { playerTime: await evaluate('__gp.save.horizonRacing.weekend.qualifying.find(r=>r.name==="你").time'), drivers: 22 };
  });
  await check('真UI衝刺→正賽，圈中無效checkpoint重載精確恢復，完賽積分/歷史不重加', async () => {
    await click('horizon-weekend-continue'); await page.until('__gp.horizonSession==="sprint"'); await lightsOut(); await driveTo('race'); assert.ok(await evaluate('__gp.save.horizonRacing.weekend.sprint.some(r=>r.finish>20)')); assertProtectedEqual(await evaluate(protectedSave), protectedBefore);
    await click('horizon-weekend-continue'); await page.until('__gp.horizonSession==="race"'); await lightsOut(); await evaluate('for(let i=0;i<1200;i++)__gp.step(1/120)'); await click('btn-reset'); await click('btn-pause');
    const cp = await evaluate('JSON.stringify(__gp.save.horizonRacing.weekend.checkpoint)'), points = await evaluate('JSON.stringify(__gp.save.horizonRacing.weekend.sprint)'); assert.equal(JSON.parse(cp).player.lapValid, false);
    await navigate('bot&sim=0&q=low&notraffic&horizon-weekend=1'); assert.deepEqual(await evaluate('__gp.save.horizonRacing.weekend.checkpoint'), JSON.parse(cp)); assert.deepEqual(await evaluate('__gp.save.horizonRacing.weekend.sprint'), JSON.parse(points));
    await click('horizon-weekend-continue'); await page.until('__gp.horizonSession==="race"&&__gp.state==="race"'); assert.equal(await evaluate('__gp.lapValid'), false); assert.deepEqual(await evaluate('__gp.field.snapshot()'), JSON.parse(cp).race); await driveTo('complete');
    assert.equal(await evaluate('__gp.save.horizonRacing.history.length'), 1); assert.equal(await evaluate('document.getElementById("horizon-weekend-continue").hidden'), true); const final = await evaluate('JSON.stringify(__gp.save.horizonRacing)'); await evaluate('document.getElementById("horizon-weekend-continue").click()'); assert.equal(await evaluate('JSON.stringify(__gp.save.horizonRacing)'), final); assertProtectedEqual(await evaluate(protectedSave), protectedBefore); await shot('weekend-complete.png'); return { grid: qualifyingGrid, history: 1, checkpointElapsed: JSON.parse(cp).race.raceTime, reloadWithoutFormalTtSimulation: true };
  });
  await check('週末退出→普通TT及GP重讀原規則/AI/難度/圈數/天氣，不殘留週末設定', async () => {
    await click('horizon-weekend-close'); await navigate('q=low&notraffic'); await clickSelector('.m-tabs [data-tab="settings"]'); for (const [id, value] of [['opt-rules', '2026'], ['opt-ai-policy', 'legacy'], ['opt-diff', 'hard'], ['opt-laps', '6'], ['opt-gpwx', 'wet']]) await select(id, value);
    await menuPlay(); await click('btn-gp'); await clickSelector('.cp-go'); await page.until('__gp.state==="countdown"'); await click('btn-pause'); const prior = await evaluate('__gp.field.snapshot()');
    await clickSelector('.m-tabs [data-tab="play"]'); await click('btn-horizon-weekend'); await select('horizon-weekend-difficulty', 'easy'); await select('horizon-weekend-rules', 'classic'); await select('horizon-weekend-weather', 'dry'); await click('horizon-weekend-create'); await page.until('__gp.horizonSession==="qualifying"'); await click('btn-pause'); await clickSelector('.m-tabs [data-tab="play"]'); await click('btn-horizon-weekend'); await click('horizon-weekend-close'); assert.deepEqual(await evaluate('__gp.field.snapshot()'), prior);
    await click('btn-start'); await clickSelector('.cp-go'); await page.until('__gp.state==="countdown"'); assert.deepEqual(await evaluate('({rules:__gp.field.rules,ai:__gp.field.aiPolicy,difficulty:__gp.field.difficulty,tt:__gp.field.ttMode})'), { rules: '2026', ai: 'legacy', difficulty: 'hard', tt: true });
    await click('btn-pause'); await clickSelector('.m-tabs [data-tab="play"]'); await click('btn-gp'); await clickSelector('.cp-go'); await page.until('__gp.state==="countdown"'); assert.deepEqual(await evaluate('({rules:__gp.field.rules,ai:__gp.field.aiPolicy,difficulty:__gp.field.difficulty,laps:__gp.field.laps,wet:__gp.field.wet,form:__gp.field.form,tt:__gp.field.ttMode})'), { rules: '2026', ai: 'legacy', difficulty: 'hard', laps: 6, wet: 1, form: {}, tt: false });
  });
  await check('await userStart期間失去存檔所有權，晚到繼續不得啟動週末', async () => {
    await click('btn-pause'); await clickSelector('.m-tabs [data-tab="play"]'); await click('btn-horizon-weekend'); await evaluate(`document.getElementById('horizon-weekend-continue').click();const p=JSON.parse(localStorage.getItem('taipei-gp-v2'));p.name='另一頁';localStorage.setItem('taipei-gp-v2',JSON.stringify(p));dispatchEvent(new StorageEvent('storage',{key:'taipei-gp-v2'}));`); await evaluate('new Promise(resolve=>setTimeout(resolve,0))'); assert.equal(await evaluate('__gp.horizonSession'), null); return { lateStartPrevented: true };
  });
  assert.equal(report.exceptions.length, 0, JSON.stringify(report.exceptions)); assert.equal(report.externalRequests.length, 0, JSON.stringify(report.externalRequests)); report.status = 'PASS';
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  for (const [file, digest] of Object.entries(report.sourceHashes)) if (hash(await readFile(path.join(project, file))) !== digest) { report.status = 'FAIL'; process.exitCode = 1; (report.sourcesChangedDuringTest ??= []).push(file); }
  if (report.swSha256 && hash(await readFile(path.join(project, 'dist/sw.js'))) !== report.swSha256) { report.status = 'FAIL'; process.exitCode = 1; report.buildChangedDuringTest = true; }
  page?.close(); if (browser && context) { try { await browser.send('Target.disposeBrowserContext', { browserContextId: context }); report.cleanup.contextDisposed = true; } catch (error) { report.cleanup.errors.push(String(error)); report.status = 'FAIL'; process.exitCode = 1; } } browser?.close(); report.cleanup.connectionsClosed = true; if (web) { await new Promise(resolve => web.httpServer.close(resolve)); report.cleanup.previewClosed = true; }
  report.completedAt = new Date().toISOString(); report.summary = { PASS: report.cases.filter(c => c.status === 'PASS').length, FAIL: report.cases.filter(c => c.status === 'FAIL').length };
  report.limitations = ['僅本機隔離Chrome與真物理/AI；沒有手機實機、真人難度平衡或效能結論。', '固定三BOT基準由root另跑；四人/城市功能不屬此腳本範圍。'];
  const output = JSON.stringify(report, null, 2) + '\n'; await writeFile(path.join(here, 'horizon-racing-browser-result.json'), output); await writeFile(path.join(evidence, 'report.json'), output); console.log(JSON.stringify({ status: report.status, ...report.summary, build: report.build, evidence }));
}
