import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const port = process.argv[2], label = process.argv[3] || 'after';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(), exceptions = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data), job = pending.get(m.id);
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
  if (!job) return;
  pending.delete(m.id); clearTimeout(job.timer);
  m.error ? job.reject(new Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id, timer = setTimeout(() => reject(new Error(`${method} 逾時`)), 120000);
  pending.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params }));
});
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;
};
const until = async expression => {
  const end = Date.now() + 120000;
  while (!await ev(expression)) { if (Date.now() > end) throw new Error(expression); await new Promise(r => setTimeout(r, 100)); }
};
const result = { label };
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__audioEdges=[]; window.__garageContexts=0;
    window.__audioTargets=new WeakMap();
    const target=AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime=function(v,...args){ window.__audioTargets.set(this,v); return target.call(this,v,...args); };
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(...args){ window.__audioEdges.push([this,args[0]]); return connect.apply(this,args); };
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(...args){ const r=get.apply(this,args); if(this.id==='car-3d' && args[0]==='webgl2' && r) window.__garageContexts++; return r; };
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4317/?circuit=monaco&q=low' });
  await until('!!window.__gp && !document.getElementById("btn-gp").disabled');
  if(label==='before') await ev('__gp.renderer.setAnimationLoop(null)');
  result.initialScripts = await ev(`performance.getEntriesByType('resource').filter(e => e.name.includes('/assets/') && e.name.endsWith('.js')).map(e => ({name:e.name.split('/').pop(), bytes:e.encodedBodySize,decoded:e.decodedBodySize}))`);
  if(label==='after') {
    await until('!!navigator.serviceWorker.controller');
    result.garagePrecached=await ev(`(async()=>{const names=await caches.keys();const keys=(await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>r.url)))).flat();return keys.some(n=>n.includes('/assets/garage3d-'));})()`);
    assert.equal(result.garagePrecached,false);
  }
  result.controls = await ev(`(() => {
    const g=__gp, pad=document.getElementById('pad');
    g.input.padId=10; g.input.padSteer=.5; g.input.tiltSteer=.7;
    window.dispatchEvent(new Event('blur'));
    const reset=g.input.read();
    g.input.padId=10; g.input.padSteer=.5;
    const linear=g.input.read().steer;
    g.input.curve='gentle'; const gentle=g.input.read().steer;
    g.input.curve='linear'; g.input.padId=-1; g.input.padSteer=0;
    return {reset,linear,gentle};
  })()`);
  result.garage = await ev(`(() => {
    document.querySelector('[data-tab="garage"]').click();
    const key='taipei-gp-v2', before=JSON.parse(localStorage.getItem(key)||'{}').car||'sedan';
    document.querySelector('#car-list [data-id="pickup"]').click();
    const preview=JSON.parse(localStorage.getItem(key)||'{}').car||'sedan';
    const compare=document.getElementById('car-compare')?.textContent;
    document.getElementById('car-use')?.click();
    const equipped=JSON.parse(localStorage.getItem(key)||'{}').car;
    return {before,preview,equipped,compare};
  })()`);
  if (label === 'after') {
    assert.equal(result.controls.reset.steer, 0);
    assert.equal(result.controls.linear, .5);
    assert.ok(result.controls.gentle > 0 && result.controls.gentle < .5);
    assert.equal(result.garage.preview, result.garage.before);
    assert.equal(result.garage.equipped, 'pickup');
    assert.match(result.garage.compare, /目前使用/);
    await until(`performance.getEntriesByType('resource').some(e=>/garage3d-.*\.js/.test(e.name))`);
    assert.ok(!result.initialScripts.some(e => e.name.startsWith('garage3d-')));
    await until('__garageContexts>0');
    await ev('__gp.renderer.setAnimationLoop(null)');
    result.audio = await ev(`(async () => {
      const s=__gp.sound; s.start(); await s.ctx.resume();
      for(const [k,v] of Object.entries({master:.8,engine:0,others:.35,fx:.6,ambient:.2})) {
        const e=document.getElementById('opt-vol-'+k); e.value=v; e.dispatchEvent(new Event('input'));
      }
      const end=performance.now()+10000;
      while(!s.others.length) { if(performance.now()>end) throw Error('其他車引擎未載入'); await new Promise(r=>setTimeout(r,30)); }
      await new Promise(r=>setTimeout(r,350));
      const linked=(a,b)=>__audioEdges.some(([x,y])=>x===a&&y===b);
      return {state:s.ctx.state,time:s.ctx.currentTime,targets:[s.master,s.engBus,s.otherBus,s.fx,s.amb].map(b=>__audioTargets.get(b.gain)),
        own:linked(s.eng,s.engBus),other:s.others.every(o=>linked(o.pan,s.otherBus)&&!linked(o.pan,s.engBus)),
        ambient:linked(s.amb,s.master)&&!linked(s.amb,s.fx),
        saved:JSON.parse(localStorage.getItem('taipei-gp-v2')).vol};
    })()`);
    assert.ok(result.audio.own && result.audio.other && result.audio.ambient);
    [.48,0,.35,.6,.2].forEach((v,i)=>assert.ok(Math.abs(result.audio.targets[i]-v)<.001,JSON.stringify(result.audio)));
    assert.equal(result.audio.saved.others,.35);
    assert.equal(result.audio.saved.ambient,.2);
    result.model = await ev(`(async () => {
      const f=document.createElement('iframe'); document.body.append(f);
      const w=f.contentWindow, d=w.document;
      d.body.innerHTML='<div id="boot"><div class="b-load"><div class="b-track"><i id="boot-bar"></i></div><span id="boot-label"></span><span id="boot-pct"></span><span id="boot-tip"></span></div></div>';
      const m=await w.eval("import('/__experience.js')");
      w.AudioContext=function(){return new w.OfflineAudioContext(2,44100,44100);};
      const sound=new m.Sound();sound.setVolume({master:.8,engine:0,others:.35,fx:.6,ambient:.2});sound.start();
      await sound.ctx.startRendering();
      const offlineGains=[sound.master,sound.engBus,sound.otherBus,sound.fx,sound.amb].map(b=>b.gain.value);
      const values=[];
      for(const v of [.8,.2,NaN,2]) {m.bootProgress('測試',v);values.push(d.getElementById('boot-pct').textContent);}
      const aria=d.querySelector('.b-track').getAttribute('aria-valuenow');
      m.bootDone(); m.bootProgress('倒退',.1);
      const frozen=d.getElementById('boot-pct').textContent;
      const old=m.parseSaveFile(JSON.stringify({opts:{},vol:{master:.8,engine:.3,fx:.4}}));
      const modern=m.parseSaveFile(JSON.stringify({opts:{},curve:'gentle',vol:{master:1,engine:0,fx:.5,others:.35,ambient:.2}}));
      const bad=m.parseSaveFile(JSON.stringify({opts:{},curve:'bad',vol:{master:1,engine:1,fx:1,others:9,ambient:-2}}));
      const loss=[m.pitBaselineLoss(300,60/3.6,5),m.pitBaselineLoss(300,80/3.6,5),m.pitBaselineLoss(-1,20,5),m.pitBaselineLoss(300,0,5)];
      const trends=[m.wetTrend(0,.1),m.wetTrend(.5,.4),m.wetTrend(1,1)];
      const els=Array.from({length:7},()=>{const e=d.createElement('div');e.setPointerCapture=()=>{};d.body.append(e);return e;});
      const input=new m.Input(...els);
      const pointer=(el,type,pointerId,x=60)=>el.dispatchEvent(new w.PointerEvent(type,{pointerId,clientX:x,bubbles:true,cancelable:true}));
      els[0].style.cssText='width:200px;height:40px';
      const r=els[0].getBoundingClientRect(), x=r.left+r.width*.65;
      pointer(els[0],'pointerdown',1,x); const first=input.read().steer;
      pointer(els[0],'pointerdown',2,r.right); const second=input.read().steer;
      pointer(els[0],'lostpointercapture',1); const lost=input.read().steer;
      pointer(els[3],'pointerdown',5);pointer(els[3],'pointerdown',6);
      pointer(els[3],'lostpointercapture',5);const held=input.read().throttle;
      pointer(els[3],'lostpointercapture',6);const released=input.read().throttle;
      w.dispatchEvent(new w.KeyboardEvent('keydown',{code:'KeyW'}));
      w.dispatchEvent(new Event('blur')); const blur=input.read();
      input.padId=3; input.padSteer=.8;
      Object.defineProperty(d,'hidden',{configurable:true,value:true});d.dispatchEvent(new Event('visibilitychange'));const hidden=input.read().steer;
      delete w.DeviceOrientationEvent;const tilt=await input.enableTilt();
      input.curve='gentle'; input.padId=4; input.padSteer=1;const full=input.read().steer;
      f.remove();
      return {offlineGains,values,aria,frozen,old,modern,bad,loss,trends,first,second,lost,held,released,blur,hidden,tilt,full};
    })()`);
    const m=result.model;
    [.48,0,.35,.6,.2].forEach((v,i)=>assert.ok(Math.abs(m.offlineGains[i]-v)<.001,JSON.stringify(m.offlineGains)));
    assert.deepEqual(m.values,['80%','80%','80%','100%']);assert.equal(m.aria,'100');assert.equal(m.frozen,'100%');
    assert.ok(m.old.ok && m.modern.ok && m.bad.ok);
    assert.equal(m.modern.save.curve,'gentle');assert.equal(m.modern.save.vol.ambient,.2);
    assert.equal(m.old.save.vol.engine,.3);assert.equal(m.bad.save.curve,undefined);assert.equal(m.bad.save.vol.others,undefined);
    assert.deepEqual(m.loss,[15.5,11,null,null]);
    assert.deepEqual(m.trends,['路面持續變濕','路面逐漸乾燥','路面大致穩定']);
    assert.ok(m.first>0 && m.first<1);assert.equal(m.first,m.second);assert.equal(m.lost,0);
    assert.equal(m.held,true);assert.equal(m.released,false);assert.equal(m.blur.throttle,false);
    assert.equal(m.hidden,0);assert.equal(m.tilt,false);assert.equal(m.full,1);
    result.curveSaved=await ev(`(() => {const e=document.getElementById('opt-curve');e.value='gentle';e.dispatchEvent(new Event('change'));return JSON.parse(localStorage.getItem('taipei-gp-v2')).curve;})()`);
    assert.equal(result.curveSaved,'gentle');
  }
  result.layouts = [];
  for (const [width,height] of [[375,812],[390,844],[667,375]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    const layout=await ev(`(() => {
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      const t=document.getElementById('toast'); t.textContent='進站策略提醒：賽道正在變濕，請留意胎況並在安全時機安排進站換胎'; t.classList.add('show');
      const r=t.getBoundingClientRect(); return {width:innerWidth,left:r.left,right:r.right,height:r.height};
    })()`);
    result.layouts.push({viewportWidth:width,viewportHeight:height,...layout});
    const shot=await send('Page.captureScreenshot', {format:'png'});
    writeFileSync(new URL(`shots-experience-${label}-${width}.png`,import.meta.url),Buffer.from(shot.data,'base64'));
    if(label==='after') assert.ok(layout.left>=0 && layout.right<=layout.width,JSON.stringify(layout));
  }
  result.exceptions=exceptions;
  if(label==='after') {
    await send('Network.enable');
    await send('Network.setBlockedURLs',{urls:['*garage3d-*.js']});
    await send('Page.navigate',{url:'http://127.0.0.1:4317/?circuit=monaco&q=low&retry-test'});
    await until('!!window.__gp && !document.getElementById("btn-gp").disabled');
    await ev(`document.querySelector('[data-tab="garage"]').click()`);
    await until(`document.getElementById('car-preview-status').textContent.includes('失敗')`);
    result.previewFailure=await ev(`(() => {document.querySelector('#car-list [data-id="super"]').click();document.getElementById('car-use').click();return {status:document.getElementById('car-preview-status').textContent,car:JSON.parse(localStorage.getItem('taipei-gp-v2')).car,curve:document.getElementById('opt-curve').value,vol:['master','engine','others','fx','ambient'].map(k=>+document.getElementById('opt-vol-'+k).value)};})()`);
    assert.equal(result.previewFailure.car,'super');
    assert.equal(result.previewFailure.curve,'gentle');
    assert.deepEqual(result.previewFailure.vol,[.8,0,.35,.6,.2]);
    await send('Network.setBlockedURLs',{urls:[]});
    await ev(`document.getElementById('car-preview-status').click()`);
    await until(`__garageContexts>0`);
    result.previewRetry=true;
  }
  assert.equal(exceptions.length,0);
  writeFileSync(new URL(`shots-experience-${label}.json`,import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { ws.close(); }
