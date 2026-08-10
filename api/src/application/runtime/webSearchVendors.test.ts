/**
 * The web-search vendor port: the pure result-shaping half (which is also the security
 * half — a search index is untrusted input that the agent will very likely fetch next)
 * and each adapter's request/error contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exaSearchVendor, linkupSearchVendor, parseExaResults, parseLinkupResults,
  parseSearxngResults, parseTavilyResults, parseWikipediaResults, searxngSearchVendor,
  snippetToText, tavilySearchVendor, toSearchRow, webSearchVendor, wikipediaArticleUrl,
  wikipediaSearchVendor, MAX_SEARCH_RESULTS, type WebSearchVendor,
} from './webSearchVendors';

/** Stub `fetch` with one canned response. */
function stubFetch(res: Partial<Response> & { bodyText?: string }): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(res.bodyText ?? '', {
    status: res.status ?? 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** The request a vendor actually made. */
function lastRequest(fn: ReturnType<typeof vi.fn>): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('toSearchRow — the shared security filter', () => {
  it('keeps a public URL and flattens highlight markup out of the snippet', () => {
    expect(toSearchRow({ title: 'React docs', url: 'https://react.dev/learn', snippet: 'Learn <strong>React</strong>' }))
      .toEqual({ url: 'https://react.dev/learn', title: 'React docs', snippet: 'Learn React' });
  });

  it('drops a row whose URL the egress policy refuses (a poisoned index entry)', () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/admin', 'file:///etc/passwd', '']) {
      expect(toSearchRow({ title: 'x', url })).toBeNull();
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

describe('vendor payload parsers', () => {
  // Each vendor names its fields differently — Tavily `content`, Exa `text`, Linkup
  // `name`/`content`, SearXNG `content`. Getting one wrong yields titleless, snippetless
  // results rather than an error, which is exactly the kind of silent degradation worth
  // a test per vendor.
  it('maps Tavily rows', () => {
    expect(parseTavilyResults({ results: [{ title: 'T', url: 'https://example.com/a', content: 'body' }] }))
      .toEqual([{ url: 'https://example.com/a', title: 'T', snippet: 'body' }]);
  });

  it('maps Exa rows, including its `text` contents field', () => {
    expect(parseExaResults({ results: [{ title: 'E', url: 'https://example.com/b', text: 'body' }] }))
      .toEqual([{ url: 'https://example.com/b', title: 'E', snippet: 'body' }]);
  });

  it('maps Linkup rows, whose title field is `name`', () => {
    expect(parseLinkupResults({ results: [{ type: 'text', name: 'L', url: 'https://example.com/c', content: 'body' }] }))
      .toEqual([{ url: 'https://example.com/c', title: 'L', snippet: 'body' }]);
  });

  it('maps SearXNG rows', () => {
    expect(parseSearxngResults({ results: [{ title: 'S', url: 'https://example.com/d', content: 'body' }] }))
      .toEqual([{ url: 'https://example.com/d', title: 'S', snippet: 'body' }]);
  });

  it('caps every parser at MAX_SEARCH_RESULTS', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ title: `r${i}`, name: `r${i}`, url: `https://example.com/${i}`, content: 'c', text: 'c' }));
    for (const parse of [parseTavilyResults, parseExaResults, parseLinkupResults, parseSearxngResults]) {
      expect(parse({ results: rows })).toHaveLength(MAX_SEARCH_RESULTS);
    }
  });

  it('tolerates a malformed / empty payload instead of throwing', () => {
    for (const parse of [parseTavilyResults, parseExaResults, parseLinkupResults, parseSearxngResults]) {
      for (const junk of [null, undefined, {}, { results: 'nope' }, 'string']) {
        expect(parse(junk)).toEqual([]);
      }
    }
  });
});

describe('keyed vendors (Tavily / Exa / Linkup)', () => {
  const KEYED: Array<[WebSearchVendor, string, (init: RequestInit) => string | undefined]> = [
    [tavilySearchVendor, 'api.tavily.com', (init) => (init.headers as Record<string, string>).Authorization],
    [exaSearchVendor, 'api.exa.ai', (init) => (init.headers as Record<string, string>)['x-api-key']],
    [linkupSearchVendor, 'api.linkup.so', (init) => (init.headers as Record<string, string>).Authorization],
  ];

  it.each(KEYED)('$label POSTs the query with its own auth header', async (vendor, host, authOf) => {
    const fn = stubFetch({ bodyText: JSON.stringify({ results: [{ title: 'T', name: 'T', url: 'https://example.com/x', content: 'c', text: 'c' }] }) });
    const r = await vendor.search('react hooks', { apiKey: 'secret-key' });

    expect(r.ok).toBe(true);
    expect(r.coverage).toBe('web');
    const { url, init, body } = lastRequest(fn);
    expect(url).toContain(host);
    expect(init.method).toBe('POST');
    expect(authOf(init)).toContain('secret-key');
    // The query must actually be in the body — every one of these is POST-with-a-body,
    // and a vendor that names the field differently would otherwise search for nothing.
    expect(JSON.stringify(body)).toContain('react hooks');
  });

  it.each(KEYED)('$label refuses without a key rather than calling the vendor unauthenticated', async (vendor) => {
    const fn = stubFetch({ bodyText: '{}' });
    expect(await vendor.search('q', { apiKey: null })).toMatchObject({ ok: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('reports a rejected key as a non-throwing error result', async () => {
    stubFetch({ status: 401 });
    const r = await tavilySearchVendor.search('q', { apiKey: 'bad-key' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401.*rejected/);
  });

  it('names a rate limit specifically', async () => {
    stubFetch({ status: 429 });
    expect((await tavilySearchVendor.search('q', { apiKey: 'k' })).error).toMatch(/rate-limited/);
  });

  it('turns a transport failure into an error result, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const r = await tavilySearchVendor.search('q', { apiKey: 'k' });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/request failed/);
  });

  it('reports a non-JSON body rather than throwing on parse', async () => {
    stubFetch({ bodyText: '<html>nope</html>' });
    expect((await tavilySearchVendor.search('q', { apiKey: 'k' })).error).toMatch(/non-JSON/);
  });
});

describe('searxngSearchVendor (operator-hosted)', () => {
  it('queries the operator instance for JSON, with no credential of any kind', async () => {
    const fn = stubFetch({ bodyText: JSON.stringify({ results: [{ title: 'S', url: 'https://example.com/d', content: 'c' }] }) });
    const r = await searxngSearchVendor.search('michigan districts', { apiKey: null, baseUrl: 'https://search.internal/' });

    expect(r.ok).toBe(true);
    expect(r.coverage).toBe('web');
    const { url, init } = lastRequest(fn);
    // The trailing slash on the configured base must not produce `//search`.
    expect(url).toBe('https://search.internal/search?q=michigan+districts&format=json');
    expect(JSON.stringify(init.headers)).not.toMatch(/token|key|authorization/i);
  });

  it('accepts a PRIVATE base URL — a self-hosted instance is the intended deployment', async () => {
    // The egress policy guards untrusted URLs; this one is operator configuration, and
    // blocking it would reject exactly the setup this vendor exists for.
    const fn = stubFetch({ bodyText: '{"results":[]}' });
    expect(await searxngSearchVendor.search('q', { apiKey: null, baseUrl: 'http://searxng:8080' })).toMatchObject({ ok: true });
    expect(fn).toHaveBeenCalled();
  });

  it('refuses cleanly when the deployment has no instance configured', async () => {
    const fn = stubFetch({ bodyText: '{}' });
    expect(await searxngSearchVendor.search('q', { apiKey: null })).toMatchObject({ ok: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('names the JSON-format misconfiguration, which is otherwise invisible', async () => {
    stubFetch({ status: 403 });
    const r = await searxngSearchVendor.search('q', { apiKey: null, baseUrl: 'https://search.internal' });
    expect(r.error).toMatch(/formats: \[json\]/);
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
    const r = await wikipediaSearchVendor.search('michigan school districts', { apiKey: null });

    expect(r.ok).toBe(true);
    expect(r.coverage).toBe('encyclopedic');
    expect(r.attribution).toMatch(/CC BY-SA/);
    expect(r.results).toEqual([{ url: 'https://en.wikipedia.org/wiki/Detroit', title: 'Detroit' }]);
    const { url, init } = lastRequest(fn);
    expect(url).toContain('en.wikipedia.org/w/api.php');
    expect(url).toContain('srsearch=michigan+school+districts');
    // No credential header of any kind — this is the whole point of the vendor.
    expect(JSON.stringify(init.headers)).not.toMatch(/token|key|authorization/i);
  });

  it('turns a vendor outage into an error result, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await wikipediaSearchVendor.search('q', { apiKey: null })).toMatchObject({ ok: false });
  });
});

describe('webSearchVendor registry', () => {
  it('resolves every wired id and refuses an unknown one', () => {
    expect(webSearchVendor('tavily')).toBe(tavilySearchVendor);
    expect(webSearchVendor('exa')).toBe(exaSearchVendor);
    expect(webSearchVendor('linkup')).toBe(linkupSearchVendor);
    expect(webSearchVendor('searxng')).toBe(searxngSearchVendor);
    expect(webSearchVendor('wikipedia')).toBe(wikipediaSearchVendor);
    expect(webSearchVendor('not_a_vendor')).toBeNull();
  });

  it('no longer answers to the retired Brave id, so a leftover credential row is skipped', () => {
    // The enum label survives (PostgreSQL cannot drop one); the ADAPTER does not, and
    // the resolver treats an unwired vendor as absent.
    expect(webSearchVendor('brave_search')).toBeNull();
  });

  it('marks exactly the keyless vendors as keyless — the credential lookup filters on it', () => {
    expect(wikipediaSearchVendor.keyless).toBe(true);
    expect(searxngSearchVendor.keyless).toBe(true);
    expect(tavilySearchVendor.keyless).toBe(false);
    expect(exaSearchVendor.keyless).toBe(false);
    expect(linkupSearchVendor.keyless).toBe(false);
  });
});
