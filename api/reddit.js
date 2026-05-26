export default async function handler(req, res) {
  const { subreddit, sort, limit, search, t } = req.query;
  if (!subreddit) return res.status(400).json({ error: 'subreddit required' });

  const sub   = encodeURIComponent(subreddit);
  const lim   = encodeURIComponent(limit   || '50');
  const sortQ = encodeURIComponent(sort    || 'new');

  let url;
  if (search) {
    url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(search)}&sort=new&t=${encodeURIComponent(t || 'week')}&limit=${lim}&restrict_sr=1`;
  } else {
    url = `https://www.reddit.com/r/${sub}/${sortQ}.json?limit=${lim}`;
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'RBXRadar/1.0 (ban-wave monitor; +https://github.com)',
        'Accept':     'application/json',
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'reddit returned ' + r.status });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
