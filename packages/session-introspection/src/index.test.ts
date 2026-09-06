import { describe, expect, it } from 'vitest';
import { SESSION_INTROSPECT_CACHE_TTL, SESSION_INTROSPECT_PATH, sessionIntrospectCacheKey } from './index';

describe('session-introspection contract', () => {
  it('keys the verdict on the jti under one fixed prefix', () => {
    expect(sessionIntrospectCacheKey('abc-123')).toBe('auth:introspect:abc-123');
  });

  it('pins the path and the TTLs both ends rely on', () => {
    expect(SESSION_INTROSPECT_PATH).toBe('/api/auth/introspect');
    // KV cannot expire below 60s; the L1 window is the revoke-propagation bound.
    expect(SESSION_INTROSPECT_CACHE_TTL).toEqual({ kvTtlSeconds: 60, l1TtlMs: 30_000 });
  });
});
