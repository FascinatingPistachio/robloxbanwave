export function htmlDecode(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

// Parses Reddit Atom/RSS XML and returns an array of post objects.
// Filters to only posts whose title contains "ban wave" (case-insensitive).
export function parseAtom(xml) {
  const posts = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const get = tag => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? htmlDecode(m[1].trim()) : '';
    };

    const title = get('title');
    if (!title || !/ban\s*wave/i.test(title)) continue;

    const href  = (entry.match(/href="([^"]+)"/) || [])[1] || '';
    const id    = get('id');

    const scoreMatch = entry.match(/<(?:\w+:)?score[^>]*>(\d+)<\/(?:\w+:)?score>/);
    const score      = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const postId     = (id.match(/comments\/([a-z0-9]+)\//) || [])[1] || id.slice(-8);
    const updated    = get('updated') || get('published');

    const rawContent = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
    const selftext   = htmlDecode(rawContent)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);

    const author = get('name').replace(/^\/u\//, '');
    const permalink = href.replace('https://www.reddit.com', '') ||
                      `/r/robloxhackers/comments/${postId}/`;

    posts.push({
      id:              postId,
      title,
      selftext,
      author,
      permalink,
      score,
      num_comments:    null,
      link_flair_text: null,
      created_utc:     updated
        ? Math.floor(new Date(updated).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
    });
  }
  return posts;
}
