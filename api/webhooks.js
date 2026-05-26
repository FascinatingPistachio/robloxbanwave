import { kv } from '@vercel/kv';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

// AES-256-GCM key derived from WEBHOOK_CIPHER_KEY env var.
// Set this to a random 64-char hex string in your Vercel project settings.
function getCipherKey() {
  const raw = process.env.WEBHOOK_CIPHER_KEY || 'CHANGE_ME_set_WEBHOOK_CIPHER_KEY_env_var';
  return createHash('sha256').update(raw).digest(); // always 32 bytes
}

function encrypt(text) {
  const iv  = randomBytes(16);
  const c   = createCipheriv('aes-256-gcm', getCipherKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [iv, tag, enc].map(b => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('bad ciphertext');
  const [iv, tag, enc] = parts.map(s => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', getCipherKey(), iv);
  d.setAuthTag(tag);
  return d.update(enc).toString('utf8') + d.final('utf8');
}

// One-way hash of the user's deletion token — stored in KV, never the raw token
function hashToken(token) {
  const salt = process.env.WEBHOOK_CIPHER_KEY || 'CHANGE_ME';
  return createHash('sha256').update(token + salt).digest('hex');
}

const DISCORD_RE = /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/.+/;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST') {
    const { webhookUrl } = req.body ?? {};
    if (!webhookUrl || !DISCORD_RE.test(webhookUrl)) {
      return res.status(400).json({ error: 'Provide a valid Discord webhook URL.' });
    }

    try {
      const token     = randomUUID();
      const tokenHash = hashToken(token);
      const encrypted = encrypt(webhookUrl);

      await kv.set(`webhook:${tokenHash}`, { encrypted, createdAt: Date.now() });
      await kv.sadd('webhook:index', tokenHash);

      return res.status(201).json({ token });
    } catch (e) {
      if (/KV_|UPSTASH|fetch failed/i.test(e.message ?? '')) {
        return res.status(503).json({ error: 'Webhook storage not set up — add Vercel KV to your project.' });
      }
      return res.status(500).json({ error: 'Server error. Try again.' });
    }
  }

  if (req.method === 'DELETE') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });

    try {
      const tokenHash = hashToken(token);
      const exists    = await kv.exists(`webhook:${tokenHash}`);
      if (!exists) return res.status(404).json({ error: 'Webhook not found — may already be removed.' });

      await kv.del(`webhook:${tokenHash}`);
      await kv.srem('webhook:index', tokenHash);

      return res.status(200).json({ ok: true });
    } catch (e) {
      if (/KV_|UPSTASH|fetch failed/i.test(e.message ?? '')) {
        return res.status(503).json({ error: 'Webhook storage not configured.' });
      }
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
