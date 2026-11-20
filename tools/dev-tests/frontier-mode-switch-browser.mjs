// Rex <game88521@gmail.com>. Actual menu path from a borrowed rally car to legacy solo practice.
import assert from 'node:assert/strict';
import {FrontierBrowserHarness,focus,click,protectedSave} from './frontier-browser-harness.mjs';
const h=new FrontierBrowserHarness('frontier-mode-switch-browser',new URL(import.meta.url),['src/main.ts','src/frontier-rally-ui.ts','src/frontier-lazy-city.ts','src/tt-practice.ts','tools/dev-tests/frontier-browser-harness.mjs']);let error;
try{
 await h.start(1);const p=h.pages[0];
 await h.test('真UI借拉力車後從P選單開原分段練習，先離房還車再切換',async()=>{
  await focus(p);await p.evaluate('document.getElementById("atlas-modes").open=true');await click(p,'atlas-launch-friend-rally');await p.until('!!__gp.frontierRally?.opened',180000);await click(p,'frontier-rally-create');await p.until('__gp.frontierRally.active',180000);await click(p,'frontier-rally-close');await p.until('__gp.state==="free"');assert.equal(await p.evaluate(protectedSave),await p.evaluate('__frontierProtected'));
  await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'p',code:'KeyP',windowsVirtualKeyCode:80});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'p',code:'KeyP',windowsVirtualKeyCode:80});await p.until('__gp.state==="paused"');
  await p.evaluate('document.querySelector(".m-tabs [data-tab=records]").click();document.getElementById("tt-practice").open=true');await click(p,'practice-start');await p.until('__gp.state==="race"');assert.equal(await p.evaluate('__gp.frontierRally.active'),false,'legacy solo practice must release the borrowed rally car first');assert.equal(await p.evaluate('__gp.frontierRally.client.room'),null);await h.shot(p,'solo-practice-after-return.png');await click(p,'practice-exit-button');return{nativePause:true,recordsMenu:true,legacyPractice:true,borrowedRoomReleased:true};
 });
}catch(e){error=e;}finally{await h.finish(error);}
