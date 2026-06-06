/**
 * Minimal RSS / Atom feed reader for the rss workflow trigger.
 *
 * The Workers runtime has no DOM/XML parser, so this does a deliberately small
 * regex extraction of the fields we need to detect "new items": a stable id
 * (RSS `<guid>`, else `<link>`, else `<title>`; Atom `<id>`, else `<link href>`),
 * a title, and a link. It is not a general-purpose XML parser — it targets the
 * common RSS 2.0 and Atom shapes feeds actually publish.
 *
 * Items are returned newest-first (document order, which both formats use).
 */

export interface FeedItem {
  /** Stable identifier used for dedup (guid / atom id / link / title). */
  id: string;
  title: string;
  link: string;
}

/** Strip CDATA wrappers and decode the handful of XML entities feeds use. */
function clean(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata && cdata[1] !== undefined) s = cdata[1];
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagContent(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : undefined;
}

/** Atom links are `<link href="…"/>`; prefer rel="alternate" or the first link. */
function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  if (links.length === 0) return undefined;
  const alt = links.find((l) => /rel=["']alternate["']/i.test(l[0]));
  return (alt ?? links[0])?.[1];
}

/** Parse a feed body (RSS or Atom) into items, newest-first. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  // RSS <item> and Atom <entry> are handled the same way.
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);

  for (const block of blocks) {
    const title = clean(tagContent(block, 'title'));
    const guid = clean(tagContent(block, 'guid') ?? tagContent(block, 'id'));
    const link = clean(tagContent(block, 'link')) || clean(atomLink(block));
    const id = guid || link || title;
    if (!id) continue;
    items.push({ id, title, link });
  }
  return items;
}

/** Fetch + parse a feed URL into items (newest-first). Throws on HTTP failure. */
export async function fetchFeedItems(feedUrl: string): Promise<FeedItem[]> {
  const res = await fetch(feedUrl, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return parseFeed(await res.text());
}
