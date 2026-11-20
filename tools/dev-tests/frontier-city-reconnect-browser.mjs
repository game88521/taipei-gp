import assert from 'node:assert/strict';
import {FrontierBrowserHarness,click,focus,set,protectedSave,layout} from './frontier-browser-harness.mjs';
const files=['src/frontier-city-reconnect.ts','shared/frontier-city-resume.ts','src/main.ts','shared/expedition-social.ts','server/expedition-social-service.mjs','src/expedition-social-client.ts','src/expedition-social-ui.ts','shared/expedition-duty.ts','server/expedition-duty-service.mjs','src/expedition-duty-client.ts','src/expedition-duty-ui.ts','tools/dev-tests/frontier-browser-harness.mjs'];
const h=new FrontierBrowserHarness('frontier-city-reconnect-browser',new URL(import.meta.url),files);let error;
const wait=async test=>{for(let n=0;n<400;n++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error('local service fixture wait timed out');};
async function protectedState(p){assert.equal(await p.evaluate(protectedSave),await p.evaluate('__frontierProtected'));}
async function dutyOpen(p){await focus(p);await p.evaluate('document.getElementById("atlas-modes").open=true');await click(p,'atlas-launch-crew');await p.until('__gp.expeditionDuty.opened',180000);}
async function dutyPanel(p){await focus(p);if(!await p.evaluate('__gp.expeditionDuty.opened'))await click(p,'expedition-duty-inspect');await p.until('__gp.expeditionDuty.opened');}
function holdWelcome(service,id,once){const original=service.send;let held=null,count=0;service.send=function(c,m){if(m.type==='welcome'&&m.selfId===id&&(!once||count===0)){count++;held={c,m};return;}return original.call(this,c,m);};return{get held(){return held;},restore(){service.send=original;}};}
try{
 await h.start(2);const[a,b]=h.pages,r=await h.pair();await h.startSocial();for(const p of[a,b])await click(p,'social-close');
 const socialId=await a.evaluate('__gp.expeditionSocial.client.selfId'),socialPlayer=r.players.get(socialId);
 await h.test('巡航真socket斷線自動續原席，連回先暫停且不送操控',async()=>{
  await focus(a);const oldToken=socialPlayer.token;socialPlayer.client.ws.terminate();await a.until('__gp.expeditionSocial.client.reconnectState.phase==="confirm"',15000);assert.equal(await a.evaluate('__gp.expeditionSocial.client.selfId'),socialId);assert.notEqual(socialPlayer.token,oldToken);assert.equal(r.players.size,2);assert.equal(await a.evaluate('__gp.state'),'paused');assert.equal(await a.evaluate('__gp.expeditionSocial.client.controlGated'),true);
  const sent=await a.evaluate('__frontierWire.filter(m=>m.type==="input").length');assert.equal(await a.evaluate('__gp.expeditionSocial.client.input({steer:1,throttle:true,brake:false,handbrake:true,active:true})'),null);assert.equal(await a.evaluate('__frontierWire.filter(m=>m.type==="input").length'),sent);await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal(await a.evaluate('__gp.expeditionSocial.opened'),true);await protectedState(a);return{sameSeat:true,tokenRotated:true,confirmationRequired:true};
 });
 await h.test('巡航確認在三尺寸可達，明確確認後才回到駕駛',async()=>{
  await layout(a,'social-reconnect','#social-reconnect',h.report,h.evidence);await click(a,'social-reconnect-confirm');await a.until('__gp.expeditionSocial.client.controlGated===false&&!__gp.expeditionSocial.opened');assert.equal(await a.evaluate('__gp.state'),'free');await protectedState(a);
 });
 await h.test('明示丟失第一個welcome，真四秒期限後同grant重試不再次rotate',async()=>{
  h.report.limitations.push('welcome遺失／取消測試以本機service.send攔截welcome的明示網路故障fixture驗證，仍使用真WS、權威服務與實際重試計時；沒有外網斷訊測試。');
  await focus(a);const hold=holdWelcome(h.app.socialService,socialId,true);try{socialPlayer.client.ws.terminate();await wait(()=>!!hold.held);const firstToken=hold.held.m.token;await a.until('__gp.expeditionSocial.client.reconnectState.phase==="confirm"',15000);assert.equal(socialPlayer.token,firstToken);assert.ok(await a.evaluate('__gp.expeditionSocial.client.reconnectState.attempts>=2'));await click(a,'social-reconnect-confirm');await a.until('!__gp.expeditionSocial.client.controlGated');await protectedState(a);}finally{hold.restore();}
 });
 await h.test('巡航等welcome中取消不自動再試，原期限內可手動續原grant再確認',async()=>{
  await focus(a);const hold=holdWelcome(h.app.socialService,socialId,false);try{socialPlayer.client.ws.terminate();await wait(()=>!!hold.held);await a.until('__gp.expeditionSocial.client.reconnectState.phase==="connecting"');await click(a,'social-reconnect-cancel');await a.until('__gp.expeditionSocial.client.reconnectState.phase==="cancelled"');}finally{hold.restore();}
  await wait(()=>!socialPlayer.client);const attempts=await a.evaluate('__frontierWire.filter(m=>m.type==="resume").length');await a.evaluate('new Promise(r=>setTimeout(r,700))');assert.equal(await a.evaluate('__frontierWire.filter(m=>m.type==="resume").length'),attempts);assert.equal(await a.evaluate('__gp.state'),'paused');
  // A transient typed error must leave the real UI's private seat available.
  const service=h.app.socialService,original=service.receive,saved=await a.evaluate('sessionStorage.getItem("taipei-gp-expedition-social-seat-v1")');let busyFixture=false;
  service.receive=function(c,m,now){if(m.type==='resume'&&m.selfId===socialId&&!busyFixture){busyFixture=true;throw Object.assign(Error('原席位仍在另一條連線，請等候釋放'),{code:'SEAT_BUSY'});}return original.call(this,c,m,now);};
  try{await click(a,'social-resume');await a.until('!document.getElementById("social-resume").disabled&&document.getElementById("social-status").textContent.includes("等候釋放")');assert.equal(busyFixture,true);assert.equal(await a.evaluate('__gp.expeditionSocial.client.resumable'),true);assert.equal(await a.evaluate('sessionStorage.getItem("taipei-gp-expedition-social-seat-v1")'),saved);assert.equal(await a.evaluate('__gp.state'),'paused');}finally{service.receive=original;}
  await click(a,'social-resume');await a.until('__gp.expeditionSocial.client.reconnectState.phase==="confirm"',10000);assert.equal(await a.evaluate('__gp.expeditionSocial.client.selfId'),socialId);await click(a,'social-reconnect-confirm');await a.until('!__gp.expeditionSocial.client.controlGated');await protectedState(a);
 });
 await h.test('巡航socket仍OPEN卻無伺服器狀態時，自動停止並續接而不等TCP關閉',async()=>{
  await focus(a);const service=h.app.socialService,original=service.send,oldSocket=socialPlayer.client.ws;assert.equal(oldSocket.readyState,1);service.send=function(c,m){if(c.player?.id===socialId&&m.type==='room')return;return original.call(this,c,m);};let pongCount=0;
  const pongs=setInterval(()=>{if(socialPlayer.client){original.call(service,socialPlayer.client,{type:'pong',sentAt:Date.now(),serverTime:Date.now()});pongCount++;}},200);
  try{await a.until('__gp.expeditionSocial.client.reconnectState.phase!=="idle"',12000);assert.equal(await a.evaluate('__gp.expeditionSocial.client.controlGated'),true);assert.equal(await a.evaluate('__gp.state'),'paused');assert.ok(pongCount>=5);}finally{clearInterval(pongs);service.send=original;}
  await a.until('__gp.expeditionSocial.client.reconnectState.phase==="confirm"',15000);assert.equal(oldSocket.readyState,3);assert.equal(await a.evaluate('__gp.expeditionSocial.client.selfId'),socialId);await click(a,'social-reconnect-confirm');await a.until('!__gp.expeditionSocial.client.controlGated');await protectedState(a);return{packetSilenceFixture:true,testDidNotTerminateSocket:true};
 });
 for(const p of[b,a])await h.leaveSocial(p);
 let duty;
 await dutyOpen(a);await click(a,'expedition-duty-create');await a.until('__gp.expeditionDuty.client.room?.phase==="lobby"',180000);const code=await a.evaluate('__gp.expeditionDuty.client.room.code');duty=h.app.dutyService.rooms.get(code);await dutyOpen(b);await set(b,'expedition-duty-code',code);await click(b,'expedition-duty-join');await b.until('__gp.expeditionDuty.client.room?.players.length===2',180000);for(const p of[a,b]){await dutyPanel(p);await click(p,'expedition-duty-ready');}await focus(a);await a.until('!document.getElementById("expedition-duty-start").disabled');await click(a,'expedition-duty-start');for(const p of[a,b])await click(p,'expedition-duty-close');
 const dutyId=await b.evaluate('__gp.expeditionDuty.client.selfId'),technician=duty.players.get(dutyId);
 await h.test('救援協助者真斷線續接原職責，確認前不送絞盤或駕駛',async()=>{
  await focus(b);const oldToken=technician.token;technician.client.ws.terminate();await b.until('__gp.expeditionDuty.client.reconnectState.phase==="confirm"',15000);assert.notEqual(technician.token,oldToken);assert.equal(technician.role,'technician');assert.equal(duty.players.size,2);assert.equal(await b.evaluate('__gp.expeditionDuty.client.controlGated'),true);assert.equal(await b.evaluate('__gp.state'),'paused');const sent=await b.evaluate('__frontierWire.filter(m=>m.type==="input"||m.type==="operate"||m.type==="action").length');await b.evaluate('__gp.expeditionDuty.client.operate("winch",1,1)');assert.equal(await b.evaluate('__frontierWire.filter(m=>m.type==="input"||m.type==="operate"||m.type==="action").length'),sent);await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal(await b.evaluate('__gp.expeditionDuty.opened'),true);await protectedState(b);
 });
 await h.test('救援確認按鈕在手機三尺寸可達，確認釋放舊操控再繼續',async()=>{
  await layout(b,'duty-reconnect','#expedition-duty-overlay',h.report,h.evidence);await click(b,'expedition-duty-reconnect-confirm');await b.until('!__gp.expeditionDuty.client.controlGated&&!__gp.expeditionDuty.opened');assert.equal(await b.evaluate('__gp.state'),'free');assert.equal(duty.held.kind,'stop');await protectedState(b);
 });
 await h.test('救援welcome遺失後同grant恢復，token只輪替一次',async()=>{
  await focus(b);const hold=holdWelcome(h.app.dutyService,dutyId,true);try{technician.client.ws.terminate();await wait(()=>!!hold.held);const token=hold.held.m.token;await b.until('__gp.expeditionDuty.client.reconnectState.phase==="confirm"',15000);assert.equal(technician.token,token);assert.ok(await b.evaluate('__gp.expeditionDuty.client.reconnectState.attempts>=2'));await click(b,'expedition-duty-reconnect-confirm');await b.until('!__gp.expeditionDuty.client.controlGated');await protectedState(b);}finally{hold.restore();}
 });
 await h.test('救援等welcome中取消後不重試，手動續接仍需明確恢復',async()=>{
  await focus(b);const hold=holdWelcome(h.app.dutyService,dutyId,false);try{technician.client.ws.terminate();await wait(()=>!!hold.held);await b.until('__gp.expeditionDuty.client.reconnectState.phase==="connecting"');await click(b,'expedition-duty-reconnect-cancel');await b.until('__gp.expeditionDuty.client.reconnectState.phase==="cancelled"');}finally{hold.restore();}
  await wait(()=>!technician.client);const sent=await b.evaluate('__frontierWire.filter(m=>m.type==="resume").length');await b.evaluate('new Promise(r=>setTimeout(r,700))');assert.equal(await b.evaluate('__frontierWire.filter(m=>m.type==="resume").length'),sent);await click(b,'expedition-duty-resume');await b.until('__gp.expeditionDuty.client.reconnectState.phase==="confirm"',10000);assert.equal(await b.evaluate('__gp.expeditionDuty.client.selfId'),dutyId);await click(b,'expedition-duty-reconnect-confirm');await b.until('!__gp.expeditionDuty.client.controlGated');await protectedState(b);
 });
 await h.test('救援OPEN連線狀態停更也釋放作業並安全續接',async()=>{
  await focus(b);const service=h.app.dutyService,original=service.send,oldSocket=technician.client.ws;assert.equal(oldSocket.readyState,1);service.send=function(c,m){if(c.player?.id===dutyId&&['room','state'].includes(m.type))return;return original.call(this,c,m);};let pongCount=0;
  const pongs=setInterval(()=>{if(technician.client){original.call(service,technician.client,{type:'pong',sentAt:Date.now(),serverTime:Date.now()});pongCount++;}},200);
  try{await b.until('__gp.expeditionDuty.client.reconnectState.phase!=="idle"',12000);assert.equal(await b.evaluate('__gp.expeditionDuty.client.controlGated'),true);assert.equal(await b.evaluate('__gp.state'),'paused');assert.ok(pongCount>=5);}finally{clearInterval(pongs);service.send=original;}
  await b.until('__gp.expeditionDuty.client.reconnectState.phase==="confirm"',15000);assert.equal(oldSocket.readyState,3);assert.equal(await b.evaluate('__gp.expeditionDuty.client.selfId'),dutyId);await click(b,'expedition-duty-reconnect-confirm');await b.until('!__gp.expeditionDuty.client.controlGated');assert.equal(duty.held.kind,'stop');await protectedState(b);return{packetSilenceFixture:true,testDidNotTerminateSocket:true};
 });
 for(const p of[b,a]){await dutyPanel(p);await click(p,'expedition-duty-cancel');await click(p,'expedition-duty-close');await protectedState(p);}
}catch(e){error=e;}finally{await h.finish(error);}
