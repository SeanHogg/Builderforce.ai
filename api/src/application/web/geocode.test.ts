import { describe, expect, it, vi } from 'vitest';
import {
  BULK_CHUNK_SIZE,
  MAX_BATCH,
  geocodeBatch,
  normalizeGeocodeQuery,
  parseNominatimResult,
  parseWikipediaCoordinates,
  resolveWikipediaTitle,
  type GeocodeResult,
  type GeocodeVendor,
} from './geocode';

/** A vendor that records what it was asked and answers from a fixture table. */
function stubVendor(table: Record<string, { lat: number; lng: number } | 'miss'>) {
  const calls: string[] = [];
  const vendor: GeocodeVendor = {
    id: 'stub',
    label: 'Stub',
    attribution: '© test',
    // A stub has no usage policy, so the batch loop must not pace it. This is also the
    // assertion that pacing is the VENDOR's property and not baked into the loop.
    minIntervalMs: 0,
    async lookup(query) {
      calls.push(query);
      const hit = table[query];
      if (!hit || hit === 'miss') return { query, ok: false, error: 'no match found' };
      return {
        query, ok: true, lat: hit.lat, lng: hit.lng,
        displayName: query, boundingBox: [hit.lat, hit.lat, hit.lng, hit.lng], kind: 'administrative',
      };
    },
  };
  return { vendor, calls };
}

/** A BULK vendor that answers whole chunks from a fixture table and records the size of
 *  each request — the number that decides whether a 200-row dataset is one call. */
function stubBulkVendor(table: Record<string, { lat: number; lng: number }>) {
  const requests: string[][] = [];
  const vendor: GeocodeVendor = {
    id: 'bulk-stub',
    label: 'Bulk stub',
    attribution: '© bulk',
    minIntervalMs: 0,
    async lookupMany(queries) {
      requests.push([...queries]);
      const out = new Map<string, GeocodeResult>();
      for (const query of queries.slice(0, BULK_CHUNK_SIZE)) {
        const hit = table[query];
        if (!hit) continue;
        out.set(query, {
          query, ok: true, lat: hit.lat, lng: hit.lng,
          displayName: query, boundingBox: [hit.lat, hit.lat, hit.lng, hit.lng], kind: 'city', via: 'bulk-stub',
        });
      }
      return out;
    },
    async lookup(query) { return { query, ok: false, error: 'single lookup not used' }; },
  };
  return { vendor, requests };
}

describe('normalizeGeocodeQuery', () => {
  it('collapses whitespace so spelling variants share one cache entry', () => {
    expect(normalizeGeocodeQuery('  Detroit   Public  Schools ')).toBe('Detroit Public Schools');
  });

  it('survives a non-string', () => {
    expect(normalizeGeocodeQuery(undefined as unknown as string)).toBe('');
  });
});

describe('parseNominatimResult', () => {
  const ROW = {
    lat: '42.3314', lon: '-83.0458', display_name: 'Detroit, Wayne County, Michigan, United States',
    boundingbox: ['42.2554', '42.4503', '-83.2876', '-82.9105'], type: 'city',
  };

  it('parses the vendor STRING coordinates into numbers', () => {
    const result = parseNominatimResult('Detroit', [ROW], false);
    expect(result).toMatchObject({ ok: true, lat: 42.3314, lng: -83.0458, kind: 'city' });
  });

  it('keeps the bounding box in [south, north, west, east] order', () => {
    const result = parseNominatimResult('Detroit', [ROW], false);
    expect(result.ok && result.boundingBox).toEqual([42.2554, 42.4503, -83.2876, -82.9105]);
  });

  it('falls back to a degenerate box when the vendor omits one', () => {
    const result = parseNominatimResult('Detroit', [{ ...ROW, boundingbox: undefined }], false);
    expect(result.ok && result.boundingBox).toEqual([42.3314, 42.3314, -83.0458, -83.0458]);
  });

  it('is a MISS, not (0,0), when nothing matched', () => {
    expect(parseNominatimResult('Nowhere', [], false)).toEqual({ query: 'Nowhere', ok: false, error: 'no match found' });
  });

  it('is a MISS when the match has unusable coordinates', () => {
    const result = parseNominatimResult('Broken', [{ ...ROW, lat: 'north', lon: 'west' }], false);
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range coordinate rather than plotting it', () => {
    expect(parseNominatimResult('Bad', [{ ...ROW, lat: '120' }], false).ok).toBe(false);
  });

  it('carries an outline only when one was requested', () => {
    const geojson = { type: 'MultiPolygon', coordinates: [[[[-83, 42], [-84, 42], [-84, 43], [-83, 42]]]] };
    expect(parseNominatimResult('Michigan', [{ ...ROW, geojson }], true)).toMatchObject({ outline: geojson });
    expect(parseNominatimResult('Michigan', [{ ...ROW, geojson }], false)).not.toHaveProperty('outline');
  });
});

describe('geocodeBatch', () => {
  it('resolves a batch and reports how many landed', async () => {
    const { vendor } = stubVendor({ Detroit: { lat: 42.33, lng: -83.04 }, 'Ann Arbor': { lat: 42.28, lng: -83.74 } });
    const result = await geocodeBatch(undefined, ['Detroit', 'Ann Arbor'], { vendor });
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(0);
    expect(result.attribution).toBe('© test');
  });

  it('reports misses instead of dropping them, so the caller can name the unplotted rows', async () => {
    const { vendor } = stubVendor({ Detroit: { lat: 42.33, lng: -83.04 }, Atlantis: 'miss' });
    const result = await geocodeBatch(undefined, ['Detroit', 'Atlantis'], { vendor });
    expect(result.resolved).toBe(1);
    expect(result.unresolved).toBe(1);
    expect(result.results.find((entry) => entry.query === 'Atlantis')).toMatchObject({ ok: false });
  });

  it('biases each term with the context but reports the ORIGINAL term back', async () => {
    const { vendor, calls } = stubVendor({ 'Ann Arbor Public Schools, Michigan, USA': { lat: 42.28, lng: -83.74 } });
    const result = await geocodeBatch(undefined, ['Ann Arbor Public Schools'], { vendor, context: 'Michigan, USA' });
    expect(calls).toEqual(['Ann Arbor Public Schools, Michigan, USA']);
    // The caller has to join this onto its own rows, so it must get its own key back.
    expect(result.results[0]!.query).toBe('Ann Arbor Public Schools');
  });

  it('de-duplicates repeated terms so one place costs one lookup', async () => {
    const { vendor, calls } = stubVendor({ Detroit: { lat: 42.33, lng: -83.04 } });
    const result = await geocodeBatch(undefined, ['Detroit', 'detroit', '  Detroit  '], { vendor });
    expect(calls).toHaveLength(1);
    expect(result.results).toHaveLength(1);
  });

  it('caps the batch and SAYS it truncated rather than silently half-plotting', async () => {
    const { vendor } = stubVendor({});
    const queries = Array.from({ length: MAX_BATCH + 5 }, (_, index) => `Place ${index}`);
    const result = await geocodeBatch(undefined, queries, { vendor });
    expect(result.results).toHaveLength(MAX_BATCH);
    expect(result.truncated).toBe(true);
  });

  it('does not mark a full-but-not-over batch as truncated', async () => {
    const { vendor } = stubVendor({});
    const result = await geocodeBatch(undefined, Array.from({ length: MAX_BATCH }, (_, i) => `P${i}`), { vendor });
    expect(result.truncated).toBe(false);
  });

  it('leaves at least the vendor declared interval between uncached calls', async () => {
    const at: number[] = [];
    const paced: GeocodeVendor = {
      id: 'paced', label: 'Paced', attribution: '', minIntervalMs: 40,
      async lookup(query) { at.push(Date.now()); return { query, ok: true, lat: 1, lng: 2, displayName: query, boundingBox: [1, 1, 2, 2], kind: 'place' }; },
    };
    await geocodeBatch(undefined, ['A', 'B', 'C'], { vendor: paced });
    // Only the LOWER bound is asserted. An upper bound would be measuring the CI box's
    // scheduler, not this code, and that is how a timing test becomes a flake.
    expect(at).toHaveLength(3);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(35);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(35);
  });

  it('ignores blank terms', async () => {
    const { vendor, calls } = stubVendor({ Detroit: { lat: 42.33, lng: -83.04 } });
    await geocodeBatch(undefined, ['', '   ', 'Detroit'], { vendor });
    expect(calls).toEqual(['Detroit']);
  });

  it('degrades a throwing vendor to one unresolved row rather than failing the turn', async () => {
    const vendor: GeocodeVendor = {
      id: 'boom', label: 'Boom', attribution: '', minIntervalMs: 0,
      lookup: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const result = await geocodeBatch(undefined, ['Detroit'], { vendor });
    expect(result.results[0]).toMatchObject({ query: 'Detroit', ok: false });
    expect(result.unresolved).toBe(1);
  });
});

describe('resolveWikipediaTitle', () => {
  it('follows a normalize-then-redirect chain to the page that actually answered', () => {
    const alias = new Map([['detroit, michigan', 'Detroit, Michigan'], ['Detroit, Michigan', 'Detroit']]);
    expect(resolveWikipediaTitle(alias, 'detroit, michigan')).toBe('Detroit');
  });

  it('terminates on a cycle instead of spinning', () => {
    const alias = new Map([['A', 'B'], ['B', 'A']]);
    expect(['A', 'B']).toContain(resolveWikipediaTitle(alias, 'A'));
  });

  it('passes an unaliased title straight through', () => {
    expect(resolveWikipediaTitle(new Map(), 'Detroit')).toBe('Detroit');
  });
});

describe('parseWikipediaCoordinates', () => {
  const payload = (pages: unknown[], extra: Record<string, unknown> = {}) => ({ query: { pages, ...extra } });

  it('keys the result by the title the CALLER asked for, through the redirect chain', () => {
    const json = payload(
      [{ title: 'Detroit', coordinates: [{ lat: 42.33, lon: -83.04, primary: true, globe: 'earth', type: 'city' }] }],
      { redirects: [{ from: 'Detroit, Michigan', to: 'Detroit' }] },
    );
    const out = parseWikipediaCoordinates(['Detroit, Michigan'], json);
    expect(out.get('Detroit, Michigan')).toMatchObject({ ok: true, lat: 42.33, lng: -83.04, via: 'wikipedia' });
  });

  it('prefers the PRIMARY coordinate when an article carries several', () => {
    const json = payload([{ title: 'X', coordinates: [
      { lat: 1, lon: 1, globe: 'earth' },
      { lat: 51.5, lon: -0.12, primary: true, globe: 'earth' },
    ] }]);
    expect(parseWikipediaCoordinates(['X'], json).get('X')).toMatchObject({ lat: 51.5, lng: -0.12 });
  });

  it('refuses a coordinate that is not on Earth', () => {
    const json = payload([{ title: 'Olympus Mons', coordinates: [{ lat: 18.65, lon: -133.8, primary: true, globe: 'mars' }] }]);
    expect(parseWikipediaCoordinates(['Olympus Mons'], json).size).toBe(0);
  });

  it('OMITS an article with no coordinate rather than reporting a miss', () => {
    // The distinction is load-bearing: absent means "ask the precise vendor", and a
    // reported miss would suppress the fallback that can actually answer.
    const json = payload([{ title: 'Ann Arbor Public Schools' }, { title: 'Nowhere', missing: true }]);
    expect(parseWikipediaCoordinates(['Ann Arbor Public Schools', 'Nowhere'], json).size).toBe(0);
  });

  it('survives a payload with no query at all', () => {
    expect(parseWikipediaCoordinates(['A'], null).size).toBe(0);
    expect(parseWikipediaCoordinates(['A'], { query: {} }).size).toBe(0);
  });
});

describe('geocodeBatch bulk pre-pass', () => {
  it('resolves a whole dataset from bulk requests instead of paced single lookups', async () => {
    // The gap this closes: 200 places used to mean 200 paced round-trips, so the tool
    // capped at 12 and told the model to chunk the rest — which it may never do.
    const places = Array.from({ length: 120 }, (_, index) => `Place ${index}`);
    const table = Object.fromEntries(places.map((place, index) => [place, { lat: 40 + index / 100, lng: -80 - index / 100 }]));
    const { vendor: bulkVendor, requests } = stubBulkVendor(table);
    const { vendor, calls } = stubVendor({});

    const result = await geocodeBatch(undefined, places, { vendor, bulkVendor });

    expect(result.resolved).toBe(120);
    expect(result.pending).toBe(0);
    // 120 names in chunks of 50 → 3 requests, and the paced vendor is never touched.
    expect(requests).toHaveLength(Math.ceil(120 / BULK_CHUNK_SIZE));
    expect(requests.every((chunk) => chunk.length <= BULK_CHUNK_SIZE)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('falls through to the precise vendor for exactly what bulk could not name', async () => {
    const { vendor: bulkVendor } = stubBulkVendor({ Detroit: { lat: 42.33, lng: -83.04 } });
    const { vendor, calls } = stubVendor({ 'Ann Arbor Public Schools': { lat: 42.28, lng: -83.74 } });

    const result = await geocodeBatch(undefined, ['Detroit', 'Ann Arbor Public Schools'], { vendor, bulkVendor });

    expect(calls).toEqual(['Ann Arbor Public Schools']);
    expect(result.resolved).toBe(2);
  });

  it('credits BOTH sources when a batch is answered by both', async () => {
    const { vendor: bulkVendor } = stubBulkVendor({ Detroit: { lat: 42.33, lng: -83.04 } });
    const { vendor } = stubVendor({ Flint: { lat: 43.01, lng: -83.69 } });
    const result = await geocodeBatch(undefined, ['Detroit', 'Flint'], { vendor, bulkVendor });
    expect(result.attribution).toContain('© bulk');
    expect(result.attribution).toContain('© test');
  });

  it('offers bulk the bare term as well as the context-biased one', async () => {
    // "Ann Arbor" is an article; "Ann Arbor, Michigan, USA" is not. Both forms ride one
    // request, so a batch that passes `context` for the precise vendor's benefit still
    // gets bulk coverage.
    const { vendor: bulkVendor, requests } = stubBulkVendor({ 'Ann Arbor': { lat: 42.28, lng: -83.74 } });
    const { vendor } = stubVendor({});
    const result = await geocodeBatch(undefined, ['Ann Arbor'], { vendor, bulkVendor, context: 'Michigan, USA' });
    expect(requests[0]).toEqual(['Ann Arbor, Michigan, USA', 'Ann Arbor']);
    expect(result.results[0]).toMatchObject({ query: 'Ann Arbor', ok: true, lat: 42.28 });
  });

  it('is skipped entirely when an outline is requested, because a point index has none', async () => {
    const { vendor: bulkVendor, requests } = stubBulkVendor({ Michigan: { lat: 44.3, lng: -85.6 } });
    const { vendor, calls } = stubVendor({ Michigan: { lat: 44.3, lng: -85.6 } });
    await geocodeBatch(undefined, ['Michigan'], { vendor, bulkVendor, outline: true });
    expect(requests).toEqual([]);
    expect(calls).toEqual(['Michigan']);
  });

  it('does not go near a bulk vendor when the caller injected its own vendor', async () => {
    const { vendor, calls } = stubVendor({ Detroit: { lat: 42.33, lng: -83.04 } });
    await geocodeBatch(undefined, ['Detroit'], { vendor });
    expect(calls).toEqual(['Detroit']);
  });

  it('survives a bulk vendor that throws by falling through to the precise one', async () => {
    const bulkVendor: GeocodeVendor = {
      id: 'boom-bulk', label: 'Boom', attribution: '', minIntervalMs: 0,
      lookupMany: vi.fn().mockRejectedValue(new Error('bulk down')),
      lookup: vi.fn(),
    };
    const { vendor, calls } = stubVendor({ Detroit: { lat: 42.33, lng: -83.04 } });
    const result = await geocodeBatch(undefined, ['Detroit'], { vendor, bulkVendor });
    expect(calls).toEqual(['Detroit']);
    expect(result.resolved).toBe(1);
  });
});

describe('geocodeBatch time budget', () => {
  it('defers what will not fit and says to call again, rather than reporting it missing', async () => {
    const paced: GeocodeVendor = {
      id: 'slow', label: 'Slow', attribution: '© slow', minIntervalMs: 0,
      async lookup(query) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { query, ok: true, lat: 1, lng: 2, displayName: query, boundingBox: [1, 1, 2, 2], kind: 'place' };
      },
    };
    const terms = Array.from({ length: 12 }, (_, index) => `P${index}`);
    const result = await geocodeBatch(undefined, terms, { vendor: paced, budgetMs: 60 });

    expect(result.pending).toBeGreaterThan(0);
    expect(result.resolved).toBeGreaterThan(0);
    // A deferred row is NOT counted as unresolved: the two ask the caller for
    // completely different things — retry vs. re-spell.
    expect(result.unresolved).toBe(0);
    expect(result.results).toHaveLength(terms.length);
    const deferredRow = result.results.find((row) => !row.ok);
    // The retry instruction must name the ADVERTISED tool name. A catalog id here
    // ('geo.geocode') appears nowhere in the model's tool list, so the model reads a
    // resumable batch as terminal and the map stays half-plotted — the silent-failure
    // mode api/scripts/check-prompt-tool-names.mjs exists to catch.
    expect(deferredRow && !deferredRow.ok && deferredRow.error).toContain('call builtin_geo_geocode again');
  });

  it('returns every term in the CALLER’s order however the passes reordered the work', async () => {
    const { vendor: bulkVendor } = stubBulkVendor({ B: { lat: 2, lng: 2 } });
    const { vendor } = stubVendor({ A: { lat: 1, lng: 1 }, C: { lat: 3, lng: 3 } });
    const result = await geocodeBatch(undefined, ['A', 'B', 'C'], { vendor, bulkVendor });
    expect(result.results.map((row) => row.query)).toEqual(['A', 'B', 'C']);
  });
});
