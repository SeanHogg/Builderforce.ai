import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import {
  TENANT_API_SCOPES,
  isTenantApiScope,
  deserializeScopes,
  keyHasScope,
  revokeTenantApiKeyByRawKey,
  touchTenantApiKey,
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

describe('revokeTenantApiKeyByRawKey — input guard', () => {
  // A DB that throws on any use, so the test proves the guard short-circuits
  // before ever touching the database for empty / whitespace-only input.
  const explodingDb = new Proxy({}, {
    get() { throw new Error('db must not be touched for an empty raw key'); },
  }) as unknown as Db;

  it('returns false without hitting the db for empty or whitespace keys', async () => {
    expect(await revokeTenantApiKeyByRawKey(explodingDb, { rawKey: '' })).toBe(false);
    expect(await revokeTenantApiKeyByRawKey(explodingDb, { rawKey: '   ' })).toBe(false);
    expect(await revokeTenantApiKeyByRawKey(explodingDb, { rawKey: undefined as unknown as string })).toBe(false);
  });
});

describe('touchTenantApiKey — last_used_at throttle', () => {
  function recordingDb() {
    const where = vi.fn(async () => undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    return { db: { update } as unknown as Db, update, where };
  }

  it('sends the conditional UPDATE once per key per window, not once per request', async () => {
    const { db, update, where } = recordingDb();
    await touchTenantApiKey(db, 'key-a');
    await touchTenantApiKey(db, 'key-a');
    await touchTenantApiKey(db, 'key-a');
    expect(update).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('throttles per key — a different key is still stamped', async () => {
    const { db, update } = recordingDb();
    await touchTenantApiKey(db, 'key-b');
    await touchTenantApiKey(db, 'key-c');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('a failed stamp is not remembered, so the next request retries it', async () => {
    const where = vi.fn()
      .mockRejectedValueOnce(new Error('neon down'))
      .mockResolvedValue(undefined);
    const update = vi.fn(() => ({ set: () => ({ where }) }));
    const db = { update } as unknown as Db;
    await expect(touchTenantApiKey(db, 'key-d')).rejects.toThrow('neon down');
    await touchTenantApiKey(db, 'key-d');
    expect(update).toHaveBeenCalledTimes(2);
  });
});
