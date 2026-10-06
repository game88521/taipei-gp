// 線上排行榜（Vercel Serverless Function）：計時賽最快圈，每個車手名字只留最快的一圈
// 資料存在 Upstash Redis（Vercel 後台 Storage → Upstash for Redis → Connect 到這個專案，會自動加上環境變數）
// GET  /api/leaderboard          → 前 20 名 { top: [{ name, time }] }
// GET  /api/leaderboard?name=Rex → 另外附上這個人的名次 { me: { rank, time } }
// POST /api/leaderboard { name, time } → 寫入（比原本慢就不會蓋掉）並回傳名次

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'taipei-gp:tt:v2'; // 賽道改了就換 key
const MIN_LAP = 40, MAX_LAP = 300; // 圈速合理範圍（秒）；目前最快的 AI 約 52 秒

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>"'`\\]/g, '').trim().slice(0, 12);

async function top() {
  const flat = await redis('ZRANGE', KEY, 0, 19, 'WITHSCORES');
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ name: flat[i], time: Number(flat[i + 1]) });
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) { res.status(503).json({ error: 'not-configured' }); return; }
  try {
    if (req.method === 'GET') {
      const name = cleanName(req.query?.name);
      const body = { top: await top() };
      if (name) {
        const [rank, time] = await Promise.all([redis('ZRANK', KEY, name), redis('ZSCORE', KEY, name)]);
        if (rank != null) body.me = { rank: rank + 1, time: Number(time) };
      }
      res.status(200).json(body);
      return;
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const name = cleanName(b.name), time = Number(b.time);
      if (!name) { res.status(400).json({ error: 'name' }); return; }
      if (!Number.isFinite(time) || time < MIN_LAP || time > MAX_LAP) { res.status(400).json({ error: 'time' }); return; }
      // 同一個 IP 10 秒內只能上傳一次
      const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
      const ok = await redis('SET', `taipei-gp:rl:${ip}`, '1', 'NX', 'EX', 10);
      if (ok !== 'OK') { res.status(429).json({ error: 'slow-down' }); return; }
      await redis('ZADD', KEY, 'LT', Math.round(time * 1000) / 1000, name); // LT：比原本快才更新
      const rank = await redis('ZRANK', KEY, name);
      res.status(200).json({ rank: rank + 1, top: await top() });
      return;
    }
    res.status(405).json({ error: 'method' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
