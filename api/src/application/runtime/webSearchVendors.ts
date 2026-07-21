/**
 * Web-search VENDOR PORT (+ its concrete adapters) — the missing half of the cloud
 * `web` capability. `web_fetch` reads a URL the agent already has; discovering that URL
 * needs a search engine, and a search engine is a metered third-party API. There is no
 * platform-funded search key: the credential is BYO per tenant (see
 * `webSearchCredential.ts`), so this module is deliberately a PORT with an id-keyed
 * registry rather than a hard-wired vendor — adding Tavily/Exa/SerpAPI later is one
 * adapter object plus one enum value, with no change to `cloudWeb.ts` or the engine.
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
import { FETCH_TIMEOUT_MS, classifyWebEgress, htmlToText, readCapped } from './cloudWeb';

/** Vendor ids. Each MUST also exist as an `integration_provider` enum value, because
 *  that is where the tenant's key is stored (migration 0353). */
export const WEB_SEARCH_VENDOR_IDS = ['brave_search'] as const;
export type WebSearchVendorId = (typeof WEB_SEARCH_VENDOR_IDS)[number];

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
  /** Which key the credential blob carries, for the "how do I configure this" error. */
  readonly credentialField: string;
  /** Run one query. Never throws — a vendor outage costs the agent one turn. */
  search(query: string, apiKey: string): Promise<WebSearchResult>;
}

/** One bounded, timed request to a vendor's REST endpoint, decoded as JSON. Shared by
 *  every adapter so there is exactly ONE outbound HTTP path for search. Never throws:
 *  `{ ok: false, error }` describes the failure in the same voice `web_fetch` uses. */
export async function searchVendorRequest(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string; status?: number }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'BuilderforceAgent/1.0 (+https://builderforce.ai)', Accept: 'application/json', ...headers },
    });
    // Read the body under the same byte cap as a page fetch: a vendor is trusted to be
    // well-behaved, but "trusted" is not a size guarantee.
    const { text } = await readCapped(res);
    if (!res.ok) {
      // 401/403 is the case that actually matters operationally — it means the tenant's
      // stored key is wrong/expired, and the agent should stop retrying the tool.
      const hint = res.status === 401 || res.status === 403
        ? ' — the configured search API key was rejected'
        : res.status === 429 ? ' — the search vendor rate-limited this key' : '';
      return { ok: false, status: res.status, error: `search vendor returned HTTP ${res.status}${hint}` };
    }
    try {
      return { ok: true, json: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, error: 'search vendor returned a non-JSON response' };
    }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: timedOut ? `search timed out after ${FETCH_TIMEOUT_MS}ms` : `search request failed: ${msg}` };
  }
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
  credentialField: 'apiKey',
  async search(query: string, apiKey: string): Promise<WebSearchResult> {
    const url = `${braveSearchVendor.endpoint}?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`;
    const res = await searchVendorRequest(url, { 'X-Subscription-Token': apiKey });
    if (!res.ok) return { ok: false, query, error: res.error };
    const results = parseBraveResults(res.json);
    return { ok: true, query, results };
  },
};

const VENDORS: Record<WebSearchVendorId, WebSearchVendor> = {
  brave_search: braveSearchVendor,
};

/** Look up an adapter by id, or null when the id is not a wired vendor (e.g. a stored
 *  credential row for a provider this build does not know). */
export function webSearchVendor(id: string): WebSearchVendor | null {
  return (VENDORS as Record<string, WebSearchVendor | undefined>)[id] ?? null;
}
