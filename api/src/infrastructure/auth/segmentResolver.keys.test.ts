import { describe, expect, it } from 'vitest';
import { segmentCacheKeys } from './segmentResolver';

describe('segmentCacheKeys', () => {
  it('derives a federated segment\'s key from its row alone — no per-isolate memory', () => {
    expect(segmentCacheKeys({ tenantId: 7, externalAccountId: 'acct', externalCompanyId: 'co', isDefault: false }))
      .toEqual(['segment:7|acct|co']);
  });

  it('adds the claimless key for the tenant default segment', () => {
    expect(segmentCacheKeys({ tenantId: 7, externalAccountId: null, externalCompanyId: null, isDefault: true }))
      .toEqual(['segment:7||']);
  });

  it('a segment with only half of the external pair is never resolved by claims', () => {
    expect(segmentCacheKeys({ tenantId: 7, externalAccountId: 'acct', externalCompanyId: null, isDefault: false })).toEqual([]);
  });
});
