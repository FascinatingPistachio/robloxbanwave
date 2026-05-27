import { getPostsWithCache } from './_reddit-cache.js';

export default async function handler(req, res) {
  const { posts, source, fetchedAt, ratelimited, error } = await getPostsWithCache();

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.setHeader('X-Data-Source', source);
  if (fetchedAt) res.setHeader('X-Fetched-At', String(fetchedAt));

  if (source === 'error' && !posts.length) {
    return res.status(503).json({
      error: error || 'Reddit data unavailable — try again shortly.',
      data:  { children: [] },
    });
  }

  return res.json({
    data:         { children: posts.map(p => ({ data: p })) },
    _source:      source,
    _fetchedAt:   fetchedAt,
    _ratelimited: ratelimited ?? false,
  });
}
