import { COOP_CITY_STAMP, COOP_VERSION, parseCoopRoom, validCoopCode, validCoopPose, type CoopPose, type CoopRoom, type CoopInput } from '../shared/nexus-coop';
export const COOP_RESUME_KEY = 'taipei-gp-city-coop-seat-v5';
export type CoopStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
interface Seat { endpoint: string; code: string; selfId: string; token: string }
export function coopEndpoint(config: string, location: Pick<Location, 'hostname' | 'protocol'>): string {
  try {
    if (config.trim()) { const url = new URL(config.trim()); if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return ''; url.pathname = '/coop'; return url.href; }
    if (location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname)) return `ws://${location.hostname}:4320/coop`;
  } catch { /* 顯示設定尚未就緒，不能猜測公開服務位址。 */ }
  return '';
}
export function coopInvite(href: string, code: string): string | null { if (!validCoopCode(code)) return null; try { const u = new URL('/', href); if (!['https:', 'http:'].includes(u.protocol)) return null; u.searchParams.set('coop', code); return u.href; } catch { return null; } }
export class NexusCoopClient {
  status: CoopStatus = 'idle'; room: CoopRoom | null = null; selfId = ''; message = '';motionRevision=0;
  private ws: WebSocket | null = null; private generation = 0; private wanted = false; private commandSeq = 0; private poseSeq = 0;
  private seat: Seat | null = null; private retry: ReturnType<typeof setTimeout> | null = null; private retryUntil = 0;
  private connecting: Promise<void> | null = null; private openCancel: (() => void) | null = null; private joiningType = '';
  private pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private joined: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private offset = 0;
  constructor(readonly endpoint: string, private changed: () => void, private relocate: (pose: CoopPose) => void, private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) { this.loadSeat(); }
  get resumable() { return !!this.seat && (this.status === 'idle' || this.status === 'closed'); }
  get rememberedCode() { return this.seat?.code ?? ''; }
  get retryRemainingMs(){return this.retryUntil?Math.max(0,this.retryUntil-Date.now()):0;}
  serverNow() { return Date.now() + this.offset; }
  private loadSeat() { try { const raw = this.storage?.getItem(COOP_RESUME_KEY); if (!raw || raw.length > 1500) return; const s = JSON.parse(raw) as Seat; if (s.endpoint === this.endpoint && validCoopCode(s.code) && /^[a-f0-9]{20}$/.test(s.selfId) && /^[a-f0-9]{64}$/.test(s.token)) this.seat = { ...s }; } catch {} }
  private saveSeat() { try { if (this.seat) this.storage?.setItem(COOP_RESUME_KEY, JSON.stringify(this.seat)); else this.storage?.removeItem(COOP_RESUME_KEY); } catch { /* 本次連線仍可玩，重開頁面可能無法續接。 */ } }
  connect(): Promise<void> {
    if (this.status === 'connected' && this.ws?.readyState === 1) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (!this.endpoint) return Promise.reject(new Error('合作服務尚未設定，請先設定對戰伺服器網址。'));
    this.wanted = true; const generation = ++this.generation; this.status = this.room ? 'reconnecting' : 'connecting'; this.changed();
    this.connecting = new Promise<void>((resolve, reject) => {
      let opened = false, settled = false;
      const socket = new WebSocket(this.endpoint); this.ws = socket;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (generation === this.generation) { this.connecting = null; this.openCancel = null; } if (error) reject(error); else resolve(); };
      this.openCancel = () => finish(new Error('已取消合作連線'));
      const timeout = setTimeout(() => { finish(new Error('合作服務尚未回應，可稍後重試。')); socket.close(); }, Math.min(7000,this.retryUntil?Math.max(1,this.retryUntil-Date.now()):7000));
      socket.addEventListener('message', event => {
        if (this.ws !== socket || generation !== this.generation || typeof event.data !== 'string' || event.data.length > 32 * 1024) return;
        let m: Record<string, unknown>; try { m = JSON.parse(event.data); if (!m || typeof m !== 'object' || Array.isArray(m)) return; } catch { return; }
        if (m.type === 'hello') {
          if (m.v !== COOP_VERSION || m.cityStamp !== COOP_CITY_STAMP) { this.wanted = false; finish(new Error('合作配送版本或城市資料不相容，請更新前後端。')); socket.close(); return; }
          opened = true; this.status = 'connected'; finish(); this.changed();
        } else if (opened) this.receive(m);
      });
      socket.addEventListener('close', () => {
        if (this.ws !== socket || generation !== this.generation) return;
        this.ws = null; this.connecting = null; finish(new Error('合作連線中斷'));
        this.rejectPending('連線中斷；取送指令沒有自動重送，請確認貨單後再試。');
        if (this.wanted && this.room && this.seat) { this.status = 'reconnecting'; if (!this.retryUntil) this.retryUntil = Date.now() + 28_000; this.message = '正在續接合作席位（最多28秒）；貨物保留30秒。'; this.scheduleReconnect(); }
        else this.status = 'closed'; this.changed();
      });
      socket.addEventListener('error', () => { if (!opened) { finish(new Error('無法連線至合作服務，請確認服務與來源設定。')); socket.close(); } });
    });
    return this.connecting;
  }
  private scheduleReconnect() {
    if (this.retry || !this.wanted) return;
    if (Date.now() >= this.retryUntil) { this.stopRetry(); this.message = '自動續接已逾時。可先手動續接；若席位已釋放，再用房間碼加入。'; this.changed(); return; }
    this.retry = setTimeout(() => { this.retry = null; if (!this.wanted || !this.seat) return;
      void this.connect().then(() => { if (this.wanted && this.seat) return this.resume(); }).catch(() => {
        if (!this.wanted || !this.seat) return;
        const socket=this.ws;this.ws=null;this.generation++;this.connecting=null;try{socket?.close();}catch{}
        this.status = 'reconnecting'; this.scheduleReconnect(); this.changed();
      });
    }, Math.min(1500, Math.max(1, this.retryUntil-Date.now())));
  }
  private receive(m: Record<string, unknown>) {
    if (m.type === 'welcome') {
      const room = parseCoopRoom(m.room);
      if (!room || m.v !== COOP_VERSION || m.cityStamp !== COOP_CITY_STAMP || typeof m.selfId !== 'string' || !room.players.some(p => p.id === m.selfId) || typeof m.token !== 'string' || !/^[a-f0-9]{64}$/.test(m.token) || !validCoopPose(m.relocation)) { this.disconnect(); this.message = '合作服務回傳無效席位資料，已中止。'; this.changed(); return; }
      this.room = room; this.selfId = m.selfId; this.offset = room.serverTime - Date.now(); this.seat = { endpoint: this.endpoint, code: room.code, selfId: this.selfId, token: m.token }; this.saveSeat();
      this.poseSeq=room.players.find(p=>p.id===this.selfId)!.ack;this.motionRevision++;
      this.retryUntil = 0; this.status = 'connected'; this.message = m.resumed ? '已續接原合作席位。' : '已加入合作房；每車一次運送一件，全部送達才完成。'; this.relocate(m.relocation);
      if (this.joined) { clearTimeout(this.joined.timer); this.joined.resolve(); this.joined = null; } this.joiningType=''; this.changed();
    } else if (m.type === 'room') {
      const room = parseCoopRoom(m.room); if (!room || !this.room || room.code !== this.room.code || !room.players.some(p => p.id === this.selfId)) return;
      if(room.serverTime<this.room.serverTime)return;if(room.runId!==this.room.runId){this.motionRevision++;this.poseSeq=room.players.find(p=>p.id===this.selfId)!.ack;}this.room = room; this.offset = room.serverTime - Date.now(); this.changed();
    } else if (m.type === 'relocated' && validCoopPose(m.pose) && this.room) { this.motionRevision++;this.relocate(m.pose); this.message = typeof m.message === 'string' ? m.message.slice(0, 180) : '位置已還原。'; this.changed(); }
    else if (m.type === 'ack' && typeof m.request === 'number') { const p = this.pending.get(m.request); if (p) { clearTimeout(p.timer); this.pending.delete(m.request); p.resolve(); } }
    else if (m.type === 'error') {
      this.message = typeof m.message === 'string' ? m.message.slice(0, 180) : '合作指令未完成。';
      const p = this.pending.get(Number(m.request)); if (p) { clearTimeout(p.timer); this.pending.delete(Number(m.request)); p.reject(new Error(this.message)); }
      if (this.joined) { const resumed=this.joiningType==='resume',message=this.message;clearTimeout(this.joined.timer); this.joined.reject(new Error(message)); this.joined = null;this.joiningType='';if(resumed){this.disconnect();this.message=message;} } this.changed();
    } else if (m.type === 'expired') { this.disconnect(); this.message = typeof m.message === 'string' ? m.message.slice(0, 180) : '合作房已結束。'; this.changed(); }
  }
  async enter(type: 'create' | 'join', name: string, vehicle: string, code = '',mode:'direct'|'relay'|'special'='direct') { if (this.room) throw new Error('請先離開目前合作房'); await this.connect(); await this.join({ type, name, vehicle, code,mode, v: COOP_VERSION, cityStamp: COOP_CITY_STAMP }); }
  async resume() { if (!this.seat) throw new Error('沒有可續接的合作席位'); await this.connect(); await this.join({ type: 'resume', ...this.seat, v: COOP_VERSION, cityStamp: COOP_CITY_STAMP }); }
  private join(m: Record<string, unknown>): Promise<void> {
    if (this.joined) return Promise.reject(new Error('合作進房進行中'));
    this.joiningType=String(m.type);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.joined = null;this.joiningType=''; reject(new Error('合作進房未收到回覆；請先離線後手動續接，避免建立重複房間。')); }, Math.min(8000,this.retryUntil?Math.max(1,this.retryUntil-Date.now()):8000)); this.joined = { resolve, reject, timer }; if (!this.send({ ...m, request: ++this.commandSeq })) { clearTimeout(timer); this.joined = null;this.joiningType=''; reject(new Error('合作連線尚未就緒')); } });
  }
  command(type: 'ready' | 'start' | 'pickup' | 'deliver' | 'release' | 'return' | 'again' | 'reserve' | 'cancel-reservation' | 'ping' | 'cancel-ping' | 'offer-handoff' | 'accept-handoff' | 'cancel-handoff' | 'quick' | 'ack-quick', fields: Record<string, unknown> = {}): Promise<void> {
    if (!this.room || this.status !== 'connected') return Promise.reject(new Error('請等待合作席位連線完成'));
    const request = ++this.commandSeq;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(request); reject(new Error('指令等待逾時，請先核對貨單狀態再重試。')); }, 5000); this.pending.set(request, { resolve, reject, timer }); if (!this.send({ ...fields, type, request })) { clearTimeout(timer); this.pending.delete(request); reject(new Error('指令尚未送出')); } });
  }
  input(input:CoopInput):number|null {if(!this.room||this.status!=='connected')return null;const seq=this.poseSeq+1;if(!this.send({type:'input',code:this.room.code,runId:this.room.runId,seq,...input}))return null;this.poseSeq=seq;return seq;}
  private send(value: unknown) { if (!this.ws || this.ws.readyState !== 1 || this.ws.bufferedAmount > 32 * 1024) return false; this.ws.send(JSON.stringify(value)); return true; }
  leave() { if (this.room) this.send({ type: 'leave', request: ++this.commandSeq }); this.disconnect(); }
  private rejectPending(message: string) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } this.pending.clear(); if (this.joined) { clearTimeout(this.joined.timer); this.joined.reject(new Error(message)); this.joined = null; } }
  disconnect() {
    this.wanted = false; this.retryUntil = 0; if (this.retry) clearTimeout(this.retry); this.retry = null;
    this.openCancel?.(); this.openCancel = null; this.connecting = null; this.generation++;
    const socket = this.ws; this.ws = null; try { socket?.close(1000, '離開合作配送'); } catch {}
    this.rejectPending('已離開合作連線');this.joiningType=''; this.room = null; this.selfId = ''; this.status = 'idle'; this.seat = null; this.saveSeat(); this.changed();
  }
  /** Stop transport while keeping the capability in this tab for an explicit retry. */
  stopRetry() { this.wanted = false;this.retryUntil=0; if (this.retry) clearTimeout(this.retry); this.retry = null;this.openCancel?.();this.openCancel=null;this.connecting=null;this.generation++;const socket=this.ws;this.ws=null;try{socket?.close();}catch{}this.rejectPending('已停止合作續接');this.joiningType='';this.status='closed';this.message='已停止自動續接，可手動重試或離房。';this.changed(); }
}
