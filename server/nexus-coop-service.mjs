import { randomBytes } from 'node:crypto';
import { COOP_VERSION, COOP_URGENT_MS, COOP_CITY_STAMP, COOP_STATIONS, COOP_MAX_PLAYERS, COOP_SESSION_MS, COOP_GRACE_MS, COOP_DWELL_MS, COOP_VEHICLES, COOP_RESERVATION_MS, COOP_PING_MS, COOP_RELAY_STATION, COOP_HANDOFF_MS, validCoopCode, coopNear } from '../shared/nexus-coop.ts';
import {FreeCar} from './summit-city-physics.mjs';
import {realCityWorld} from './summit-city-race-service.mjs';
import {COOP_QUICK_PHRASES,COOP_QUICK_MS,COOP_QUICK_COOLDOWN_MS,COOP_QUICK_LIMIT} from '../shared/odyssey-coop.ts';

const OPEN = 1, ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nameOf = v => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 20 && !/[\x00-\x1f\x7f]/.test(v) ? v.trim() : null;
const spawnPose = () => ({ x: COOP_STATIONS[0].x, z: COOP_STATIONS[0].z, y: COOP_STATIONS[0].y, h: COOP_STATIONS[0].h, speed: 0, driving: false });
const idle=()=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
const carPhysics=p=>Object.fromEntries(['vx','vz','w','vy','steer','pitch','roll'].map(k=>[k,p.car[k]]));
/** Both driving and freight are simulated here. The client sends controls, never positions. */
export class NexusCoopService {
  constructor(options = {}) {
    this.now = options.now ?? Date.now; this.maxClients = options.maxClients ?? 64; this.maxRooms = options.maxRooms ?? 16;
    this.clients = new Set(); this.rooms = new Map(); this.lastBroadcast = 0; this.closed = false;this.worldFactory=options.worldFactory??realCityWorld;this.worldRef=null;
  }
  world(){return this.worldRef??=this.worldFactory();}
  place(player,where=COOP_STATIONS[0]){const world=this.world();FreeCar.surface=world.surfaceAt;player.car.spec=world.spec(player.vehicle);player.car.place(where.x,where.z,where.h,where.y);player.car.y=where.y;player.pose={...where,h:Math.atan2(Math.sin(where.h),Math.cos(where.h)),speed:0,driving:false};player.input=idle();player.queue=[];player.received=player.ack;player.dwellStation='';player.dwellAt=this.now();player.poseAt=this.now();}
  send(client, message) { if (client.ws.readyState === OPEN && client.ws.bufferedAmount < 192 * 1024) { try { client.ws.send(JSON.stringify(message)); } catch { client.ws.terminate?.(); } } else if (client.ws.bufferedAmount >= 192 * 1024) client.ws.terminate?.(); }
  error(client, message, request = null) { this.send(client, { type: 'error', message, request }); }
  accept(ws) {
    if (this.closed || this.clients.size >= this.maxClients) { ws.close(1013, '合作配送連線已滿'); return; }
    const now = this.now(), client = { ws, player: null, room: null, alive: true, messages: 0, windowAt: now, commandSeq: 0, poseSeq: -1, lastPoseAt: -Infinity, lastSeen: now, lastErrorAt: -Infinity };
    this.clients.add(client);
    ws.on('message', data => this.receive(client, data)); ws.on('close', () => this.disconnect(client)); ws.on('error', () => this.disconnect(client)); ws.on('pong', () => { client.alive = true; });
    this.send(client, { type: 'hello', v: COOP_VERSION, cityStamp: COOP_CITY_STAMP, serverTime: now });
  }
  snapshot(room) {
    const now = this.now(); this.pruneDispatch(room, now);
    return { code: room.code, hostId: room.hostId, round: room.round, runId: room.runId, phase: room.phase, reason: room.reason, startedAt: room.startedAt, endsAt: room.endsAt,
      mode:room.mode,players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, vehicle: p.vehicle, connected: !!p.connection, ready: p.ready, pose: { ...p.pose },physics:carPhysics(p),ack:p.ack, cargo: p.cargo, delivered: p.delivered, points: room.mode==='special'?room.cargo.filter(c=>c.state==='delivered'&&c.owner===p.id).reduce((n,c)=>n+c.score,0):p.delivered * 100 })),
      cargo: room.cargo.map(c => ({ ...c })), delivered: room.cargo.filter(c => c.state === 'delivered').length, points: room.cargo.filter(c => c.state === 'delivered').reduce((n,c)=>n+(room.mode==='special'?c.score:100),0), serverTime: now, dispatch: structuredClone(room.dispatch) };
  }
  pruneDispatch(room, now = this.now()) {
    room.dispatch ??= { reservations: [], pings: [] };
    room.dispatch.reservations = room.dispatch.reservations.filter(r => r.expiresAt > now && room.players.get(r.playerId)?.connection && !room.players.get(r.playerId).cargo && room.cargo.some(c => c.id === r.cargoId && c.state === 'waiting') && room.phase !== 'finished');
    room.dispatch.pings = room.dispatch.pings.filter(r => r.expiresAt > now && room.players.get(r.playerId)?.connection);
    room.dispatch.quick = (room.dispatch.quick ?? []).filter(m => room.phase === 'running' && m.expiresAt > now && room.players.get(m.from)?.connection && (m.to === null || room.players.get(m.to)?.connection));
    for (const m of room.dispatch.quick) m.acks = m.acks.filter(id => room.players.get(id)?.connection);
    for(const cargo of room.cargo)if(cargo.offer&&(cargo.offer.expiresAt<=now||room.phase!=='running'||!room.players.get(cargo.owner)?.connection||!room.players.get(cargo.offer.to)?.connection||room.players.get(cargo.offer.to)?.cargo))cargo.offer=null;
  }
  clearDispatch(room, id) { room.dispatch ??= { reservations: [], pings: [] }; room.dispatch.reservations = room.dispatch.reservations.filter(r => r.playerId !== id); room.dispatch.pings = room.dispatch.pings.filter(r => r.playerId !== id); }
  broadcast(room) { const message = { type: 'room', room: this.snapshot(room) }; for (const p of room.players.values()) if (p.connection) this.send(p.connection, message); }
  cargoFor(round,mode='direct') { return COOP_STATIONS.slice(1).filter(s=>mode!=='relay'||s.id!==COOP_RELAY_STATION.id).map((s, i) => ({ id: `cargo-${round}-${i + 1}`, destination: s.id, state: 'waiting', owner: null,leg:mode==='relay'?'to-relay':'direct',relayFrom:null,offer:null,...mode==='special'?{kind:['urgent','urgent','fragile','fragile','standard','standard'][i],deadlineAt:null,integrity:100,score:null}:{} })); }
  newCode() { for (let attempt = 0; attempt < 30; attempt++) { const code = [...randomBytes(6)].map(b => ALPHABET[b % ALPHABET.length]).join(''); if (!this.rooms.has(code)) return code; } throw new Error('房間碼暫時用盡'); }
  bind(client, room, player, resumed = false) {
    const previous = player.connection;
    player.connection = client; player.token = randomBytes(32).toString('hex'); player.disconnectedAt = null; player.dwellStation = ''; player.dwellAt = this.now(); player.poseAt = this.now();
    client.player = player; client.room = room; client.poseSeq = -1; client.lastPoseAt = -Infinity;
    player.input=idle();player.queue=[];player.received=player.ack;player.lastInputAt=this.now();
    if (previous && previous !== client) { previous.player = null; previous.room = null; previous.ws.close(4001, '席位已在另一個連線續接'); }
    this.send(client, { type: 'welcome', v: COOP_VERSION, cityStamp: COOP_CITY_STAMP, selfId: player.id, token: player.token, resumed, room: this.snapshot(room), relocation: { ...player.pose } });
    this.broadcast(room);
  }
  newPlayer(name, vehicle) {const p={ id: randomBytes(10).toString('hex'), name, vehicle, token: '', connection: null, disconnectedAt: null, pose: spawnPose(), poseAt: this.now(), ready: false, cargo: null, delivered: 0, dwellStation: '', dwellAt: this.now(),car:new FreeCar(),input:idle(),queue:[],received:0,ack:0,lastInputAt:this.now() };this.place(p);return p; }
  receive(client, bytes) {
    if (!this.clients.has(client)) return;
    const now = this.now();
    if (now - client.windowAt >= 1000) { client.windowAt = now; client.messages = 0; }
    if (++client.messages > 90 || bytes.length > 4096) { client.ws.close(1008, '合作配送訊息過多或過大'); return; }
    let m; try { m = JSON.parse(String(bytes)); } catch { this.error(client, '無法讀取合作配送訊息'); return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') { this.error(client, '合作配送訊息格式錯誤'); return; }
    client.lastSeen = now;
    if (m.type === 'position') { this.error(client,'合作v4只接受操控輸入，不接受位置或車況'); return; }
    if (m.type === 'input') { this.input(client, m); return; }
    if (!Number.isSafeInteger(m.request) || m.request <= 0 || m.request > 1e9) { this.error(client, '合作配送指令缺少序號'); return; }
    if (m.request <= client.commandSeq) { this.error(client, '重複或過期指令未執行', m.request); return; }
    client.commandSeq = m.request;
    try { this.command(client, m); } catch { this.error(client, '合作配送指令無法完成，請重新確認房間', m.request); }
  }
  command(client, m) {
    const fail = text => this.error(client, text, m.request), now = this.now();
    if (['create', 'join', 'resume'].includes(m.type)) {
      if (client.room) { fail('請先離開目前房間'); return; }
      if (m.v !== COOP_VERSION || m.cityStamp !== COOP_CITY_STAMP) { fail('合作配送版本或城市資料不同，請更新前後端後再試'); return; }
      if (m.type === 'resume') {
        if (!validCoopCode(m.code) || typeof m.token !== 'string' || !/^[a-f0-9]{64}$/.test(m.token) || typeof m.selfId !== 'string') { fail('續接資料無效'); return; }
        const room = this.rooms.get(m.code), p = room?.players.get(m.selfId);
        if (!p || p.token !== m.token || p.disconnectedAt !== null && now - p.disconnectedAt > COOP_GRACE_MS) { fail('合作席位已失效，請用房間碼重新加入'); return; }
        this.bind(client, room, p, true); return;
      }
      const name = nameOf(m.name);
      if (!name || !COOP_VEHICLES.includes(m.vehicle)) { fail('請輸入1～20字暱稱，並選擇有效車款'); return; }
      let room;
      if (m.type === 'create') {
        if (this.rooms.size >= this.maxRooms) { fail('合作房間已滿，請稍後再試'); return; }
        if(m.mode!==undefined&&!['direct','relay','special'].includes(m.mode)){fail('合作任務種類無效');return;}const mode=m.mode??'direct';const code = this.newCode(); room = { code, hostId: '', players: new Map(), mode,phase: 'lobby', round: 0, runId: randomBytes(12).toString('hex'), reason: '', cargo: this.cargoFor(0,mode), startedAt: null, endsAt: null, lastActivity: now,simAt:now };
        this.rooms.set(code, room);
      } else {
        if (!validCoopCode(m.code)) { fail('請輸入六碼合作房間碼'); return; }
        room = this.rooms.get(m.code);
        if (!room) { fail('找不到合作房間，房間可能已結束'); return; }
        if (room.players.size >= COOP_MAX_PLAYERS) { fail('合作房間已滿（斷線席位保留30秒）'); return; }
        if (room.phase === 'finished') { fail('這輪已結算，請房主開新一輪後再加入'); return; }
      }
      const player = this.newPlayer(name, m.vehicle); room.players.set(player.id, player); if (!room.hostId) room.hostId = player.id;
      room.lastActivity = now; this.bind(client, room, player); return;
    }
    const room = client.room, p = client.player;
    if (!room || !p || p.connection !== client) { fail('請先建立或加入合作房間'); return; }
    room.lastActivity = now;
    this.pruneDispatch(room);
    if (m.type === 'leave') { this.removePlayer(room, p); client.player = null; client.room = null; this.send(client, { type: 'left', request: m.request }); return; }
    if (m.type === 'quick' || m.type === 'ack-quick') {
      if (room.phase !== 'running' || now >= room.endsAt) { this.finishIfDue(room); fail('配送進行中才能使用快捷通訊'); return; }
      if (m.type === 'quick') {
        if (Object.keys(m).some(k => !['type','request','phrase','to','cargoId'].includes(k)) || !Object.hasOwn(COOP_QUICK_PHRASES, m.phrase) || !(m.to === null || typeof m.to === 'string' && m.to !== p.id && room.players.get(m.to)?.connection) || !(m.cargoId === null || room.cargo.some(c => c.id === m.cargoId))) { fail('請選擇固定短句、在線隊友與有效貨單'); return; }
        if (now - (p.quickAt ?? -Infinity) < COOP_QUICK_COOLDOWN_MS) { fail('快捷通訊每三秒可送出一次'); return; }
        if (room.dispatch.quick.length >= COOP_QUICK_LIMIT) { fail('目前訊息已滿，請等待舊訊息到期'); return; }
        p.quickAt = now; room.dispatch.quick.push({ id: randomBytes(8).toString('hex'), from: p.id, to: m.to, cargoId: m.cargoId, phrase: m.phrase, createdAt: now, expiresAt: now + COOP_QUICK_MS, acks: [] });
      } else {
        if (Object.keys(m).some(k => !['type','request','id'].includes(k))) { fail('確認訊息格式無效'); return; }
        const q = room.dispatch.quick.find(q => q.id === m.id);
        if (!q || q.from === p.id || q.to !== null && q.to !== p.id) { fail('訊息已到期或不是傳給你的訊息'); return; }
        if (!q.acks.includes(p.id)) q.acks.push(p.id);
      }
    } else if (m.type === 'reserve' || m.type === 'cancel-reservation') {
      if (room.phase !== 'running' || now >= room.endsAt) { this.finishIfDue(room); fail('配送進行中才可預約貨物'); return; }
      if (m.type === 'reserve') {
        const cargo = room.cargo.find(c => c.id === m.cargoId && c.state === 'waiting');
        if (!cargo || p.cargo) { fail('只能預約待領貨物，每車限一件'); return; }
        if (room.dispatch.reservations.some(r => r.cargoId === cargo.id && r.playerId !== p.id)) { fail('隊友已預約這件貨物'); return; }
        room.dispatch.reservations = room.dispatch.reservations.filter(r => r.playerId !== p.id);
        room.dispatch.reservations.push({ cargoId: cargo.id, playerId: p.id, expiresAt: now + COOP_RESERVATION_MS });
      } else room.dispatch.reservations = room.dispatch.reservations.filter(r => r.playerId !== p.id);
    } else if (m.type === 'ping' || m.type === 'cancel-ping') {
      if (m.type === 'ping') {
        if (!COOP_STATIONS.some(s => s.id === m.stationId)) { fail('集合標記必須是目前可達站點'); return; }
        if (now - (p.pingAt ?? -Infinity) < 2000) { fail('集合標記每兩秒可更新一次'); return; }
        p.pingAt = now; room.dispatch.pings = room.dispatch.pings.filter(r => r.playerId !== p.id);
        room.dispatch.pings.push({ playerId: p.id, stationId: m.stationId, expiresAt: now + COOP_PING_MS });
      } else room.dispatch.pings = room.dispatch.pings.filter(r => r.playerId !== p.id);
    } else if (m.type === 'ready') { if (room.phase !== 'lobby' || typeof m.ready !== 'boolean') { fail('只有等待中可以切換準備'); return; } p.ready = m.ready; }
    else if (m.type === 'start') {
      if (room.hostId !== p.id || room.phase !== 'lobby') { fail('只有房主能在等待中開始'); return; }
      const players = [...room.players.values()];
      if (players.length < 2 || players.some(p => !p.connection || !p.ready)) { fail('需要2～4位已連線且準備的朋友'); return; }
      room.phase = 'running'; room.reason = ''; room.startedAt = now; room.endsAt = now + COOP_SESSION_MS;
      room.simAt=now;
      for (const player of players) { player.dwellStation = ''; player.dwellAt = now; }
    } else if (m.type === 'again') {
      if (room.hostId !== p.id || room.phase !== 'finished') { fail('只有房主能在結算後開新一輪'); return; }
      room.round++; room.phase = 'lobby'; room.reason = ''; room.runId = randomBytes(12).toString('hex'); room.cargo = this.cargoFor(room.round,room.mode); room.startedAt = room.endsAt = null;room.simAt=now;
      room.dispatch = { reservations: [], pings: [] };
      for (const player of room.players.values()) { player.cargo = null; player.delivered = 0; player.ready = false;this.place(player); }
    } else if (m.type === 'return') {
      this.release(room, p); this.place(p);
      this.send(client, { type: 'relocated', pose: { ...p.pose }, message: '已返回共同倉庫，攜帶中的貨物已退回待領。' });
    } else if(['offer-handoff','accept-handoff','cancel-handoff'].includes(m.type)){
      if(room.mode!=='relay'||room.phase!=='running'||now>=room.endsAt){fail('接力配送進行中才能交接');return;}
      const cargo=room.cargo.find(c=>c.id===m.cargoId);if(!cargo||cargo.state!=='carried'||cargo.leg!=='to-relay'){fail('這件貨物不在待中繼階段');return;}
      const from=room.players.get(cargo.owner);
      if(m.type==='cancel-handoff'){if(from!==p){fail('只能取消自己的交接邀請');return;}cargo.offer=null;}
      else if(m.type==='offer-handoff'){
        const to=room.players.get(m.to);if(from!==p||!to||to===p||!to.connection||to.cargo){fail('請選擇另一位在線空車隊友');return;}
        if(!this.stoppedAt(from,COOP_RELAY_STATION)||!this.stoppedAt(to,COOP_RELAY_STATION)){fail('交接雙方須在中繼站同層停穩1.2秒');return;}cargo.offer={to:to.id,expiresAt:now+COOP_HANDOFF_MS};
      }else{
        if(!cargo.offer||cargo.offer.to!==p.id){fail('只有受邀隊友可以確認這次交接');return;}
        if(!from||!cargo.offer||cargo.offer.to!==p.id||cargo.offer.expiresAt<=now||p.cargo||from===p||!this.stoppedAt(from,COOP_RELAY_STATION)||!this.stoppedAt(p,COOP_RELAY_STATION)){cargo.offer=null;fail('交接已失效；雙方須同層停穩，由原貨主重新邀請');return;}
        from.cargo=null;p.cargo=cargo.id;cargo.owner=p.id;cargo.relayFrom=from.id;cargo.leg='to-destination';cargo.offer=null;this.clearDispatch(room,p.id);
      }
    } else if (['pickup', 'deliver', 'release'].includes(m.type)) {
      if (room.phase !== 'running' || now >= room.endsAt) { this.finishIfDue(room); fail('目前不在配送時間內'); return; }
      if (m.type === 'release') this.release(room, p);
      else {
        const c = room.cargo.find(c => c.id === m.cargoId);
        if (!c) { fail('貨單不存在'); return; }
        const station = m.type === 'pickup' ? COOP_STATIONS[0] : COOP_STATIONS.find(s => s.id === c.destination);
        if (!this.stoppedAt(p, station)) { fail('請在目標站同層、12公尺內停穩1.2秒，並保持遊戲在前景'); return; }
        if (m.type === 'pickup') {
          if (p.cargo || c.state !== 'waiting') { fail('這張貨單已被領走，或你的車已有貨物'); return; }
          if (room.dispatch.reservations.some(r => r.cargoId === c.id && r.playerId !== p.id)) { fail('隊友已預約這件貨物，請選另一張貨單'); return; }
          c.owner = p.id; c.state = 'carried'; p.cargo = c.id;if(c.kind==='urgent'&&c.deadlineAt===null)c.deadlineAt=now+COOP_URGENT_MS;
          room.dispatch.reservations = room.dispatch.reservations.filter(r => r.playerId !== p.id && r.cargoId !== c.id);
        } else {
          if(c.leg==='to-relay'){fail('這件貨物須先在市民大道中繼站交給另一位隊友');return;}
          if (p.cargo !== c.id || c.owner !== p.id || c.state !== 'carried') { fail('只能交付自己正在運送的貨物'); return; }
          if(room.mode==='special')c.score=c.kind==='urgent'?(now<=c.deadlineAt?200:100):c.kind==='fragile'?Math.round(c.integrity*2):100;
          c.state = 'delivered'; p.cargo = null; p.delivered++;
          if (room.cargo.every(c => c.state === 'delivered')) { room.phase = 'finished'; room.reason = 'complete'; }
        }
      }
    } else { fail('不支援的合作配送指令'); return; }
    this.send(client, { type: 'ack', request: m.request }); this.broadcast(room);
  }
  input(client,m){
    const p=client.player,r=client.room,now=this.now();if(!p||!r||p.connection!==client)return;
    if(m.runId!==r.runId||m.code!==r.code||!Number.isSafeInteger(m.seq)||m.seq<=p.received||m.seq>Math.min(1e9,p.received+10000)||typeof m.steer!=='number'||!Number.isFinite(m.steer)||Math.abs(m.steer)>1||!['throttle','brake','handbrake','active'].every(k=>typeof m[k]==='boolean')||Object.keys(m).some(k=>!['type','runId','code','seq','steer','throttle','brake','handbrake','active'].includes(k)))return this.error(client,'操控輸入或合作場次無效');
    if(!m.active){p.queue=[];p.input=idle();}
    if(p.queue.length>=12)return this.error(client,'操控輸入累積過多，請稍候同步');
    p.received=m.seq;p.lastInputAt=now;p.queue.push({seq:m.seq,at:now,steer:m.steer,throttle:m.throttle,brake:m.brake,handbrake:m.handbrake,active:m.active});r.lastActivity=now;
  }
  simulate(room,at){const world=this.world();FreeCar.surface=world.surfaceAt;
    for(const p of room.players.values()){
      const queued=p.queue.shift();if(queued){p.input=queued;p.ack=queued.seq;}const fresh=p.connection&&at-p.lastInputAt<700&&p.input.active===true,active=fresh&&room.phase==='running',input=active?p.input:idle();
      const speedBefore=Math.hypot(p.car.vx,p.car.vz);p.car.drift=input.handbrake&&Math.abs(p.car.v)>8;const impact=p.car.update(1/30,input.steer,input.throttle,input.brake,world.collider);
      if(!active){p.car.vx*=.65;p.car.vz*=.65;p.car.w*=.65;if(Math.hypot(p.car.vx,p.car.vz)<.2)p.car.vx=p.car.vz=p.car.w=0;}
      if(!['x','y','z','vx','vz','w'].every(k=>Number.isFinite(p.car[k]))){this.place(p);this.release(room,p);continue;}
      const cargo=room.mode==='special'&&room.cargo.find(c=>c.id===p.cargo&&c.owner===p.id&&c.state==='carried');if(cargo?.kind==='fragile'){const deceleration=active&&(input.brake||input.handbrake)?Math.max(0,(speedBefore-Math.hypot(p.car.vx,p.car.vz))*30-4):0,loss=(impact>2?impact*2:0)+deceleration/30*.6;cargo.integrity=Math.max(0,cargo.integrity-loss);}
      p.pose={x:p.car.x,z:p.car.z,y:p.car.y,h:Math.atan2(Math.sin(p.car.h),Math.cos(p.car.h)),speed:Math.hypot(p.car.vx,p.car.vz),driving:!!fresh};p.poseAt=at;
      const station=COOP_STATIONS.find(s=>coopNear(p.pose,s));if(!station||!p.pose.driving||p.pose.speed>1){p.dwellStation='';p.dwellAt=at;}else if(p.dwellStation!==station.id){p.dwellStation=station.id;p.dwellAt=at;}
    }
  }
  stoppedAt(p, station) { const now = this.now(); return !!station && p.connection && p.pose.driving && p.pose.speed <= 1 && now - p.poseAt <= 600 && coopNear(p.pose, station) && p.dwellStation === station.id && now - p.dwellAt >= COOP_DWELL_MS; }
  release(room, p) { this.clearDispatch(room, p.id); for (const c of room.cargo) if (c.state === 'carried' && c.owner === p.id) { c.state = 'waiting'; c.owner = null;c.leg=room.mode==='relay'?'to-relay':'direct';c.relayFrom=null;c.offer=null; } p.cargo = null;for(const c of room.cargo)if(c.offer?.to===p.id)c.offer=null; }
  removePlayer(room, p) {
    this.release(room, p); for (const c of room.cargo) if (c.owner === p.id) c.owner = null;
    room.players.delete(p.id); p.token = ''; p.connection = null;
    if (!room.players.size) { this.rooms.delete(room.code); return; }
    if (room.hostId === p.id) room.hostId = ([...room.players.values()].find(p => p.connection) ?? [...room.players.values()][0]).id;
    this.broadcast(room);
  }
  disconnect(client) {
    if (!this.clients.delete(client)) return;
    const p = client.player, room = client.room;
    if (p && room && p.connection === client) {
      this.clearDispatch(room, p.id);
      p.connection = null; p.disconnectedAt = this.now(); p.pose.driving = false; p.pose.speed = 0; p.ready = false; p.dwellStation = '';
      p.input=idle();p.queue=[];for(const cargo of room.cargo)if(cargo.owner===p.id||cargo.offer?.to===p.id)cargo.offer=null;
      if (room.hostId === p.id) room.hostId = ([...room.players.values()].find(p => p.connection) ?? p).id;
      this.broadcast(room);
    }
    client.player = client.room = null;
  }
  finishIfDue(room) { if (room.phase === 'running' && this.now() >= room.endsAt) { room.phase = 'finished'; room.reason = 'timeout'; room.lastActivity = this.now(); this.broadcast(room); } }
  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      for (const p of [...room.players.values()]) if (!p.connection && p.disconnectedAt !== null && now - p.disconnectedAt > COOP_GRACE_MS) this.removePlayer(room, p);
      if (!this.rooms.has(room.code)) continue;
      if(now-room.simAt>1000){for(const p of room.players.values()){p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;p.dwellStation='';p.dwellAt=now;}room.simAt=now;}
      let steps=0;while(steps++<30&&room.simAt+1000/30<=now+.0001){room.simAt+=1000/30;this.simulate(room,room.simAt);}
      this.finishIfDue(room);
      if (room.phase !== 'running' && now - room.lastActivity > 10 * 60_000) { for (const p of room.players.values()) if (p.connection) { this.send(p.connection, { type: 'expired', message: '合作房間閒置超過10分鐘，已關閉。' }); p.connection.player = p.connection.room = null; } this.rooms.delete(room.code); }
    }
    for (const client of this.clients) if (!client.player && now - client.lastSeen > 45_000) client.ws.close(1000, '等待進房逾時');
    if (now - this.lastBroadcast >= 100) { this.lastBroadcast = now; for (const room of this.rooms.values()) this.broadcast(room); }
  }
  heartbeat() { for (const client of this.clients) { if (!client.alive) { client.ws.terminate?.(); this.disconnect(client); continue; } client.alive = false; try { client.ws.ping?.(); } catch { this.disconnect(client); } } }
  close() { if (this.closed) return; this.closed = true; for (const c of this.clients) { try { c.ws.close(1001, '服務關閉'); } catch {} } this.clients.clear(); this.rooms.clear();this.worldRef=null; }
}
