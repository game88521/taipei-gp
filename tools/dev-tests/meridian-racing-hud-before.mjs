// Rex <game88521@gmail.com>. Historical pre-fix computed styles; the full race failure screenshot is retained separately.
import assert from 'node:assert/strict';
import {FrontierBrowserHarness,ORIGIN} from './frontier-browser-harness.mjs';
const h=new FrontierBrowserHarness('meridian-racing-hud-before',new URL(import.meta.url),['src/meridian-racing-ui.ts','src/meridian-racing.css']);let error;
try{
 await h.start(1);const p=h.pages[0];await p.send('Page.navigate',{url:ORIGIN+'/multiplayer.html'});await p.until('!!window.__mp?.ready&&!!document.getElementById("mp-meridian-live")',180000);
 await h.test('修前真DOM樣式重現：Meridian普通文流與fixed場景的層級缺口',async()=>{
  const styles=await p.evaluate(`(()=>{const describe=id=>{const e=document.getElementById(id),s=getComputedStyle(e),r=e.getBoundingClientRect();return{id,hidden:e.hidden,parent:e.parentElement.id,position:s.position,zIndex:s.zIndex,display:s.display,left:r.left,top:r.top,width:r.width,height:r.height};};return{live:describe('mp-meridian-live'),scene:describe('mp-scene'),information:describe('mp-race-information')};})()`);
  assert.equal(styles.live.position,'static');assert.equal(styles.live.zIndex,'auto');assert.equal(styles.live.parent,'mp-hud');assert.equal(styles.scene.position,'fixed');
  h.report.scope='Computed styles are from the real pre-fix page in its initial no-room state; hidden live geometry is not a racing geometry assertion.';
  h.report.priorRaceFailure='tools/dev-tests/meridian-racing-browser-evidence-1795409233307/report.json';h.report.priorRaceScreenshot='tools/dev-tests/meridian-racing-browser-evidence-1795409233307/failure.png';h.report.reproducedPresentationDefect=true;
  return styles;
 });
}catch(e){error=e;}finally{await h.finish(error);}
