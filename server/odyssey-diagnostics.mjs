// Rex <game88521@gmail.com>
import {MERIDIAN_ROTATION_VERSION} from '../shared/meridian-social.ts';
import {MERIDIAN_NAVIGATOR_VERSION} from '../shared/meridian-navigator.ts';
import {MERIDIAN_CITY_VERSION} from '../shared/meridian-city.ts';
import {MERIDIAN_RACING_VERSION} from '../shared/meridian-racing.ts';
import {MERIDIAN_CHECKPOINT_VERSION} from '../shared/meridian-checkpoints.ts';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';
import { COOP_VERSION } from '../shared/nexus-coop.ts';
import { CITY_RACE_VERSION } from '../shared/summit-city-race.ts';
import {SOCIAL_VERSION} from '../shared/expedition-social.ts';
import {CONVOY_VERSION} from '../shared/frontier-convoy.ts';
import {CROWN_VERSION} from '../shared/frontier-crown.ts';
import {FRONTIER_RALLY_VERSION,AURORA_RALLY_VERSION} from '../shared/frontier-rally.ts';
import {PARTY_VERSION} from '../shared/aurora-social.ts';
import {CREW_TEAM_VERSION} from '../shared/aurora-duty.ts';
import {AURORA_CUP_VERSION} from '../shared/frontier-cup.ts';
import {DUTY_MISSIONS_VERSION} from '../shared/frontier-duty-missions.ts';
import {EXPEDITION_DUTY_VERSION} from '../shared/expedition-duty.ts';
import {CITY_REPLAY_VERSION} from '../shared/frontier-city-replay.ts';
import {CITY_AUTO_RESUME_VERSION} from '../shared/frontier-city-resume.ts';
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
    return send(200, { schema: 1, status: 'ok', originAllowed: allowed.has(origin), protocol: { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP, coopVersion: COOP_VERSION, cityRaceVersion: CITY_RACE_VERSION }, capabilities: { odysseyDiagnostics: true,rotationVersion:MERIDIAN_ROTATION_VERSION,navigatorVersion:MERIDIAN_NAVIGATOR_VERSION,meridianCityVersion:MERIDIAN_CITY_VERSION,meridianRacingVersion:MERIDIAN_RACING_VERSION,meridianCheckpointVersion:MERIDIAN_CHECKPOINT_VERSION,partyVersion:PARTY_VERSION,crewTeamVersion:CREW_TEAM_VERSION,auroraCupVersion:AURORA_CUP_VERSION,auroraRallyVersion:AURORA_RALLY_VERSION, socialVersion:SOCIAL_VERSION,dutyVersion:EXPEDITION_DUTY_VERSION,cityReplayVersion:CITY_REPLAY_VERSION,autoResumeVersion:CITY_AUTO_RESUME_VERSION,convoyVersion:CONVOY_VERSION,crownVersion:CROWN_VERSION,rallyVersion:FRONTIER_RALLY_VERSION,dutyMissionsVersion:DUTY_MISSIONS_VERSION } });
  };
}
