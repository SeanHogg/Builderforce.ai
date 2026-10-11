import { describe, expect, it } from 'vitest';
import { scopeWhere } from './replayScope';

describe('scopeWhere', () => {
  it('passes a positive tenant and a site through', () => {
    expect(scopeWhere({ tenantId: 7, siteId: 'site-a' })).toEqual({
      tenantId: 7,
      siteId: 'site-a',
    });
  });

  it('maps a non-positive tenant to null (signed-out / platform)', () => {
    expect(scopeWhere({ tenantId: 0, siteId: 'platform' })).toEqual({
      tenantId: null,
      siteId: 'platform',
    });
  });

  it('omits an empty siteId so a tenant-wide listing can reuse it', () => {
    expect(scopeWhere({ tenantId: 3, siteId: '' })).toEqual({ tenantId: 3 });
  });
});
