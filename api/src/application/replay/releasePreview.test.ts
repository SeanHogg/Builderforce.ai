/**
 * `GET REPLAY_PATHS.previewUrl` (PRD 33 §5.1.4): a short-lived link to a hosted
 * release of THIS project, served by the sites Worker. External sites, pruned
 * releases and deploys without KV say so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../domain/shared/errors';

const mocks = vi.hoisted(() => ({
  site: { id: 's1', tenantId: 7, kind: 'hosted', projectId: 42 } as Record<string, unknown>,
  releasePrefix: vi.fn(async () => 'sites/shop/abc/'),
  grant: vi.fn(async () => ({ token: 'f'.repeat(32), expiresAt: new Date('2026-10-13T12:30:00.000Z') }) as { token: string; expiresAt: Date } | null),
}));

vi.mock('./replaySites', () => ({ getSiteForTenant: vi.fn(async () => mocks.site) }));
vi.mock('./prescriptionReleases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prescriptionReleases')>()),
  releasePrefix: mocks.releasePrefix,
}));
vi.mock('../ide/siteTraffic', () => ({ siteForProject: vi.fn(async () => ({ siteId: 1, subdomain: 'shop', customDomain: null })) }));
vi.mock('../ide/sitePreviewAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ide/sitePreviewAccess')>()),
  grantSitePreview: mocks.grant,
}));

import { previewUrlFor } from './releasePreview';

const SCOPE = { tenantId: 7, siteId: 's1' };

beforeEach(() => {
  mocks.site = { id: 's1', tenantId: 7, kind: 'hosted', projectId: 42 };
  mocks.releasePrefix.mockClear();
  mocks.grant.mockClear();
});

describe('previewUrlFor', () => {
  it('grants a preview of the project\'s release on its own host', async () => {
    const out = await previewUrlFor({} as never, {} as never, SCOPE, 'abc');
    expect(out).toEqual({ releaseKey: 'abc', url: `https://shop.builderforce.ai/?bf_preview=${'f'.repeat(32)}`, expiresAt: '2026-10-13T12:30:00.000Z' });
    expect(mocks.releasePrefix).toHaveBeenCalledWith({}, 7, 42, 'abc');
    expect(mocks.grant).toHaveBeenCalledWith({}, { tenantId: 7, projectId: 42, versionToken: 'abc', r2Prefix: 'sites/shop/abc/' }, expect.any(Date));
  });

  it('refuses an external site and a malformed key', async () => {
    mocks.site = { id: 's1', tenantId: 7, kind: 'external', projectId: null };
    await expect(previewUrlFor({} as never, {} as never, SCOPE, 'abc')).rejects.toMatchObject({ name: 'ValidationError' });
    mocks.site = { id: 's1', tenantId: 7, kind: 'hosted', projectId: 42 };
    await expect(previewUrlFor({} as never, {} as never, SCOPE, '../etc')).rejects.toMatchObject({ name: 'ValidationError' });
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it('answers 409 for a pruned release and 503 without KV', async () => {
    mocks.releasePrefix.mockRejectedValueOnce(new ConflictError('That preview release is no longer available'));
    await expect(previewUrlFor({} as never, {} as never, SCOPE, 'gone')).rejects.toMatchObject({ name: 'ConflictError' });
    mocks.grant.mockResolvedValueOnce(null);
    await expect(previewUrlFor({} as never, {} as never, SCOPE, 'abc')).rejects.toMatchObject({ name: 'ServiceUnavailableError' });
  });
});
