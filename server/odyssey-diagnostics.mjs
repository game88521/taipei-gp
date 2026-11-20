// Rex <game88521@gmail.com>
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';
import { COOP_VERSION } from '../shared/nexus-coop.ts';
import { CITY_RACE_VERSION } from '../shared/summit-city-race.ts';
export function createDiagnostics(allowed, now = Date.now) {
  const requests = new Map();
  return (req, res) => {
    if (req.url !== '/diagnostics') return false;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); return true; };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'METHOD_NOT_ALLOWED' }); }
    const origin = req.headers.origin;
    try { const u = new URL(origin); if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin) throw Error(); }
    catch { return send(400, { error: 'INVALID_ORIGIN' }); }
    res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Origin', origin);
    const at = now(), address = req.socket.remoteAddress ?? 'unknown';
    for (const [key, value] of requests) if (at - value.at >= 60_000) requests.delete(key);
    let window = requests.get(address);
    if (!window) { if (requests.size >= 1024) requests.delete(requests.keys().next().value); window = { at, count: 0 }; requests.set(address, window); }
    if (++window.count > 30) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((60_000 - at + window.at) / 1000)))); return send(429, { error: 'RATE_LIMITED' }); }
    return send(200, { schema: 1, status: 'ok', originAllowed: allowed.has(origin), protocol: { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP, coopVersion: COOP_VERSION, cityRaceVersion: CITY_RACE_VERSION }, capabilities: { odysseyDiagnostics: true } });
  };
}
