import { describe, expect, it, vi } from 'vitest';

// The object trail and the seat timeline must be FILTERS on the one activity read,
// not queries of their own — that is what keeps them on the database the writers
// append to and on the timeline's version-token cache.
const getActivityLog = vi.fn(async () => ({ events: [{ id: 1 }], nextCursor: null }));
vi.mock('../activity/activityLog', () => ({
  getActivityLog: (...args: unknown[]) => getActivityLog(...(args as [])),
  activityDatabase: (_env: unknown, db: unknown) => db,
}));

import { getObjectActivity } from './ObjectRegistry';
import { getDomainActivity } from './DomainService';

const db = {} as never;
const env = {} as never;

describe('kernel activity feeds are filters over THE activity read', () => {
  it('/api/objects/:id/activity → getActivityLog({ objectId })', async () => {
    const rows = await getObjectActivity(db, env, 7, 'obj-1', 30);
    expect(getActivityLog).toHaveBeenLastCalledWith(env, db, 7, { objectId: 'obj-1', limit: 30 });
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('/api/<domain>/activity → getActivityLog({ domain })', async () => {
    const rows = await getDomainActivity(db, env, 7, 'finance' as never, 20);
    expect(getActivityLog).toHaveBeenLastCalledWith(env, db, 7, { domain: 'finance', limit: 20 });
    expect(rows).toEqual([{ id: 1 }]);
  });
});
