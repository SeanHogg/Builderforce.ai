import { describe, it, expect } from 'vitest';
import { parseFeed } from './rssFeed';

describe('parseFeed (RSS 2.0)', () => {
  const rss = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <title>Example</title>
      <item>
        <title>First post</title>
        <link>https://ex.com/1</link>
        <guid>guid-1</guid>
      </item>
      <item>
        <title><![CDATA[Second & special]]></title>
        <link>https://ex.com/2</link>
        <guid>guid-2</guid>
      </item>
    </channel></rss>`;

  it('extracts items newest-first with guid as id', () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe('guid-1');
    expect(items[0]?.title).toBe('First post');
    expect(items[0]?.link).toBe('https://ex.com/1');
  });

  it('unwraps CDATA and decodes entities in titles', () => {
    const items = parseFeed(rss);
    expect(items[1]?.title).toBe('Second & special');
  });
});

describe('parseFeed (Atom)', () => {
  const atom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom one</title>
        <id>atom-id-1</id>
        <link rel="alternate" href="https://ex.com/a1"/>
      </entry>
    </feed>`;

  it('uses <id> and the alternate link href', () => {
    const items = parseFeed(atom);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('atom-id-1');
    expect(items[0]?.link).toBe('https://ex.com/a1');
  });
});

describe('parseFeed (degenerate)', () => {
  it('falls back to link, then title, for the id', () => {
    const items = parseFeed('<rss><item><title>No guid</title><link>https://ex.com/x</link></item></rss>');
    expect(items[0]?.id).toBe('https://ex.com/x');
  });
  it('returns empty for non-feed input', () => {
    expect(parseFeed('<html><body>not a feed</body></html>')).toEqual([]);
  });
});
