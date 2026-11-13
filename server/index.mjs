import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomService } from './room-service.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION } from '../shared/multiplayer-protocol.ts';

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
  const allowedOrigins = originsOf(options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS);
  const service = new RoomService({ ...options.roomOptions, now: options.now ?? Date.now });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const perAddress = new Map();
  const httpServer = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, rooms: service.rooms.size, connections: service.clients.size }));
    } else { res.writeHead(404); res.end(); }
  });
  httpServer.headersTimeout = 10_000; httpServer.requestTimeout = 10_000;
  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (status) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    if (req.url !== '/ws') { reject('404 Not Found'); return; }
    if (!allowedOrigins.has(req.headers.origin)) { reject('403 Forbidden'); return; }
    const address = req.socket.remoteAddress ?? 'unknown';
    // Ignore forwarded headers; a deployment proxy must enforce its own public
    // IP policy. This cap cannot be bypassed by forging X-Forwarded-For.
    if (service.clients.size >= service.maxClients || (perAddress.get(address) ?? 0) >= 16) { reject('503 Service Unavailable'); return; }
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    let counted = true;
    const release = () => {
      if (!counted) return; counted = false;
      const n = (perAddress.get(address) ?? 1) - 1;
      if (n) perAddress.set(address, n); else perAddress.delete(address);
    };
    socket.once('close', release);
    try { wss.handleUpgrade(req, socket, head, (ws) => { ws.once('close', release); service.accept(ws); }); }
    catch { release(); socket.destroy(); }
  });
  const timers = [];
  if (options.autoTick !== false) {
    timers.push(setInterval(() => service.tick(), 1000 / 60));
    timers.push(setInterval(() => service.heartbeat(), 5000));
    for (const timer of timers) timer.unref();
  }
  let closing;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      for (const timer of timers) clearInterval(timer);
      service.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (httpServer.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
      httpServer.closeAllConnections();
    })();
    return closing;
  }
  return { httpServer, wss, service, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4320), host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const app = createMultiplayerServer();
  app.httpServer.listen(port, host, () => console.log(`Taipei GP multiplayer listening on ${host}:${port} (WebSocket /ws)`));
  app.httpServer.on('error', (error) => { console.error(`Multiplayer server failed: ${error.message}`); process.exitCode = 1; void app.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().catch((error) => { console.error(error.message); process.exitCode = 1; }); });
}
