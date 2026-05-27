import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';

function kvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const d = todayKey();

  if (req.method === 'GET') {
    try {
      const [up, down] = await Promise.all([
        kv.get(`vote:up:${d}`),
        kv.get(`vote:down:${d}`),
      ]);
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.json({ up: Number(up || 0), down: Number(down || 0), date: d });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured', up: 0, down: 0 });
      return res.status(500).json({ error: e.message, up: 0, down: 0 });
    }
  }

  if (req.method === 'POST') {
    const { type } = req.body ?? {};
    if (type !== 'up' && type !== 'down') {
      return res.status(400).json({ error: 'type must be "up" or "down".' });
    }

    const ip     = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 20);
    try {
      const rlKey = `rl:vote:${ipHash}:${d}`;
      const cnt   = await kv.incr(rlKey);
      if (cnt === 1) await kv.expire(rlKey, 86400);
      if (cnt > 1) return res.status(429).json({ error: 'You have already voted today.' });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured.' });
    }

    try {
      const val   = await kv.incr(`vote:${type}:${d}`);
      await kv.expire(`vote:${type}:${d}`, 9 * 24 * 3600);
      const other = Number(await kv.get(`vote:${type === 'up' ? 'down' : 'up'}:${d}`) || 0);
      return res.status(201).json({
        up:    type === 'up'   ? val   : other,
        down:  type === 'down' ? val   : other,
        voted: type,
        date:  d,
      });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured.' });
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
