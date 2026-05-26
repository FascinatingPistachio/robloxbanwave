// GitHub Issues search — executor devs file issues when byfron/hyperion patches them.
// No auth needed for public search (60 req/hr unauthenticated).
const QUERY = 'roblox (banwave OR byfron OR hyperion OR "executor detected" OR "hwid ban" OR "krnl" OR "synapse" OR "delta executor" OR "fluxus" OR "evon")';

export default async function handler(req, res) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(QUERY)}&sort=created&order=desc&per_page=30`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':             'RBXRadar/1.0 (ban-wave monitor)',
        'Accept':                 'application/vnd.github+json',
        'X-GitHub-Api-Version':   '2022-11-28',
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'github returned ' + r.status });

    const data  = await r.json();
    const posts = (data.items || []).map(item => {
      const repo = (item.repository_url || '').replace('https://api.github.com/repos/', '');
      return {
        id:              String(item.id),
        title:           item.title || '',
        selftext:        (item.body || '').slice(0, 600),
        author:          item.user?.login || 'unknown',
        permalink:       item.html_url || '',
        score:           (item.reactions?.total_count) || 0,
        num_comments:    item.comments || 0,
        link_flair_text: repo,
        created_utc:     Math.floor(new Date(item.created_at).getTime() / 1000),
      };
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.json(posts);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
