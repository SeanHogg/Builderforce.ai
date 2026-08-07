/**
 * Web-search VENDOR PORT (+ its concrete adapters) — the missing half of the cloud
 * `web` capability. `web_fetch` reads a URL the agent already has; discovering that URL
 * needs a search engine, so this module is deliberately a PORT with an id-keyed
 * registry rather than a hard-wired vendor — adding Tavily/Exa/SerpAPI later is one
 * adapter object plus one enum value, with no change to `cloudWeb.ts` or the engine.
 *
 * Vendors come in two kinds, and the distinction is the whole reason research works at
 * all on a workspace with nothing configured:
 *
 *  • **Credentialed** ({@link CREDENTIALED_WEB_SEARCH_VENDOR_IDS}) — a general web
 *    index, metered per query, key stored per tenant in `integration_credentials`
 *    (see `webSearchCredential.ts`). Widest coverage, someone has to pay for it.
 *  • **Keyless** ({@link KEYLESS_WEB_SEARCH_VENDOR_IDS}) — no account, no meter, a
 *    licence that only asks for attribution. Narrower (encyclopedic, not the open
 *    web), but it is REAL, citable, fetchable evidence rather than model recall.
 *
 * The keyless kind exists because search used to self-gate to nothing: a logged-out
 * visitor or a fresh free workspace asked "research X and plot it" and the pipeline
 * stopped at step one with an actionable-but-useless refusal. Geocoding was made
 * keyless for exactly this reason (`application/web/geocode.ts`); this is the same
 * decision applied to the step before it. A BYO or operator key still WINS — the
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
 */

import type { WebSearchResult } from '@builderforce/agent-tools';
import { classifyWebEgress, fetchVendorJson, htmlToText, type JsonFetchResult } from './cloudWeb';
import { MEDIAWIKI_API_ENDPOINT, mediaWikiQuery } from '../web/mediaWiki';

/** Vendor ids that need a KEY. Each MUST also exist as an `integration_provider` enum
 *  value, because that is where the tenant's key is stored (migration 0353). */
export const CREDENTIALED_WEB_SEARCH_VENDOR_IDS = ['brave_search'] as const;

/** Vendor ids that need NO account at all. Never looked up in `integration_credentials`
 *  — there is nothing to store — so these ids are deliberately NOT integration
 *  providers, and adding one here must not add a connectable integration. */
export const KEYLESS_WEB_SEARCH_VENDOR_IDS = ['wikipedia'] as const;

export type WebSearchVendorId =
  | (typeof CREDENTIALED_WEB_SEARCH_VENDOR_IDS)[number]
  | (typeof KEYLESS_WEB_SEARCH_VENDOR_IDS)[number];

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
  /** Run one query. Never throws — a vendor outage costs the agent one turn. `apiKey`
   *  is null for a keyless vendor and MUST be ignored by it. */
  search(query: string, apiKey: string | null): Promise<WebSearchResult>;
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
): Promise<JsonFetchResult> {
  return fetchVendorJson(url, {
    label: 'search vendor',
    headers,
    statusHint: (status) => (status === 401 || status === 403
      ? ' — the configured search API key was rejected'
      : status === 429 ? ' — the search vendor rate-limited this key' : ''),
  });
}

/** Flatten a vendor snippet to one line of prose. Brave (and most engines) return the
 *  snippet with `<strong>` highlight markup around the matched terms — reuse the
 *  capability's own HTML→text reduction rather than a second, weaker tag-stripper. */
export function snippetToText(raw: unknown, maxChars = 400): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const flat = htmlToText(raw).replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, maxChars) : undefined;
}

/**
 * Shape Brave's `{ web: { results: [{ title, url, description }] } }` payload into the
 * shared `WebSearchResult` rows, dropping anything without a usable public URL. Pure →
 * unit-testable, which is the whole point of keeping parsing out of the fetch.
 */
export function parseBraveResults(json: unknown): Array<{ title?: string; url?: string; snippet?: string }> {
  const web = (json as { web?: { results?: unknown } } | null)?.web;
  const rows = Array.isArray(web?.results) ? web.results : [];
  const out: Array<{ title?: string; url?: string; snippet?: string }> = [];
  for (const row of rows) {
    if (out.length >= MAX_SEARCH_RESULTS) break;
    const r = row as { title?: unknown; url?: unknown; description?: unknown };
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    // A result the agent could not legally fetch anyway is noise at best and an SSRF
    // lead at worst — drop it here rather than let the model spend a turn on it.
    if (!url || classifyWebEgress(url)) continue;
    const title = typeof r.title === 'string' ? snippetToText(r.title, 200) : undefined;
    out.push({
      url,
      ...(title ? { title } : {}),
      ...(snippetToText(r.description) ? { snippet: snippetToText(r.description) } : {}),
    });
  }
  return out;
}

/**
 * Brave Search adapter. Chosen as the first concrete vendor because it is the smallest
 * possible integration for this port — a plain GET with ONE header token, no SDK, no
 * OAuth, no per-account endpoint — it runs its own index (results do not depend on
 * another engine's terms), and it has a free tier a tenant can self-serve, which
 * matters when the credential is BYO rather than platform-funded.
 */
export const braveSearchVendor: WebSearchVendor = {
  id: 'brave_search',
  label: 'Brave Search',
  endpoint: 'https://api.search.brave.com/res/v1/web/search',
  coverage: 'web',
  attribution: 'Results from Brave Search',
  keyless: false,
  credentialField: 'apiKey',
  async search(query: string, apiKey: string | null): Promise<WebSearchResult> {
    if (!apiKey) return { ok: false, query, error: 'Brave Search requires an API key.' };
    const url = `${braveSearchVendor.endpoint}?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`;
    const res = await searchVendorRequest(url, { 'X-Subscription-Token': apiKey });
    if (!res.ok) return { ok: false, query, error: res.error };
    const results = parseBraveResults(res.json);
    return { ok: true, query, results, coverage: braveSearchVendor.coverage, attribution: braveSearchVendor.attribution };
  },
};

/** Article title → its canonical public URL. MediaWiki's search API returns titles,
 *  not links, and the model needs something `web_fetch` can actually read. */
export function wikipediaArticleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/**
 * Shape MediaWiki's `{ query: { search: [{ title, snippet }] } }` payload into the
 * shared rows. Pure → unit-testable, same contract as {@link parseBraveResults}: the
 * constructed URL still goes through the egress policy, because "we built this URL
 * ourselves" is an assumption, and the one place an assumption like that is worth
 * re-checking is the one that feeds `web_fetch`.
 */
export function parseWikipediaResults(json: unknown): Array<{ title?: string; url?: string; snippet?: string }> {
  const rows = (json as { query?: { search?: unknown } } | null)?.query?.search;
  const list = Array.isArray(rows) ? rows : [];
  const out: Array<{ title?: string; url?: string; snippet?: string }> = [];
  for (const row of list) {
    if (out.length >= MAX_SEARCH_RESULTS) break;
    const r = row as { title?: unknown; snippet?: unknown };
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) continue;
    const url = wikipediaArticleUrl(title);
    if (classifyWebEgress(url)) continue;
    out.push({
      url,
      title: title.slice(0, 200),
      // The snippet arrives with `<span class="searchmatch">` highlight markup — reuse
      // the capability's own HTML→text reduction rather than a second tag-stripper.
      ...(snippetToText(r.snippet) ? { snippet: snippetToText(r.snippet) } : {}),
    });
  }
  return out;
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
 * Its coverage is honestly narrower than a web engine's, which is why the result
 * carries `coverage: 'encyclopedic'`: the answering surface tells the user what kind
 * of index backed the research, and that connecting a key widens it.
 */
export const wikipediaSearchVendor: WebSearchVendor = {
  id: 'wikipedia',
  label: 'Wikipedia',
  endpoint: MEDIAWIKI_API_ENDPOINT,
  coverage: 'encyclopedic',
  attribution: 'Results from Wikipedia, available under CC BY-SA 4.0',
  keyless: true,
  async search(query: string): Promise<WebSearchResult> {
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
  brave_search: braveSearchVendor,
  wikipedia: wikipediaSearchVendor,
};

/** Look up an adapter by id, or null when the id is not a wired vendor (e.g. a stored
 *  credential row for a provider this build does not know). */
export function webSearchVendor(id: string): WebSearchVendor | null {
  return (VENDORS as Record<string, WebSearchVendor | undefined>)[id] ?? null;
}
