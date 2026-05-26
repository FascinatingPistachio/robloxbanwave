export default async function handler(req, res) {
  const { subreddit, id, limit, depth } = req.query;
  if (!subreddit || !id) return res.status(400).json({ error: 'subreddit and id required' });

  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(id)}.json?limit=${encodeURIComponent(limit || '100')}&depth=${encodeURIComponent(depth || '3')}`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'RBXRadar/1.0 (ban-wave monitor; +https://github.com)',
        'Accept':     'application/json',
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'reddit returned ' + r.status });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
