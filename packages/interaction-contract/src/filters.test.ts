import { describe, expect, it } from 'vitest';
import {
  FILTER_FIELDS,
  MAX_FILTER_CLAUSES,
  filterFromQuery,
  filterToQuery,
  parseReplayFilter,
  type ReplayFilter,
} from './filters';

describe('FILTER_FIELDS', () => {
  it('declares exactly the §3.4 field ids', () => {
    expect(FILTER_FIELDS.map((f) => f.id)).toEqual([
      'device', 'browser', 'os', 'country', 'referrer', 'entryPath', 'exitPath', 'visitedPath',
      'clickedSelector', 'frustration', 'durationMs', 'activeMs', 'pageCount', 'release', 'smartEvent',
      'tag', 'converted', 'variant',
    ]);
  });

  it('gives every field at least one op and a value kind', () => {
    for (const field of FILTER_FIELDS) {
      expect(field.ops.length).toBeGreaterThan(0);
      expect(field.valueKind).toBeTruthy();
      if (field.valueKind === 'enum') expect(field.values?.length).toBeGreaterThan(0);
    }
  });
});

describe('parseReplayFilter', () => {
  it('treats null/undefined as the empty filter', () => {
    expect(parseReplayFilter(null)).toEqual({ all: [] });
    expect(parseReplayFilter(undefined)).toEqual({ all: [] });
  });

  it('accepts valid clauses of every value kind', () => {
    const filter = {
      all: [
        { field: 'device', op: 'eq', value: 'phone' },
        { field: 'frustration', op: 'in', value: ['rage', 'dead'] },
        { field: 'durationMs', op: 'gte', value: 5000 },
        { field: 'converted', op: 'eq', value: true },
        { field: 'tag', op: 'eq', value: 'plan=pro' },
        { field: 'visitedPath', op: 'prefix', value: '/checkout' },
      ],
    };
    expect(parseReplayFilter(filter)).toEqual(filter);
  });

  it('rejects unknown fields, ops and value kinds', () => {
    expect(parseReplayFilter({ all: [{ field: 'nope', op: 'eq', value: 'x' }] })).toBeNull();
    expect(parseReplayFilter({ all: [{ field: 'device', op: 'contains', value: 'phone' }] })).toBeNull();
    expect(parseReplayFilter({ all: [{ field: 'device', op: 'eq', value: 'watch' }] })).toBeNull();
    expect(parseReplayFilter({ all: [{ field: 'durationMs', op: 'gte', value: '5000' }] })).toBeNull();
    expect(parseReplayFilter({ all: [{ field: 'tag', op: 'eq', value: 'noequals' }] })).toBeNull();
    expect(parseReplayFilter({ all: [{ field: 'country', op: 'in', value: [] }] })).toBeNull();
    expect(parseReplayFilter({ clauses: [] })).toBeNull();
    expect(parseReplayFilter('device=phone')).toBeNull();
  });

  it('rejects more than 12 clauses', () => {
    const clause = { field: 'country', op: 'eq', value: 'NZ' };
    expect(MAX_FILTER_CLAUSES).toBe(12);
    expect(parseReplayFilter({ all: Array(12).fill(clause) })).not.toBeNull();
    expect(parseReplayFilter({ all: Array(13).fill(clause) })).toBeNull();
  });
});

describe('filterToQuery / filterFromQuery', () => {
  const filter: ReplayFilter = {
    all: [
      { field: 'device', op: 'eq', value: 'phone' },
      { field: 'durationMs', op: 'gte', value: 5000 },
      { field: 'durationMs', op: 'lte', value: 60000 },
      { field: 'frustration', op: 'in', value: ['rage', 'dead'] },
      { field: 'converted', op: 'eq', value: false },
      { field: 'referrer', op: 'in', value: ['a,b.com', 'c.com'] },
      { field: 'tag', op: 'eq', value: 'plan=pro' },
    ],
  };

  it('round-trips every clause, in order', () => {
    expect(filterFromQuery(filterToQuery(filter))).toEqual(filter);
  });

  it('round-trips through the serialised string', () => {
    expect(filterFromQuery(`?${filterToQuery(filter).toString()}`)).toEqual(filter);
  });

  it('prefixes params so other URL state is ignored', () => {
    const params = filterToQuery({ all: [{ field: 'device', op: 'eq', value: 'phone' }] });
    expect(params.get('f.device.eq')).toBe('phone');
    params.set('site', 'abc');
    params.set('panel', 'recording:1');
    expect(filterFromQuery(params)).toEqual({ all: [{ field: 'device', op: 'eq', value: 'phone' }] });
  });

  it('drops malformed filter params', () => {
    expect(filterFromQuery('f.nope.eq=1&f.durationMs.gte=abc&f.device.eq=phone')).toEqual({
      all: [{ field: 'device', op: 'eq', value: 'phone' }],
    });
  });
});
