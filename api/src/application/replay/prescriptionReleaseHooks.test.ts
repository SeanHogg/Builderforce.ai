/**
 * A new release and a canvas publish start measuring the fixes a person applied by
 * hand (PRD 33 §5.2): `manual` → the next release first seen, `composer` → the
 * publish's release; the verdict compares the page on that release with the one
 * before it. A first-seen release also queues its page captures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queueReleaseCaptures: vi.fn(async () => {}),
  bump: vi.fn(async () => {}),
  momentEffect: vi.fn(),
  site: { id: '11111111-2222-4333-8444-555555555555', tenantId: 7, kind: 'hosted', projectId: 42, status: 'active' } as Record<string, unknown>,
}));

vi.mock('./pageCapture', () => ({ queueReleaseCaptures: mocks.queueReleaseCaptures }));
vi.mock('./replayCacheKeys', () => ({ bumpSiteVersion: mocks.bump }));
vi.mock('./replaySites', () => ({
  getSite: vi.fn(async () => mocks.site),
  listSitesForTenant: vi.fn(async () => [mocks.site]),
}));
vi.mock('./ticketEffect', () => ({ momentEffect: mocks.momentEffect }));
vi.mock('./ReplayReadService', () => ({
  ReplayReadService: vi.fn(function ReplayReadService() {
    return { releases: async () => [{ releaseKey: 'r3' }, { releaseKey: 'r2' }, { releaseKey: 'r1' }] };
  }),
}));
vi.mock('./prescriptionPageActions', () => ({ MANUAL_ACTION_REF: 'manual', COMPOSER_ACTION_REF: 'composer' }));

import { noteComposerPublish, onReleasesFirstSeen } from './prescriptionReleaseHooks';
import { viaReleaseEffect } from './prescriptionReleaseEffect';
import { decodeActionRef } from '../../domain/replay/prescriptions/prescriptionState';

const SITE_ID = '11111111-2222-4333-8444-555555555555';

function fakeDb(moved: number) {
  const sets: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({
      set: (set: Record<string, unknown>) => {
        sets.push(set);
        return { where: () => ({ returning: async () => Array.from({ length: moved }, (_, i) => ({ id: `rx-${i}` })) }) };
      },
    }),
  };
  return { db: db as never, sets };
}

beforeEach(() => {
  mocks.queueReleaseCaptures.mockClear();
  mocks.bump.mockClear();
  mocks.momentEffect.mockReset();
  mocks.site = { id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42, status: 'active' };
});

describe('onReleasesFirstSeen', () => {
  it('moves hand-applied fixes onto the release that shipped them and queues its page captures', async () => {
    const { db, sets } = fakeDb(2);
    await onReleasesFirstSeen({} as never, db, [{ siteId: SITE_ID, tenantId: 7, releaseKey: 'r3' }]);
    expect(sets[0]).toMatchObject({ actionRef: 'p=r3', status: 'measuring' });
    expect(mocks.bump).toHaveBeenCalledWith({}, SITE_ID);
    expect(mocks.queueReleaseCaptures).toHaveBeenCalledWith({}, db, mocks.site, 'r3', expect.any(Date));
  });

  it('ignores a release of a site outside its workspace', async () => {
    const { db, sets } = fakeDb(0);
    await onReleasesFirstSeen({} as never, db, [{ siteId: SITE_ID, tenantId: 8, releaseKey: 'r3' }]);
    expect(sets).toHaveLength(0);
    expect(mocks.queueReleaseCaptures).not.toHaveBeenCalled();
  });

  it('leaves a fix pending when the release key cannot be carried in the ref column', async () => {
    const { db, sets } = fakeDb(1);
    await onReleasesFirstSeen({} as never, db, [{ siteId: SITE_ID, tenantId: 7, releaseKey: 'v1.2.3 beta' }]);
    expect(sets).toHaveLength(0);
  });
});

describe('noteComposerPublish', () => {
  it('measures apply-in-composer fixes on the release the canvas published', async () => {
    const { db, sets } = fakeDb(1);
    await noteComposerPublish({} as never, db, { tenantId: 7, projectId: 42, versionToken: 'abcdef0123456789' });
    expect(sets[0]).toMatchObject({ actionRef: 'p=abcdef0123456789', status: 'measuring' });
    expect(decodeActionRef(String(sets[0]!.actionRef)).previewRelease).toBe('abcdef0123456789');
  });

  it('does nothing for a project without an Insights site', async () => {
    const { db, sets } = fakeDb(1);
    await noteComposerPublish({} as never, db, { tenantId: 7, projectId: 99, versionToken: 'abc' });
    expect(sets).toHaveLength(0);
  });
});

describe('viaReleaseEffect', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    env: {} as never, db: {} as never, scope: { tenantId: 7, siteId: SITE_ID }, now: new Date(),
    row: { id: 'rx-1', pagePath: '/pricing', acceptance: { metric: 'conversion_rate', direction: 'up', minVisits: 500 } } as never,
    refs: { taskId: null, testId: null, previewRelease: 'r2', liveRelease: null, sequenceObjectId: null },
    ...over,
  });

  it('compares the page on the shipped release with the release before it', async () => {
    mocks.momentEffect.mockResolvedValue({ status: 'measured', delta: 0.01, before: { rate: 0.02 }, after: { rate: 0.03 } });
    const m = await viaReleaseEffect(ctx() as never);
    expect(mocks.momentEffect).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: SITE_ID }, expect.objectContaining({ releaseKey: 'r1', route: '/pricing', metric: 'conversions' }));
    expect(m).toMatchObject({ verdict: 'worked', releaseKey: 'r2', delta: 0.01 });
  });

  it('waits until the shipped release has enough visits, and needs a release before it', async () => {
    mocks.momentEffect.mockResolvedValue({ status: 'waiting', delta: null, before: { rate: 0.02 }, after: null });
    expect(await viaReleaseEffect(ctx() as never)).toBeNull();
    expect(await viaReleaseEffect(ctx({ refs: { taskId: null, testId: null, previewRelease: 'r1', liveRelease: null, sequenceObjectId: null } }) as never)).toBeNull();
  });
});
