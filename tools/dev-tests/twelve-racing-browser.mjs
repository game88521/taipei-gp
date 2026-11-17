// 主代理循序執行：只測本機 dist，獨立 context；不連外、不修改產品、不自行 build。
// node tools/dev-tests/twelve-racing-browser.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection, click as realClick } from './multiplayer-ui-cdp.mjs';

const script = fileURLToPath(import.meta.url), here = path.dirname(script), project = path.resolve(here, '../..');
const port = Number(process.env.GP_TWELVE_RACING_PORT ?? 4346), origin = `http://127.0.0.1:${port}`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = new Date().toISOString().replaceAll(/[^0-9]/g, '');
const evidence = path.join(here, `twelve-racing-browser-evidence-${stamp}`);
const report = { startedAt: new Date().toISOString(), status: 'FAIL', cases: [], exceptions: [], externalRequests: [], sourceHashes: {}, cleanup: [], screenshots: [], localOnly: true };
let web, browser, page, context;
const evaluate = code => page.evaluate(code);
const click = id => realClick(page, id);
const sourceFiles = ['src/main.ts', 'src/style.css', 'index.html', 'src/season.ts', 'src/save.ts', 'src/rivals.ts', 'src/racing-replay.ts', 'src/strategy.ts', 'src/bounded-recording.ts', 'src/tt-practice.ts', 'src/practice-entry.ts', 'src/pit-calibration.ts'];
async function check(name, run) {
  try { report.cases.push({ name, status: 'PASS', details: await run() }); }
  catch (error) {
    let diagnostics;
    try { if (page) diagnostics = await evaluate(`({state:window.__gp?.state,title:document.title,strategy:document.getElementById('strategy-detail')?.textContent,strategyOpen:document.getElementById('gp-strategy')?.open,raceTime:window.__gp?.field.raceTime,pits:window.__gp?.field.me.pits,pit:window.__gp?.field.me.pit?.ph,frameSource:window.__twelveRacingFrame?.toString(),calibration:localStorage.getItem('taipei-gp-pit-calibration-v1')})`); } catch {}
    report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error), diagnostics }); throw error;
  }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
async function ready() {
  await page.until(`!!window.__gp && !!document.getElementById('tt-practice') && !document.getElementById('btn-start').disabled`, 180000);
  await evaluate(`__gp.renderer.setPixelRatio(.15); __gp.renderer.setSize(160,90,false); window.__twelveRacingManual=true; cancelAnimationFrame(window.__twelveRacingRafId)`);
  assert.equal(await evaluate(`typeof window.__twelveRacingFrame==='function'&&window.__twelveRacingFrame.toString().includes('requestAnimationFrame')`), true, '必須保存Three真正持續排程的render loop，不能拿通知的單次rAF替代');
}
async function navigate(query) {
  const previous = await evaluate('window.__twelveRacingToken');
  await page.send('Page.navigate', { url: `${origin}/?${query}` });
  await page.until(`!!window.__twelveRacingToken && window.__twelveRacingToken !== ${JSON.stringify(previous)}`, 60000);
  await ready();
}
async function refreshUi() { await evaluate(`for(let i=0;i<12;i++) window.__twelveRacingFrame(performance.now())`); }
const officialSnapshot = `JSON.stringify({best:__gp.save.best,sectors:__gp.save.sectors,ghost:__gp.save.ghost,records:__gp.save.records,stats:__gp.save.stats,ach:__gp.save.ach})`;
async function finishPractice() {
  for (let i = 0; i < 60; i++) {
    const state = await evaluate(`(()=>{let steps=0;for(;steps<500&&__gp.state==='race';steps++)__gp.step(1/120);return{state:__gp.state,steps,status:document.getElementById('practice-status').textContent,complete:document.getElementById('practice-hud').dataset.complete}})()`);
    if (state.complete === 'true') return state;
    assert.equal(state.state, 'race', JSON.stringify(state));
  }
  throw new Error('250 秒真 BOT 步進內尚未完成所選練習區段');
}
async function practiceLayout(width, height, stage) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  const layout = await evaluate(`(()=>{
    const panel=document.getElementById('practice-hud'),rect=panel.getBoundingClientRect();
    const controls=[...panel.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return{id:e.id,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===e}});
    return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,panel:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},controls,status:document.getElementById('practice-status').textContent};
  })()`);
  assert.ok(layout.documentWidth <= width + 1, JSON.stringify(layout));
  assert.ok(layout.panel.left >= -1 && layout.panel.right <= width + 1 && layout.panel.top >= -1 && layout.panel.bottom <= height + 1, JSON.stringify(layout));
  assert.equal(layout.controls.length, 2);
  for (const c of layout.controls) assert.ok(c.width >= 44 && c.height >= 44 && c.left >= -1 && c.right <= width + 1 && c.top >= -1 && c.bottom <= height + 1 && c.reachable, JSON.stringify(c));
  const screenshot = `${stage}-${width}x${height}.png`, shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, screenshot), Buffer.from(shot.data, 'base64')); report.screenshots.push(screenshot);
  return layout;
}
try {
  await mkdir(evidence, { recursive: true });
  const sw = await readFile(path.join(project, 'dist/sw.js'));
  report.swSha256 = digest(sw); report.build = sw.toString('utf8').match(/const VERSION = '([^']+)'/)?.[1];
  assert.ok(report.build, 'dist/sw.js 必須含建置版本');
  report.scriptSha256 = digest(await readFile(script));
  for (const file of sourceFiles) report.sourceHashes[file] = digest(await readFile(path.join(project, file)));
  web = await preview({ root: project, preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  const cdp = process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334, version = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  context = (await browser.send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
  page = new CdpConnection(targets.find(t => t.id === targetId).webSocketDebuggerUrl, 'twelve-racing', report);
  page.on('Runtime.exceptionThrown', e => report.exceptions.push(e.exceptionDetails));
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: false }));
  page.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url), allowed = url.origin === origin || ['about:', 'data:', 'blob:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(request.url);
    await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) });
  });
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker', { bypass: true });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const seed = { schema: 3, best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, quali: false }, taxi: { money: 1000, trips: 0 }, quality: 'low', touch: 'off', tutDone: true };
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
    if(location.origin!==${JSON.stringify(origin)})return;
    if(!sessionStorage.getItem('twelve-racing-seed')){localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('twelve-racing-seed','1')}
    window.__twelveRacingToken=crypto.randomUUID();window.__twelveRacingManual=false;
    // Three WebGLAnimation callback會自己排下一個requestAnimationFrame；通知排版與城市讓步的單次callback不會。
    // 只攔真正render loop，保留其他UI callback，避免MutationObserver把保存的frame覆成通知update。
    const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{
      if(cb.toString().includes('requestAnimationFrame')){window.__twelveRacingFrame=cb;if(window.__twelveRacingManual)return 0;return window.__twelveRacingRafId=raf(cb)}
      return raf(cb);
    };
  })()` });
  await navigate('bot&sim=120&q=low&notraffic');
  await check('真TT完整圈後可從紀錄進入區段練習，錯誤目標被拒絕', async () => {
    assert.ok((await evaluate('__gp.sessionLaps.summary().validCount')) >= 1);
    await click('btn-pause');
    await evaluate(`document.querySelector('.m-tabs [data-tab="records"]').click();document.getElementById('tt-practice').open=true;document.getElementById('practice-time').value='-1';document.getElementById('practice-start').click()`);
    const actual = await evaluate(`({state:__gp.state,best:__gp.save.best,options:[...document.getElementById('practice-segment').options].map(o=>o.value),text:document.getElementById('practice-validation').textContent,hidden:document.getElementById('practice-hud').hidden})`);
    assert.equal(actual.state, 'paused'); assert.ok(actual.best > 20); assert.ok(actual.options.includes('s1')); assert.ok(actual.options.some(o => o.startsWith('bend'))); assert.ok(actual.text.includes('請輸入正數')); assert.equal(actual.hidden, true);
    return actual;
  });
  await check('待啟動練習立即切換選單會取消，不會在await後誤開賽', async () => {
    await evaluate(`document.getElementById('practice-time').value='90';document.getElementById('practice-start').click();document.querySelector('.m-tabs [data-tab="play"]').click()`);
    // 讓 userStart() 的真正 promise 繼續，再觀察遊戲狀態。
    const actual = await evaluate(`({state:__gp.state,hidden:document.getElementById('practice-hud').hidden,menuVisible:!document.getElementById('menu').classList.contains('hidden')})`);
    assert.equal(actual.state, 'paused'); assert.equal(actual.hidden, true); assert.equal(actual.menuVisible, true);
    return actual;
  });
  let practiceOfficial;
  await check('真正UI啟動S1飛行練習，獨立場次不提交正式紀錄', async () => {
    await evaluate(`document.querySelector('.m-tabs [data-tab="records"]').click();document.getElementById('tt-practice').open=true;document.getElementById('practice-segment').value='s1';document.getElementById('practice-time').value='90';document.getElementById('practice-exit').value='1';document.getElementById('practice-flying').checked=true`);
    practiceOfficial = await evaluate(officialSnapshot);
    await click('practice-start'); await page.until(`__gp.state==='race'&&!document.getElementById('practice-hud').hidden`);
    const actual = await evaluate(`({state:__gp.state,speed:__gp.car.v*3.6,text:document.getElementById('practice-status').textContent,summary:__gp.sessionLaps.summary(),official:${officialSnapshot}})`);
    assert.ok(actual.speed > 0 && actual.speed <= 200 + 1e-6); assert.ok(actual.text.includes('獨立練習')); assert.equal(actual.official, practiceOfficial); assert.equal(actual.summary.count ?? actual.summary.total ?? actual.summary.validCount, 0);
    return { ...actual, official: '與開賽前PB／分段／ghost／成就完全一致；開新練習場次會清本場圈表' };
  });
  await check('S1真BOT物理跑完自動暫停，顯示出彎／目標且不寫正式PB或圈表', async () => {
    const result = await finishPractice();
    assert.equal(result.state, 'paused'); assert.ok(result.status.includes('完成')); assert.ok(result.status.includes('出彎')); assert.ok(result.status.includes('時間目標')); assert.ok(result.status.includes('速度目標'));
    assert.equal(await evaluate(officialSnapshot), practiceOfficial);
    assert.equal(await evaluate('__gp.sessionLaps.summary().validCount'), 0);
    return result;
  });
  await check('練習結果在直式與矮橫式畫面兩個44px操作按鈕可點', async () => {
    const layouts = [];
    for (const [w, h] of [[390, 844], [844, 390], [844, 220]]) layouts.push(await practiceLayout(w, h, 'practice-result'));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    return { layouts };
  });
  await check('真點重練後重置車輛，無效試次不達標，結束回選單', async () => {
    await click('practice-retry'); assert.equal(await evaluate('__gp.state'), 'race');
    await click('btn-reset');
    const result = await finishPractice();
    assert.ok(result.status.includes('無效練習')); assert.ok(result.status.includes('未達'));
    assert.equal(await evaluate(officialSnapshot), practiceOfficial);
    await click('practice-exit-button');
    const actual = await evaluate(`({state:__gp.state,hidden:document.getElementById('practice-hud').hidden,menuVisible:!document.getElementById('menu').classList.contains('hidden')})`);
    assert.equal(actual.state, 'menu'); assert.equal(actual.hidden, true); assert.equal(actual.menuVisible, true);
    return { result, ...actual };
  });
  await check('同分fixture的真賽季榜單與公開決勝規則一致，舊已結算規則仍明示', async () => {
    const result = await evaluate(`(()=>{
      const original=__gp.save.season;try{
        __gp.save.season={tieBreak:'recent-finish-v1',round:3,calendar:['australia','china','japan'],paid:true,no:1,laps:3,rules:'classic',diff:'normal',results:[{id:'australia',order:['你','陳冠宇']},{id:'china',order:['陳冠宇','你']},{id:'japan',order:['陳冠宇','你'],dnf:['陳冠宇','你']}]};
        document.getElementById('btn-season-table').click();
        const current={title:document.getElementById('season-title').textContent,rule:document.querySelector('.season-countback').textContent,rows:document.getElementById('season-drivers').textContent};
        delete __gp.save.season.tieBreak;document.getElementById('btn-season-table').click();
        const legacy={title:document.getElementById('season-title').textContent,rule:document.querySelector('.season-countback').textContent};
        document.getElementById('season-close').click();return{current,legacy};
      }finally{__gp.save.season=original}
    })()`);
    assert.ok(result.current.title.includes('陳冠宇')); assert.ok(result.current.rule.includes('最後一站')); assert.ok(result.current.rule.includes('獎金與成就'));
    assert.ok(result.legacy.title.includes('你')); assert.ok(result.legacy.rule.includes('不追溯'));
    return result;
  });
  await navigate('bot&gp&pittest&sim=20&q=low&notraffic');
  await check('真GP策略初始樣本不足，不會提前聲稱已校準', async () => {
    assert.equal(await evaluate('__gp.state'), 'race');
    await evaluate(`document.getElementById('gp-strategy').open=true`); await refreshUi();
    const actual = await evaluate(`({time:__gp.field.raceTime,pits:__gp.field.me.pits,text:document.getElementById('strategy-detail').textContent})`);
    assert.ok(actual.text.includes('0 筆有效進站觀測'), JSON.stringify(actual)); assert.ok(actual.text.includes('樣本不足 3 筆'), JSON.stringify(actual));
    return actual;
  });
  await check('真GP完整玩家進出站在未開策略面板時仍收集，UI與持久化含真觀測值', async () => {
    await evaluate(`document.getElementById('gp-strategy').open=false`);
    let actual;
    for (let i = 0; i < 70; i++) {
      actual = await evaluate(`(()=>{for(let j=0;j<500&&__gp.state==='race'&&!(__gp.field.me.pits>=1&&!__gp.field.me.pit);j++)__gp.step(1/120);return{state:__gp.state,pits:__gp.field.me.pits,pit:__gp.field.me.pit?.ph??null,time:__gp.field.raceTime,buckets:JSON.parse(localStorage.getItem('taipei-gp-pit-calibration-v1')??'[]')}})()`);
      if (actual.pits >= 1 && !actual.pit) break;
      assert.equal(actual.state, 'race', JSON.stringify(actual));
    }
    assert.ok(actual.pits >= 1 && !actual.pit, JSON.stringify(actual));
    const samples = actual.buckets.flatMap(b => b.samples);
    assert.equal(samples.length, 1, JSON.stringify(actual));
    const sample = samples[0]; assert.ok(sample.elapsed > 1 && sample.elapsed < 600); assert.ok(sample.baseline > 0); assert.ok(Math.abs(sample.observed - (sample.elapsed - sample.baseline)) < 1e-8);
    await evaluate(`document.getElementById('gp-strategy').open=true`); await refreshUi();
    const text = await evaluate(`document.getElementById('strategy-detail').textContent`);
    assert.ok(text.includes('1 筆有效進站觀測')); assert.ok(text.includes('樣本不足 3 筆')); assert.ok(text.includes('最近觀測')); assert.ok(text.includes('不是真實反事實') || text.includes('不是真') || text.includes('不是未進站的真實反事實'));
    return { ...actual, text };
  });
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []);
  report.status = 'PASS';
} catch (error) { report.error = error.stack ?? String(error); console.error(report.error); process.exitCode = 1; }
finally {
  for (const [file, expected] of Object.entries(report.sourceHashes)) {
    try { assert.equal(digest(await readFile(path.join(project, file))), expected); }
    catch (error) { (report.sourcesChangedDuringTest ??= []).push(file); report.status = 'FAIL'; process.exitCode = 1; }
  }
  if (report.swSha256 && digest(await readFile(path.join(project, 'dist/sw.js'))) !== report.swSha256) { report.buildChangedDuringTest = true; report.status = 'FAIL'; process.exitCode = 1; }
  page?.close();
  if (browser && context) {
    try { await browser.send('Target.disposeBrowserContext', { browserContextId: context }); report.cleanup.push({ name: 'isolated_browser_context', status: 'PASS' }); }
    catch (error) { report.cleanup.push({ name: 'isolated_browser_context', status: 'FAIL', error: String(error) }); report.status = 'FAIL'; process.exitCode = 1; }
  }
  browser?.close();
  if (web) { await new Promise(resolve => web.httpServer.close(resolve)); report.cleanup.push({ name: 'local_preview', status: 'PASS' }); }
  report.completedAt = new Date().toISOString();
  report.summary = { PASS: report.cases.filter(c => c.status === 'PASS').length, FAIL: report.cases.filter(c => c.status === 'FAIL').length };
  report.limitations = ['本機隔離Chrome，真BOT物理操作；非手機實機、真人手控或外網證據。', '同分UI使用記憶體fixture；完整決勝／獎金／成就一致性另由Node真函式驗證。', '新練習場次沿用開賽清空本場圈表；不寫入正式PB／最佳分段／ghost／排行榜／成就。', '校準只驗真進出站觀測與最少樣本門檻，沒有證明反事實損失或策略估值更準。', '畫面只驗按鈕可達、溢位與截圖；未量測FPS／耗電／教學效果。'];
  const payload = JSON.stringify(report, null, 2) + '\n';
  await writeFile(path.join(here, `twelve-racing-browser-${stamp}.json`), payload);
  await writeFile(path.join(here, 'twelve-racing-browser-result.json'), payload);
  console.log(JSON.stringify({ status: report.status, ...report.summary, build: report.build, evidence: path.relative(project, evidence) }));
}
