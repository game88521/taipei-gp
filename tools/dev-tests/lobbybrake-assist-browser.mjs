// 本機真 GP 提示／線色整合；只安排車輛胎況與位置，不測安全速度或手機 FPS。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection } from './multiplayer-ui-cdp.mjs';
import { pureUrl } from './pure-module-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), ownProject = path.resolve(here, '../..');
const project = path.resolve(process.env.LOBBYBRAKE_ASSIST_BROWSER_PROJECT ?? ownProject);
const before = process.env.LOBBYBRAKE_EXPECT_BEFORE === '1';
const origin = 'http://127.0.0.1:4332', cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const evidence = path.join(here, `lobbybrake-assist-browser-evidence-${Date.now()}`);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const report = { startedAt: new Date().toISOString(), project, origin, before, status: 'FAIL', localOnly: true,
  cases: [], sourceHashes: {}, exceptions: [], externalRequests: [], layouts: [], screenshots: [], cleanup: {} };
const sourceFiles = ['src/main.ts', 'src/world.ts', 'src/car.ts', 'src/track.ts', 'src/rivals.ts', 'src/style.css'];
if (!before) sourceFiles.push('src/braking-assist.ts');
const perf = { vmax: 95, engine: 16, brake: 50, g0: 23, gk: .0068, gmax: 66 };
let web, browser, page, context;
async function check(name, action) {
  try { report.cases.push({ name, status: 'PASS', details: await action() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
async function refresh() {
  return page.evaluate(`(() => {for(let i=0;i<5;i++)__lobbybrakeFrame(__lobbybrakeNow);return document.getElementById('warn').textContent})()`);
}
async function screenshot(file) {
  // 時鐘固定時 frame cap 可能略過 draw；以真 renderer 畫目前 scene，保留 HUD 的真 DOM。
  await page.evaluate(`__gp.renderer.setPixelRatio(.5);__gp.renderer.setSize(innerWidth,innerHeight,false);__gp.renderer.render(__gp.scene,__gp.camera)`);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, file), Buffer.from(shot.data, 'base64')); report.screenshots.push(file);
  await page.evaluate(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)`);
}
async function startCountdown() {
  await page.until(`__gp.state==='countdown'`, 20000);
  const state = await page.evaluate(`(() => {
    for(let i=0;i<80&&__gp.state==='countdown';i++){__lobbybrakeNow+=100;__lobbybrakeFrame(__lobbybrakeNow)}
    return{state:__gp.state,quali:__gp.qualiRun};
  })()`);
  assert.deepEqual(state, { state: 'race', quali: false }); await refresh();
}
async function placeFixture({ wet = .8, wear = .65, compound = 1, index, speed, pit = null }) {
  await page.evaluate(`(() => {
    const g=__gp,f=g.field,m=f.me,t=g.track;
    m.pit=null;m.pitReq=false;m.compound=${compound};m.wear=${wear};m.laps=1;
    f.wet=${wet};f.raceTime+=.3;f.rainAt=Infinity;
    let other=0;for(const r of f.racers)if(!r.isPlayer){r.pit=null;r.pitReq=false;
      r.car.placeAt(t,(${index}+Math.round(t.N/2)+(other++)*12)%t.N);r.car.v=0}
    g.car.placeAt(t,${index});g.car.v=${speed};
    f.update(0,false);
    ${pit ? `m.pit={ph:${JSON.stringify(pit)},sd:-150,v:${speed},entry:5,exit:4.5,t:0,T:2.5,slow:-1,next:2,box:0,team:0};` : ''}
    g.step(0);
  })()`);
  await refresh();
  return page.evaluate(`(() => {
    const g=__gp,c=g.car,t=g.track,i=c.pos.i,ahead=(i+Math.round(c.v*.7/t.ds))%t.N;
    return{grip:c.gripMul,speed:c.v,index:i,ahead,originalTarget:t.vTarget[ahead],warning:document.getElementById('warn').textContent,
      pit:g.field.me.pit?.ph??null,colors:__lobbybrakeColors()};
  })()`);
}
try {
  await mkdir(evidence);
  for (const file of sourceFiles) report.sourceHashes[file] = hash(await readFile(path.join(project, file)));
  report.scriptSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  report.referenceModelHash = hash(await readFile(path.join(ownProject, 'src/braking-assist.ts')));
  const { BrakingAssist } = await import(await pureUrl(ownProject, 'braking-assist.ts'));
  const sw = await readFile(path.join(project, 'dist/sw.js'), 'utf8');
  report.build = sw.match(/const VERSION = '([a-f0-9]{12})'/)?.[1]; assert.ok(report.build);
  if (process.env.LOBBYBRAKE_EXPECT_BUILD) assert.equal(report.build, process.env.LOBBYBRAKE_EXPECT_BUILD);
  web = await preview({ root: project, logLevel: 'error', preview: { host: '127.0.0.1', port: 4332, strictPort: true } });
  assert.equal(await (await fetch(origin + '/sw.js')).text(), sw, 'preview 必須對應所選 dist');
  browser = new CdpConnection((await (await fetch(cdp + '/json/version')).json()).webSocketDebuggerUrl, 'browser', report);
  context = (await browser.send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const target = (await (await fetch(cdp + '/json')).json()).find((item) => item.id === targetId); assert.ok(target);
  page = new CdpConnection(target.webSocketDebuggerUrl, 'assist', report);
  page.on('Runtime.exceptionThrown', (event) => report.exceptions.push(event.exceptionDetails));
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: false }));
  page.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url), allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(request.url);
    await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...allowed ? {} : { errorReason: 'BlockedByClient' } });
  });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker', { bypass: true }); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const seed = { schema: 3, best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, quali: false, assist: true },
    taxi: { money: 1000, trips: 0 }, tutDone: true, quality: 'low', touch: 'on', steer: 'buttons' };
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    if(location.origin!==${JSON.stringify(origin)})return;
    localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});
    const raf=requestAnimationFrame.bind(window),now=performance.now.bind(performance);
    window.__lobbybrakeManual=false;window.__lobbybrakeNow=null;
    Object.defineProperty(performance,'now',{value:()=>window.__lobbybrakeNow??now()});
    window.requestAnimationFrame=callback=>{window.__lobbybrakeFrame=callback;if(__lobbybrakeManual)return 0;return window.__lobbybrakeFrameId=raf(callback)};
  })()` });
  await page.send('Page.navigate', { url: origin + '/?circuit=australia&q=low&notraffic&perf=95,16,50,23,.0068,66' });
  await page.until(`!!window.__gp&&!document.getElementById('btn-gp').disabled`, 180000);
  await page.evaluate(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);
    window.__lobbybrakeManual=true;cancelAnimationFrame(window.__lobbybrakeFrameId);window.__lobbybrakeNow=performance.now();
    __gp.input.read=()=>({steer:0,brake:false});
    document.getElementById('opt-quali').checked=false;document.getElementById('opt-quali').dispatchEvent(new Event('change'));
    for(const[id,value]of[['opt-laps','6'],['opt-gpwx','dry'],['opt-sc','off']]){document.getElementById(id).value=value;document.getElementById(id).dispatchEvent(new Event('change'))}
    document.getElementById('btn-gp').click();document.querySelector('.cp-go:not(:disabled)').click()`);
  await startCountdown(); assert.equal(await page.evaluate('__gp.field.laps'), 6);
  await page.evaluate(`(() => {
    const found=[];__gp.scene.traverse(o=>{const m=o.material;
      if(o.isMesh&&m?.isMeshBasicMaterial&&m.opacity===.55&&m.polygonOffsetFactor===-6&&m.polygonOffsetUnits===-80&&o.geometry.getAttribute('position').count===__gp.track.N*6)found.push(o)});
    if(found.length!==1)throw Error('Expected unique assist mesh, got '+found.length);
    window.__lobbybrakeLine=found[0];
    window.__lobbybrakeColors=()=>{const a=__lobbybrakeLine.geometry.getAttribute('color'),b=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength);let h=2166136261;
      for(const v of b){h^=v;h=Math.imul(h,16777619)}return{fingerprint:(h>>>0).toString(16),version:a.version,geometry:__lobbybrakeLine.geometry.uuid}};
    window.__lobbybrakeOriginalTargets=Array.from(__gp.track.vTarget);
  })()`);
  const actualTrack = await page.evaluate(`(() => {const t=__gp.track;return{N:t.N,ds:t.ds,vTarget:Array.from(t.vTarget),curv:Array.from(t.curv),bankGrip:Array.from(t.bankGrip)}})()`);
  const wetSetup = await placeFixture({ index: Math.round(actualTrack.N * .4), speed: 0 });
  const model = new BrakingAssist(actualTrack, perf); model.update(wetSetup.grip, 1, true);
  const reductions = actualTrack.vTarget.map((speed, i) => speed - model.targets[i]);
  const ahead = reductions.indexOf(Math.max(...reductions)); assert.ok(reductions[ahead] > 1);
  const speed = (actualTrack.vTarget[ahead] + model.targets[ahead]) / 2 + 5;
  const index = (ahead - Math.round(speed * .7 / actualTrack.ds) + actualTrack.N) % actualTrack.N;
  const fixture = { index, speed };
  await check('same_real_GP_grip_position_speed_produces_earlier_warning_and_updated_line', async () => {
    const dry = await placeFixture({ ...fixture, wet: 0, wear: 0 });
    assert.equal(dry.grip, 1); assert.equal(dry.warning, '');
    const wet = await placeFixture(fixture); assert.equal(wet.ahead, ahead);
    assert.ok(wet.speed < wet.originalTarget + 5); assert.ok(wet.speed > model.targets[ahead] + 5);
    assert.equal(wet.warning, before ? '' : '煞車！');
    assert.equal(wet.colors.geometry, dry.colors.geometry);
    if (before) assert.equal(wet.colors.fingerprint, dry.colors.fingerprint);
    else assert.notEqual(wet.colors.fingerprint, dry.colors.fingerprint);
    const unchanged = await page.evaluate(`__lobbybrakeOriginalTargets.every((v,i)=>v===__gp.track.vTarget[i])`); assert.equal(unchanged, true);
    report.comparison = { fixture, ahead, dry, wet, adjustedTarget: model.targets[ahead] };
    await screenshot(before ? 'assist-before-wet.png' : 'assist-after-wet.png');
    return { ...report.comparison, originalTargetsUnchanged: unchanged };
  });
  if (!before) {
    await check('in_box_out_hide_braking_warning_and_return_to_track_restores_it', async () => {
      const phases = [];
      for (const pit of ['in', 'box', 'out']) {
        const snapshot = await placeFixture({ ...fixture, pit }); assert.equal(snapshot.pit, pit); assert.equal(snapshot.warning, ''); phases.push(snapshot);
      }
      const racing = await placeFixture(fixture); assert.equal(racing.warning, '煞車！'); return { phases, racing };
    });
    await check('three_mobile_viewports_keep_warning_and_touch_controls_accessible', async () => {
      for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true }); await refresh();
        const layout = await page.evaluate(`(() => {
          const box=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
          const warn=document.getElementById('warn'),controls=['brake',...(document.documentElement.dataset.steer==='buttons'?['steer-l','steer-r']:['pad'])].map(id=>{
            const e=document.getElementById(id),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
            return{id,...box(e),reachable:!!hit&&(hit===e||e.contains(hit))};
          });return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,warning:{...box(warn),text:warn.textContent,shown:warn.classList.contains('show')},controls};
        })()`);
        assert.ok(layout.documentWidth <= width + 1); assert.equal(layout.warning.text, '煞車！'); assert.equal(layout.warning.shown, true);
        for (const box of [layout.warning, ...layout.controls]) assert.ok(box.left >= -1 && box.right <= width + 1 && box.top >= -1 && box.bottom <= height + 1, JSON.stringify(layout));
        for (const control of layout.controls) { assert.ok(control.width >= 44 && control.height >= 44); assert.equal(control.reachable, true, JSON.stringify(layout)); }
        report.layouts.push(layout); await screenshot(`assist-${width}x${height}.png`);
      }
      return report.layouts;
    });
    await check('leaving_GP_for_real_time_trial_restores_original_line_and_warning_threshold', async () => {
      await page.evaluate(`document.getElementById('btn-pause').click()`); assert.equal(await page.evaluate('__gp.state'), 'paused');
      await page.evaluate(`document.getElementById('btn-start').click();document.querySelector('.cp-go:not(:disabled)').click()`);
      await startCountdown();
      const tt = await placeFixture(fixture);
      assert.equal(tt.warning, ''); assert.equal(tt.colors.fingerprint, report.comparison.dry.colors.fingerprint);
      return { tt, originalLineRestored: true };
    });
  }
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); report.status = 'PASS';
} catch (error) { report.error = error.stack ?? String(error); console.error(report.error); process.exitCode = 1; }
finally {
  page?.close();
  if (browser && context) {
    try { await browser.send('Target.disposeBrowserContext', { browserContextId: context }); report.cleanup.browserContextDisposed = true; }
    catch (error) { report.cleanup.error = String(error); report.status = 'FAIL'; process.exitCode = 1; }
  }
  browser?.close();
  if (web) { await new Promise((resolve) => web.httpServer.close(resolve)); report.cleanup.previewClosed = true; }
  report.sourceUnchanged = true;
  for (const [file, initial] of Object.entries(report.sourceHashes)) if (hash(await readFile(path.join(project, file))) !== initial) report.sourceUnchanged = false;
  if (!report.sourceUnchanged) { report.status = 'FAIL'; process.exitCode = 1; }
  report.completedAt = new Date().toISOString(); report.limitations = [
    '只連本機 preview 與既有 CDP；新隔離 browser context，銷毀後不影響一般 Chrome 或玩家存檔。',
    '透過真 GP／TT 選單起跑，胎種、磨耗、濕度、車速、位置與進站階段由測試安排；其他車移遠避免碰撞。',
    '提示由真 step(0) 與既有 rAF／真 DOM 更新，線色讀取真 Three.js geometry color buffer；參考模型只用來選擇前後版比較點。',
    '時間固定、低解析 render；截圖用真 renderer 額外繪製當前 scene。桌面 Chrome 模擬 viewport，未驗證手機實機、實際駕駛安全速度、實際進站、FPS、耗電或延遲。',
    'before 模式只跑相同胎況／位置／速度的單一對照；新版另驗進站、三種版面、離開 GP。',
  ];
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(here, before ? 'lobbybrake-assist-browser-before.json' : 'lobbybrake-assist-browser-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, before, cases: report.cases.length, build: report.build, evidence }));
}
