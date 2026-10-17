import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTenantMembership } from './tenantMembership';
import { membershipChanged } from '../tenant/membershipChanged';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../kernel/TeamRoster', () => ({ invalidateTeamCaches: vi.fn(async () => undefined) }));

function fakeDb(rows: () => unknown[]) {
  const chain = {
    from: () => chain, innerJoin: () => chain, where: () => chain,
    limit: async () => rows(),
  };
  const select = vi.fn(() => chain);
  return { db: { select } as unknown as Db, select };
}

const env = {} as Env;

beforeEach(() => __clearL1CacheForTests());

describe('resolveTenantMembership', () => {
  it('returns the current role and superadmin flag of an active member', async () => {
    const { db } = fakeDb(() => [{ userId: 'u', role: 'manager', isSuperadmin: false }]);
    expect(await resolveTenantMembership(env, () => db, 1, 'u')).toEqual({ isSuperadmin: false, role: 'manager' });
  });

  it('returns null for a non-member', async () => {
    const { db } = fakeDb(() => []);
    expect(await resolveTenantMembership(env, () => db, 1, 'gone')).toBeNull();
  });

  it('serves a warm hit without opening the database', async () => {
    const { db, select } = fakeDb(() => [{ userId: 'u', role: 'developer', isSuperadmin: false }]);
    const loadDb = vi.fn(() => db);
    await resolveTenantMembership(env, loadDb, 2, 'u');
    await resolveTenantMembership(env, loadDb, 2, 'u');
    expect(select).toHaveBeenCalledTimes(1);
    expect(loadDb).toHaveBeenCalledTimes(1);
  });

  it('a membership write (membershipChanged) makes a removal bite on the next read', async () => {
    let rows: unknown[] = [{ userId: 'u', role: 'owner', isSuperadmin: false }];
    const { db } = fakeDb(() => rows);
    expect(await resolveTenantMembership(env, () => db, 3, 'u')).not.toBeNull();

    rows = [];
    await membershipChanged(env, 3, ['u']);
    expect(await resolveTenantMembership(env, () => db, 3, 'u')).toBeNull();
  });
});
