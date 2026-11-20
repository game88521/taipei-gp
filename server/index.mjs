import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomService } from './room-service.mjs';
import { NexusCoopService } from './nexus-coop-service.mjs';
import { SummitCityRaceService } from './summit-city-race-service.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';
import { COOP_VERSION } from '../shared/nexus-coop.ts';
import { CITY_RACE_VERSION } from '../shared/summit-city-race.ts';
import {atlasCapacity,AtlasRuntime} from './atlas-runtime.mjs';
import {performance} from 'node:perf_hooks';
import { createDiagnostics } from './odyssey-diagnostics.mjs';

const DEFAULT_ORIGINS = ['http://127.0.0.1:4317', 'http://localhost:4317', 'http://127.0.0.1:5173', 'http://localhost:5173'];

function originsOf(value) {
  const origins = Array.isArray(value) ? value : String(value).split(',').map((part) => part.trim()).filter(Boolean);
  if (!origins.length) throw new Error('ALLOWED_ORIGINS must contain at least one exact HTTP(S) origin.');
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) throw new Error(`Invalid allowed origin: ${origin}`);
  }
  return new Set(origins);
}

/** Factory for local integration tests and a single deployed Node process. */
export function createMultiplayerServer(options = {}) {
  const capacity=atlasCapacity(options.capacityEnv??process.env),runtime=new AtlasRuntime();
  const allowedOrigins = originsOf(options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS);
  const service = new RoomService({maxRooms:capacity.gpRooms,maxClients:capacity.connections, ...options.roomOptions, now: options.now ?? Date.now });
  const coopService = new NexusCoopService({maxRooms:capacity.coopRooms,maxClients:capacity.connections, worldFactory:()=>cityRaceService.world(), ...options.coopOptions, now: options.now ?? Date.now });
  const cityRaceService = new SummitCityRaceService({maxRooms:capacity.cityRooms,maxClients:capacity.connections, ...options.cityRaceOptions, now: options.now ?? Date.now });
  // Parse/build the shared 184-tile city before listen() or any simulation
  // interval starts. A first city-room request must not stall an existing GP.
  const warmStart=performance.now();
  if (options.prewarmCityRace !== false) cityRaceService.world();
  runtime.warmupMs=+(performance.now()-warmStart).toFixed(3);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false });
  const perAddress = new Map();
  const diagnostics = createDiagnostics(allowedOrigins, options.now ?? Date.now);
  const httpServer = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (diagnostics(req, res)) return;
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP, rooms: service.rooms.size, connections: service.clients.size, coop: { version: COOP_VERSION, rooms: coopService.rooms.size, connections: coopService.clients.size }, cityRace: { version: CITY_RACE_VERSION, rooms: cityRaceService.rooms.size, connections: cityRaceService.clients.size },capacity:{gpRooms:service.maxRooms,coopRooms:coopService.maxRooms,cityRooms:cityRaceService.maxRooms,connections:Math.min(capacity.connections,service.maxClients)},runtime:runtime.snapshot() }));
    } else { res.writeHead(404); res.end(); }
  });
  httpServer.headersTimeout = 10_000; httpServer.requestTimeout = 10_000;
  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (status) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    if (req.url !== '/ws' && req.url !== '/coop' && req.url !== '/city-race') { reject('404 Not Found'); return; }
    if (!allowedOrigins.has(req.headers.origin)) { reject('403 Forbidden'); return; }
    const address = req.socket.remoteAddress ?? 'unknown';
    // Ignore forwarded headers; a deployment proxy must enforce its own public
    // IP policy. This cap cannot be bypassed by forging X-Forwarded-For.
    const targetService = req.url === '/city-race' ? cityRaceService : req.url === '/coop' ? coopService : service;
    if (targetService.clients.size >= targetService.maxClients || service.clients.size + coopService.clients.size + cityRaceService.clients.size >= Math.min(capacity.connections,service.maxClients) || (perAddress.get(address) ?? 0) >= 16) { reject('503 Service Unavailable'); return; }
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    let counted = true;
    const release = () => {
      if (!counted) return; counted = false;
      const n = (perAddress.get(address) ?? 1) - 1;
      if (n) perAddress.set(address, n); else perAddress.delete(address);
    };
    socket.once('close', release);
    try { wss.handleUpgrade(req, socket, head, (ws) => { ws.once('close', release); targetService.accept(ws); }); }
    catch { release(); socket.destroy(); }
  });
  const timers = [];
  if (options.autoTick !== false) {
    timers.push(setInterval(() => {if(service.rooms.size||service.clients.size)runtime.run('gp',()=>service.tick());}, 1000 / 60));
    timers.push(setInterval(() => service.heartbeat(), 5000));
    timers.push(setInterval(() => {if(coopService.rooms.size||coopService.clients.size)runtime.run('coop',()=>coopService.tick());}, 1000 / 30));
    timers.push(setInterval(() => coopService.heartbeat(), 5000));
    timers.push(setInterval(() => {if(cityRaceService.rooms.size||cityRaceService.clients.size)runtime.run('city',()=>cityRaceService.tick());}, 1000 / 60));
    timers.push(setInterval(() => cityRaceService.heartbeat(), 5000));
    for (const timer of timers) timer.unref();
  }
  let closing;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      for (const timer of timers) clearInterval(timer);
      runtime.close();
      service.close();
      coopService.close();
      cityRaceService.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (httpServer.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
      httpServer.closeAllConnections();
    })();
    return closing;
  }
  return { httpServer, wss, service, coopService, cityRaceService, runtime, capacity, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4320), host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const app = createMultiplayerServer();
  app.httpServer.listen(port, host, () => console.log(`Taipei GP multiplayer listening on ${host}:${port} (WebSocket /ws)`));
  app.httpServer.on('error', (error) => { console.error(`Multiplayer server failed: ${error.message}`); process.exitCode = 1; void app.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().catch((error) => { console.error(error.message); process.exitCode = 1; }); });
}
