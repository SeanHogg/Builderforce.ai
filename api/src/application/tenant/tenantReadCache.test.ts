import { beforeEach, describe, expect, it } from 'vitest';
import { __clearL1CacheForTests, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { invalidateTenantPlan } from './tenantPlanCache';
import {
  invalidateMyWorkspaces, invalidateNavigationFeatures, invalidateTenantMembersWorkspaces, invalidateTenantSnapshot,
  myWorkspacesKey, navigationFeaturesKey, tenantSnapshotKey, TENANT_READ_TTL,
} from './tenantReadCache';

const env = {} as never;

describe('tenant read cache invalidation', () => {
  beforeEach(() => __clearL1CacheForTests());

  async function reloads(key: string, invalidate: () => Promise<void>) {
    let loads = 0;
    const load = () => getOrSetCached(env, key, async () => ++loads, TENANT_READ_TTL);
    await load();
    await load();
    expect(loads).toBe(1);
    await invalidate();
    await load();
    return loads;
  }

  it('snapshot is reloaded after invalidateTenantSnapshot', async () => {
    expect(await reloads(tenantSnapshotKey(5), () => invalidateTenantSnapshot(env, 5))).toBe(2);
  });

  it('navigation features are reloaded after the PUT invalidation', async () => {
    expect(await reloads(navigationFeaturesKey(5), () => invalidateNavigationFeatures(env, 5))).toBe(2);
  });

  it('workspace list is reloaded for each affected user', async () => {
    expect(await reloads(myWorkspacesKey('u1'), () => invalidateMyWorkspaces(env, ['u1', 'u2']))).toBe(2);
  });

  it("a plan/billing write drops every member's workspace list (roster in hand)", async () => {
    expect(await reloads(myWorkspacesKey('u7'), () => invalidateTenantPlan(env, 5, { memberUserIds: ['u7', 'u8'] }))).toBe(2);
  });

  it('reads the roster when the writer does not hold it', async () => {
    const db = { select: () => ({ from: () => ({ where: async () => [{ userId: 'u9' }] }) }) } as never;
    expect(await reloads(myWorkspacesKey('u9'), () => invalidateTenantMembersWorkspaces(env, 5, { db }))).toBe(2);
  });
});
