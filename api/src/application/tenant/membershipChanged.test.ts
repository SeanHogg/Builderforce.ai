import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const m = vi.hoisted(() => ({
  invalidateJwtMembershipCache: vi.fn(async (..._args: unknown[]) => undefined),
  invalidateTeamCaches: vi.fn(async (..._args: unknown[]) => undefined),
  invalidateTenantSnapshot: vi.fn(async (..._args: unknown[]) => undefined),
  invalidateMyWorkspaces: vi.fn(async (..._args: unknown[]) => undefined),
  bumpInboxes: vi.fn(async (..._args: unknown[]) => undefined),
  reportCaughtError: vi.fn(),
}));

vi.mock('../../infrastructure/auth/keyResolutionCache', () => ({ invalidateJwtMembershipCache: m.invalidateJwtMembershipCache }));
vi.mock('../kernel/TeamRoster', () => ({ invalidateTeamCaches: m.invalidateTeamCaches }));
vi.mock('./tenantReadCache', () => ({ invalidateTenantSnapshot: m.invalidateTenantSnapshot, invalidateMyWorkspaces: m.invalidateMyWorkspaces }));
vi.mock('../messaging/dmThreadsCache', () => ({ bumpInboxes: m.bumpInboxes }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: m.reportCaughtError }));

import { membershipChanged } from './membershipChanged';

const env = {} as Env;

beforeEach(() => vi.clearAllMocks());

describe('membershipChanged', () => {
  it('hands the change kind to the JWT membership invalidation for every affected user', async () => {
    await membershipChanged(env, 5, ['a', 'b'], 'grant');
    expect(m.invalidateJwtMembershipCache).toHaveBeenCalledWith(env, 5, 'a', 'grant');
    expect(m.invalidateJwtMembershipCache).toHaveBeenCalledWith(env, 5, 'b', 'grant');
  });

  it('raises a failed access invalidation, after the best-effort clears still ran', async () => {
    m.invalidateJwtMembershipCache.mockRejectedValueOnce(new Error('KV DELETE failed'));
    await expect(membershipChanged(env, 5, ['a'], 'revoke')).rejects.toThrow('KV DELETE failed');
    expect(m.invalidateTeamCaches).toHaveBeenCalled();
  });

  it('REPORTS (and does not raise) a failure of the best-effort clears', async () => {
    const failure = new Error('roster clear failed');
    m.invalidateTeamCaches.mockRejectedValueOnce(failure);
    await expect(membershipChanged(env, 5, ['a'], 'grant')).resolves.toBeUndefined();
    expect(m.reportCaughtError).toHaveBeenCalledWith(failure, expect.objectContaining({ operation: 'membershipChanged' }));
  });
});
