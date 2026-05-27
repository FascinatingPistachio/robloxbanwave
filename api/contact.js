import { createHash } from 'node:crypto';
import { kv } from '@vercel/kv';

const VALID_CATEGORIES = ['bug', 'false-positive', 'dmca', 'general'];

function kvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, category } = req.body ?? {};
  const msg = String(message || '').trim();
  if (msg.length < 10) return res.status(400).json({ error: 'Message too short (min 10 characters).' });
  if (msg.length > 1800) return res.status(400).json({ error: 'Message too long (max 1800 characters).' });
  const cat = VALID_CATEGORIES.includes(String(category || '').toLowerCase()) ? String(category).toLowerCase() : 'general';

  const webhookUrl = process.env.CONTACT_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(503).json({ error: 'Contact form not configured yet - please open a GitHub issue instead.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 20);
  try {
    const rlKey = `rl:contact:${ipHash}`;
    const cnt   = await kv.incr(rlKey);
    if (cnt === 1) await kv.expire(rlKey, 86400);
    if (cnt > 3) return res.status(429).json({ error: 'Too many messages today. Try again tomorrow.' });
  } catch (e) {
    if (kvError(e)) { /* proceed if KV unavailable */ }
  }

  const colors = { bug: 0xef4444, 'false-positive': 0xf59e0b, dmca: 0x8b5cf6, general: 0x94a3b8 };
  const embed = {
    title:       `Contact: ${cat}`,
    description: msg,
    color:       colors[cat] ?? 0x94a3b8,
    footer:      { text: 'robloxbanwave.vercel.app - anonymous contact form' },
    timestamp:   new Date().toISOString(),
  };

  try {
    const r = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: 'RBX Radar Contact', embeds: [embed] }),
    });
    if (r.ok || r.status === 204) return res.json({ ok: true });
    const text = await r.text().catch(() => '');
    return res.status(500).json({ error: `Delivery failed (${r.status}). ${text.slice(0, 120)}` });
  } catch (e) {
    return res.status(500).json({ error: 'Server error.' });
  }
}
