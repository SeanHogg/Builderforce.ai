/**
 * The web-search vendor port: the pure result-shaping half (which is also the security
 * half — a search index is untrusted input that the agent will very likely fetch next)
 * and the Brave adapter's error contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  braveSearchVendor, parseBraveResults, parseWikipediaResults, snippetToText, webSearchVendor,
  wikipediaArticleUrl, wikipediaSearchVendor, MAX_SEARCH_RESULTS,
} from './webSearchVendors';

/** A minimal Brave payload with `n` synthetic results. */
function bravePayload(rows: Array<{ title?: unknown; url?: unknown; description?: unknown }>): unknown {
  return { web: { results: rows } };
}

/** Stub `fetch` with one canned response. */
function stubFetch(res: Partial<Response> & { bodyText?: string }): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(res.bodyText ?? '', {
    status: res.status ?? 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('parseBraveResults', () => {
  it('maps title/url/description onto the shared result shape', () => {
    const out = parseBraveResults(bravePayload([
      { title: 'React docs', url: 'https://react.dev/learn', description: 'Learn <strong>React</strong> today' },
    ]));
    expect(out).toEqual([{ url: 'https://react.dev/learn', title: 'React docs', snippet: 'Learn React today' }]);
  });

  it('drops results whose URL the egress policy would refuse (a poisoned index entry)', () => {
    const out = parseBraveResults(bravePayload([
      { title: 'ok', url: 'https://example.com/a' },
      { title: 'metadata', url: 'http://169.254.169.254/latest/meta-data/' },
      { title: 'loopback', url: 'http://localhost:8080/admin' },
      { title: 'file', url: 'file:///etc/passwd' },
    ]));
    expect(out.map((r) => r.url)).toEqual(['https://example.com/a']);
  });

  it('drops rows with no usable URL and caps the result count', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ title: `r${i}`, url: `https://example.com/${i}` }));
    rows.push({ title: 'no url', url: '' as unknown as string });
    const out = parseBraveResults(bravePayload(rows));
    expect(out).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it('tolerates a malformed / empty payload instead of throwing', () => {
    for (const junk of [null, undefined, {}, { web: {} }, { web: { results: 'nope' } }, 'string']) {
      expect(parseBraveResults(junk)).toEqual([]);
    }
  });
});

describe('snippetToText', () => {
  it('flattens highlight markup and entities to one line', () => {
    expect(snippetToText('a <strong>b</strong>\n c &amp; d')).toBe('a b c & d');
  });
  it('returns undefined for empty / non-string input', () => {
    expect(snippetToText('')).toBeUndefined();
    expect(snippetToText('   ')).toBeUndefined();
    expect(snippetToText(42)).toBeUndefined();
  });
  it('caps snippet length', () => {
    expect(snippetToText('x'.repeat(1000), 50)).toHaveLength(50);
  });
});

describe('braveSearchVendor', () => {
  it('sends the key as the subscription header and parses the results', async () => {
    const fn = stubFetch({ bodyText: JSON.stringify(bravePayload([{ title: 'T', url: 'https://example.com/x' }])) });
    const r = await braveSearchVendor.search('react hooks', 'secret-key');

    expect(r.ok).toBe(true);
    expect(r.results).toEqual([{ url: 'https://example.com/x', title: 'T' }]);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.search.brave.com');
    expect(url).toContain('q=react%20hooks');
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('secret-key');
  });

  it('reports a rejected key as a non-throwing error result', async () => {
    stubFetch({ status: 401 });
    const r = await braveSearchVendor.search('q', 'bad-key');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401.*rejected/);
  });

  it('names a rate limit specifically', async () => {
    stubFetch({ status: 429 });
    const r = await braveSearchVendor.search('q', 'k');
    expect(r.error).toMatch(/rate-limited/);
  });

  it('turns a transport failure into an error result, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const r = await braveSearchVendor.search('q', 'k');
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/search request failed/);
  });

  it('reports a non-JSON body rather than throwing on parse', async () => {
    stubFetch({ bodyText: '<html>nope</html>' });
    const r = await braveSearchVendor.search('q', 'k');
    expect(r.error).toMatch(/non-JSON/);
  });
});

describe('parseWikipediaResults', () => {
  /** A minimal MediaWiki `list=search` payload. */
  const payload = (rows: Array<{ title?: unknown; snippet?: unknown }>): unknown => ({ query: { search: rows } });

  it('turns article titles into fetchable canonical URLs', () => {
    const out = parseWikipediaResults(payload([
      { title: 'Ann Arbor Public Schools', snippet: 'a <span class="searchmatch">district</span> in Michigan' },
    ]));
    expect(out).toEqual([{
      url: 'https://en.wikipedia.org/wiki/Ann_Arbor_Public_Schools',
      title: 'Ann Arbor Public Schools',
      snippet: 'a district in Michigan',
    }]);
  });

  it('percent-encodes a title so the URL survives punctuation', () => {
    expect(wikipediaArticleUrl('Guns N\' Roses')).toBe("https://en.wikipedia.org/wiki/Guns_N'_Roses");
    expect(wikipediaArticleUrl('C++')).toBe('https://en.wikipedia.org/wiki/C%2B%2B');
  });

  it('drops untitled rows and caps the result count', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ title: `Article ${i}` }));
    rows.push({ title: '  ' });
    expect(parseWikipediaResults(payload(rows))).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it('tolerates a malformed / empty payload instead of throwing', () => {
    for (const junk of [null, undefined, {}, { query: {} }, { query: { search: 'nope' } }, 'string']) {
      expect(parseWikipediaResults(junk)).toEqual([]);
    }
  });
});

describe('wikipediaSearchVendor (the keyless floor)', () => {
  it('searches with NO key and reports its narrower coverage', async () => {
    const fn = stubFetch({ bodyText: JSON.stringify({ query: { search: [{ title: 'Detroit' }] } }) });
    const r = await wikipediaSearchVendor.search('michigan school districts', null);

    expect(r.ok).toBe(true);
    expect(r.coverage).toBe('encyclopedic');
    expect(r.attribution).toMatch(/CC BY-SA/);
    expect(r.results).toEqual([{ url: 'https://en.wikipedia.org/wiki/Detroit', title: 'Detroit' }]);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('en.wikipedia.org/w/api.php');
    expect(url).toContain('srsearch=michigan+school+districts');
    // No credential header of any kind — this is the whole point of the vendor.
    expect(JSON.stringify(init.headers)).not.toMatch(/token|key|authorization/i);
  });

  it('turns a vendor outage into an error result, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await wikipediaSearchVendor.search('q', null)).toMatchObject({ ok: false });
  });
});

describe('braveSearchVendor without a key', () => {
  it('refuses rather than calling the vendor unauthenticated', async () => {
    const fn = stubFetch({ bodyText: '{}' });
    expect(await braveSearchVendor.search('q', null)).toMatchObject({ ok: false });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('webSearchVendor registry', () => {
  it('resolves a wired id and refuses an unknown one', () => {
    expect(webSearchVendor('brave_search')).toBe(braveSearchVendor);
    expect(webSearchVendor('wikipedia')).toBe(wikipediaSearchVendor);
    expect(webSearchVendor('not_a_vendor')).toBeNull();
  });

  it('marks exactly the keyless vendors as keyless — the credential lookup filters on it', () => {
    expect(wikipediaSearchVendor.keyless).toBe(true);
    expect(braveSearchVendor.keyless).toBe(false);
  });
});
