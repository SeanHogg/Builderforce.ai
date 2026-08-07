/**
 * Place name → coordinates. The missing half of "research a subject, then plot it".
 *
 * A research turn produces a dataset of NAMES ("Ann Arbor Public Schools", "Detroit
 * Public Schools Community District"). A map needs NUMBERS. Without this step the
 * Canvas can build the dataset and can draw the map, and the two can never be joined —
 * which is exactly why a "plot these on a map" request previously ended at a table.
 *
 * Design notes, in the order they mattered:
 *
 *  1. **Keyless by default.** Search is metered and therefore BYO
 *     ({@link ../runtime/webSearchCredential}); geocoding does not have to be. OSM's
 *     Nominatim is free, needs no account, and its licence only asks for attribution —
 *     so the plot-a-dataset path works on a fresh tenant with nothing configured. The
 *     vendor sits behind {@link GeocodeVendor} so a keyed vendor can be added the same
 *     way `webSearchVendors.ts` adds a second search engine.
 *  2. **Cached hard.** Nominatim's usage policy caps callers at ~1 request/second, and
 *     the same place is looked up on every re-plot and every re-run of the same canvas.
 *     Lookups go through the canonical read-through cache (L1 Map + L2 KV) keyed by the
 *     normalized query, so a repeat plot costs zero egress and zero wall-clock. A FAILED
 *     lookup is cached briefly too — re-asking a vendor for a place it does not know is
 *     the same answer at the same cost.
 *  3. **Bulk first, paced second.** A per-request-paced vendor makes batch size a
 *     latency budget: at {@link RATE_LIMIT_MS} apart, a dozen places already cost ~13s,
 *     which is why this used to cap at twelve and tell the model to chunk the rest
 *     itself — something a model may simply not do, leaving a 200-row dataset
 *     half-plotted. So the batch now runs in THREE passes, cheapest first:
 *       a. **cache** — free, no network, no pacing;
 *       b. **bulk** — {@link wikipediaGeocodeVendor} resolves up to
 *          {@link BULK_CHUNK_SIZE} names per REQUEST with no pacing at all, so 200
 *          places cost ~4 requests rather than 200 paced ones;
 *       c. **paced** — whatever bulk could not name falls through to the precise
 *          vendor, one at a time, bounded by {@link FALLBACK_BUDGET_MS}.
 *     Anything still unresolved when the budget runs out comes back as a miss that SAYS
 *     to call again — and because passes (a) and (b) persist their hits, calling again
 *     resumes instead of restarting. That is the queue, without a queue: idempotent,
 *     cache-backed, and it makes progress on every call.
 *  4. **Outlines are optional and simplified.** A state boundary as raw GeoJSON is
 *     megabytes; at `polygon_threshold` it is a few KB and still reads as the right
 *     shape at card size. It is off unless asked for, because most plots want the
 *     points, not the coastline. The bulk pass is skipped entirely when an outline is
 *     asked for, because a point index cannot supply a boundary.
 *
 * Every host is a constant, so there is no SSRF surface here — the caller never
 * supplies a URL, only a search term.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getOrSetCached, invalidateCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { advertisedName } from '../llm/toolNaming';
import { fetchVendorJson } from '../runtime/cloudWeb';
import { mediaWikiQuery } from './mediaWiki';
import type { Env } from '../../env';

/** Ceiling on places resolved per call. No longer a latency budget (the bulk pass
 *  removed that) — it is a RESULT-SIZE cap, sized so a full US state's districts fit in
 *  one call and a tool result stays a sane number of tokens. */
export const MAX_BATCH = 250;
/** Names per bulk request. The MediaWiki API's documented ceiling for an anonymous
 *  caller is 50 titles, and asking for more silently drops the tail. */
export const BULK_CHUNK_SIZE = 50;
/** Wall-clock allowance for the PACED pass. Well under a Worker request budget: what
 *  does not fit comes back as a resumable miss rather than a timed-out call. */
export const FALLBACK_BUDGET_MS = 12_000;
/** Nominatim's published courtesy limit is 1 request/second; leave headroom. */
export const RATE_LIMIT_MS = 1_100;
/** A hit is stable — a town does not move. A miss is re-checked sooner in case the
 *  caller simply spelled it better the second time. */
const HIT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Douglas-Peucker tolerance in degrees. Coarse enough that a US state outline is a
 *  few KB, fine enough that the shape is still recognisably that state. */
const POLYGON_THRESHOLD = 0.01;
/** Refuse to carry an outline larger than this into a canvas object. */
const MAX_OUTLINE_CHARS = 120_000;

/** One resolved place. `ok: false` carries the reason so the model can say which of
 *  its rows failed to resolve instead of silently dropping them off the map. */
export type GeocodeHit = {
  query: string;
  ok: true;
  lat: number;
  lng: number;
  displayName: string;
  /** `[south, north, west, east]` — what a map fits its viewport to. */
  boundingBox: [number, number, number, number];
  /** Nominatim's classification (`administrative`, `city`, `school`, …). */
  kind: string;
  /** Simplified boundary, only when the caller asked for one. */
  outline?: unknown;
  /** Which vendor answered. Carried on the RESULT (and therefore through the cache) so
   *  the batch can credit every source that actually contributed — a mixed bulk/paced
   *  batch owes attribution to both, and a cache hit still owes it to whoever
   *  originally answered. */
  via?: string;
};
export type GeocodeMiss = { query: string; ok: false; error: string };
export type GeocodeResult = GeocodeHit | GeocodeMiss;

/** The port. One vendor = one object; callers only ever see {@link GeocodeResult}. */
export interface GeocodeVendor {
  readonly id: string;
  readonly label: string;
  readonly attribution: string;
  /**
   * Minimum gap the batch loop leaves between two UNCACHED calls to this vendor.
   *
   * It lives on the vendor, not on the loop, because it is a fact about the vendor's
   * usage policy: Nominatim asks for ~1 request/second, and a keyed vendor on a paid
   * plan would ask for nothing. Defaults to {@link RATE_LIMIT_MS} when a vendor does
   * not state one, so an adapter added without thinking about it is throttled rather
   * than let loose.
   */
  readonly minIntervalMs?: number;
  /** Resolve one term. Never throws — a vendor outage costs one unplotted row. */
  lookup(query: string, opts: { countryCodes?: string; outline?: boolean }): Promise<GeocodeResult>;
  /**
   * Resolve MANY terms in ONE request, when the vendor can — the lever that turns a
   * 200-place batch from 200 paced round-trips into a handful.
   *
   * Optional because it is a genuine vendor capability, not a loop preference:
   * Nominatim has no batch endpoint at all, so it simply does not implement this and
   * the batch falls through to {@link lookup}. Returns a map keyed by the EXACT term it
   * was given, holding only what it could resolve — an absent key means "ask the
   * precise vendor", never "this place does not exist".
   */
  lookupMany?(queries: readonly string[]): Promise<Map<string, GeocodeResult>>;
}

/** Trim, collapse whitespace, lowercase — so "  Detroit  " and "detroit" share a
 *  cache entry and a rate-limit slot. */
export function normalizeGeocodeQuery(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** A finite number inside a coordinate range, or null. Nominatim returns coordinates
 *  as STRINGS, so this is a parse, not just a range check. */
function coordinate(value: unknown, limit: number): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

/**
 * Shape Nominatim's `[{ lat, lon, display_name, boundingbox, type, geojson }]` into the
 * port's result. Pure → unit-testable, which is the point of keeping parsing out of the
 * fetch. A row without usable coordinates is a miss, not a zero — plotting a failed
 * lookup at (0, 0) puts every unresolved place in the Gulf of Guinea.
 */
export function parseNominatimResult(query: string, json: unknown, outline: boolean): GeocodeResult {
  const rows = Array.isArray(json) ? json : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { query, ok: false, error: 'no match found' };
  const lat = coordinate(row.lat, 90);
  const lng = coordinate(row.lon, 180);
  if (lat == null || lng == null) return { query, ok: false, error: 'match had no usable coordinates' };
  // Nominatim's box is [south, north, west, east] as strings, in that order.
  const box = Array.isArray(row.boundingbox) ? row.boundingbox : [];
  const south = coordinate(box[0], 90);
  const north = coordinate(box[1], 90);
  const west = coordinate(box[2], 180);
  const east = coordinate(box[3], 180);
  const boundingBox: [number, number, number, number] = south != null && north != null && west != null && east != null
    ? [south, north, west, east]
    : [lat, lat, lng, lng];
  const serializedOutline = outline && row.geojson ? JSON.stringify(row.geojson) : '';
  return {
    query,
    ok: true,
    lat,
    lng,
    displayName: String(row.display_name ?? query).slice(0, 300),
    boundingBox,
    kind: String(row.type ?? row.class ?? 'place').slice(0, 60),
    ...(serializedOutline && serializedOutline.length <= MAX_OUTLINE_CHARS ? { outline: row.geojson } : {}),
  };
}

/**
 * OpenStreetMap Nominatim adapter — the keyless default.
 *
 * `email` is deliberately absent: the policy asks for a contact route, and the
 * descriptive User-Agent with a project URL is the one that does not put a tenant's
 * address into a third-party query log.
 */
export const nominatimVendor: GeocodeVendor = {
  id: 'nominatim',
  label: 'OpenStreetMap Nominatim',
  attribution: '© OpenStreetMap contributors',
  minIntervalMs: RATE_LIMIT_MS,
  async lookup(query, opts): Promise<GeocodeResult> {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '0' });
    if (opts.countryCodes) params.set('countrycodes', opts.countryCodes);
    if (opts.outline) {
      params.set('polygon_geojson', '1');
      params.set('polygon_threshold', String(POLYGON_THRESHOLD));
    }
    const res = await fetchVendorJson(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      label: 'geocoder',
      statusHint: (status) => (status === 429 ? ' — the geocoder rate-limited this deployment' : ''),
    });
    if (!res.ok) return { query, ok: false, error: res.error };
    const parsed = parseNominatimResult(query, res.json, !!opts.outline);
    return parsed.ok ? { ...parsed, via: nominatimVendor.id } : parsed;
  },
};

/**
 * Walk MediaWiki's `normalized` + `redirects` alias chains so the title we ASKED for
 * maps to the page we GOT. "detroit, michigan" is normalized to "Detroit, Michigan"
 * and then redirected to "Detroit"; without following both, every result comes back
 * unmatched. Pure → unit-testable, and the chain is depth-bounded because a malicious
 * or merely broken payload could otherwise describe a cycle.
 */
export function resolveWikipediaTitle(alias: Map<string, string>, title: string, maxHops = 4): string {
  let current = title;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = alias.get(current);
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

/**
 * Shape MediaWiki's `prop=coordinates` payload into results keyed by the title the
 * caller asked for. Pure → unit-testable, which is the point of keeping parsing out of
 * the fetch.
 *
 * Two guards matter. `globe` must be `earth` — the same API serves Mars and lunar
 * coordinates, and plotting Olympus Mons on a map of Michigan is a real failure mode.
 * And a page with no `coordinates` array is simply ABSENT from the returned map, not a
 * miss: the caller must still try the precise vendor, because "Wikipedia has no
 * coordinate for this article" is not "this place has no coordinates".
 */
export function parseWikipediaCoordinates(queries: readonly string[], json: unknown): Map<string, GeocodeResult> {
  const query = (json as { query?: Record<string, unknown> } | null)?.query;
  const alias = new Map<string, string>();
  for (const field of ['normalized', 'redirects'] as const) {
    const rows = Array.isArray(query?.[field]) ? (query[field] as unknown[]) : [];
    for (const row of rows) {
      const { from, to } = (row ?? {}) as { from?: unknown; to?: unknown };
      if (typeof from === 'string' && typeof to === 'string') alias.set(from, to);
    }
  }

  const byTitle = new Map<string, { lat: number; lng: number; kind: string }>();
  const pages = Array.isArray(query?.pages) ? (query.pages as unknown[]) : [];
  for (const page of pages) {
    const row = (page ?? {}) as { title?: unknown; coordinates?: unknown };
    if (typeof row.title !== 'string') continue;
    const coordinates = Array.isArray(row.coordinates) ? row.coordinates : [];
    const primary = coordinates.find((entry) => (entry as { primary?: unknown })?.primary) ?? coordinates[0];
    const point = (primary ?? {}) as { lat?: unknown; lon?: unknown; globe?: unknown; type?: unknown };
    if (point.globe != null && String(point.globe) !== 'earth') continue;
    const lat = coordinate(point.lat, 90);
    const lng = coordinate(point.lon, 180);
    if (lat == null || lng == null) continue;
    byTitle.set(row.title, { lat, lng, kind: String(point.type ?? 'place').slice(0, 60) });
  }

  const out = new Map<string, GeocodeResult>();
  for (const term of queries) {
    const hit = byTitle.get(resolveWikipediaTitle(alias, term));
    if (!hit) continue;
    out.set(term, {
      query: term,
      ok: true,
      lat: hit.lat,
      lng: hit.lng,
      displayName: term.slice(0, 300),
      // A point index has no extent. A degenerate box is HONEST — `geoBoundsFor` pads a
      // zero-span extent into a viewport, whereas inventing a radius here would claim a
      // footprint the vendor never reported.
      boundingBox: [hit.lat, hit.lat, hit.lng, hit.lng],
      kind: hit.kind,
      via: 'wikipedia',
    });
  }
  return out;
}

/**
 * Wikipedia (MediaWiki `prop=coordinates`) — the BULK pre-pass.
 *
 * It exists for one property Nominatim does not have: {@link BULK_CHUNK_SIZE} places per
 * request with no courtesy pacing, which is what makes "plot a whole state's districts"
 * a single call. It is deliberately NOT the precise vendor — it only knows places that
 * have an article carrying a coordinate, it cannot filter by country, and it cannot
 * return a boundary — so it answers what it can and everything else falls through to
 * Nominatim, which is the one that actually geocodes.
 *
 * `lookup` (the single-term half of the port) is implemented as a one-item bulk call so
 * this vendor is a legal `opts.vendor` too, rather than a half-vendor the loop has to
 * special-case.
 */
export const wikipediaGeocodeVendor: GeocodeVendor = {
  id: 'wikipedia',
  label: 'Wikipedia',
  attribution: 'Coordinates from Wikipedia (CC BY-SA)',
  minIntervalMs: 0,
  async lookupMany(queries): Promise<Map<string, GeocodeResult>> {
    const titles = queries.slice(0, BULK_CHUNK_SIZE);
    if (!titles.length) return new Map();
    // The same MediaWiki client the keyless SEARCH vendor uses — one client, two
    // adapters. See `web/mediaWiki.ts`.
    const res = await mediaWikiQuery({
      prop: 'coordinates', coprop: 'type', colimit: 'max', redirects: '1', titles: titles.join('|'),
    });
    // A bulk outage is not a batch failure: every term simply falls through to the
    // precise vendor, which is exactly what an empty map means.
    if (!res.ok) return new Map();
    return parseWikipediaCoordinates(titles, res.json);
  },
  async lookup(query): Promise<GeocodeResult> {
    const found = await wikipediaGeocodeVendor.lookupMany!([query]);
    return found.get(query) ?? { query, ok: false, error: 'no match found' };
  },
};

export interface GeocodeBatchOptions {
  /** ISO-3166 alpha-2 filter, e.g. `us`. Disambiguates "Springfield" without making
   *  the caller append a country to every row. */
  countryCodes?: string;
  /** Bias every term, e.g. `Michigan, USA`. Appended, not substituted — a row that
   *  already names its state is unharmed by naming it twice. */
  context?: string;
  /** Fetch a simplified boundary polygon alongside the point. */
  outline?: boolean;
  /** The PRECISE vendor — the one that actually geocodes, one paced term at a time. */
  vendor?: GeocodeVendor;
  /**
   * The BULK pre-pass vendor, or null to skip bulk entirely.
   *
   * Defaults to {@link wikipediaGeocodeVendor} only when the caller did NOT inject its
   * own `vendor`. That coupling is deliberate rather than incidental: bulk-then-paced is
   * a property of the DEFAULT keyless stack, so a caller who names a vendor gets exactly
   * that vendor and nothing else on the wire — which is also what makes this loop
   * testable without stubbing two hosts.
   */
  bulkVendor?: GeocodeVendor | null;
  /** Wall-clock allowance for the paced pass. Defaults to {@link FALLBACK_BUDGET_MS}. */
  budgetMs?: number;
}

export interface GeocodeBatchResult {
  results: GeocodeResult[];
  resolved: number;
  unresolved: number;
  /** Every source that actually contributed a coordinate, credited together — a batch
   *  answered partly from the bulk index and partly from Nominatim owes both. */
  attribution: string;
  /** True when the caller asked for more than {@link MAX_BATCH} terms. Reported rather
   *  than silently swallowed: a half-plotted map that claims to be whole is worse than
   *  one that says which rows it dropped. */
  truncated: boolean;
  /** How many terms ran out of time budget rather than failing to resolve. Non-zero
   *  means "call again with the same list" — the resolved ones are cached, so the next
   *  call skips straight to these. Distinguished from {@link unresolved} because the two
   *  ask the caller for completely different things: retry vs. re-spell. */
  pending: number;
}

/** A cache key that varies with everything that can change the answer. */
function cacheKey(vendorId: string, term: string, opts: GeocodeBatchOptions): string {
  return `geocode:${vendorId}:${opts.outline ? 'poly' : 'pt'}:${opts.countryCodes ?? ''}:${normalizeGeocodeQuery(term)}`;
}

/** What a term that ran out of budget says back. Phrased as an instruction because the
 *  caller is usually a model deciding whether to try again, and "geocode failed" would
 *  read as terminal when the correct move is one more identical call. */
const BUDGET_EXHAUSTED =
  `not resolved within this call’s time budget — call ${advertisedName('geo.geocode')} again with the same names; `
  + 'everything already resolved is cached and returns instantly, so each call gets further';

/**
 * Resolve a batch of place names: cache, then bulk, then paced — see the module note.
 *
 * `env` may be absent (tests, non-Worker callers). The cache helpers all treat a missing
 * KV binding as a miss, so nothing here needs to know the difference; without `env` the
 * batch simply runs uncached.
 */
export async function geocodeBatch(
  env: Env | undefined,
  queries: readonly string[],
  opts: GeocodeBatchOptions = {},
): Promise<GeocodeBatchResult> {
  const vendor = opts.vendor ?? nominatimVendor;
  // Bulk is the default stack's pre-pass, not a wrapper around an injected vendor —
  // see `GeocodeBatchOptions.bulkVendor`. An outline request skips it outright: a point
  // index has no boundary to give, so a bulk hit would suppress the very lookup that
  // could satisfy the request.
  const bulkVendor = opts.outline
    ? null
    : opts.bulkVendor !== undefined
      ? opts.bulkVendor
      : opts.vendor
        ? null
        : wikipediaGeocodeVendor;

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of queries) {
    const term = normalizeGeocodeQuery(raw);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
  }
  const truncated = terms.length > MAX_BATCH;
  const batch = terms.slice(0, MAX_BATCH);

  const searchFor = (term: string) => (opts.context ? `${term}, ${opts.context}` : term);
  const keyFor = (term: string) => cacheKey(vendor.id, searchFor(term), opts);
  const resolved = new Map<string, GeocodeResult>();

  // ---- Pass 1: cache. Free, unpaced, and the reason a re-plot costs nothing. Only a
  // HIT is honoured — a miss is never persisted (see pass 3), so a cached miss would be
  // a stale artefact, and re-asking is both cheap and more likely to be right now.
  let pending: string[] = [];
  for (const term of batch) {
    const cached = env ? await peekCached<GeocodeResult>(env, keyFor(term)) : null;
    if (cached?.ok) resolved.set(term, cached);
    else pending.push(term);
  }

  // ---- Pass 2: bulk. One request per BULK_CHUNK_SIZE names, no pacing at all.
  if (bulkVendor?.lookupMany && pending.length) {
    // Try the context-biased title AND the bare term: "Ann Arbor, Michigan" is the
    // article, while "Ann Arbor Public Schools, Michigan, USA" is not — so a batch that
    // passes `context` for Nominatim's benefit still gets bulk coverage. Both forms are
    // free here (they ride the same request), and the biased form is preferred on a tie
    // because it is the more specific claim.
    const candidatesFor = (term: string) => {
      const search = searchFor(term);
      return search === term ? [search] : [search, term];
    };
    const titles = [...new Set(pending.flatMap(candidatesFor))];
    const found = new Map<string, GeocodeResult>();
    for (let index = 0; index < titles.length; index += BULK_CHUNK_SIZE) {
      const chunk = titles.slice(index, index + BULK_CHUNK_SIZE);
      try {
        for (const [title, hit] of await bulkVendor.lookupMany(chunk)) {
          if (hit.ok) found.set(title, hit);
        }
      } catch (error) {
        // A bulk failure costs speed, never correctness — the chunk falls through.
        reportCaughtError(error, { source: 'application/web/geocode.ts', operation: 'geocodeBatch.bulk', context: { chunk: chunk.length } });
      }
    }

    const stillPending: string[] = [];
    for (const term of pending) {
      const hit = candidatesFor(term).map((title) => found.get(title)).find(Boolean);
      if (!hit) { stillPending.push(term); continue; }
      // Report the term the CALLER passed, not the title that matched — the caller has
      // to join this back onto its own rows.
      const result = { ...hit, query: term } as GeocodeResult;
      resolved.set(term, result);
      // Written through the SAME key the paced pass uses, so the next call (and the next
      // re-plot) hits pass 1 regardless of which vendor originally answered.
      if (env) await setCached(env, keyFor(term), result, { kvTtlSeconds: HIT_TTL_SECONDS });
    }
    pending = stillPending;
  }

  // ---- Pass 3: paced. The precise vendor, one term at a time, under a wall-clock
  // budget. What does not fit is DEFERRED, not failed.
  const budgetMs = opts.budgetMs ?? FALLBACK_BUDGET_MS;
  const startedAt = Date.now();
  const deferred = new Set<string>();
  let networkCalls = 0;

  for (const term of pending) {
    if (Date.now() - startedAt >= budgetMs) { deferred.add(term); continue; }
    const key = keyFor(term);
    let result: GeocodeResult;
    try {
      result = await getOrSetCached<GeocodeResult>(
        env as Env,
        key,
        async () => {
          // Pace only the calls that actually leave the isolate.
          const gap = vendor.minIntervalMs ?? RATE_LIMIT_MS;
          if (networkCalls > 0 && gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
          networkCalls += 1;
          const hit = await vendor.lookup(searchFor(term), {
            ...(opts.countryCodes ? { countryCodes: opts.countryCodes } : {}),
            ...(opts.outline ? { outline: true } : {}),
          });
          return { ...hit, query: term, ...(hit.ok && !hit.via ? { via: vendor.id } : {}) };
        },
        { kvTtlSeconds: HIT_TTL_SECONDS },
      );
      // A miss must not occupy a month-long slot: a transient 429, or a term the user
      // corrects a minute later, would otherwise stay unresolvable for the full TTL.
      // Same discipline `cloudWeb` applies to a failed fetch.
      if (!result.ok) await invalidateCached(env as Env, key);
    } catch (error) {
      reportCaughtError(error, { source: 'application/web/geocode.ts', operation: 'geocodeBatch', context: { term } });
      result = { query: term, ok: false, error: 'geocode failed' };
    }
    resolved.set(term, result);
  }

  // Rebuild in the CALLER's order — the three passes reorder the work, and a caller
  // zipping this back onto its own rows must not have to re-sort.
  const results: GeocodeResult[] = batch.map((term) => resolved.get(term)
    ?? { query: term, ok: false, error: BUDGET_EXHAUSTED });

  // Credit every vendor that actually answered, deduped and in a stable order.
  const attributions = new Map<string, string>();
  for (const contributor of [vendor, bulkVendor]) {
    if (contributor) attributions.set(contributor.id, contributor.attribution);
  }
  const credited = [...new Set(results.flatMap((result) => (result.ok && result.via ? [result.via] : [])))]
    .flatMap((id) => (attributions.get(id) ? [attributions.get(id)!] : []));

  return {
    results,
    resolved: results.filter((result) => result.ok).length,
    unresolved: results.filter((result) => !result.ok).length - deferred.size,
    attribution: (credited.length ? credited : [vendor.attribution]).join(' · '),
    truncated,
    pending: deferred.size,
  };
}
