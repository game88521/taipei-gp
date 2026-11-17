// 本機真瀏覽器結算流程；控制組可指定 NEXT6_BROWSER_PROJECT 與 NEXT6_EXPECT_BEFORE=1。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'vite';
import { CdpConnection } from './multiplayer-ui-cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), ownProject = path.resolve(here, '../..');
const project = path.resolve(process.env.NEXT6_BROWSER_PROJECT ?? ownProject);
const before = process.env.NEXT6_EXPECT_BEFORE === '1';
const origin = 'http://127.0.0.1:4319';
const report = { startedAt: new Date().toISOString(), before, project, cases: [], exceptions: [], externalRequests: [], layouts: [], localOnly: true, status: 'FAIL' };
const evidence = path.join(ownProject, 'tools/dev-tests', `next6-city-browser-evidence-${Date.now()}`);
await mkdir(evidence);
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let web, browser, page, context;
async function check(name, exercise) {
  try { const details = await exercise(); report.cases.push({ name, status: 'PASS', details }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
const visible = id => `!document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`;
const click = id => page.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
async function finishStreet() {
  return page.evaluate(`(() => {
    const g=__gp,s=g.sr;
    s.update(4,g.fcar,null);
    for(const i of s.active.checkpoints){const p=s.active.path[i];g.fcar.place(p[0],p[1],0);s.update(.02,g.fcar,null)}
    s.update(.7,g.fcar,null);g.freeStep(0);
    return {phase:s.phase,state:g.state,visible:!document.getElementById('sr-result').classList.contains('hidden'),menuVisible:!document.getElementById('menu').classList.contains('hidden')};
  })()`);
}
async function startStreet() {
  await click('btn-pause'); await click('btn-duel');
  await page.until(`document.querySelector('#duel-list button')`);
  await page.evaluate(`document.querySelector('#duel-list button').click()`);
  await page.until(`__gp.state==='free'&&__gp.sr?.phase==='count'`);
}
try {
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4319, strictPort: true }, logLevel: 'error' });
  const version = await (await fetch(`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}/json/version`)).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  context = (await browser.send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const targets = await browser.send('Target.getTargets');
  const target = targets.targetInfos.find(t => t.targetId === targetId); assert.ok(target);
  const list = await (await fetch(`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}/json`)).json();
  page = new CdpConnection(list.find(t => t.id === targetId).webSocketDebuggerUrl, 'city', report);
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
  await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  const seed = { schema: 3, best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, quali: false }, taxi: { money: 10000, trips: 2 }, tutDone: true, quality: 'low', touch: 'on', car: 'sedan' };
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(location.origin!==${JSON.stringify(origin)})return;
    if(!sessionStorage.getItem('next6-city')){localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('next6-city','1')}
    const raf=requestAnimationFrame.bind(window);window.__next6Manual=false;
    window.requestAnimationFrame=cb=>{window.__next6Frame=cb;if(__next6Manual)return 0;return window.__next6RafId=raf(cb)};
  `.replace(`if(location.origin!==${JSON.stringify(origin)})return;`, `if(location.origin!==${JSON.stringify(origin)})throw new Error('unexpected test origin');`) });
  await page.send('Page.navigate', { url: origin + '/?q=low&notraffic' });
  await page.until(`!!window.__gp&&!document.getElementById('btn-free').disabled`, 180000);
  await page.evaluate(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);document.getElementById('btn-free').click()`);
  await page.until(`__gp.state==='free'&&__gp.streetSystemsReady`, 180000);
  await page.evaluate(`window.__next6Manual=true;cancelAnimationFrame(window.__next6RafId)`);
  await startStreet();
  await check('street_result_freezes_simulation_and_menu_stays_hidden', async () => {
    const result = await finishStreet();
    assert.equal(result.visible, true); assert.equal(result.menuVisible, false);
    assert.equal(result.state, before ? 'free' : 'paused');
    // 真 renderer/rAF callback；控制組仍推自由物理，新版覆蓋層下應保持不動。
    await page.evaluate(`__gp.fcar.v=15;__gp.fcar.vx=Math.sin(__gp.fcar.h)*15;__gp.fcar.vz=Math.cos(__gp.fcar.h)*15;window.__next6CarBefore={x:__gp.fcar.x,z:__gp.fcar.z}`);
    await delay(160); await page.evaluate(`window.__next6Frame(performance.now())`);
    const movement = await page.evaluate(`Math.hypot(__gp.fcar.x-__next6CarBefore.x,__gp.fcar.z-__next6CarBefore.z)`);
    if (before) assert.ok(movement > .001, 'control must actually continue moving'); else assert.equal(movement, 0);
    return { ...result, movement, expectedBefore: before };
  });
  if (!before) {
    await check('result_is_not_bypassed_by_escape_or_resume', async () => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await click('btn-resume');
      assert.equal(await page.evaluate(`__gp.state==='paused'&&${visible('sr-result')}&&!${visible('menu')}`), true);
      return { state: await page.evaluate('__gp.state') };
    });
    await check('result_buttons_reachable_in_three_mobile_viewports', async () => {
      for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        const layout = await page.evaluate(`(() => {const buttons=['sr-ok','sr-again'].map(id=>{const b=document.getElementById(id);b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{id,width:r.width,height:r.height,top:r.top,bottom:r.bottom,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b}});return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,buttons}})()`);
        assert.ok(layout.scrollWidth <= width + 1);
        for (const b of layout.buttons) assert.ok(b.width >= 44 && b.height >= 44 && b.top >= -1 && b.bottom <= height + 1 && b.hit, JSON.stringify(b));
        report.layouts.push(layout);
      }
      return report.layouts;
    });
    await check('again_restarts_and_ok_resumes_free_driving', async () => {
      await click('sr-again'); await page.until(`__gp.state==='free'&&__gp.sr.phase==='count'`);
      const again = await finishStreet(); assert.equal(again.state, 'paused');
      await click('sr-ok');
      assert.equal(await page.evaluate(`__gp.state==='free'&&!${visible('sr-result')}&&!__gp.sr.active`), true);
      return { againState: again.state, afterOk: await page.evaluate('__gp.state') };
    });
  }
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []);
  report.status = 'PASS';
} catch (error) { report.error = error.stack ?? String(error); console.error(report.error); process.exitCode = 1; }
finally {
  page?.close();
  if (browser && context) await browser.send('Target.disposeBrowserContext', { browserContextId: context }).catch(e => { report.cleanupError = String(e); report.status = 'FAIL'; process.exitCode = 1; });
  browser?.close(); if (web) await new Promise(resolve => web.httpServer.close(resolve));
  report.completedAt = new Date().toISOString();
  report.limitations = ['同機本機Chrome，非手機實機／外網。', '合法街賽檢查點以測試安排的車輛座標通過，非完整真人駕駛。', '驗證覆蓋層下模擬暫停，不量測FPS或耗電。'];
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(here, before ? 'next6-city-browser-before.json' : 'next6-city-browser-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, before, cases: report.cases.length, build: report.build, evidence }));
}
