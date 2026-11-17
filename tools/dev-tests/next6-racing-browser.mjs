// 本機真瀏覽器驗證分段保存與賽季重載；測試安排車位，計圈仍走真 car.update／main.step。
// node tools/dev-tests/next6-racing-browser.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection } from './multiplayer-ui-cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(here, '../..');
const port = 4324, origin = `http://127.0.0.1:${port}`, key = 'taipei-gp-v2';
const report = { startedAt: new Date().toISOString(), project, origin, localOnly: true,
  expectedBuild: process.env.NEXT6_EXPECT_BUILD ?? '38335611f205', status: 'FAIL', cases: [], exceptions: [], externalRequests: [] };
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let web, browser, page, context, knownCheckpointSave;
async function check(name, action) {
  try { report.cases.push({ name, status: 'PASS', details: await action() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
const click = id => page.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const stored = () => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
const ttRecord = () => page.evaluate(`JSON.parse(JSON.stringify({best:__gp.save.best,sectors:__gp.save.sectors,ghost:__gp.save.ghost}))`);
async function ready() {
  await page.until(`!!window.__gp&&!document.getElementById('btn-start').disabled`, 180000);
  await page.evaluate(`(() => {
    __gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);
    window.__next6RacingManual=true;cancelAnimationFrame(window.__next6RacingFrameId);
    window.__next6RacingNow=performance.now();
    __gp.input.read=()=>({steer:0,brake:true});
  })()`);
}
async function navigate(query) {
  const token = await page.evaluate(`window.__next6RacingToken`);
  await page.send('Page.navigate', { url: `${origin}/?${query}` });
  await page.until(`!!window.__next6RacingToken&&window.__next6RacingToken!==${JSON.stringify(token)}`);
  await ready();
}
async function startLights() {
  await page.until(`__gp.state==='countdown'`, 15000);
  const result = await page.evaluate(`(() => {
    for(let i=0;i<80&&__gp.state==='countdown';i++){
      __next6RacingNow+=100;__next6RacingFrame(__next6RacingNow);
    }
    return{state:__gp.state,quali:__gp.qualiRun};
  })()`);
  assert.equal(result.state, 'race');
}
async function hold(seconds) {
  return page.evaluate(`(() => {
    __gp.input.read=()=>({steer:0,brake:true});
    for(let i=0;i<${Math.round(seconds * 120)}&&__gp.state==='race';i++)__gp.step(1/120);
    return{state:__gp.state,time:__gp.lapTime,valid:__gp.lapValid};
  })()`);
}
async function cross(boundary) {
  const result = await page.evaluate(`(() => {
    const g=__gp,t=g.track,finish=${JSON.stringify(boundary)}==='finish';
    const target=finish?t.length:${JSON.stringify(boundary)}*t.length/3;
    // 從檢查線前一個取樣點實際駛過；不改 local lapTime／sectorIdx，也不替換物理。
    const index=Math.max(0,Math.min(t.N-1,Math.floor(target/t.ds)-1));
    g.car.placeAt(t,index);g.car.v=40;
    g.input.read=()=>({steer:0,brake:false});
    const previous=g.car.pos.s;let steps=0;
    for(;steps<120&&g.state==='race';steps++){
      g.step(1/120);
      if(finish?g.car.pos.s<40:g.car.pos.s>=target)break;
    }
    g.input.read=()=>({steer:0,brake:true});
    return{previous,s:g.car.pos.s,target,finish,steps,state:g.state,valid:g.lapValid,time:g.lapTime};
  })()`);
  assert.ok(result.previous < result.target && result.previous > result.target - 20, JSON.stringify(result));
  assert.ok(result.finish ? result.s < 40 : result.s >= result.target, JSON.stringify(result));
  assert.ok(result.steps < 120, JSON.stringify(result));
  return result;
}
async function reloadSeason() {
  const token = await page.evaluate(`window.__next6RacingToken`);
  await page.send('Page.reload', { ignoreCache: true });
  await page.until(`!!window.__next6RacingToken&&window.__next6RacingToken!==${JSON.stringify(token)}`);
  await ready();
  assert.ok((await stored()).season.pending.checkpoint);
  await click('btn-season'); await page.until(`__gp.state==='race'`, 15000);
  assert.equal(await page.evaluate(`__gp.sessionLaps.summary().count`), 0);
}
try {
  assert.equal(report.build, report.expectedBuild, 'dist 必須是本輪已確認的建置');
  web = await preview({ root: project, logLevel: 'error', preview: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'next6-local-storage-fixture',
    configurePreviewServer(server) {
      server.middlewares.use('/__next6-fixture', (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><title>next6 storage fixture</title>');
      });
    },
  }] });
  const cdpPort = process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334;
  const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  context = (await browser.send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
  const target = targets.find(t => t.id === targetId); assert.ok(target);
  page = new CdpConnection(target.webSocketDebuggerUrl, 'racing', report);
  page.on('Runtime.exceptionThrown', e => report.exceptions.push(e.exceptionDetails));
  page.on('Page.javascriptDialogOpening', async () => page.send('Page.handleJavaScriptDialog', { accept: false }));
  page.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url), allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(request.url);
    await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...allowed ? {} : { errorReason: 'BlockedByClient' } });
  });
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker', { bypass: true });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const seed = { schema: 3, best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, quali: false },
    taxi: { money: 1000, trips: 0 }, tutDone: true, quality: 'low', touch: 'off' };
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    if(location.origin!==${JSON.stringify(origin)})return;
    if(!sessionStorage.getItem('next6-racing')){
      localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(seed))});
      sessionStorage.setItem('next6-racing','1');
    }
    const raf=requestAnimationFrame.bind(window),now=performance.now.bind(performance);
    window.__next6RacingToken=crypto.randomUUID();
    window.__next6RacingManual=false;window.__next6RacingNow=null;
    Object.defineProperty(performance,'now',{value:()=>window.__next6RacingNow??now()});
    window.requestAnimationFrame=cb=>{
      window.__next6RacingFrame=cb;if(window.__next6RacingManual)return 0;
      return window.__next6RacingFrameId=raf(cb);
    };
  })()` });
  await navigate('circuit=australia&q=low&notraffic');
  await click('btn-start'); await page.evaluate(`document.querySelector('.cp-go:not(:disabled)').click()`);
  await startLights();
  await check('reset_invalid_lap_does_not_commit_earlier_sector', async () => {
    await page.evaluate(`__gp.save.best=150;__gp.save.sectors=[50,50,50];__gp.save.ghost=null`);
    const storedBefore = await stored(), baseline = await ttRecord();
    const s1 = await cross(1);
    assert.deepEqual((await ttRecord()).sectors, [50, 50, 50]);
    await click('btn-reset'); assert.equal(await page.evaluate(`__gp.lapValid`), false);
    const s2 = await cross(2), finish = await cross('finish');
    assert.deepEqual(await ttRecord(), baseline); assert.deepEqual(await stored(), storedBefore);
    const row = await page.evaluate(`__gp.sessionLaps.rows().at(-1)`); assert.equal(row.valid, false);
    return { s1, s2, finish, sectors: baseline.sectors, invalidRow: row };
  });
  await check('valid_tt_lap_commits_three_sectors_only_after_finish', async () => {
    await hold(8); await cross(1); assert.deepEqual((await ttRecord()).sectors, [50, 50, 50]);
    await hold(8); await cross(2); assert.deepEqual((await ttRecord()).sectors, [50, 50, 50]);
    await hold(8); await cross('finish');
    const record = await ttRecord(), row = await page.evaluate(`__gp.sessionLaps.rows().at(-1)`);
    assert.equal(row.valid, true); assert.ok(row.time > 24 && row.time < 27);
    assert.deepEqual(record.sectors, row.sectors); assert.equal(record.best, row.time);
    const disk = await stored(), classified = Object.values(disk.records).find(r => r.best === row.time);
    assert.ok(classified); assert.deepEqual(classified.sectors, row.sectors);
    return { best: record.best, sectors: record.sectors, row, persisted: true };
  });
  await click('btn-pause');
  const seasonNavigationToken = await page.evaluate(`window.__next6RacingToken`);
  await click('btn-season'); await page.evaluate(`document.getElementById('sn-length').value='3';document.getElementById('sn-go').click()`);
  await page.until(`location.search.includes('season=1')&&!!window.__next6RacingToken&&window.__next6RacingToken!==${JSON.stringify(seasonNavigationToken)}`); await ready();
  const ttBaseline = await ttRecord();
  await page.evaluate(`document.getElementById('opt-sc').value='off';document.getElementById('delta').textContent='-999'`);
  await click('btn-season'); await startLights();
  assert.equal(await page.evaluate(`__gp.qualiRun`), true);
  await check('qualifying_never_changes_tt_sectors_pb_or_ghost', async () => {
    assert.equal(await page.evaluate(`document.getElementById('delta').textContent`), '');
    await hold(8); await cross(1); assert.deepEqual(await ttRecord(), ttBaseline);
    await hold(8); await cross(2); assert.deepEqual(await ttRecord(), ttBaseline);
    await hold(8); await cross('finish');
    await page.until(`__gp.state==='results'&&!__gp.qualiRun&&document.getElementById('quali-go').style.display!=='none'`, 240000);
    assert.deepEqual(await ttRecord(), ttBaseline);
    return { best: ttBaseline.best, sectors: ttBaseline.sectors, result: await page.evaluate(`document.getElementById('quali-sub').textContent`) };
  });
  await click('quali-go'); await startLights();
  await cross('finish'); // 發車線：真正開始 GP 第 1 圈。
  await hold(8); await cross(1); await hold(8); await cross(2);
  await click('btn-pause'); knownCheckpointSave = await stored();
  const knownPlayer = knownCheckpointSave.season.pending.checkpoint.player;
  assert.equal(knownPlayer.sectorIdx, 2); assert.ok(knownPlayer.lapSectors.slice(0, 2).every(v => v > 8));
  assert.equal(knownPlayer.lapSectors[2], null);
  await check('season_reload_restores_known_sectors_and_completes_real_lap_row', async () => {
    await reloadSeason();
    assert.equal(await page.evaluate(`__gp.lapTime`), knownPlayer.lapTime);
    await click('btn-pause');
    const restored = (await stored()).season.pending.checkpoint.player;
    assert.deepEqual(restored.lapSectors, knownPlayer.lapSectors);
    await click('btn-resume'); await hold(8); await cross('finish');
    const row = await page.evaluate(`__gp.sessionLaps.rows().at(-1)`);
    assert.ok(row && row.valid); assert.deepEqual(row.sectors.slice(0, 2), knownPlayer.lapSectors.slice(0, 2));
    assert.ok(row.sectors[2] > 8); assert.ok(Math.abs(await page.evaluate(`__gp.sessionLaps.summary().theoreticalBest`) - row.time) < 1e-8);
    assert.deepEqual(await ttRecord(), ttBaseline);
    return { saved: knownPlayer, restored, row, ttUnchanged: true };
  });
  await check('legacy_checkpoint_without_sectors_resumes_with_unknown_values', async () => {
    // 先離開遊戲釋放存檔鎖，再於同 context 的純 HTML fixture 準備舊格式。
    await page.send('Page.navigate', { url: `${origin}/__next6-fixture` });
    await page.until(`document.title==='next6 storage fixture'&&!window.__gp`);
    const legacy = structuredClone(knownCheckpointSave); delete legacy.season.pending.checkpoint.player.lapSectors;
    await page.evaluate(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(legacy))})`);
    await navigate('circuit=australia&season=1&q=low&notraffic');
    const parsed = (await page.evaluate(`__gp.save.season.pending.checkpoint.player`));
    assert.deepEqual(parsed.lapSectors, [null, null, null]);
    await click('btn-season'); await page.until(`__gp.state==='race'`, 15000);
    await click('btn-pause'); assert.deepEqual((await stored()).season.pending.checkpoint.player.lapSectors, [null, null, null]);
    await click('btn-resume'); await hold(8); await cross('finish');
    const row = await page.evaluate(`__gp.sessionLaps.rows().at(-1)`), summary = await page.evaluate(`__gp.sessionLaps.summary()`);
    assert.ok(row && row.valid); assert.deepEqual(row.sectors.slice(0, 2), [null, null]);
    assert.ok(row.sectors[2] > 8); assert.equal(summary.theoreticalBest, null);
    return { parsed, row, theoreticalBest: summary.theoreticalBest };
  });
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []);
  report.status = 'PASS';
} catch (error) { report.error = error.stack ?? String(error); console.error(report.error); process.exitCode = 1; }
finally {
  page?.close();
  if (browser && context) await browser.send('Target.disposeBrowserContext', { browserContextId: context }).catch(error => { report.cleanupError = String(error); report.status = 'FAIL'; process.exitCode = 1; });
  browser?.close(); if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.completedAt = new Date().toISOString();
  report.limitations = [
    '隔離 context 的本機 Chrome；僅載入本機 preview，不連正式站或外部 API。',
    '測試在檢查線前安排車位，再由真車輛物理及 main.step 過線；非真人完整駕駛或賽道完成度測試。',
    '起跑燈透過測試時間來源與真 rAF callback 前進；不量測幀率、真實倒數時間、耗電或手機實機。',
    '舊格式由自己 context 內的純 HTML fixture 寫入；先釋放遊戲分頁鎖，未操作玩家存檔。',
    '本腳本驗證目前版本；前後程式行為對照另見 next6-racing-regression.mjs。',
  ];
  await writeFile(path.join(here, 'next6-racing-browser-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, build: report.build, result: 'next6-racing-browser-result.json' }));
}
