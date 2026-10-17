import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ secret: 'bfx_secret' as string | null }));

vi.mock('../integrations/connectionApiKey', () => ({
  readConnectionApiKey: vi.fn(async () => mocks.secret),
  writeConnectionApiKey: vi.fn(async () => undefined),
  deleteConnectionApiKey: vi.fn(async () => undefined),
}));

import { authenticateLrsRequest, revokeLrsCredential } from './lrsCredentials';
import { lookupLrsCredential, lrsCredentialLookupKey } from './lrsCredentialLookup';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

type Row = { id: number; tenantId: number; status: string; displayName: string; config: unknown };

/** A db whose SELECT resolves to `rows()` and whose UPDATE…RETURNING resolves to `updated`. */
function fakeDb(rows: () => Row[], updated: Array<{ id: number; externalAccount: string }> = []) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => rows() }) }),
  }));
  const update = vi.fn(() => ({
    set: () => ({ where: () => ({ returning: async () => updated }) }),
  }));
  return { db: { select, update } as unknown as Db, select };
}

const env = {} as Env;
const basic = (key: string, secret: string) => `Basic ${btoa(`${key}:${secret}`)}`;
const inbound: Row = { id: 7, tenantId: 3, status: 'connected', displayName: 'Storyline', config: { direction: 'inbound' } };

beforeEach(() => {
  __clearL1CacheForTests();
  mocks.secret = 'bfx_secret';
});

describe('lrsCredentialLookup', () => {
  it('keys on a digest of the public key, never on the key or secret verbatim', async () => {
    const key = await lrsCredentialLookupKey('bfx_public');
    expect(key).toMatch(/^lrs:auth:[0-9a-f]{64}$/);
    expect(key).not.toContain('bfx_public');
  });

  it('caches only a digest of the secret', async () => {
    const { db } = fakeDb(() => [inbound]);
    const hit = await lookupLrsCredential(db, env, 'bfx_public');
    expect(hit.found && hit.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(hit)).not.toContain('bfx_secret');
  });
});

describe('authenticateLrsRequest (cached)', () => {
  it('serves a repeat request without a second database read', async () => {
    const { db, select } = fakeDb(() => [inbound]);
    const first = await authenticateLrsRequest(db, env, basic('bfx_public', 'bfx_secret'));
    const second = await authenticateLrsRequest(db, env, basic('bfx_public', 'bfx_secret'));
    expect(first).toEqual({ ok: true, tenantId: 3, connectionId: 7, label: 'Storyline' });
    expect(second).toEqual(first);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong secret even on a warm cache entry', async () => {
    const { db } = fakeDb(() => [inbound]);
    await authenticateLrsRequest(db, env, basic('bfx_public', 'bfx_secret'));
    const wrong = await authenticateLrsRequest(db, env, basic('bfx_public', 'nope'));
    expect(wrong).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses an outbound credential presented inbound with 403', async () => {
    const { db } = fakeDb(() => [{ ...inbound, config: { direction: 'outbound', endpoint: 'https://x' } }]);
    expect(await authenticateLrsRequest(db, env, basic('k', 'bfx_secret'))).toMatchObject({ ok: false, status: 403 });
  });

  it('a revoke drops the cached verdict, so the key is dead on the next request', async () => {
    let current: Row = inbound;
    const { db, select } = fakeDb(() => [current], [{ id: 7, externalAccount: 'bfx_public' }]);
    expect(await authenticateLrsRequest(db, env, basic('bfx_public', 'bfx_secret'))).toMatchObject({ ok: true });

    await revokeLrsCredential(db, env, 3, 7);
    current = { ...inbound, status: 'revoked' };
    mocks.secret = null;

    expect(await authenticateLrsRequest(db, env, basic('bfx_public', 'bfx_secret')))
      .toMatchObject({ ok: false, status: 401 });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('caches an unknown key as a refusal', async () => {
    const { db, select } = fakeDb(() => []);
    await authenticateLrsRequest(db, env, basic('bfx_unknown', 's'));
    expect(await authenticateLrsRequest(db, env, basic('bfx_unknown', 's'))).toMatchObject({ ok: false, status: 401 });
    expect(select).toHaveBeenCalledTimes(1);
  });
});
