/**
 * Site resolution for ingest (origin-bound, both token kinds) and the D17 workspace
 * check. The key lookup and the hosted-app lookup are mocked; the site row comes from
 * a fake db.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../domain/shared/errors';

const SITE_ID = '11111111-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => ({
  resolveTenantApiKey: vi.fn(),
  siteForProject: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock('../llm/tenantApiKeyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/tenantApiKeyService')>()),
  resolveTenantApiKey: mocks.resolveTenantApiKey,
}));
vi.mock('../ide/siteTraffic', () => ({ siteForProject: mocks.siteForProject }));

import { getSiteForTenant, resolveSiteForIngest, siteSettings } from './replaySites';

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows, orderBy: async () => mocks.rows }) }) }),
} as never;
const env = {} as never;

const row = (over: Record<string, unknown> = {}) => ({
  id: SITE_ID, tenantId: 7, kind: 'external', projectId: null, label: 'Shop', apiKeyId: 'key-1',
  settings: { keepRate: 0.5 }, status: 'active', createdAt: new Date('2026-10-01T00:00:00Z'), ...over,
});

beforeEach(() => {
  mocks.resolveTenantApiKey.mockReset();
  mocks.siteForProject.mockReset();
  mocks.rows = [row()];
});

describe('resolveSiteForIngest — bfr_ keys', () => {
  beforeEach(() => {
    mocks.resolveTenantApiKey.mockResolvedValue({ keyId: 'key-1', tenantId: 7, scopes: ['replay:ingest'], allowedOrigins: ['https://shop.example.com'] });
  });

  it('resolves the site from an allowed origin, asking for the replay:ingest scope', async () => {
    const site = await resolveSiteForIngest(env, db, 'bfr_abc', 'https://shop.example.com');
    expect(site).toMatchObject({ id: SITE_ID, tenantId: 7, kind: 'external' });
    expect(site?.settings.keepRate).toBe(0.5);
    expect(mocks.resolveTenantApiKey).toHaveBeenCalledWith(db, 'bfr_abc', 'replay:ingest');
  });

  it('refuses another origin', async () => {
    expect(await resolveSiteForIngest(env, db, 'bfr_abc', 'https://evil.example')).toBeNull();
  });

  it('refuses a request with no Origin at all', async () => {
    expect(await resolveSiteForIngest(env, db, 'bfr_abc', null)).toBeNull();
    expect(mocks.resolveTenantApiKey).not.toHaveBeenCalled();
  });

  it('refuses an unknown, revoked or unscoped key', async () => {
    mocks.resolveTenantApiKey.mockResolvedValue(null);
    expect(await resolveSiteForIngest(env, db, 'bfr_nope', 'https://shop.example.com')).toBeNull();
  });

  it('refuses a key that has no site', async () => {
    mocks.rows = [];
    expect(await resolveSiteForIngest(env, db, 'bfr_orphan', 'https://shop.example.com')).toBeNull();
  });

  it('refuses a token of any other shape', async () => {
    expect(await resolveSiteForIngest(env, db, 'bfk_full_tenant_key', 'https://shop.example.com')).toBeNull();
    expect(await resolveSiteForIngest(env, db, '', 'https://shop.example.com')).toBeNull();
  });
});

describe('resolveSiteForIngest — hosted apps', () => {
  beforeEach(() => {
    mocks.rows = [row({ kind: 'hosted', projectId: 42, apiKeyId: null })];
    mocks.siteForProject.mockResolvedValue({ siteId: 3, subdomain: 'acme', customDomain: 'shop.acme.com' });
  });

  it('accepts the app’s own subdomain and its custom domain', async () => {
    expect(await resolveSiteForIngest(env, db, `hosted:${SITE_ID}`, 'https://acme.builderforce.ai')).toMatchObject({ id: SITE_ID });
    expect(await resolveSiteForIngest(env, db, `hosted:${SITE_ID}`, 'https://shop.acme.com')).toMatchObject({ id: SITE_ID });
    expect(mocks.siteForProject).toHaveBeenCalledWith(db, 7, 42);
  });

  it('refuses any other origin', async () => {
    expect(await resolveSiteForIngest(env, db, `hosted:${SITE_ID}`, 'https://other.builderforce.ai')).toBeNull();
  });

  it('refuses an external site named as hosted', async () => {
    mocks.rows = [row()];
    expect(await resolveSiteForIngest(env, db, `hosted:${SITE_ID}`, 'https://acme.builderforce.ai')).toBeNull();
  });

  it('refuses a malformed hosted id without a lookup', async () => {
    expect(await resolveSiteForIngest(env, db, 'hosted:../x', 'https://acme.builderforce.ai')).toBeNull();
    expect(mocks.siteForProject).not.toHaveBeenCalled();
  });
});

describe('getSiteForTenant', () => {
  it('returns the caller workspace’s site', async () => {
    expect(await getSiteForTenant(env, db, 7, SITE_ID)).toMatchObject({ id: SITE_ID });
  });

  it('answers 403 for another workspace’s site', async () => {
    await expect(getSiteForTenant(env, db, 8, SITE_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('answers the same 403 for no site and for a malformed id', async () => {
    mocks.rows = [];
    await expect(getSiteForTenant(env, db, 7, SITE_ID)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSiteForTenant(env, db, 7, 'not-a-uuid')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('siteSettings', () => {
  it('fills defaults and bounds the numbers', () => {
    expect(siteSettings({ keepRate: 4, retentionDays: 365, recorderChannel: '  ab12cd34ef56 ' })).toMatchObject({
      keepRate: 1, retentionDays: 90, recorderChannel: 'ab12cd34ef56', maskAllText: false,
    });
    expect(siteSettings(null).retentionDays).toBe(30);
  });
});
