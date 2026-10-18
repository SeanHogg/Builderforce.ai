import { beforeEach, describe, expect, it } from 'vitest';
import { __clearL1CacheForTests, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  invalidateMyWorkspaces, invalidateNavigationFeatures, invalidateTenantSnapshot,
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
});
