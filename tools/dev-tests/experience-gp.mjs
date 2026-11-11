import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const port=process.argv[2];
const pages=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
let id=0;const pending=new Map(),exceptions=[];
ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>reject(Error(method+' 逾時')),120000);pending.set(next,{resolve,reject,timer});ws.send(JSON.stringify({id:next,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const until=async expression=>{const end=Date.now()+120000;while(!await ev(expression)){if(Date.now()>end)throw Error(expression);await new Promise(r=>setTimeout(r,100));}};
const result={};
try{
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:667,height:375,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:'http://127.0.0.1:4317/?circuit=monaco&q=low&bot&gp&sim=2'});
  await until(`!!window.__gp && document.getElementById('strategy-advice').textContent.length>0`);
  await ev(`document.getElementById('gp-strategy').open=true`);
  await until(`document.getElementById('strategy-detail').textContent.includes('基礎損失')`);
  result.dry=await ev(`document.getElementById('strategy-detail').textContent`);
  assert.match(result.dry,/未含進出減速/);
  assert.match(result.dry,/含本圈尚餘 3 圈/);
  await ev(`__gp.field.wet=.7; __gp.field.me.wear=.2; __gp.field.me.compound=1`);
  await until(`document.getElementById('strategy-advice').textContent.includes('建議換雨胎')`);
  result.wet=await ev(`document.getElementById('strategy-detail').textContent`);
  assert.match(result.wet,/濕度 70%/);
  await ev(`__gp.field.me.laps=__gp.field.laps`);
  await until(`document.getElementById('strategy-advice').textContent.includes('最後一圈')`);
  await ev(`document.documentElement.classList.add('touch'); document.getElementById('rotate').classList.add('hidden')`);
  result.matrix=[];
  for(const [width,height] of [[375,812],[390,844],[667,375]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    for(const mode of ['race','free'])for(const scale of [.7,1.4])for(const pos of ['std','swap-lift'])for(const steer of ['buttons','drag']){
      const row=await ev(`(() => {
        const root=document.documentElement,hud=document.getElementById('hud');
        root.style.setProperty('--tc-request-scale','${scale}');root.style.setProperty('--tc-lift','${pos.endsWith('lift')?'46':'0'}px');root.classList.toggle('tc-swap',${pos.startsWith('swap')});root.classList.toggle('tc-radio-top',${scale>1.05||pos!=='std'});root.dataset.steer='${steer}';hud.dataset.mode='${mode}';hud.dataset.kind='gp';
        document.getElementById('gp-strategy').open=false;
        document.getElementById('pit-tyre').classList.remove('on');
        document.getElementById('radio').classList.add('show');
        const ids=['brake',...('${steer}'==='buttons'?['steer-l','steer-r']:['pad']),...('${mode}'==='free'?['gas','btn-horn','btn-drift']:['pit','drs','gp-strategy','radio']),'.speedo'];
        const rects=ids.map(id=>{const el=id.startsWith('.')?document.querySelector(id):document.getElementById(id),r=el.getBoundingClientRect();return {id,x:r.x,y:r.y,w:r.width,h:r.height,visible:r.width>0&&r.height>0};}).filter(r=>r.visible);
        const outside=rects.filter(r=>r.x<-.1||r.y<-.1||r.x+r.w>innerWidth+.1||r.y+r.h>innerHeight+.1);
        const small=rects.filter(r=>r.id!=='.speedo'&&r.id!=='radio'&&(r.w<43.9||r.h<43.9));
        const overlaps=[];
        for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1)overlaps.push([a.id,b.id]);}
        return {rects,outside,overlaps,small};
      })()`);
      result.matrix.push({width,height,mode,scale,pos,steer,...row});
    }
    await ev(`document.getElementById('hud').dataset.mode='race';document.documentElement.classList.remove('tc-swap');document.documentElement.dataset.steer='buttons';document.documentElement.style.setProperty('--tc-lift','0px');document.getElementById('gp-strategy').open=true`);
    await until(`(()=>{const r=document.getElementById('pit-tyre').getBoundingClientRect();return r.width===0||(r.left>=0 && r.right<=innerWidth);})()`);
    const shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(new URL(`shots-experience-gp-${width}.png`,import.meta.url),Buffer.from(shot.data,'base64'));
  }
  result.exceptions=exceptions;
  await ev('__gp.renderer.setAnimationLoop(null)');
  writeFileSync(new URL('shots-experience-gp.json',import.meta.url),JSON.stringify(result,null,2));
  const failures=result.matrix.filter(r=>r.outside.length||r.overlaps.length||r.small.length).map(({rects,...rest})=>rest);
  assert.deepEqual(failures,[]);
  assert.deepEqual(exceptions,[]);
  console.log(JSON.stringify({dry:result.dry,wet:result.wet,cases:result.matrix.length,exceptions},null,2));
}finally{ws.close();}
