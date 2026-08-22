/**
 * Feed parsing — the part of a scraper that is actually wrong.
 *
 * A scraper fails silently: a feed shape it does not understand produces zero
 * listings and a SUCCESSFUL run, and nobody notices until somebody asks why a
 * board stopped producing candidates. Every case here is one of those.
 */

import { describe, expect, it } from 'vitest';
import { listingSlug, parseJsonFeed, parseRssFeed } from './sourcingFeed';

describe('RSS', () => {
  it('reads a standard RSS item', () => {
    const [job] = parseRssFeed(`
      <rss><channel>
        <item>
          <title>Senior Platform Engineer</title>
          <description>Build the thing.</description>
          <company>Acme</company>
          <location>Dublin</location>
          <link>https://jobs.example.com/1</link>
          <category>Full-time</category>
        </item>
      </channel></rss>`);

    expect(job).toEqual({
      title: 'Senior Platform Engineer',
      description: 'Build the thing.',
      company: 'Acme',
      location: 'Dublin',
      url: 'https://jobs.example.com/1',
      jobType: 'Full-time',
    });
  });

  it('reads an ATOM entry, which the source product silently ignored', () => {
    // `<entry>` with an href-only `<link>`. The original parser matched only
    // `<item>` and only element bodies, so every Atom feed an operator added
    // produced zero listings and reported success.
    const jobs = parseRssFeed(`
      <feed>
        <entry>
          <title>Staff SRE</title>
          <summary>Keep it up.</summary>
          <link href="https://jobs.example.com/2"/>
        </entry>
      </feed>`);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Staff SRE');
    expect(jobs[0]?.description).toBe('Keep it up.');
    expect(jobs[0]?.url).toBe('https://jobs.example.com/2');
  });

  it('unwraps CDATA and strips the markup inside it', () => {
    const [job] = parseRssFeed(
      '<item><title><![CDATA[Head of <b>Data</b>]]></title>'
      + '<description><![CDATA[<p>Line one</p><p>Line two</p>]]></description></item>',
    );
    expect(job?.title).toBe('Head of Data');
    expect(job?.description).toBe('Line one Line two');
  });

  it('decodes the entities that survive markup stripping', () => {
    // `&amp;` in a company name is the single most visible version of this bug:
    // it renders literally on the listing card.
    const [job] = parseRssFeed('<item><title>Sales &amp; Marketing Lead</title></item>');
    expect(job?.title).toBe('Sales & Marketing Lead');
  });

  it('handles an item element carrying attributes', () => {
    const jobs = parseRssFeed('<item xmlns:x="urn:x"><title>Analyst</title></item>');
    expect(jobs).toHaveLength(1);
  });

  it('skips an item with no title rather than writing a blank listing', () => {
    expect(parseRssFeed('<item><description>Nothing</description></item>')).toEqual([]);
  });

  it('returns nothing for a body that is not a feed', () => {
    expect(parseRssFeed('<html><body>Not a feed</body></html>')).toEqual([]);
    expect(parseRssFeed('')).toEqual([]);
  });
});

describe('JSON', () => {
  const payload = {
    data: { results: [{ position: 'Designer', org: { name: 'Acme' }, city: 'Cork' }] },
  };

  it('walks a nested items path and an operator field mapping', () => {
    const jobs = parseJsonFeed(payload, {
      itemsPath: 'data.results',
      mapping: { title: 'position', company: 'org.name', location: 'city' },
    });
    expect(jobs).toEqual([{
      title: 'Designer', description: '', company: 'Acme',
      location: 'Cork', url: '', jobType: '',
    }]);
  });

  it('returns nothing when the items path misses, rather than throwing', () => {
    // An operator's mapping is a guess about somebody else's payload. A wrong
    // guess must produce an empty run, not a crashed sweep that stops every
    // OTHER source behind it.
    expect(parseJsonFeed(payload, { itemsPath: 'data.nope' })).toEqual([]);
    expect(parseJsonFeed(null, { itemsPath: 'a.b.c' })).toEqual([]);
    expect(parseJsonFeed({ jobs: 'not-an-array' })).toEqual([]);
  });

  it('drops a field mapped at the wrong level instead of stringifying an object', () => {
    // `String({})` is `[object Object]`, which looks like real data in a title.
    const jobs = parseJsonFeed(payload, {
      itemsPath: 'data.results',
      mapping: { title: 'position', company: 'org' },
    });
    expect(jobs[0]?.company).toBe('');
  });

  it('skips a row whose mapped title is missing', () => {
    const jobs = parseJsonFeed({ jobs: [{ other: 'x' }, { title: 'Real' }] });
    expect(jobs.map((j) => j.title)).toEqual(['Real']);
  });

  it('coerces a numeric field rather than dropping it', () => {
    const jobs = parseJsonFeed({ jobs: [{ title: 'Role', location: 12345 }] });
    expect(jobs[0]?.location).toBe('12345');
  });
});

describe('listing identity', () => {
  const base = { title: 'Engineer', description: '', company: 'Acme', location: 'Dublin', url: '', jobType: '' };

  it('is stable for the same listing', async () => {
    expect(await listingSlug(base)).toBe(await listingSlug({ ...base }));
  });

  it('prefers the URL, so a re-titled posting stays one row', async () => {
    const withUrl = { ...base, url: 'https://jobs.example.com/9' };
    const renamed = { ...withUrl, title: 'Senior Engineer' };
    expect(await listingSlug(withUrl)).toBe(await listingSlug(renamed));
  });

  it('ignores case and surrounding space in the URL', async () => {
    const a = { ...base, url: 'https://Jobs.Example.com/9' };
    const b = { ...base, url: '  https://jobs.example.com/9  ' };
    expect(await listingSlug(a)).toBe(await listingSlug(b));
  });

  it('falls back to the three fields that name a job', async () => {
    const other = { ...base, company: 'Globex' };
    expect(await listingSlug(base)).not.toBe(await listingSlug(other));
  });

  it('cannot collide a fingerprint with a URL slug', async () => {
    // Different prefixes, so a listing whose URL happens to hash like another
    // listing's fields is still a different row.
    expect(await listingSlug(base)).toMatch(/^f:/);
    expect(await listingSlug({ ...base, url: 'https://x.example.com' })).toMatch(/^u:/);
  });

  it('fits the slug column', async () => {
    const slug = await listingSlug({ ...base, title: 'x'.repeat(500) });
    expect(slug.length).toBeLessThanOrEqual(160);
  });
});
