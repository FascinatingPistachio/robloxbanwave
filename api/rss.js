import { getPostsWithCache } from './_reddit-cache.js';

function xmlEsc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req, res) {
  const { posts, source, fetchedAt } = await getPostsWithCache();

  const items = posts.map(p => {
    const url     = p.permalink.startsWith('http')
      ? p.permalink
      : `https://www.reddit.com${p.permalink}`;
    const pubDate = new Date(p.created_utc * 1000).toUTCString();
    const desc    = p.selftext
      ? xmlEsc(p.selftext.slice(0, 300))
      : `Banwave report from r/robloxhackers. Score: ${p.score}`;

    return `
  <item>
    <title>${xmlEsc(p.title)}</title>
    <link>${xmlEsc(url)}</link>
    <guid isPermaLink="true">${xmlEsc(url)}</guid>
    <pubDate>${pubDate}</pubDate>
    <author>noreply@reddit.com (u/${xmlEsc(p.author)})</author>
    <description>${desc}</description>
  </item>`;
  }).join('');

  const lastBuild = fetchedAt ? new Date(fetchedAt).toUTCString() : new Date().toUTCString();

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Roblox Ban Wave Monitor</title>
    <link>https://robloxbanwave.vercel.app</link>
    <description>Real-time Roblox executor ban wave tracker — community posts from r/robloxhackers. Not affiliated with Roblox Corporation.</description>
    <language>en-us</language>
    <ttl>5</ttl>
    <lastBuildDate>${lastBuild}</lastBuildDate>
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
  res.setHeader('X-Data-Source', source);
  return res.send(rss);
}
