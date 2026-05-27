import { kv } from '@vercel/kv';
import { parseAtom } from './_atom-parser.js';

const CACHE_KEY = 'cache:reddit:posts:v3';
const BASE_TTL  = 5 * 60 * 1000;   // 5 min normal refresh
const MAX_MULT  = 12;               // max backoff → 60 min
const TIMEOUT   = 14000;            // 14 s per request

// Try search endpoint first, then regular new feed as fallback.
// Both are filtered by parseAtom to "ban wave" posts only.
const ENDPOINTS = [
  'https://www.reddit.com/r/robloxhackers/search.rss?q=banwave&sort=new&t=year&limit=100&restrict_sr=1',
  'https://old.reddit.com/r/robloxhackers/search.rss?q=banwave&sort=new&t=year&limit=100&restrict_sr=1',
  'https://www.reddit.com/r/robloxhackers/new.rss?limit=100',
];

const FETCH_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (compatible; RBXRadar/1.0; +https://robloxbanwave.vercel.app)',
  'Accept':          'application/atom+xml, application/rss+xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function isKvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

async function timedFetch(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: FETCH_HEADERS });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

async function safeKvGet() {
  try { return await kv.get(CACHE_KEY); } catch { return null; }
}

async function safeKvSet(value) {
  try { await kv.set(CACHE_KEY, value, { ex: 27 * 3600 }); } catch { /* non-fatal */ }
}

/**
 * Returns { posts, source, fetchedAt, ratelimited?, error? }
 *
 * source: 'reddit' | 'cache' | 'stale' | 'error'
 *
 * Always resolves — never throws. Callers get an empty array in the worst case.
 */
export async function getPostsWithCache() {
  const now    = Date.now();
  const cached = await safeKvGet();

  // Serve from fresh cache
  if (cached?.posts?.length && cached.nextFetchAt > now) {
    return { posts: cached.posts, source: 'cache', fetchedAt: cached.fetchedAt };
  }

  // Try each Reddit endpoint in order
  let lastError = null;
  for (const url of ENDPOINTS) {
    try {
      const r = await timedFetch(url);

      if (r.status === 403 || r.status === 429) {
        lastError = `HTTP ${r.status}`;
        // Increase backoff and continue to next endpoint
        continue;
      }
      if (!r.ok) { lastError = `HTTP ${r.status}`; continue; }

      const xml   = await r.text();
      const posts = parseAtom(xml);

      // Sanity check: empty result when we had data before is suspicious
      if (!posts.length && cached?.posts?.length) {
        return { posts: cached.posts, source: 'cache', fetchedAt: cached.fetchedAt };
      }

      // Success — reset backoff
      await safeKvSet({ posts, fetchedAt: now, nextFetchAt: now + BASE_TTL, backoffMult: 1 });
      return { posts, source: 'reddit', fetchedAt: now };

    } catch (e) {
      lastError = e.message;
    }
  }

  // All endpoints failed — extend stale cache with backoff
  if (cached?.posts?.length) {
    const mult  = Math.min((cached.backoffMult || 1) * 2, MAX_MULT);
    await safeKvSet({ ...cached, nextFetchAt: now + BASE_TTL * mult, backoffMult: mult });
    return {
      posts:       cached.posts,
      source:      'stale',
      fetchedAt:   cached.fetchedAt,
      ratelimited: true,
      error:       lastError,
    };
  }

  // No cache at all — return empty
  return { posts: [], source: 'error', fetchedAt: now, error: lastError || 'All Reddit endpoints unavailable' };
}
