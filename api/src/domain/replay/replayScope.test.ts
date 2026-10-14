import { describe, expect, it } from 'vitest';
import { isReplayScope, isReplaySiteId } from './replayScope';

const SITE = '7d4b8c52-0d36-4c5e-9a43-2f1d6b0e9a10';

describe('isReplaySiteId', () => {
  it('accepts a uuid and refuses anything else', () => {
    expect(isReplaySiteId(SITE)).toBe(true);
    expect(isReplaySiteId('platform')).toBe(false);
    expect(isReplaySiteId('')).toBe(false);
    expect(isReplaySiteId(42)).toBe(false);
  });
});

describe('isReplayScope', () => {
  it('accepts a positive tenant with a site', () => {
    expect(isReplayScope({ tenantId: 7, siteId: SITE })).toBe(true);
  });

  it('refuses the platform shape (no tenant) — D17 has no platform scope', () => {
    expect(isReplayScope({ tenantId: 0, siteId: SITE })).toBe(false);
    expect(isReplayScope({ tenantId: null, siteId: SITE })).toBe(false);
  });

  it('refuses a scope without a site', () => {
    expect(isReplayScope({ tenantId: 3, siteId: '' })).toBe(false);
    expect(isReplayScope({ tenantId: 3 })).toBe(false);
    expect(isReplayScope(null)).toBe(false);
  });
});
