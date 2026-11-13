import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export class CdpConnection {
  constructor(url, label, report) {
    this.ws = new WebSocket(url); this.label = label; this.report = report; this.sequence = 0; this.pending = new Map(); this.handlers = new Map(); this.closing = false;
    this.opened = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        pending.command.completedAt = new Date().toISOString();
        if (message.error) pending.reject(new Error(`${label}: ${JSON.stringify(message.error)}`)); else pending.resolve(message.result);
      } else for (const handler of this.handlers.get(message.method) ?? []) Promise.resolve(handler(message.params)).catch(error => { if (!this.closing) report.exceptions.push({ page: label, event: message.method, error: String(error) }); });
    };
    this.ws.onclose = () => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`${label}: CDP disconnected`)); } this.pending.clear(); };
  }
  on(name, handler) { const handlers = this.handlers.get(name) ?? []; handlers.push(handler); this.handlers.set(name, handlers); }
  async send(method, params = {}) {
    await this.opened;
    return new Promise((resolve, reject) => {
      const id = ++this.sequence, startedAt = new Date().toISOString();
      const command = { label: this.label, id, method, startedAt, params };
      (this.report.lastCdpCommands ??= {})[this.label] = command;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        command.timedOutAt = new Date().toISOString();
        (this.report.cdpTimeouts ??= []).push(command);
        reject(new Error(`${this.label}: ${method} timeout${params.expression ? `: ${params.expression}` : ''}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer, command }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(`${this.label}: ${JSON.stringify(response.exceptionDetails)}`);
    return response.result.value;
  }
  async until(expression, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await this.evaluate(expression); if (value) return value; await delay(80); }
    throw new Error(`${this.label}: condition timeout: ${expression}`);
  }
  close() { this.closing = true; this.ws.close(); }
}

export function instrument(origin, endpoint) {
  return `(() => {
    if(location.origin!==${JSON.stringify(origin)})return;
    const key='taipei-gp-v2',seed=JSON.stringify({schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{},taxi:{money:12345,trips:3}});
    if(!sessionStorage.getItem('__mp-test-seeded')){localStorage.setItem(key,seed);localStorage.setItem('__mp-test-wallet','12345');sessionStorage.setItem('__mp-test-seeded','1')}
    window.__mpInitialStorage=Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]));
    window.__mpStorageWrites=[];window.__mpWire=[];window.__mpSockets=[];window.__mpSocketCount=0;
    for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(this===localStorage)window.__mpStorageWrites.push({method,args});return original.apply(this,args)}}
    const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){if(String(url)!==${JSON.stringify(endpoint)})throw new Error('測試拒絕非本機WS:'+url);super(url,protocols);window.__mpSocketCount++;window.__mpSockets.push(this);const send=this.send.bind(this);this.send=data=>{try{const m=JSON.parse(data);if(m.type==='input'){window.__mpWire.push({at:Date.now(),...m});if(__mpWire.length>5000)__mpWire.shift()}}catch{}return send(data)}}};
  })()`;
}
export async function snapshot(page) {
  return page.evaluate(`(() => {const c=__mp.client,r=c.room,m=r?.players.find(p=>p.id===c.selfId);return{status:c.status,id:c.selfId,code:r?.code,phase:r?.phase,matchId:r?.matchId,startAt:r?.startAt,serverTime:r?.serverTime,me:m,models:__mp.scene.cars.size,focus:document.hasFocus(),active:document.activeElement.id}})()`);
}
export async function focus(page) { await page.send('Page.bringToFront'); await page.until('document.hasFocus()', 15000); }
export async function click(page, id) {
  await page.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center',inline:'nearest'})`);
  const point = await page.evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();if(e.disabled||e.hidden)throw new Error('button unavailable:'+e.id);const x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)?.closest('button,a')?.id}})()`);
  assert.equal(point.hit, id, `${id} must be reachable`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
export async function key(page, code, down) {
  const codes = { ArrowLeft: 37, ArrowRight: 39, ArrowDown: 40, Space: 32 };
  await page.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key: code === 'Space' ? ' ' : code, code, windowsVirtualKeyCode: codes[code] });
}
export async function layout(page, stage, section, report, evidence) {
  for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    const result = await page.evaluate(`(() => {window.scrollTo(0,0);const ids=[...document.querySelectorAll(${JSON.stringify(section + ' button, ' + section + ' input, ' + section + ' select')})].filter(e=>e.getClientRects().length&&!e.hidden).map(e=>e.id);const controls=ids.map(id=>{const e=document.getElementById(id);e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===e||e.contains(hit))}});return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,controls}})()`);
    assert.ok(result.documentWidth <= width + 1, `${stage} overflow ${JSON.stringify(result)}`); assert.ok(result.controls.length > 0);
    for (const control of result.controls) {
      assert.ok(control.width >= 44 && control.height >= 44, `${stage} target ${JSON.stringify(control)}`);
      assert.ok(control.left >= -1 && control.right <= width + 1 && control.top >= -1 && control.bottom <= height + 1, `${stage} inaccessible ${JSON.stringify(control)}`);
      assert.equal(control.reachable, true, `${stage} covered ${JSON.stringify(control)}`);
    }
    report.layouts.push({ stage, ...result });
    const file = `${stage}-${width}x${height}.png`, shot = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidence, file), Buffer.from(shot.data, 'base64')); report.screenshots.push(file);
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await page.evaluate('window.scrollTo(0,0)');
}
