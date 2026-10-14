import { describe, expect, it } from 'vitest';
import { REPLAY_PATHS } from '@builderforce/interaction-contract';
import { fill, listOf } from './replayHttp';

describe('replayHttp.fill', () => {
  it('fills every :name segment, URL-encoded', () => {
    expect(fill(REPLAY_PATHS.opsTenantSettings, { tenantId: 7 })).toBe('/api/admin/replay-ops/tenants/7/settings');
    expect(fill(REPLAY_PATHS.capabilityState, { slug: 'a b/c' })).toBe('/api/capabilities/a%20b%2Fc/state');
  });

  it('fills a missing param with an empty segment rather than leaving the placeholder', () => {
    expect(fill('/x/:siteId/y', {})).toBe('/x//y');
  });
});

describe('replayHttp.listOf', () => {
  it('reads a bare array or { items }', () => {
    expect(listOf([1, 2])).toEqual([1, 2]);
    expect(listOf({ items: ['a'] })).toEqual(['a']);
    expect(listOf<number>(null)).toEqual([]);
    expect(listOf<number>(undefined)).toEqual([]);
  });

  it('reads a list under its own name when given a key', () => {
    expect(listOf<string>({ sites: ['s1'] }, 'sites')).toEqual(['s1']);
    expect(listOf<string>({ items: ['i1'], sites: ['s1'] }, 'sites')).toEqual(['i1']);
    expect(listOf<string>(['bare'], 'sites')).toEqual(['bare']);
  });

  it('answers [] for anything that is not a list', () => {
    expect(listOf<string>({ sites: 'nope' }, 'sites')).toEqual([]);
    expect(listOf<string>('text', 'sites')).toEqual([]);
    expect(listOf<string>({ other: [] }, 'sites')).toEqual([]);
  });
});
