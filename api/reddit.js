// Reddit Atom/RSS feed — different endpoint, avoids the JSON API 403
function decode(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseAtom(xml) {
  const posts = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const get = (tag) => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decode(m[1].trim()) : '';
    };
    const href = (entry.match(/href="([^"]+)"/) || [])[1] || '';
    const id   = get('id');

    // Reddit embeds score in its own namespace
    const scoreMatch = entry.match(/<(?:\w+:)?score[^>]*>(\d+)<\/(?:\w+:)?score>/);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

    const postId    = (id.match(/comments\/([a-z0-9]+)\//) || [])[1] || id.slice(-8);
    const permalink = href.replace('https://www.reddit.com', '');
    const updated   = get('updated') || get('published');

    // content is double-encoded HTML — strip tags to recover body text
    const rawContent = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
    const selftext   = decode(rawContent)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);

    // author: Reddit RSS gives "/u/name", strip the prefix
    const authorRaw = get('name');
    const author    = authorRaw.replace(/^\/u\//, '');

    posts.push({
      id:              postId,
      title:           get('title'),
      selftext,
      author,
      permalink,
      score,
      num_comments:    null,
      link_flair_text: null,
      created_utc:     updated ? Math.floor(new Date(updated).getTime() / 1000) : Math.floor(Date.now() / 1000),
    });
  }
  return posts;
}

export default async function handler(req, res) {
  const { subreddit, sort, limit, search, t } = req.query;
  if (!subreddit) return res.status(400).json({ error: 'subreddit required' });

  const sub = encodeURIComponent(subreddit);
  let url;
  if (search) {
    url = `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(search)}&sort=new&t=${encodeURIComponent(t || 'month')}&restrict_sr=1`;
  } else {
    url = `https://www.reddit.com/r/${sub}/${encodeURIComponent(sort || 'new')}.rss?limit=${encodeURIComponent(limit || '25')}`;
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'RBXRadar/1.0 (ban-wave monitor)',
        'Accept':     'application/atom+xml, application/rss+xml, text/xml, */*',
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'reddit rss returned ' + r.status });
    const xml   = await r.text();
    const posts = parseAtom(xml);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.json({ data: { children: posts.map(p => ({ data: p })) } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
