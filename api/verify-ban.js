import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';

const VALID_EXECUTORS = ['synapse z', 'wave', 'fluxus', 'krnl', 'solara', 'arceus x', 'delta', 'other'];
const VALID_PLATFORMS = ['pc', 'mobile-android', 'mobile-ios', 'console'];

// Roblox ban message keywords - must match at least one
const BAN_RE = /\b(moderat|terminat|suspend|banned|violation|account.*action|warning.*roblox|roblox.*moderat)\b/i;

function hashIp(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 20);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function kvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // -- GET: return today's verified ban count --------------------------------
  if (req.method === 'GET') {
    const d = req.query.date || todayKey();
    try {
      const raw     = await kv.lrange(`ban:${d}`, 0, -1);
      const entries = (raw || []).map(e => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean);
      const byExecutor = {};
      for (const e of entries) byExecutor[e.executor] = (byExecutor[e.executor] || 0) + 1;
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.json({ count: entries.length, byExecutor, date: d });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured', count: 0 });
      return res.status(500).json({ error: e.message, count: 0 });
    }
  }

  // -- POST: submit a verified ban report ------------------------------------
  if (req.method === 'POST') {
    const { ocrText, executor, platform } = req.body ?? {};

    if (!ocrText || !executor || !platform) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (!VALID_EXECUTORS.includes(String(executor).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid executor selection.' });
    }
    if (!VALID_PLATFORMS.includes(String(platform).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid platform selection.' });
    }
    if (!BAN_RE.test(String(ocrText).slice(0, 2000))) {
      return res.status(400).json({
        error: 'Screenshot does not appear to contain a Roblox ban message. Upload a screenshot of your moderation notice.',
      });
    }

    // Rate limit: 3 submissions per IP per hour
    const ipHash = hashIp(req);
    try {
      const rlKey  = `rl:ban:${ipHash}`;
      const count  = await kv.incr(rlKey);
      if (count === 1) await kv.expire(rlKey, 3600);
      if (count > 3) return res.status(429).json({ error: 'Too many submissions. Try again in an hour.' });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured.' });
      return res.status(500).json({ error: e.message });
    }

    const d     = todayKey();
    const entry = JSON.stringify({
      executor: String(executor).toLowerCase().slice(0, 30),
      platform: String(platform).toLowerCase().slice(0, 20),
      ts:       Date.now(),
    });

    try {
      await kv.lpush(`ban:${d}`, entry);
      await kv.expire(`ban:${d}`, 9 * 24 * 3600); // keep 9 days
      const total = await kv.llen(`ban:${d}`);
      return res.status(201).json({ count: total, date: d });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured.' });
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
