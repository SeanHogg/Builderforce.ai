import { describe, expect, it } from 'vitest';
import { cacheScopeDigest, cacheScopeKey, principalScope, TENANT_PRINCIPAL } from './cacheScope';

describe('principalScope', () => {
  it('is the tenant-internal principal when nobody is named', () => {
    expect(principalScope(null)).toBe(TENANT_PRINCIPAL);
    expect(principalScope({})).toBe(TENANT_PRINCIPAL);
  });

  it('separates person, host and key, and leads with the role', () => {
    expect(principalScope({ userId: 'u1', role: 'member' })).toBe('member.user-u1');
    expect(principalScope({ agentHostId: 9, role: 'developer' })).toBe('developer.host-9');
    expect(principalScope({ apiKeyId: 'k1', role: 'owner' })).toBe('owner.key-k1');
    expect(principalScope({ userId: 'u1', role: 'owner' })).not.toBe(principalScope({ userId: 'u1', role: 'member' }));
  });

  it('keeps the separator out of the segment', () => {
    expect(principalScope({ userId: 'agentHost:3', role: 'developer' })).toBe('developer.user-agentHost_3');
  });
});

describe('cacheScopeKey', () => {
  const base = { tenantId: 1, principal: 'member.user-u1' };
  it('renders tenant, project, principal and model class', () => {
    expect(cacheScopeKey(base)).toBe('t1:p-:member.user-u1:m-');
    expect(cacheScopeKey({ ...base, projectId: 4, modelClass: 'PREMIUM' })).toBe('t1:p4:member.user-u1:mPREMIUM');
  });

  it('every dimension separates', () => {
    const k = cacheScopeKey({ ...base, projectId: 4, modelClass: 'free' });
    expect(cacheScopeKey({ ...base, tenantId: 2, projectId: 4, modelClass: 'free' })).not.toBe(k);
    expect(cacheScopeKey({ ...base, projectId: 5, modelClass: 'free' })).not.toBe(k);
    expect(cacheScopeKey({ ...base, principal: 'member.user-u2', projectId: 4, modelClass: 'free' })).not.toBe(k);
    expect(cacheScopeKey({ ...base, projectId: 4, modelClass: 'premium' })).not.toBe(k);
  });

  it('digest is short and stable', () => {
    expect(cacheScopeDigest(base)).toMatch(/^[0-9a-f]{8}$/);
    expect(cacheScopeDigest(base)).toBe(cacheScopeDigest({ ...base }));
    expect(cacheScopeDigest(base)).not.toBe(cacheScopeDigest({ ...base, principal: 'member.user-u2' }));
  });
});
