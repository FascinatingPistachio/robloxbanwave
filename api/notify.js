import { kv } from '@vercel/kv';
import { decrypt } from './webhooks.js';

const COOLDOWN_MS = 45 * 60 * 1000; // 45 minutes between notifications per webhook

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { topPost } = req.body ?? {};

  let hashes;
  try {
    hashes = await kv.smembers('webhook:index');
  } catch (e) {
    if (/KV_|UPSTASH|fetch failed/i.test(e.message ?? '')) {
      return res.status(503).json({ error: 'KV not configured' });
    }
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

      // Cooldown: skip if notified recently
      if (entry.notifiedAt && now - entry.notifiedAt < COOLDOWN_MS) { skipped++; continue; }

      const webhookUrl = decrypt(entry.encrypted);

      const embed = {
        title: '⚠  Roblox Ban Wave Active',
        description:
          '**Do NOT use any Roblox executors right now.**\n' +
          'A ban wave is being actively reported on r/robloxhackers.\n' +
          'Accounts using executors risk permanent bans.',
        color: 0xef4444,
        url: 'https://robloxbanwave.vercel.app',
        fields: topPost
          ? [{ name: 'Most Recent Report', value: `[${topPost.title}](${topPost.url})`, inline: false }]
          : [],
        footer: { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers' },
        timestamp: new Date().toISOString(),
      };

      const r = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: 'RBX Radar', embeds: [embed] }),
      });

      if (r.ok || r.status === 204) {
        // Update cooldown timestamp
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
