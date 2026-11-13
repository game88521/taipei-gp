import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from '../../server/node_modules/ws/wrapper.mjs';

export const ORIGIN = 'http://127.0.0.1:4317';

/** 使用與原 BOT 相同的觀察式駕駛；只產生方向／煞車，不改車況或圈數。 */
export function drivingInput(car, track) {
  const i = car.pos.i;
  const j = (i + Math.round((8 + car.v * 0.45) / track.ds)) % track.N;
  let error = Math.atan2(track.px[j] - car.x, track.pz[j] - car.z) - car.h;
  error = Math.atan2(Math.sin(error), Math.cos(error));
  const ahead = (i + Math.round((car.v * 0.5) / track.ds)) % track.N;
  return { steer: Math.max(-1, Math.min(1, -error * 2.5)), brake: car.v > track.vTarget[ahead] + 1 };
}

export class WireClient {
  constructor(url, origin = ORIGIN) {
    this.ws = new WebSocket(url, { origin });
    this.messages = [];
    this.waiters = new Set();
    this.closed = false;
    this.closeCode = null;
    this.error = null;
    this.ws.on('error', (error) => { this.error = error; });
    this.ws.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) {
        this.waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(message);
      }
    });
    this.ws.on('close', (code) => {
      this.closed = true; this.closeCode = code;
      for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('WebSocket closed before expected message')); }
      this.waiters.clear();
    });
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return this;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('WebSocket open timeout')); }, 3000);
      const cleanup = () => { clearTimeout(timer); this.ws.off('open', opened); this.ws.off('error', failed); };
      const opened = () => { cleanup(); resolve(); };
      const failed = (error) => { cleanup(); reject(error); };
      this.ws.once('open', opened); this.ws.once('error', failed);
    });
    return this;
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.messages.length; }
  take(predicate, after = 0) { return this.messages.slice(after).find(predicate); }
  async until(predicate, after = 0, timeout = 3000) {
    const found = this.take(predicate, after);
    if (found) return found;
    assert.equal(this.closed, false, 'client must remain connected while waiting');
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`Expected WebSocket message within ${timeout}ms; recent=${JSON.stringify(this.messages.slice(-3))}`)); }, timeout);
      this.waiters.add(waiter);
    });
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const completion = this.waitClosed(1500).catch(() => { this.ws.terminate(); });
    this.ws.close();
    await completion;
  }
  async waitClosed(timeout = 3000) {
    if (this.closed) return this.closeCode;
    return new Promise((resolve, reject) => {
      const closed = (code) => { clearTimeout(timer); resolve(code); };
      const timer = setTimeout(() => { this.ws.off('close', closed); reject(new Error(`WebSocket did not close within ${timeout}ms`)); }, timeout);
      this.ws.once('close', closed);
    });
  }
}

export async function settle() {
  // 讓真本機 socket 送入伺服器，仍不等待遊戲模擬秒數。
  await delay(3);
}
