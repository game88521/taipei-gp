import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import {MERIDIAN_ROTATION_VERSION} from '../shared/meridian-social.ts';
import {MERIDIAN_NAVIGATOR_VERSION} from '../shared/meridian-navigator.ts';
import {MeridianCheckpoints} from './meridian-checkpoints.mjs';
import {MeridianCityService} from './meridian-city-service.mjs';
import {MERIDIAN_CITY_VERSION} from '../shared/meridian-city.ts';
import {MERIDIAN_RACING_VERSION} from '../shared/meridian-racing.ts';
import { RoomService } from './room-service.mjs';
import { NexusCoopService } from './nexus-coop-service.mjs';
import { SummitCityRaceService } from './summit-city-race-service.mjs';
import { ExpeditionSocialService } from './expedition-social-service.mjs';
import { ExpeditionDutyService } from './expedition-duty-service.mjs';
import { FrontierRallyService } from './frontier-rally-service.mjs';
import { FRONTIER_RALLY_VERSION, AURORA_RALLY_VERSION } from '../shared/frontier-rally.ts';
import { PARTY_VERSION } from '../shared/aurora-social.ts';
import { CREW_TEAM_VERSION } from '../shared/aurora-duty.ts';
import { AURORA_CUP_VERSION } from '../shared/frontier-cup.ts';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';
import { COOP_VERSION } from '../shared/nexus-coop.ts';
import { CITY_RACE_VERSION } from '../shared/summit-city-race.ts';
import { SOCIAL_VERSION } from '../shared/expedition-social.ts';
import { EXPEDITION_DUTY_VERSION } from '../shared/expedition-duty.ts';
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
  const checkpoints=options.checkpoints??new MeridianCheckpoints({key:options.meridianCheckpointKey??process.env.MERIDIAN_CHECKPOINT_SECRET,now:options.now??Date.now});
  const service = new RoomService({maxRooms:capacity.gpRooms,maxClients:capacity.connections, ...options.roomOptions, checkpoints, now: options.now ?? Date.now });
  const cityRaceService = new SummitCityRaceService({maxRooms:capacity.cityRooms,maxClients:capacity.connections, ...options.cityRaceOptions, now: options.now ?? Date.now });
  const coopService = new NexusCoopService({maxRooms:capacity.coopRooms,maxClients:capacity.connections, worldFactory:()=>cityRaceService.world(), ...options.coopOptions, now: options.now ?? Date.now });
  const socialService = new ExpeditionSocialService({maxRooms:Math.min(2,capacity.cityRooms),maxClients:capacity.connections,worldFactory:()=>cityRaceService.world(),...options.socialOptions,checkpoints,now:options.now??Date.now});
  const dutyService = new ExpeditionDutyService({maxRooms:Math.min(2,capacity.cityRooms),maxClients:capacity.connections,worldFactory:()=>cityRaceService.world(),...options.dutyOptions,now:options.now??Date.now});
  const rallyService = new FrontierRallyService({maxRooms:Math.min(2,capacity.cityRooms),maxClients:capacity.connections,worldFactory:()=>cityRaceService.world(),...options.rallyOptions,now:options.now??Date.now});
  const missionService=new MeridianCityService({maxRooms:Math.min(2,capacity.cityRooms),maxClients:capacity.connections,worldFactory:()=>cityRaceService.world(),...options.missionOptions,now:options.now??Date.now});
  const services = new Map([['/ws',service],['/coop',coopService],['/city-race',cityRaceService],['/city-social',socialService],['/city-duty',dutyService],['/city-rally',rallyService],['/city-mission',missionService]]);
  const connectionLimit=Math.min(capacity.connections,service.maxClients);
  const connections=()=>[...services.values()].reduce((n,s)=>n+s.clients.size,0);
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
      res.end(JSON.stringify({ status: 'ok', meridian:{rotationVersion:MERIDIAN_ROTATION_VERSION,navigatorVersion:MERIDIAN_NAVIGATOR_VERSION,cityVersion:MERIDIAN_CITY_VERSION,racingVersion:MERIDIAN_RACING_VERSION,checkpointVersion:checkpoints.version,persistentSigning:checkpoints.persistentSigning},cityMission:{version:MERIDIAN_CITY_VERSION,rooms:missionService.rooms.size,connections:missionService.clients.size},aurora:{partyVersion:PARTY_VERSION,crewTeamVersion:CREW_TEAM_VERSION,auroraCupVersion:AURORA_CUP_VERSION,auroraRallyVersion:AURORA_RALLY_VERSION}, version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP, rooms: service.rooms.size, connections: service.clients.size, totalConnections:connections(),coop: { version: COOP_VERSION, rooms: coopService.rooms.size, connections: coopService.clients.size }, cityRace: { version: CITY_RACE_VERSION, rooms: cityRaceService.rooms.size, connections: cityRaceService.clients.size },citySocial:{version:SOCIAL_VERSION,rooms:socialService.rooms.size,connections:socialService.clients.size},cityDuty:{version:EXPEDITION_DUTY_VERSION,rooms:dutyService.rooms.size,connections:dutyService.clients.size},cityRally:{version:FRONTIER_RALLY_VERSION,rooms:rallyService.rooms.size,connections:rallyService.clients.size},capacity:{gpRooms:service.maxRooms,coopRooms:coopService.maxRooms,cityRooms:cityRaceService.maxRooms,socialRooms:socialService.maxRooms,dutyRooms:dutyService.maxRooms,rallyRooms:rallyService.maxRooms,missionRooms:missionService.maxRooms,connections:connectionLimit},runtime:runtime.snapshot() }));
    } else { res.writeHead(404); res.end(); }
  });
  httpServer.headersTimeout = 10_000; httpServer.requestTimeout = 10_000;
  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (status) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    if (!services.has(req.url)) { reject('404 Not Found'); return; }
    if (!allowedOrigins.has(req.headers.origin)) { reject('403 Forbidden'); return; }
    const address = req.socket.remoteAddress ?? 'unknown';
    // Ignore forwarded headers; a deployment proxy must enforce its own public
    // IP policy. This cap cannot be bypassed by forging X-Forwarded-For.
    const targetService = services.get(req.url);
    if (targetService.clients.size >= targetService.maxClients || connections()>=connectionLimit || (perAddress.get(address) ?? 0) >= 16) { reject('503 Service Unavailable'); return; }
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
    timers.push(setInterval(() => {if(socialService.rooms.size||socialService.clients.size)runtime.run('citySocial',()=>socialService.tick());},1000/60));
    timers.push(setInterval(() => socialService.heartbeat(),5000));
    timers.push(setInterval(() => {if(dutyService.rooms.size||dutyService.clients.size)runtime.run('cityDuty',()=>dutyService.tick());},1000/30));
    timers.push(setInterval(() => dutyService.heartbeat(),5000));
    timers.push(setInterval(() => {if(rallyService.rooms.size||rallyService.clients.size)runtime.run('cityRally',()=>rallyService.tick());},1000/60));
    timers.push(setInterval(() => rallyService.heartbeat(),5000));
    timers.push(setInterval(()=>{if(missionService.rooms.size||missionService.clients.size)runtime.run('cityMission',()=>missionService.tick());},1000/60));
    timers.push(setInterval(()=>missionService.heartbeat(),5000));
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
      socialService.close();
      dutyService.close();
      rallyService.close();
      missionService.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (httpServer.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
      httpServer.closeAllConnections();
    })();
    return closing;
  }
  return { httpServer, wss, service, coopService, cityRaceService, socialService,dutyService,rallyService,missionService,checkpoints,runtime, capacity, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4320), host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const app = createMultiplayerServer();
  app.httpServer.listen(port, host, () => console.log(`Taipei GP multiplayer listening on ${host}:${port} (WebSocket /ws)`));
  app.httpServer.on('error', (error) => { console.error(`Multiplayer server failed: ${error.message}`); process.exitCode = 1; void app.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().catch((error) => { console.error(error.message); process.exitCode = 1; }); });
}
