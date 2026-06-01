import { describe, expect, it } from 'vitest';
import {
  TENANT_API_SCOPES,
  isTenantApiScope,
  deserializeScopes,
  keyHasScope,
} from './tenantApiKeyService';

describe('tenant API key scopes', () => {
  it('isTenantApiScope only accepts known scopes', () => {
    expect(isTenantApiScope('ingest:feedback')).toBe(true);
    expect(isTenantApiScope('webhooks:manage')).toBe(true);
    expect(isTenantApiScope('admin:everything')).toBe(false);
    expect(isTenantApiScope(42)).toBe(false);
  });

  it('deserializeScopes filters non-strings and tolerates malformed JSON', () => {
    expect(deserializeScopes(null)).toBeNull();
    expect(deserializeScopes('')).toBeNull();
    expect(deserializeScopes('not json')).toBeNull();
    expect(deserializeScopes(JSON.stringify(['ingest:feedback', 7, 'webhooks:manage']))).toEqual([
      'ingest:feedback',
      'webhooks:manage',
    ]);
  });

  it('keyHasScope treats null/empty scopes as unrestricted (legacy keys)', () => {
    expect(keyHasScope(null, 'ingest:feedback')).toBe(true);
    expect(keyHasScope([], 'webhooks:manage')).toBe(true);
  });

  it('keyHasScope restricts a scoped key to exactly its scopes', () => {
    expect(keyHasScope(['ingest:feedback'], 'ingest:feedback')).toBe(true);
    expect(keyHasScope(['ingest:feedback'], 'webhooks:manage')).toBe(false);
  });

  it('every declared scope is a valid scope (no typos in the registry)', () => {
    for (const s of TENANT_API_SCOPES) expect(isTenantApiScope(s)).toBe(true);
  });
});
