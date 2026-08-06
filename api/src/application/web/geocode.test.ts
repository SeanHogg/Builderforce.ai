import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BATCH,
  geocodeBatch,
  normalizeGeocodeQuery,
  parseNominatimResult,
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
