import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const inputSource=await readFile(path.join(root,'src/input.ts'),'utf8'),hintSource=await readFile(path.join(root,'src/horizon-controls.ts'),'utf8');
const code=stripTypeScriptTypes(inputSource,{mode:'transform'}).replaceAll('export ','')+'\n'+stripTypeScriptTypes(hintSource,{mode:'transform'}).replace(/^import .*;$/mg,'').replaceAll('export ','');
const report={status:'RUNNING',cases:[],localOnly:true,realGamepadUsed:false,realPhoneUsed:false,sourceHashes:{},scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')};
for(const f of ['src/input.ts','src/horizon-controls.ts','src/main.ts','index.html','multiplayer.html','src/multiplayer-game.ts'])report.sourceHashes[f]=createHash('sha256').update(await readFile(path.join(root,f))).digest('hex');
function harness(){
 class El extends EventTarget {textContent='';title='';attrs={};classList={contains:()=>false,remove(){}};setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}closest(){return null;}}
 const elements=new Map(),win=new EventTarget(),doc=new EventTarget(),timers=new Map();let focused=true,pad=null,next=1;
 doc.hidden=false;doc.documentElement=new El();doc.hasFocus=()=>focused;doc.getElementById=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
 const context=vm.createContext({console,window:win,document:doc,navigator:{getGamepads:()=>[pad]},Element:El,setInterval:fn=>{const id=next++;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)});
 vm.runInContext(code+'\nglobalThis.api={mountControlHints,controlHint,drivingHint,tutorialPages,defaultControls};',context);
 const config=context.api.defaultControls(),input={tilt:false,getControls:()=>structuredClone(config),read(){throw Error('Hint must never read/arm gameplay input');}};
 const emit=(target,type,properties={})=>{const e=new Event(type);for(const[k,v]of Object.entries(properties))Object.defineProperty(e,k,{value:v});target.dispatchEvent(e);};
 return{...context.api,input,config,elements,win,doc,timers,setPad:p=>{pad=p;},tick:()=>{for(const fn of timers.values())fn();},emit,focus:value=>{focused=value;emit(win,value?'focus':'blur');}};
}
const test=async(name,fn)=>{try{await fn();report.cases.push({name,status:'PASS'});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack)});}};
const pad=()=>({index:0,mapping:'standard',connected:true,axes:[0],buttons:Array.from({length:8},()=>({pressed:false,value:0}))});
await test('真舊教學在自訂鍵位後仍寫預設；新版生成正確五頁',async()=>{
 const old=await readFile(path.join(root,'../taipei-gp-horizon-before-b1f70bac2788/src/main.ts'),'utf8');
 const start=old.indexOf('const TUT_TOUCH ='),end=old.indexOf('function closeTut()',start);assert.ok(start>=0&&end>start);
 const h=harness(),ctx=vm.createContext({document:{documentElement:{classList:{contains:()=>false}}},$:id=>h.doc.getElementById(id)});
 vm.runInContext(old.slice(start,end)+'\nshowTut(0);',ctx);assert.match(h.doc.getElementById('tut-text').textContent,/↑／W/);
 h.config.keys.throttle=['KeyZ'];h.config.keys.brake=['KeyX'];h.config.keys.handbrake=['KeyQ'];
 const pages=h.tutorialPages({device:'keyboard',controls:h.config,steering:'buttons'});
 assert.equal(pages.length,5);assert.match(pages[0][1],/Z 油門/);assert.match(pages[0][1],/X 煞車/);assert.doesNotMatch(pages[0][1],/↑／W/);assert.match(pages[2][1],/Q 甩尾/);
});
await test('每動作一至三鍵全部顯示，不改設定；保留快捷鍵各自說明',()=>{
 const h=harness(),before=JSON.stringify(h.config),state={device:'keyboard',controls:h.config,steering:'buttons'};
 assert.equal(h.controlHint(state,'brake'),'↓／S／空白鍵');assert.equal(h.controlHint(state,'handbrake'),'左 Shift／右 Shift');assert.equal(JSON.stringify(h.config),before);
 assert.match(h.tutorialPages(state)[4][1],/Ctrl／E 開 DRS、B 進站/);
});
await test('手把按鈕用位置避免品牌差異，不虛構選單快捷鍵',()=>{
 const h=harness(),state={device:'gamepad',controls:h.config,steering:'buttons'};
 assert.equal(h.controlHint(state,'throttle'),'右扳機／下方鍵');assert.equal(h.controlHint(state,'brake'),'左扳機／右方鍵');assert.equal(h.controlHint(state,'handbrake'),'左方鍵');
 const all=h.tutorialPages(state).flat().join(' ');assert.match(all,/先放開按鍵/);assert.ok(all.includes('手把功能鍵預設RB開DRS、LB進站、Y切鏡頭、Menu暫停，可在設定調整；選單用十字鍵、A確認／B返回。地圖仍可使用畫面按鈕。更換畫面先放開所有按鈕並回中立。'),'教學須精確說明預設功能鍵、可調整映射、選單操作及中立保護');assert.doesNotMatch(all,/按住 Shift/);
});
await test('觸控按鈕／滑桿／傾斜各有正確方向與煞車倒車提示',()=>{
 const h=harness();for(const[steering,pattern]of[['buttons',/◀/],['drag',/滑桿向左/],['tilt',/手機向左/]]){const state={device:'touch',controls:h.config,steering};assert.match(h.drivingHint(state),pattern);assert.match(h.drivingHint(state),/停住再按可倒車/);assert.doesNotMatch(h.drivingHint(state,true),/倒車/);}
});
await test('手把與傾斜反轉時，轉向動作提示也跟著反轉',()=>{
 const h=harness();h.config.gamepad.inverted=true;assert.equal(h.controlHint({device:'gamepad',controls:h.config,steering:'buttons'},'left'),'左搖桿向右');assert.equal(h.controlHint({device:'gamepad',controls:h.config,steering:'buttons'},'right'),'左搖桿向左');assert.equal(h.controlHint({device:'touch',controls:h.config,steering:'tilt',tiltInverted:true},'left'),'手機向右傾斜');
});
await test('儲存失敗無事件仍讀實際配置，低頻更新不讀Input.read或修改配置',()=>{
 const h=harness(),mounted=h.mountControlHints(h.input);h.config.keys.left=['KeyQ'];h.tick();assert.equal(mounted.label('left'),'Q');assert.match(h.doc.getElementById('control-keyboard-hint').textContent,/Q／→/);assert.equal(h.timers.size,1);assert.equal(h.doc.getElementById('steer-l').attrs['aria-keyshortcuts'],'Q');mounted.dispose();assert.equal(h.timers.size,0);
});
await test('手把接入、真駕駛鍵盤與觸控切換，打字及滑鼠不搶提示',()=>{
 const h=harness(),mounted=h.mountControlHints(h.input);const p=pad();h.setPad(p);h.tick();assert.equal(mounted.state().device,'gamepad');assert.equal(h.doc.getElementById('brake').attrs['aria-keyshortcuts'],undefined);
 const el=h.doc.getElementById('field');el.closest=()=>({});h.emit(h.win,'keydown',{code:'KeyA',target:el});assert.equal(mounted.state().device,'gamepad');
 h.emit(h.win,'pointerdown',{pointerType:'mouse'});assert.equal(mounted.state().device,'gamepad');
 h.emit(h.win,'keydown',{code:'KeyA'});assert.equal(mounted.state().device,'keyboard');h.tick();assert.equal(mounted.state().device,'keyboard');
 p.axes=[0.8];h.tick();assert.equal(mounted.state().device,'gamepad');h.emit(h.win,'pointerdown',{pointerType:'touch'});assert.equal(mounted.state().device,'touch');h.tick();assert.equal(mounted.state().device,'touch');
 h.setPad(null);h.tick();assert.equal(mounted.state().device,'touch');mounted.dispose();
});
await test('停用或非標準mapping手把不提供誤導提示',()=>{
 const h=harness(),m=h.mountControlHints(h.input);h.setPad({...pad(),mapping:''});h.tick();assert.equal(m.state().device,'keyboard');h.setPad(pad());h.config.gamepad.enabled=false;h.tick();assert.equal(m.state().device,'keyboard');m.dispose();
});
await test('失焦／背景停止輪詢；BFCache恢復，最終離頁完整清理且冪等',()=>{
 const h=harness(),m=h.mountControlHints(h.input);h.focus(false);assert.equal(h.timers.size,0);h.focus(true);assert.equal(h.timers.size,1);
 h.doc.hidden=true;h.emit(h.doc,'visibilitychange');assert.equal(h.timers.size,0);h.doc.hidden=false;h.emit(h.doc,'visibilitychange');assert.equal(h.timers.size,1);
 h.emit(h.win,'pagehide',{persisted:true});assert.equal(h.timers.size,0);h.emit(h.win,'pageshow',{persisted:true});assert.equal(h.timers.size,1);
 let updates=0;m.subscribe(()=>updates++);h.config.keys.left=['KeyQ'];h.tick();assert.equal(updates,1);h.emit(h.win,'pagehide',{persisted:false});assert.equal(h.timers.size,0);h.emit(h.win,'pageshow');h.config.keys.left=['KeyZ'];h.tick();assert.equal(updates,1);m.dispose();
});
report.status=report.cases.every(r=>r.status==='PASS')?'PASS':'FAIL';report.completedAt=new Date().toISOString();await writeFile(path.join(root,'tools/dev-tests/horizon-controls-result.json'),JSON.stringify(report,null,2)+'\n');for(const c of report.cases)console.log(JSON.stringify(c));console.log(JSON.stringify({status:report.status,cases:report.cases.length}));process.exitCode=report.status==='PASS'?0:1;
