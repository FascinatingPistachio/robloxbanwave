function xmlEsc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function htmlDecode(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

function parseAtom(xml) {
  const posts = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const get = tag => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? htmlDecode(m[1].trim()) : '';
    };
    const href  = (entry.match(/href="([^"]+)"/) || [])[1] || '';
    const id    = get('id');
    const title = get('title');
    if (!/ban\s*wave/i.test(title)) continue;

    const scoreMatch = entry.match(/<(?:\w+:)?score[^>]*>(\d+)<\/(?:\w+:)?score>/);
    const score      = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const postId     = (id.match(/comments\/([a-z0-9]+)\//) || [])[1] || id.slice(-8);
    const updated    = get('updated') || get('published');
    const author     = get('name').replace(/^\/u\//, '');

    const rawContent = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
    const selftext   = htmlDecode(rawContent).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

    posts.push({
      id:     postId,
      title,
      url:    href || `https://www.reddit.com/r/robloxhackers/comments/${postId}/`,
      author,
      score,
      desc:   selftext || `Banwave report from r/robloxhackers. Score: ${score}`,
      date:   updated ? new Date(updated) : new Date(),
    });
  }
  return posts;
}

export default async function handler(req, res) {
  try {
    const url = 'https://www.reddit.com/r/robloxhackers/search.rss?q=banwave&sort=new&t=month&limit=25&restrict_sr=1';
    const r   = await fetch(url, {
      headers: { 'User-Agent': 'RBXRadar/1.0 (robloxbanwave.vercel.app)', Accept: 'application/atom+xml, */*' },
    });
    if (!r.ok) throw new Error('Reddit returned ' + r.status);
    const xml   = await r.text();
    const posts = parseAtom(xml);

    const items = posts.map(p => `
  <item>
    <title>${xmlEsc(p.title)}</title>
    <link>${xmlEsc(p.url)}</link>
    <guid isPermaLink="true">${xmlEsc(p.url)}</guid>
    <pubDate>${p.date.toUTCString()}</pubDate>
    <author>noreply@reddit.com (u/${xmlEsc(p.author)})</author>
    <description>${xmlEsc(p.desc)}</description>
    <source url="https://robloxbanwave.vercel.app/api/rss">Roblox Ban Wave Monitor</source>
  </item>`).join('');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Roblox Ban Wave Monitor</title>
    <link>https://robloxbanwave.vercel.app</link>
    <description>Real-time Roblox executor ban wave tracker — community posts from r/robloxhackers.</description>
    <language>en-us</language>
    <ttl>60</ttl>
    <atom:link href="https://robloxbanwave.vercel.app/api/rss" rel="self" type="application/rss+xml"/>
    <image>
      <url>https://robloxbanwave.vercel.app/favicon.svg</url>
      <title>Roblox Ban Wave Monitor</title>
      <link>https://robloxbanwave.vercel.app</link>
    </image>
    ${items}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.send(rss);
  } catch (e) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: e.message });
  }
}
