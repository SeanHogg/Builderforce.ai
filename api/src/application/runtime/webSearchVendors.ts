/**
 * Web-search VENDOR PORT (+ its concrete adapters) — the missing half of the cloud
 * `web` capability. `web_fetch` reads a URL the agent already has; discovering that URL
 * needs a search engine, so this module is deliberately a PORT with an id-keyed
 * registry rather than a hard-wired vendor — adding Tavily/Exa/SerpAPI later is one
 * adapter object plus one enum value, with no change to `cloudWeb.ts` or the engine.
 *
 * Vendors come in THREE kinds, and the ladder between them is the whole reason research
 * works on a workspace with nothing configured:
 *
 *  • **Credentialed** ({@link CREDENTIALED_WEB_SEARCH_VENDOR_IDS}) — Tavily, Exa, Linkup.
 *    A general web index with page CONTENT in the response, metered per query, key
 *    stored per tenant in `integration_credentials` (see `webSearchCredential.ts`).
 *    Widest coverage; each has a standing free tier a tenant can self-serve.
 *  • **Self-hosted** ({@link searxngSearchVendor}) — a SearXNG instance the OPERATOR
 *    runs. Real open-web coverage with no vendor account and no per-query meter, which
 *    is the right default for a self-hosted product. Addressed by URL, not by key.
 *  • **Keyless** ({@link KEYLESS_WEB_SEARCH_VENDOR_IDS}) — no account, no meter, no
 *    infrastructure, a licence that only asks for attribution. Narrower (encyclopedic,
 *    not the open web), but REAL, citable, fetchable evidence rather than model recall.
 *
 * The keyless floor exists because search used to self-gate to nothing: a logged-out
 * visitor or a fresh free workspace asked "research X and plot it" and the pipeline
 * stopped at step one with an actionable-but-useless refusal. Geocoding was made keyless
 * for exactly this reason (`application/web/geocode.ts`); this is the same decision
 * applied to the step before it. A tenant key or an operator's SearXNG still WINS — the
 * keyless vendor is a floor, not a ceiling.
 *
 * Every adapter MUST go through {@link searchVendorRequest} rather than calling `fetch`
 * itself, so the safety posture `cloudWeb.ts` establishes for `web_fetch` — whole-call
 * `AbortSignal.timeout`, bounded body read, honest User-Agent, never-throw error
 * shaping — is shared, not re-implemented (weaker) per vendor.
 *
 * Result URLs come from an untrusted third party and are handed straight to the model,
 * which will very likely `web_fetch` one. They are therefore run through the SAME
 * {@link classifyWebEgress} egress policy here and dropped if they point anywhere
 * private — a poisoned index entry must not become an SSRF lead the agent follows.
 * (The SearXNG BASE URL is exempt by design — see that adapter.)
 */

import type { WebSearchResult } from '@builderforce/agent-tools';
import { classifyWebEgress, fetchVendorJson, htmlToText, type JsonFetchResult } from './cloudWeb';
import { MEDIAWIKI_API_ENDPOINT, mediaWikiQuery } from '../web/mediaWiki';

/** Vendor ids that need a KEY. Each MUST also exist as an `integration_provider` enum
 *  value, because that is where the tenant's key is stored (migration 0413).
 *
 *  Order is PRECEDENCE, not preference: when a tenant has connected more than one, the
 *  first wired here wins. Tavily leads because its free tier is the most generous of the
 *  three and its response carries page content directly. */
export const CREDENTIALED_WEB_SEARCH_VENDOR_IDS = ['tavily', 'exa', 'linkup'] as const;

/** Vendor ids that need NO account at all. Never looked up in `integration_credentials`
 *  — there is nothing to store — so these ids are deliberately NOT integration
 *  providers, and adding one here must not add a connectable integration. `searxng` is
 *  keyless in this sense too: it is addressed by an operator-set URL, not a credential. */
export const KEYLESS_WEB_SEARCH_VENDOR_IDS = ['searxng', 'wikipedia'] as const;

export type WebSearchVendorId =
  | (typeof CREDENTIALED_WEB_SEARCH_VENDOR_IDS)[number]
  | (typeof KEYLESS_WEB_SEARCH_VENDOR_IDS)[number];

/** How a vendor is addressed and authenticated for ONE query.
 *
 *  Two fields rather than a single `apiKey`, because the two are genuinely different
 *  facts: a metered vendor has a fixed endpoint and a secret, while a self-hosted one
 *  has no secret and an endpoint only the operator knows. Collapsing them into one
 *  string would mean SearXNG's base URL travelling in a field called `apiKey`, through
 *  code that reasonably assumes that field is a secret. */
export interface WebSearchAuth {
  /** Null for every vendor that needs no credential. */
  apiKey: string | null;
  /** Operator-configured origin, for a self-hosted vendor only. */
  baseUrl?: string | null;
}

/** Results returned to the model per query. Enough to choose a source from, few enough
 *  that the tool result stays a handful of hundred tokens. */
export const MAX_SEARCH_RESULTS = 8;

/** The port. One vendor = one object; the surface only ever sees this shape. */
export interface WebSearchVendor {
  readonly id: WebSearchVendorId;
  /** Human label used in tenant-facing copy and error text. */
  readonly label: string;
  /** The vendor endpoint, recorded as the metered outbound fetch's URL. */
  readonly endpoint: string;
  /** How wide this vendor's index is — carried into the tool result so the model can
   *  describe its own evidence honestly instead of implying it swept the open web. */
  readonly coverage: 'web' | 'encyclopedic';
  /** Credit line the answer must carry when it uses this vendor's results. */
  readonly attribution: string;
  /** True when the adapter needs no credential at all. Keyless vendors are the floor
   *  every surface — including a logged-out guest — can always fall back to. */
  readonly keyless: boolean;
  /** Which key the credential blob carries, for the "how do I configure this" copy.
   *  Absent on a keyless vendor, which has no credential to configure. */
  readonly credentialField?: string;
  /** Run one query. Never throws — a vendor outage costs the agent one turn. A keyless
   *  vendor receives `{ apiKey: null }` and MUST ignore it. */
  search(query: string, auth: WebSearchAuth): Promise<WebSearchResult>;
}

/** Rows shaped for {@link WebSearchResult}, before they are attached to one. */
type SearchRow = { title?: string; url?: string; snippet?: string };

/**
 * Turn one vendor row into a result row, applying the two rules every adapter owes:
 * a usable PUBLIC url (a result the agent could not legally fetch is noise at best and
 * an SSRF lead at worst), and snippets flattened out of whatever highlight markup the
 * vendor wraps matches in. Returns null for a row that must be dropped.
 *
 * Shared because it is the security-relevant half: four adapters each re-deciding what
 * "usable url" means is four chances to get it wrong once.
 */
export function toSearchRow(raw: { title?: unknown; url?: unknown; snippet?: unknown }): SearchRow | null {
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url || classifyWebEgress(url)) return null;
  const title = typeof raw.title === 'string' ? snippetToText(raw.title, 200) : undefined;
  const snippet = snippetToText(raw.snippet);
  return { url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) };
}

/** Map a vendor's result array through {@link toSearchRow}, dropping unusable rows and
 *  capping the count. The one loop every `parse*Results` shares. */
function toSearchRows(
  rows: unknown,
  pick: (row: Record<string, unknown>) => { title?: unknown; url?: unknown; snippet?: unknown },
): SearchRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const out: SearchRow[] = [];
  for (const row of list) {
    if (out.length >= MAX_SEARCH_RESULTS) break;
    if (!row || typeof row !== 'object') continue;
    const mapped = toSearchRow(pick(row as Record<string, unknown>));
    if (mapped) out.push(mapped);
  }
  return out;
}

/** One bounded, timed request to a KEYED vendor's REST endpoint, decoded as JSON.
 *
 *  The transport itself is {@link fetchVendorJson} — shared with the geocoding adapters,
 *  so there is one outbound JSON path in the app rather than one per capability. What
 *  stays here is the only thing specific to search: the status hint. A 401/403 is the
 *  case that actually matters operationally — the tenant's stored key is wrong or
 *  expired, and the agent should stop retrying the tool rather than burn steps on it. */
export function searchVendorRequest(
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<JsonFetchResult> {
  return fetchVendorJson(url, {
    label: 'search vendor',
    headers,
    ...(body === undefined ? {} : { body }),
    statusHint: (status) => (status === 401 || status === 403
      ? ' — the configured search API key was rejected'
      : status === 429 ? ' — the search vendor rate-limited this key' : ''),
  });
}

/** Flatten a vendor snippet to one line of prose. Most engines return the snippet with
 *  highlight markup around the matched terms — reuse the capability's own HTML→text
 *  reduction rather than a second, weaker tag-stripper. */
export function snippetToText(raw: unknown, maxChars = 400): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const flat = htmlToText(raw).replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, maxChars) : undefined;
}

/** Tavily: `{ results: [{ title, url, content }] }`. */
export function parseTavilyResults(json: unknown): SearchRow[] {
  return toSearchRows((json as { results?: unknown } | null)?.results,
    (row) => ({ title: row.title, url: row.url, snippet: row.content }));
}

/** Exa: `{ results: [{ title, url, text }] }`. `text` is present only when the request
 *  asked for contents, which this adapter does. */
export function parseExaResults(json: unknown): SearchRow[] {
  return toSearchRows((json as { results?: unknown } | null)?.results,
    (row) => ({ title: row.title, url: row.url, snippet: row.text ?? row.summary }));
}

/** Linkup: `{ results: [{ type, name, url, content }] }` — note `name`, not `title`.
 *  Non-text rows (images) carry no readable snippet and are left to the url/snippet
 *  rules to keep or drop on their own merits. */
export function parseLinkupResults(json: unknown): SearchRow[] {
  return toSearchRows((json as { results?: unknown } | null)?.results,
    (row) => ({ title: row.name ?? row.title, url: row.url, snippet: row.content }));
}

/** SearXNG: `{ results: [{ title, url, content }] }` — the JSON format its `search`
 *  endpoint returns when the instance enables `formats: [json]`. */
export function parseSearxngResults(json: unknown): SearchRow[] {
  return toSearchRows((json as { results?: unknown } | null)?.results,
    (row) => ({ title: row.title, url: row.url, snippet: row.content }));
}

/** Build a keyed vendor. The three commercial adapters differ only in endpoint, auth
 *  header, request body and result shape — everything else (the missing-key refusal,
 *  the shared transport, the result envelope) is identical, so it is written once. */
function keyedWebVendor(spec: {
  id: WebSearchVendorId;
  label: string;
  endpoint: string;
  attribution: string;
  authHeader: (apiKey: string) => Record<string, string>;
  body: (query: string) => unknown;
  parse: (json: unknown) => SearchRow[];
}): WebSearchVendor {
  return {
    id: spec.id,
    label: spec.label,
    endpoint: spec.endpoint,
    coverage: 'web',
    attribution: spec.attribution,
    keyless: false,
    credentialField: 'apiKey',
    async search(query, auth): Promise<WebSearchResult> {
      if (!auth.apiKey) return { ok: false, query, error: `${spec.label} requires an API key.` };
      const res = await searchVendorRequest(spec.endpoint, spec.authHeader(auth.apiKey), spec.body(query));
      if (!res.ok) return { ok: false, query, error: res.error };
      return { ok: true, query, results: spec.parse(res.json), coverage: 'web', attribution: spec.attribution };
    },
  };
}

/**
 * Tavily — the default keyed vendor.
 *
 * Built for agents rather than for browsers: one POST, a Bearer token, and a response
 * that already carries page CONTENT, so a search result is often usable without a
 * follow-up `web_fetch`. Its free tier (1,000 credits/month, no card) is the most
 * generous of the three, which is why it leads the precedence list.
 */
export const tavilySearchVendor = keyedWebVendor({
  id: 'tavily',
  label: 'Tavily',
  endpoint: 'https://api.tavily.com/search',
  attribution: 'Results from Tavily',
  authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  body: (query) => ({ query, max_results: MAX_SEARCH_RESULTS, search_depth: 'basic' }),
  parse: parseTavilyResults,
});

/**
 * Exa — neural/semantic search.
 *
 * Worth having alongside a keyword engine because it answers a different KIND of
 * question well ("papers arguing X", "companies like Y") where keyword matching does
 * poorly. `contents.text` is requested with a character cap so a result set stays a
 * tool result rather than a document dump.
 */
export const exaSearchVendor = keyedWebVendor({
  id: 'exa',
  label: 'Exa',
  endpoint: 'https://api.exa.ai/search',
  attribution: 'Results from Exa',
  authHeader: (apiKey) => ({ 'x-api-key': apiKey }),
  body: (query) => ({ query, numResults: MAX_SEARCH_RESULTS, contents: { text: { maxCharacters: 600 } } }),
  parse: parseExaResults,
});

/** Linkup — a European web index with a standing free tier. Same one-POST-one-token
 *  shape as Tavily; `outputType: 'searchResults'` asks for the raw rows rather than a
 *  synthesized answer, because synthesizing is the agent's job, not the index's. */
export const linkupSearchVendor = keyedWebVendor({
  id: 'linkup',
  label: 'Linkup',
  endpoint: 'https://api.linkup.so/v1/search',
  attribution: 'Results from Linkup',
  authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  body: (query) => ({ q: query, depth: 'standard', outputType: 'searchResults' }),
  parse: parseLinkupResults,
});

/**
 * SearXNG — the SELF-HOSTED open-web option, and the recommended one for a self-hosted
 * product: real open-web coverage with no vendor account, no per-query meter, and no
 * third party learning what a tenant researches.
 *
 * The operator points `SEARXNG_URL` at their own instance (the instance must enable
 * `formats: [json]`). Note what is deliberately NOT done here: the base URL does not go
 * through {@link classifyWebEgress}. That policy exists to stop an UNTRUSTED url — one a
 * search index or a model handed us — reaching a private address. This url is operator
 * configuration, and a self-hosted SearXNG almost always IS on a private address
 * (`http://searxng:8080`), so applying the policy would block precisely the intended
 * deployment. The RESULTS it returns are untrusted and are filtered exactly as every
 * other vendor's are.
 */
export const searxngSearchVendor: WebSearchVendor = {
  id: 'searxng',
  label: 'SearXNG',
  endpoint: '(operator-configured)',
  coverage: 'web',
  attribution: 'Results from a self-hosted SearXNG instance',
  keyless: true,
  async search(query, auth): Promise<WebSearchResult> {
    const base = auth.baseUrl?.trim().replace(/\/+$/, '');
    if (!base) return { ok: false, query, error: 'SearXNG is not configured for this deployment.' };
    const params = new URLSearchParams({ q: query, format: 'json' });
    const res = await fetchVendorJson(`${base}/search?${params.toString()}`, {
      label: 'SearXNG',
      statusHint: (status) => (status === 403
        // The single most common SearXNG misconfiguration, and invisible otherwise.
        ? ' — the instance is refusing API requests; enable `formats: [json]` in its settings.yml'
        : ''),
    });
    if (!res.ok) return { ok: false, query, error: res.error };
    return { ok: true, query, results: parseSearxngResults(res.json), coverage: 'web', attribution: searxngSearchVendor.attribution };
  },
};

/** Article title → its canonical public URL. MediaWiki's search API returns titles,
 *  not links, and the model needs something `web_fetch` can actually read. */
export function wikipediaArticleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/**
 * Shape MediaWiki's `{ query: { search: [{ title, snippet }] } }` payload into the
 * shared rows. Pure → unit-testable, same contract as every other parser here: the
 * constructed URL still goes through the egress policy, because "we built this URL
 * ourselves" is an assumption, and the one place an assumption like that is worth
 * re-checking is the one that feeds `web_fetch`.
 */
export function parseWikipediaResults(json: unknown): SearchRow[] {
  return toSearchRows((json as { query?: { search?: unknown } } | null)?.query?.search, (row) => ({
    title: row.title,
    // MediaWiki returns titles, not links — the url is DERIVED, and still goes through
    // the same egress check, because "we built this url ourselves" is an assumption and
    // the one place an assumption like that is worth re-checking is the one feeding
    // `web_fetch`.
    url: typeof row.title === 'string' && row.title.trim() ? wikipediaArticleUrl(row.title.trim()) : undefined,
    snippet: row.snippet,
  }));
}

/**
 * Wikipedia (MediaWiki search API) — the KEYLESS floor.
 *
 * Chosen because it is the only general-subject index that is simultaneously free of
 * an account, free of a per-query meter, and licence-clean to quote with attribution
 * (CC BY-SA). It is a full-text search over every article, not the "instant answer"
 * endpoints that return one paragraph — so "list the school districts in Michigan"
 * returns real articles the agent can then `web_fetch` and build a dataset from.
 *
 * Its coverage is honestly narrower than a web engine's, which is why the result carries
 * `coverage: 'encyclopedic'`: the answering surface tells the user what kind of index
 * backed the research, and that pointing the deployment at a SearXNG instance — or
 * connecting a key — widens it.
 */
export const wikipediaSearchVendor: WebSearchVendor = {
  id: 'wikipedia',
  label: 'Wikipedia',
  endpoint: MEDIAWIKI_API_ENDPOINT,
  coverage: 'encyclopedic',
  attribution: 'Results from Wikipedia, available under CC BY-SA 4.0',
  keyless: true,
  async search(query): Promise<WebSearchResult> {
    // The same MediaWiki client the keyless BULK GEOCODER uses — one client, two
    // adapters. See `web/mediaWiki.ts`.
    const res = await mediaWikiQuery({
      list: 'search', srsearch: query, srlimit: String(MAX_SEARCH_RESULTS), srprop: 'snippet',
    });
    if (!res.ok) return { ok: false, query, error: res.error };
    const results = parseWikipediaResults(res.json);
    return { ok: true, query, results, coverage: wikipediaSearchVendor.coverage, attribution: wikipediaSearchVendor.attribution };
  },
};

const VENDORS: Record<WebSearchVendorId, WebSearchVendor> = {
  tavily: tavilySearchVendor,
  exa: exaSearchVendor,
  linkup: linkupSearchVendor,
  searxng: searxngSearchVendor,
  wikipedia: wikipediaSearchVendor,
};

/** Look up an adapter by id, or null when the id is not a wired vendor (e.g. a stored
 *  credential row for a provider this build does not know). */
export function webSearchVendor(id: string): WebSearchVendor | null {
  return (VENDORS as Record<string, WebSearchVendor | undefined>)[id] ?? null;
}
