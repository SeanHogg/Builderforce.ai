/**
 * Insights site administration: the site key's least privilege, settings and origin
 * validation, and the hosted switch's idempotency. The key service, cache keys,
 * traces and project ownership are mocked; the db is a queue-driven fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  version: 0,
  mintTenantApiKey: vi.fn(),
  updateTenantApiKey: vi.fn(),
  bumpReplaySitesVersion: vi.fn(),
  recordReplayTrace: vi.fn(async () => undefined),
  firstTraceAt: vi.fn(),
  loadProjectInTenant: vi.fn(),
}));

vi.mock('../llm/tenantApiKeyService', () => ({
  REPLAY_KEY_CLIENT: 'replay',
  mintTenantApiKey: mocks.mintTenantApiKey,
  updateTenantApiKey: mocks.updateTenantApiKey,
}));
vi.mock('./replayCacheKeys', () => ({
  // A write bumps the version, so the next list read is a fresh key — as in production.
  tenantSitesKey: vi.fn(async (_env: unknown, tenantId: number) => `replay:sites:v:${mocks.version}:t${tenantId}`),
  bumpReplaySitesVersion: vi.fn(async (...args: unknown[]) => {
    mocks.version += 1;
    mocks.bumpReplaySitesVersion(...args);
  }),
  siteTokenKey: (hash: string) => `replay:site-token:${hash}`,
}));
vi.mock('./replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  firstTraceAt: mocks.firstTraceAt,
  REPLAY_TRACE_VERBS: {
    siteKeyIssued: 'replay.site_key.issued',
    loaderHit: 'replay.loader.hit',
    ingestFirstEvent: 'replay.ingest.first_event',
  },
}));
vi.mock('../project/projectOwnership', () => ({ loadProjectInTenant: mocks.loadProjectInTenant }));
vi.mock('./replayDatabase', () => ({ replayTelemetryDb: (_env: unknown, db: unknown) => db }));

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ValidationError } from '../../domain/shared/errors';
import { createExternalSite, createHostedSite, siteVerify, updateSite } from './replaySiteAdmin';

const SITE_ID = '0d6f1a52-1111-4222-8333-444455556666';
const CREATED = new Date('2026-10-13T10:00:00Z');
const env = {} as Env;

/** Every select answers the next queued row set; writes are recorded. */
function fakeDb(selects: unknown[][]) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'leftJoin', 'where', 'orderBy', 'limit']) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
    return c;
  };
  const db = {
    select: () => chain(selects.shift() ?? []),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserts.push(row);
        const returning = { returning: async () => [{ id: SITE_ID, createdAt: CREATED }] };
        return { ...returning, onConflictDoNothing: () => returning };
      },
    }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push(patch); } }) }),
  };
  return { db: db as unknown as Db, inserts, updates };
}

const hostedRow = (status: 'active' | 'disabled') => ({
  id: SITE_ID, kind: 'hosted', projectId: 42, label: 'Shop', settings: {}, status, createdAt: CREATED, allowedOrigins: null,
});

beforeEach(() => {
  mocks.version = 0;
  for (const fn of [mocks.mintTenantApiKey, mocks.updateTenantApiKey, mocks.bumpReplaySitesVersion, mocks.firstTraceAt, mocks.loadProjectInTenant]) fn.mockReset();
  mocks.recordReplayTrace.mockClear();
  mocks.mintTenantApiKey.mockResolvedValue({
    key: 'bfr_00112233445566778899aabbccddeeff', id: 'key-1', name: 'Insights · Shop',
    allowedOrigins: ['https://shop.example.com'], scopes: ['replay:ingest'], createdAt: CREATED,
  });
});

describe('createExternalSite', () => {
  it('mints a bfr_ key scoped to replay:ingest and bound to the normalised origins', async () => {
    const { db, inserts } = fakeDb([]);
    const dto = await createExternalSite(db, env, {
      tenantId: 7, userId: 'u1', label: '  Shop  ', allowedOrigins: ['Shop.Example.com', 'https://shop.example.com/'],
    });

    expect(mocks.mintTenantApiKey).toHaveBeenCalledWith(db, {
      tenantId: 7,
      name: 'Insights · Shop',
      createdByUserId: 'u1',
      client: 'replay',
      prefix: 'bfr',
      scopes: ['replay:ingest'],
      allowedOrigins: ['https://shop.example.com'],
    });
    expect(inserts[0]).toMatchObject({
      tenantId: 7, kind: 'external', projectId: null, label: 'Shop', apiKeyId: 'key-1', status: 'active',
      settings: expect.objectContaining({ publicKey: 'bfr_00112233445566778899aabbccddeeff', retentionDays: 30, keepRate: 1 }),
    });
    expect(dto).toMatchObject({
      id: SITE_ID, kind: 'external', label: 'Shop', status: 'active',
      publicKey: 'bfr_00112233445566778899aabbccddeeff', allowedOrigins: ['https://shop.example.com'],
      createdAt: CREATED.toISOString(),
    });
    expect(dto.settings).not.toHaveProperty('publicKey');
    expect(mocks.bumpReplaySitesVersion).toHaveBeenCalledWith(env, 7, SITE_ID);
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(env, db, expect.objectContaining({
      tenantId: 7, siteId: SITE_ID, verb: 'replay.site_key.issued', actorId: 'u1',
    }));
  });

  it.each([
    [['*']],
    [['http://shop.example.com']],
    [['https://shop.example.com/checkout']],
    [[]],
  ])('refuses origins %j before minting anything', async (origins) => {
    const { db } = fakeDb([]);
    await expect(createExternalSite(db, env, { tenantId: 7, userId: 'u1', label: 'Shop', allowedOrigins: origins }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mocks.mintTenantApiKey).not.toHaveBeenCalled();
  });

  it('accepts http only for localhost', async () => {
    const { db } = fakeDb([]);
    await createExternalSite(db, env, { tenantId: 7, userId: 'u1', label: 'Dev', allowedOrigins: ['http://localhost:3000'] });
    expect(mocks.mintTenantApiKey.mock.calls[0]?.[1]).toMatchObject({ allowedOrigins: ['http://localhost:3000'] });
  });

  it.each([
    [{ keepRate: 1.5 }],
    [{ keepRate: -0.1 }],
    [{ retentionDays: 0 }],
    [{ retentionDays: 91 }],
    [{ retentionDays: 30.5 }],
    [{ maskAllText: 'yes' }],
    [{ somethingElse: true }],
  ])('refuses settings %j', async (settings) => {
    const { db } = fakeDb([]);
    await expect(createExternalSite(db, env, {
      tenantId: 7, userId: 'u1', label: 'Shop', allowedOrigins: ['https://shop.example.com'], settings: settings as never,
    })).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.mintTenantApiKey).not.toHaveBeenCalled();
  });
});

describe('createHostedSite', () => {
  it('is idempotent: an active hosted site for the project is returned, not doubled', async () => {
    mocks.loadProjectInTenant.mockResolvedValue({ name: 'Shop' });
    const { db, inserts } = fakeDb([[hostedRow('active')]]);
    const dto = await createHostedSite(db, env, { tenantId: 7, projectId: 42, userId: 'u1' });
    expect(dto).toMatchObject({ id: SITE_ID, kind: 'hosted', projectId: 42, status: 'active', publicKey: null });
    expect(inserts).toHaveLength(0);
  });

  it('creates the hosted site once when none exists', async () => {
    mocks.loadProjectInTenant.mockResolvedValue({ name: 'Shop' });
    // list (none) → after the write, list again (the new row)
    const { db, inserts } = fakeDb([[], [hostedRow('active')]]);
    const dto = await createHostedSite(db, env, { tenantId: 7, projectId: 42, userId: 'u1' });
    expect(inserts[0]).toMatchObject({ tenantId: 7, kind: 'hosted', projectId: 42, label: 'Shop', apiKeyId: null });
    expect(dto.id).toBe(SITE_ID);
    expect(mocks.mintTenantApiKey).not.toHaveBeenCalled();
  });

  it('switches a disabled hosted site back on instead of creating another', async () => {
    mocks.loadProjectInTenant.mockResolvedValue({ name: 'Shop' });
    const { db, inserts, updates } = fakeDb([[hostedRow('disabled')], [{ settings: {}, apiKeyId: null }], [hostedRow('active')]]);
    const dto = await createHostedSite(db, env, { tenantId: 7, projectId: 42, userId: 'u1' });
    expect(inserts).toHaveLength(0);
    expect(updates[0]).toMatchObject({ status: 'active' });
    expect(dto.status).toBe('active');
  });

  it('404s a project outside the workspace', async () => {
    mocks.loadProjectInTenant.mockResolvedValue(null);
    const { db } = fakeDb([]);
    await expect(createHostedSite(db, env, { tenantId: 7, projectId: 999, userId: 'u1' })).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('updateSite', () => {
  const externalRow = {
    id: SITE_ID, kind: 'external', projectId: null, label: 'Shop',
    settings: { publicKey: 'bfr_k', retentionDays: 30 }, status: 'active', createdAt: CREATED,
    allowedOrigins: ['https://shop.example.com'],
  };

  it('keeps the public key when settings change, and validates the new values', async () => {
    const { db, updates } = fakeDb([[externalRow], [{ settings: externalRow.settings, apiKeyId: 'key-1' }], [externalRow]]);
    await updateSite(db, env, { tenantId: 7, siteId: SITE_ID }, { settings: { retentionDays: 90 } });
    expect(updates[0]?.settings).toMatchObject({ publicKey: 'bfr_k', retentionDays: 90 });
  });

  it('refuses retention past 90 days', async () => {
    const { db } = fakeDb([[externalRow], [{ settings: externalRow.settings, apiKeyId: 'key-1' }]]);
    await expect(updateSite(db, env, { tenantId: 7, siteId: SITE_ID }, { settings: { retentionDays: 120 } }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('moves the origin list onto the site key', async () => {
    mocks.updateTenantApiKey.mockResolvedValue({ id: 'key-1' });
    const { db } = fakeDb([[externalRow], [{ settings: externalRow.settings, apiKeyId: 'key-1' }], [externalRow]]);
    await updateSite(db, env, { tenantId: 7, siteId: SITE_ID }, { allowedOrigins: ['www.example.com'] });
    expect(mocks.updateTenantApiKey).toHaveBeenCalledWith(db, {
      tenantId: 7, keyId: 'key-1', allowedOrigins: ['https://www.example.com'], env,
    });
  });

  it('403s a site of another workspace', async () => {
    const { db } = fakeDb([[]]);
    await expect(updateSite(db, env, { tenantId: 8, siteId: SITE_ID }, { label: 'x' })).rejects.toMatchObject({ name: 'ForbiddenError' });
  });
});

describe('siteVerify', () => {
  it('reads the checks from the trace verbs and the first kept recording', async () => {
    const at = new Date('2026-10-13T11:00:00Z');
    mocks.firstTraceAt.mockImplementation(async (_e: unknown, _d: unknown, input: { verb: string }) =>
      (input.verb === 'replay.loader.hit' || input.verb === 'replay.ingest.first_event' ? at : null));
    const { db } = fakeDb([[hostedRow('active')], [{ id: 'rec-1' }]]);
    await expect(siteVerify(env, db, { tenantId: 7, siteId: SITE_ID })).resolves.toEqual({
      scriptSeen: true, originOk: true, firstEventAt: at.toISOString(), firstRecordingId: 'rec-1',
    });
  });

  it('reports nothing seen yet for a fresh site', async () => {
    mocks.firstTraceAt.mockResolvedValue(null);
    const { db } = fakeDb([[hostedRow('active')], []]);
    await expect(siteVerify(env, db, { tenantId: 7, siteId: SITE_ID })).resolves.toEqual({
      scriptSeen: false, originOk: false, firstEventAt: null, firstRecordingId: null,
    });
  });
});
