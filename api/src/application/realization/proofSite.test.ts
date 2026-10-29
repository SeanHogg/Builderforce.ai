/**
 * `ensureProofReplaySite`: a published proof ends with a hosted Insights site that records
 * it. No site yet -> `createHostedSite` makes one (bumping the sites version). An active
 * one is reused. A site a PERSON switched off stays off — a proof build must not undo
 * that — and the skip is traced so it is visible. It never throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  createHostedSite: vi.fn(),
  projectSiteDto: vi.fn(),
  invalidateCached: vi.fn(async () => {}),
  reportCaughtError: vi.fn(),
  recordReplayTrace: vi.fn(async () => {}),
}));
vi.mock('../replay/replaySiteAdmin', () => ({ createHostedSite: mocks.createHostedSite, projectSiteDto: mocks.projectSiteDto }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: vi.fn(),
  invalidateCached: mocks.invalidateCached,
}));
vi.mock('../replay/replayCacheKeys', () => ({ proofSiteKey: (id: string) => `proof-site:${id}` }));
vi.mock('../replay/replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: { proofSiteDisabled: 'replay.proof.site_disabled' },
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: mocks.reportCaughtError }));

const { ensureProofReplaySite } = await import('./proofSite');

const env = {} as Env;
const db = {} as Db;
const input = { tenantId: 7, projectId: 42, userId: 'u1' };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.invalidateCached.mockResolvedValue(undefined);
  mocks.recordReplayTrace.mockResolvedValue(undefined);
});

describe('ensureProofReplaySite', () => {
  it('creates the project\'s site when it has none, and drops the cached proof-site answer', async () => {
    mocks.projectSiteDto.mockResolvedValue(null);
    mocks.createHostedSite.mockResolvedValue({ id: 'site-1', status: 'active' });
    expect(await ensureProofReplaySite(env, db, input)).toBe('site-1');
    expect(mocks.createHostedSite).toHaveBeenCalledWith(db, env, { tenantId: 7, projectId: 42, userId: 'u1' });
    expect(mocks.invalidateCached).toHaveBeenCalledWith(env, 'proof-site:site-1');
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
  });

  it('reuses an active site without creating anything', async () => {
    mocks.projectSiteDto.mockResolvedValue({ id: 'site-2', status: 'active' });
    expect(await ensureProofReplaySite(env, db, input)).toBe('site-2');
    expect(mocks.createHostedSite).not.toHaveBeenCalled();
    expect(mocks.invalidateCached).toHaveBeenCalledWith(env, 'proof-site:site-2');
  });

  it('leaves a site a person disabled disabled, and traces that the recording was skipped', async () => {
    mocks.projectSiteDto.mockResolvedValue({ id: 'site-3', status: 'disabled' });
    expect(await ensureProofReplaySite(env, db, input)).toBeNull();
    expect(mocks.createHostedSite).not.toHaveBeenCalled();
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(env, db, expect.objectContaining({
      tenantId: 7, siteId: 'site-3', verb: 'replay.proof.site_disabled', metadata: { projectId: 42 },
    }));
  });

  it('never throws: a failure is reported and answers null', async () => {
    mocks.projectSiteDto.mockRejectedValue(new Error('db down'));
    expect(await ensureProofReplaySite(env, db, { ...input, userId: null })).toBeNull();
    expect(mocks.reportCaughtError).toHaveBeenCalledTimes(1);
  });
});
