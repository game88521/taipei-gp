// 新榜依 UUID、規則、紀錄版本分開；舊名稱榜保留唯讀。
import { createHash } from 'node:crypto';
import { UUID, isBoard, boardKey, validateLapProof } from '../shared/lap-proof.js';

const LEGACY = 'taipei-gp:tt:v2';
const MAX_BODY = 768_000;
const cleanName = (s) => typeof s === 'string' ? s.replace(/[\u0000-\u001f<>"'`\\]/g, '').trim().slice(0, 12) : '';
const header = (req, name) => String(req.headers?.[name.toLowerCase()] ?? '');
const SUBMIT = `
local old = redis.call('GET', KEYS[3])
if old then
  local receipt = cjson.decode(old)
  if receipt.fingerprint ~= ARGV[4] then return {2,0} end
  return {0,receipt.rank}
end
if not redis.call('SET', KEYS[4], '1', 'NX', 'EX', 10) then return {3,0} end
redis.call('ZADD', KEYS[1], 'LT', ARGV[3], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
local rank = redis.call('ZRANK', KEYS[1], ARGV[1]) + 1
redis.call('SET', KEYS[3], cjson.encode({fingerprint=ARGV[4],rank=rank}), 'EX', 86400)
return {1,rank}`;

class UpstreamTimeout extends Error {}
/** 可注入本機 Redis REST stand-in；正式入口只讀現有 Vercel 環境變數。 */
export function createLeaderboardHandler(options = {}) {
  const url = options.url ?? (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  const token = options.token ?? (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  const fetcher = options.fetch ?? globalThis.fetch;
  async function redis(deadline, ...cmd) {
    const remaining = Math.min(options.timeoutMs ?? 5000, deadline - Date.now());
    if (remaining <= 0) throw new UpstreamTimeout();
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new UpstreamTimeout()); }, remaining); });
    const work = async () => {
      const r = await fetcher(url, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
      if (!r.ok) throw new Error('upstream');
      const j = await r.json();
      if (j.error || !Object.hasOwn(j, 'result')) throw new Error('upstream');
      return j.result;
    };
    try { return await Promise.race([work(), expired]); }
    finally { clearTimeout(timer); }
  }
  async function leaderboard(board, playerId, legacyName, deadline) {
    const legacy = board === 'legacy', key = legacy ? LEGACY : boardKey(board);
    const flat = await redis(deadline, 'ZRANGE', key, 0, 19, 'WITHSCORES');
    if (!Array.isArray(flat)) throw new Error('upstream');
    const ids = flat.filter((_, i) => i % 2 === 0);
    const names = !legacy && ids.length ? await redis(deadline, 'HMGET', `${key}:names`, ...ids) : ids;
    if (!Array.isArray(names)) throw new Error('upstream');
    const top = ids.map((id, i) => ({ ...(legacy ? {} : { playerId: id }), name: cleanName(names[i]) || '車手', time: Number(flat[i * 2 + 1]) }));
    const body = { board: legacy ? { track: 'taipei', rules: 'legacy', version: 0 } : board, validation: legacy ? 'legacy-unverified' : 'trajectory-plausibility', top };
    const member = legacy ? legacyName : playerId;
    if (member) {
      const [rank, time] = await Promise.all([redis(deadline, 'ZRANK', key, member), redis(deadline, 'ZSCORE', key, member)]);
      if (rank != null && time != null) body.me = { rank: Number(rank) + 1, time: Number(time) };
    }
    return body;
  }
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const fail = (status, error) => res.status(status).json({ error });
    if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return fail(405, 'method'); }
    if (!url || !token) return fail(503, 'not-configured');
    // 同一請求的多次 Redis 往返共用期限，避免各自等 5 秒而超過函式執行時間。
    const deadline = Date.now() + (options.requestTimeoutMs ?? 7000);
    try {
      if (req.method === 'GET') {
        const q = req.query ?? {};
        if (q.board === 'legacy') return res.status(200).json(await leaderboard('legacy', null, cleanName(q.name), deadline));
        const board = { track: 'taipei', rules: q.rules ?? 'classic', version: Number(q.version ?? 1) };
        if (!isBoard(board) || (q.playerId != null && (typeof q.playerId !== 'string' || !UUID.test(q.playerId))) || (q.board && q.board !== 'current')) return fail(400, 'board');
        return res.status(200).json(await leaderboard(board, q.playerId?.toLowerCase(), null, deadline));
      }
      let b;
      try {
        const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        if (Buffer.byteLength(raw) > MAX_BODY) return fail(413, 'payload-too-large');
        b = JSON.parse(raw);
      } catch { return fail(400, 'invalid-request'); }
      if (!b || typeof b !== 'object') return fail(400, 'invalid-request');
      const name = cleanName(b.name), playerId = typeof b.playerId === 'string' ? b.playerId.toLowerCase() : b.playerId, time = b.time, board = b.board, idem = header(req, 'idempotency-key').toLowerCase();
      if (!name) return fail(400, 'name');
      if (typeof playerId !== 'string' || !UUID.test(playerId) || !UUID.test(idem)) return fail(400, 'identity');
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 40 || time > 300) return fail(400, 'time');
      if (!isBoard(board)) return fail(400, 'board');
      if (!validateLapProof(b.proof, time, board.rules).ok) return fail(400, 'proof');
      const key = boardKey(board), ip = header(req, 'x-forwarded-for').split(',')[0].trim() || 'unknown';
      const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 32);
      const fingerprint = createHash('sha256').update(JSON.stringify({ playerId, name, time, board, proof: b.proof })).digest('hex');
      const reply = await redis(deadline, 'EVAL', SUBMIT, 4, key, `${key}:names`, `${key}:receipt:${playerId}:${idem}`, `taipei-gp:rl:${ipHash}`, playerId, name, Math.round(time * 1000) / 1000, fingerprint);
      if (!Array.isArray(reply)) throw new Error('upstream');
      if (Number(reply[0]) === 2) return fail(409, 'idempotency-conflict');
      if (Number(reply[0]) === 3) { res.setHeader('Retry-After', '10'); return fail(429, 'slow-down'); }
      if (Number(reply[0]) !== 0 && Number(reply[0]) !== 1) throw new Error('upstream');
      return res.status(200).json({ ...await leaderboard(board, playerId, null, deadline), rank: Number(reply[1]) });
    } catch (e) {
      return fail(e instanceof UpstreamTimeout || e?.name === 'AbortError' ? 504 : 503, e instanceof UpstreamTimeout || e?.name === 'AbortError' ? 'upstream-timeout' : 'unavailable');
    }
  };
}

export default createLeaderboardHandler();
