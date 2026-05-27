import { kv } from '@vercel/kv';
import { decrypt } from './webhooks.js';
import { createHash } from 'node:crypto';

const COOLDOWN_MS = 45 * 60 * 1000;

function hashToken(token) {
  const salt = process.env.WEBHOOK_CIPHER_KEY || 'CHANGE_ME';
  return createHash('sha256').update(token + salt).digest('hex');
}

function hashIp(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 20);
}

function kvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { topPost, test, token } = req.body ?? {};

  // -- Test mode: send a single test notification to the caller's webhook ------
  if (test) {
    if (!token) return res.status(400).json({ error: 'token required for test mode' });

    try {
      const tokenHash = hashToken(token);
      const entry     = await kv.get(`webhook:${tokenHash}`);
      if (!entry?.encrypted) return res.status(404).json({ error: 'Webhook not found - register it first.' });

      const webhookUrl = decrypt(entry.encrypted);
      const embed = {
        title:       '✅  Test - RBX Radar',
        description: "Your Discord webhook is connected and working correctly!\nYou'll receive a notification like this whenever an active Roblox ban wave is detected on r/robloxhackers.",
        color:       0x22c55e,
        url:         'https://robloxbanwave.vercel.app',
        fields:      [{ name: 'Webhook status', value: 'Verified ✓', inline: true }],
        footer:      { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers' },
        timestamp:   new Date().toISOString(),
      };

      const r = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: 'RBX Radar', embeds: [embed] }),
      });

      if (r.ok || r.status === 204) return res.json({ ok: true });

      const text = await r.text().catch(() => '');
      return res.status(400).json({ error: `Discord returned ${r.status}. ${text.slice(0, 160)}` });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured' });
      return res.status(500).json({ error: e.message });
    }
  }

  // -- Normal broadcast: rate-limit by IP to prevent abuse ----------------------
  const ipHash = hashIp(req);
  try {
    const rlKey = `rl:notify:${ipHash}`;
    const cnt   = await kv.incr(rlKey);
    if (cnt === 1) await kv.expire(rlKey, 3600);
    if (cnt > 12) return res.status(429).json({ error: 'Too many requests' });
  } catch { /* non-fatal if KV unavailable for rate limit */ }

  let hashes;
  try {
    hashes = await kv.smembers('webhook:index');
  } catch (e) {
    if (kvError(e)) return res.status(503).json({ error: 'KV not configured' });
    return res.status(500).json({ error: e.message });
  }

  if (!hashes?.length) return res.json({ sent: 0, total: 0 });

  const now    = Date.now();
  let sent     = 0;
  let skipped  = 0;
  const failed = [];

  for (const hash of hashes) {
    try {
      const entry = await kv.get(`webhook:${hash}`);
      if (!entry?.encrypted) { skipped++; continue; }
      if (entry.notifiedAt && now - entry.notifiedAt < COOLDOWN_MS) { skipped++; continue; }

      const webhookUrl = decrypt(entry.encrypted);
      const embed = {
        title:       '⚠  Roblox Ban Wave Active',
        description: '**Do NOT use any Roblox executors right now.**\nA ban wave is being actively reported on r/robloxhackers.\nAccounts using executors risk permanent bans.',
        color:       0xef4444,
        url:         'https://robloxbanwave.vercel.app',
        fields:      topPost
          ? [{ name: 'Most Recent Report', value: `[${topPost.title}](${topPost.url})`, inline: false }]
          : [],
        footer:    { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers' },
        timestamp: new Date().toISOString(),
      };

      const r = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: 'RBX Radar', embeds: [embed] }),
      });

      if (r.ok || r.status === 204) {
        await kv.set(`webhook:${hash}`, { ...entry, notifiedAt: now });
        sent++;
      } else {
        failed.push(r.status);
      }
    } catch {
      failed.push('exception');
    }
  }

  return res.json({ sent, skipped, failed: failed.length });
}
