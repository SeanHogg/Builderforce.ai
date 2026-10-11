import { describe, expect, it } from 'vitest';
import { FILTER_FIELDS, filterFromQuery, filterToQuery, parseReplayFilter } from './filters';

describe('FILTER_FIELDS', () => {
  it('declares device, country, path, utm, frustration and duration', () => {
    const keys = FILTER_FIELDS.map((f) => f.key);
    for (const key of ['device', 'country', 'path', 'utmSource', 'frustration', 'durationMs']) {
      expect(keys).toContain(key);
    }
  });
});

describe('parseReplayFilter', () => {
  it('accepts the canonical { clauses } shape', () => {
    const parsed = parseReplayFilter({
      clauses: [{ field: 'device', op: 'eq', value: 'mobile' }],
    });
    expect(parsed).toEqual({ clauses: [{ field: 'device', op: 'eq', value: 'mobile' }] });
  });

  it('accepts a field→value shorthand', () => {
    expect(parseReplayFilter({ device: 'desktop', hasError: true })).toEqual({
      clauses: [
        { field: 'device', op: 'eq', value: 'desktop' },
        { field: 'hasError', op: 'eq', value: true },
      ],
    });
  });

  it('returns null for an unknown field in the shorthand', () => {
    expect(parseReplayFilter({ nope: 'x' })).toBeNull();
  });

  it('treats empty input as an empty filter', () => {
    expect(parseReplayFilter(null)).toEqual({ clauses: [] });
    expect(parseReplayFilter('')).toEqual({ clauses: [] });
  });
});

describe('filterToQuery / filterFromQuery', () => {
  it('round-trips eq and gte clauses', () => {
    const filter = {
      clauses: [
        { field: 'device' as const, op: 'eq' as const, value: 'mobile' },
        { field: 'durationMs' as const, op: 'gte' as const, value: 5_000 },
      ],
    };
    const params = filterToQuery(filter);
    expect(params.get('device')).toBe('mobile');
    expect(params.get('durationMs.gte')).toBe('5000');
    expect(filterFromQuery(params)).toEqual(filter);
  });

  it('round-trips an `in` list as repeated keys', () => {
    const filter = {
      clauses: [{ field: 'frustration' as const, op: 'in' as const, value: ['rage', 'dead'] }],
    };
    expect(filterFromQuery(filterToQuery(filter))).toEqual(filter);
  });

  it('parses a query string via parseReplayFilter', () => {
    expect(parseReplayFilter('device=tablet&path.contains=%2Fpricing')).toEqual({
      clauses: [
        { field: 'device', op: 'eq', value: 'tablet' },
        { field: 'path', op: 'contains', value: '/pricing' },
      ],
    });
  });

  it('drops unknown fields from a query rather than failing', () => {
    expect(filterFromQuery(new URLSearchParams('nope=1&device=mobile'))).toEqual({
      clauses: [{ field: 'device', op: 'eq', value: 'mobile' }],
    });
  });
});
