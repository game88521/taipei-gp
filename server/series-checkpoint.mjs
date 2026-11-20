import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { CATALOG_STAMP, PHYSICS_VERSION } from '../shared/multiplayer-protocol.ts';
import { validSeries } from '../shared/multiplayer-series.ts';
import { validEvolution } from '../shared/multiplayer-evolution.ts';
import { parseRoomRules } from '../shared/multiplayer-room-rules.ts';
import { parseHorizon } from '../shared/multiplayer-horizon.ts';

export const CHECKPOINT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_CHECKPOINT_BYTES = 65536;
export const seatHash = token => createHash('sha256').update(token).digest('hex');
/** Tokens are bearer capabilities; never log them or place them in room snapshots. */
export class SeriesCheckpointSigner {
  constructor(secret = process.env.SERIES_RESUME_SECRET) {
    if (secret !== undefined && (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 4096)) throw new Error('SERIES_RESUME_SECRET must contain 32–4096 bytes.');
    this.persistent = secret !== undefined;
    this.key = secret === undefined ? randomBytes(32) : Buffer.from(secret);
  }
  capability() { return { persistent: this.persistent, ttlSeconds: CHECKPOINT_TTL_SECONDS }; }
  sign(payload, now) {
    const data = { ...payload, schema: 1, catalogStamp: CATALOG_STAMP, physics: PHYSICS_VERSION, issuedAt: now, expiresAt: now + CHECKPOINT_TTL_SECONDS * 1000 };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const token = `${encoded}.${createHmac('sha256', this.key).update(encoded).digest('base64url')}`;
    if (Buffer.byteLength(token) > MAX_CHECKPOINT_BYTES) throw new Error('Checkpoint too large');
    return { token, expiresAt: data.expiresAt, persistent: this.persistent };
  }
  verify(token, now) {
    try {
      if (typeof token !== 'string' || Buffer.byteLength(token) > MAX_CHECKPOINT_BYTES || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const [encoded, signature] = token.split('.'), expected = createHmac('sha256', this.key).update(encoded).digest();
      const received = Buffer.from(signature, 'base64url');
      if (received.length !== expected.length || received.toString('base64url') !== signature || !timingSafeEqual(received, expected)) return null;
      const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (data.schema !== 1 || data.catalogStamp !== CATALOG_STAMP || data.physics !== PHYSICS_VERSION || !Number.isSafeInteger(data.issuedAt)
        || !Number.isSafeInteger(data.expiresAt) || data.issuedAt > now || data.expiresAt <= now || data.expiresAt - data.issuedAt !== CHECKPOINT_TTL_SECONDS * 1000
        || ![1, 3, 5].includes(data.laps) || !validEvolution(data.evolution) || !parseRoomRules(data.roomRules)
        || data.horizon !== undefined && (!parseHorizon(data.horizon) || data.horizon.elimination)
        || !validSeries(data.series, data.trackId, 'results', data.matchId, data.laps) || !data.series.locked || data.series.complete
        || data.series.rounds.length < 1 || data.originalHostId !== data.series.originalHostId || !Array.isArray(data.seats)
        || data.seats.length < 2 || data.seats.length > data.series.entrants.length || data.evolution.mode === 'teams' && data.seats.length !== 4
        || new Set(data.seats.map(s => s.playerId)).size !== data.seats.length
        || !data.seats.every(s => data.series.entrants.some(e => e.playerId === s.playerId) && /^[a-f0-9]{64}$/.test(s.tokenHash) && Number.isInteger(s.slot) && s.slot >= 0 && s.slot < 4 && (s.horizon === undefined || typeof s.horizon === 'boolean'))
        || new Set(data.seats.map(s => s.slot)).size !== data.seats.length || !data.seats.some(s => s.playerId === data.originalHostId)) return null;
      return data;
    } catch { return null; }
  }
}
