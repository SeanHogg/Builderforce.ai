import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subdomainFromHost, normalizeSubdomain, resolveSiteForHost, HOSTING_APEX } from './siteHosting';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { buildDatabase } from '../../infrastructure/database/connection';
import { fakeDb } from '../../../test/fakeDb';
import type { Env } from '../../env';

// The lookups build their own connection, so the driver is the seam to stub.
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: vi.fn() }));

describe('siteHosting apex', () => {
  it('hosts on the single-label apex (free Universal SSL wildcard)', () => {
    expect(HOSTING_APEX).toBe('builderforce.ai');
  });
});

describe('subdomainFromHost', () => {
  it('extracts a single-label site subdomain', () => {
    expect(subdomainFromHost('rumbledating.builderforce.ai')).toBe('rumbledating');
    expect(subdomainFromHost('rumbledating.builderforce.ai:443')).toBe('rumbledating');
    expect(subdomainFromHost('My-App.BuilderForce.ai')).toBe('my-app');
  });

  it('returns null for the apex itself and foreign hosts', () => {
    expect(subdomainFromHost('builderforce.ai')).toBeNull();
    expect(subdomainFromHost('example.com')).toBeNull();
    expect(subdomainFromHost(undefined)).toBeNull();
  });

  it('returns null for multi-label hosts (Universal SSL covers one level only)', () => {
    expect(subdomainFromHost('a.b.builderforce.ai')).toBeNull();
  });

  it('NEVER treats a reserved/platform label as a site (so api/www/etc. route normally)', () => {
    // This is the safety property: the apex is shared, so reserved labels must
    // fall through to normal routing rather than be looked up + 404'd as a site.
    for (const reserved of ['api', 'app', 'www', 'admin', 'gateway', 'ide', 'apps']) {
      expect(subdomainFromHost(`${reserved}.builderforce.ai`)).toBeNull();
    }
  });
});

describe('normalizeSubdomain', () => {
  it('slugifies valid candidates', () => {
    expect(normalizeSubdomain('Rumble Dating')).toBe('rumble-dating');
    expect(normalizeSubdomain('my_app')).toBe('my-app');
  });

  it('rejects reserved labels at claim time (symmetric with the serve side)', () => {
    expect(normalizeSubdomain('api')).toBeNull();
    expect(normalizeSubdomain('www')).toBeNull();
    expect(normalizeSubdomain('apps')).toBeNull();
  });

  it('rejects empty / unusable candidates', () => {
    expect(normalizeSubdomain('   ')).toBeNull();
    expect(normalizeSubdomain('!!!')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveSiteForHost — the ONE routing entry point (custom domains, 0412)
// ---------------------------------------------------------------------------

describe('resolveSiteForHost', () => {
  const site = {
    siteId: 5, projectId: 10, tenantId: 7,
    r2Prefix: 'sites/myapp/', status: 'active',
    versionToken: 'v1', indexDocument: 'index.html',
  };
  const env = { JWT_SECRET: 's' } as unknown as Env;

  /** Capture the WHERE clauses each lookup issues, and answer with `rows`. */
  function withDb(rows: unknown[]) {
    const db = fakeDb([rows]);
    vi.mocked(buildDatabase).mockReturnValue(db as never);
    return db;
  }

  beforeEach(() => {
    __clearL1CacheForTests();
    vi.mocked(buildDatabase).mockReset();
  });

  it('resolves a platform subdomain WITHOUT a second custom-domain lookup', async () => {
    const db = withDb([site]);
    await expect(resolveSiteForHost(env, 'myapp.builderforce.ai')).resolves.toMatchObject({ siteId: 5 });
    expect(db.calls).toHaveLength(1);
  });

  it('resolves a tenant\'s own hostname', async () => {
    withDb([site]);
    await expect(resolveSiteForHost(env, 'shop.example.com')).resolves.toMatchObject({ siteId: 5, tenantId: 7 });
  });

  it('returns null for a hostname no site owns', async () => {
    withDb([]);
    await expect(resolveSiteForHost(env, 'unclaimed.example.com')).resolves.toBeNull();
  });

  it('NEVER treats platform traffic as a customer domain', async () => {
    const db = withDb([site]);
    // Reserved labels and the apex itself must fall through to normal routing —
    // looking them up as custom domains would let a claim hijack the API host.
    for (const host of ['api.builderforce.ai', 'www.builderforce.ai', 'builderforce.ai', 'a.b.builderforce.ai']) {
      await expect(resolveSiteForHost(env, host)).resolves.toBeNull();
    }
    expect(db.calls).toHaveLength(0);
  });

  it('returns null with no Host header', async () => {
    const db = withDb([site]);
    await expect(resolveSiteForHost(env, undefined)).resolves.toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('ignores the port and is case-insensitive', async () => {
    withDb([site]);
    await expect(resolveSiteForHost(env, 'Shop.Example.COM:443')).resolves.toMatchObject({ siteId: 5 });
  });

  it('does not serve a disabled site on either address', async () => {
    withDb([{ ...site, status: 'disabled' }]);
    await expect(resolveSiteForHost(env, 'shop.example.com')).resolves.toBeNull();
    __clearL1CacheForTests();
    withDb([{ ...site, status: 'disabled' }]);
    await expect(resolveSiteForHost(env, 'myapp.builderforce.ai')).resolves.toBeNull();
  });

  it('exposes the join keys the traffic counter and site API need', async () => {
    withDb([site]);
    const resolved = await resolveSiteForHost(env, 'myapp.builderforce.ai');
    // Without siteId/tenantId here, every counted request would need a second
    // query to find out which site it belonged to.
    expect(resolved).toMatchObject({ siteId: 5, tenantId: 7, projectId: 10 });
  });
});
