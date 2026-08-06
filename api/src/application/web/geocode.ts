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
 *  3. **Paced, and bounded.** Uncached lookups are issued one at a time with a
 *     {@link RATE_LIMIT_MS} gap (the policy), which makes batch size a latency budget
 *     rather than a preference — hence {@link MAX_BATCH}. Cached entries skip the gap,
 *     so re-plotting 40 districts is instant even though the first plot was paced.
 *  4. **Outlines are optional and simplified.** A state boundary as raw GeoJSON is
 *     megabytes; at `polygon_threshold` it is a few KB and still reads as the right
 *     shape at card size. It is off unless asked for, because most plots want the
 *     points, not the coastline.
 *
 * The host is a constant, so there is no SSRF surface here — the caller never supplies
 * a URL, only a search term.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** Most places a card-sized map can legibly hold, and a latency ceiling: an uncached
 *  batch of this size costs roughly {@link MAX_BATCH} × {@link RATE_LIMIT_MS}. */
export const MAX_BATCH = 12;
/** Nominatim's published courtesy limit is 1 request/second; leave headroom. */
export const RATE_LIMIT_MS = 1_100;
const FETCH_TIMEOUT_MS = 10_000;
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
};
export type GeocodeMiss = { query: string; ok: false; error: string };
export type GeocodeResult = GeocodeHit | GeocodeMiss;

/** The port. One vendor = one object; callers only ever see {@link GeocodeResult}. */
export interface GeocodeVendor {
  readonly id: string;
  readonly label: string;
  readonly attribution: string;
  /** Resolve one term. Never throws — a vendor outage costs one unplotted row. */
  lookup(query: string, opts: { countryCodes?: string; outline?: boolean }): Promise<GeocodeResult>;
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
  async lookup(query, opts): Promise<GeocodeResult> {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '0' });
    if (opts.countryCodes) params.set('countrycodes', opts.countryCodes);
    if (opts.outline) {
      params.set('polygon_geojson', '1');
      params.set('polygon_threshold', String(POLYGON_THRESHOLD));
    }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Builderforce/1.0 (+https://builderforce.ai)', Accept: 'application/json' },
      });
      if (!res.ok) {
        const hint = res.status === 429 ? ' — the geocoder rate-limited this deployment' : '';
        return { query, ok: false, error: `geocoder returned HTTP ${res.status}${hint}` };
      }
      return parseNominatimResult(query, await res.json(), !!opts.outline);
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { query, ok: false, error: timedOut ? `geocode timed out after ${FETCH_TIMEOUT_MS}ms` : 'geocode request failed' };
    }
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
  vendor?: GeocodeVendor;
}

export interface GeocodeBatchResult {
  results: GeocodeResult[];
  resolved: number;
  unresolved: number;
  attribution: string;
  /** True when the caller asked for more than {@link MAX_BATCH} terms. Reported rather
   *  than silently swallowed: a half-plotted map that claims to be whole is worse than
   *  one that says which rows it dropped. */
  truncated: boolean;
}

/** A cache key that varies with everything that can change the answer. */
function cacheKey(vendorId: string, term: string, opts: GeocodeBatchOptions): string {
  return `geocode:${vendorId}:${opts.outline ? 'poly' : 'pt'}:${opts.countryCodes ?? ''}:${normalizeGeocodeQuery(term)}`;
}

/**
 * Resolve a batch of place names, cache-first and rate-limit-respecting.
 *
 * Sequential by design — see the module note. `env` may be absent (tests, non-Worker
 * callers); the cache helper's contract is "no KV → call the loader", so nothing here
 * needs to know the difference.
 */
export async function geocodeBatch(
  env: Env | undefined,
  queries: readonly string[],
  opts: GeocodeBatchOptions = {},
): Promise<GeocodeBatchResult> {
  const vendor = opts.vendor ?? nominatimVendor;
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
  const results: GeocodeResult[] = [];
  let networkCalls = 0;

  for (const term of batch) {
    const search = opts.context ? `${term}, ${opts.context}` : term;
    const key = cacheKey(vendor.id, search, opts);
    let result: GeocodeResult;
    try {
      result = await getOrSetCached<GeocodeResult>(
        env as Env,
        key,
        async () => {
          // Pace only the calls that actually leave the isolate. A cached batch is
          // instant; a cold one is paced exactly as the vendor's policy requires.
          if (networkCalls > 0) await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
          networkCalls += 1;
          const hit = await vendor.lookup(search, {
            ...(opts.countryCodes ? { countryCodes: opts.countryCodes } : {}),
            ...(opts.outline ? { outline: true } : {}),
          });
          // Report the term the CALLER passed, not the context-biased search string —
          // the caller has to join this back onto its own rows.
          return { ...hit, query: term };
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
    results.push(result);
  }

  return {
    results,
    resolved: results.filter((result) => result.ok).length,
    unresolved: results.filter((result) => !result.ok).length,
    attribution: vendor.attribution,
    truncated,
  };
}
