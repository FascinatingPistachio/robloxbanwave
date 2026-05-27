import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';

const POST_ID_RE = /^[a-z0-9_]{1,20}$/i;

function kvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // GET /api/vote?posts=id1,id2,...  - returns vote counts for listed post IDs
  if (req.method === 'GET') {
    const postIds = String(req.query.posts || '')
      .split(',').map(s => s.trim()).filter(s => POST_ID_RE.test(s)).slice(0, 50);
    if (!postIds.length) return res.json({ votes: {} });
    try {
      const pairs = await Promise.all(postIds.map(id =>
        Promise.all([kv.get(`vote:post:${id}:up`), kv.get(`vote:post:${id}:down`)])
          .then(([up, down]) => [id, { up: Number(up || 0), down: Number(down || 0) }])
      ));
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.json({ votes: Object.fromEntries(pairs) });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured', votes: {} });
      return res.status(500).json({ error: e.message, votes: {} });
    }
  }

  // POST /api/vote  body: { postId, type: "up"|"down" }
  if (req.method === 'POST') {
    const { postId, type } = req.body ?? {};
    if (!postId || !POST_ID_RE.test(String(postId))) {
      return res.status(400).json({ error: 'Invalid postId.' });
    }
    if (type !== 'up' && type !== 'down') {
      return res.status(400).json({ error: 'type must be "up" or "down".' });
    }

    const d      = todayKey();
    const ip     = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 20);
    try {
      const rlKey = `rl:vote:${ipHash}:${postId}:${d}`;
      const cnt   = await kv.incr(rlKey);
      if (cnt === 1) await kv.expire(rlKey, 86400);
      if (cnt > 1) return res.status(429).json({ error: 'Already voted on this post today.' });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured.' });
    }

    try {
      const val   = await kv.incr(`vote:post:${postId}:${type}`);
      await kv.expire(`vote:post:${postId}:${type}`, 30 * 24 * 3600);
      const other = Number(await kv.get(`vote:post:${postId}:${type === 'up' ? 'down' : 'up'}`) || 0);
      return res.status(201).json({
        up:    type === 'up'   ? val   : other,
        down:  type === 'down' ? val   : other,
        voted: type,
        postId,
      });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured.' });
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
