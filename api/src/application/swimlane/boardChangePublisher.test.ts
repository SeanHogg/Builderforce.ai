import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  broadcastProjectChanged: vi.fn(async (..._a: unknown[]) => undefined),
  invalidateLaneRouting: vi.fn(async (..._a: unknown[]) => undefined),
  reportCaughtError: vi.fn(),
}));
vi.mock('../../infrastructure/relay/broadcastRoom', () => ({ broadcastProjectChanged: mocks.broadcastProjectChanged }));
vi.mock('./laneRouting', () => ({ invalidateLaneRouting: mocks.invalidateLaneRouting }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: mocks.reportCaughtError }));

import {
  publishLaneStaffingChanged,
  publishProjectStaffingChanged,
  publishProjectStaffingChangedById,
} from './boardChangePublisher';

/** A chain whose terminal call (limit / where) resolves to `rows`. */
function dbReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin']) chain[m] = () => chain;
  chain.where = () => Object.assign(Promise.resolve(rows), { limit: async () => rows });
  return { select: () => chain, selectDistinct: () => chain } as never;
}

const env = {} as never;

beforeEach(() => Object.values(mocks).forEach((m) => m.mockClear()));

describe('publishProjectStaffingChanged', () => {
  it('broadcasts the project change', async () => {
    await publishProjectStaffingChanged(env, 1, 7);
    expect(mocks.broadcastProjectChanged).toHaveBeenCalledWith(env, 1, 7);
  });

  it('never throws when the relay fails; reports instead', async () => {
    mocks.broadcastProjectChanged.mockRejectedValueOnce(new Error('relay down'));
    await expect(publishProjectStaffingChanged(env, 1, 7)).resolves.toBeUndefined();
    expect(mocks.reportCaughtError).toHaveBeenCalledTimes(1);
  });
});

describe('publishProjectStaffingChangedById', () => {
  it('resolves the tenant from the project then publishes', async () => {
    await publishProjectStaffingChangedById(env, dbReturning([{ tenantId: 3 }]), 7);
    expect(mocks.broadcastProjectChanged).toHaveBeenCalledWith(env, 3, 7);
  });

  it('publishes nothing for an unknown project or without an env', async () => {
    await publishProjectStaffingChangedById(env, dbReturning([]), 7);
    await publishProjectStaffingChangedById(undefined, dbReturning([{ tenantId: 3 }]), 7);
    expect(mocks.broadcastProjectChanged).not.toHaveBeenCalled();
  });
});

describe('publishLaneStaffingChanged', () => {
  it('publishes and invalidates lane routing once per owning project', async () => {
    await publishLaneStaffingChanged(env, dbReturning([{ projectId: 7 }, { projectId: 8 }]), 1, ['l1', 'l2']);
    expect(mocks.broadcastProjectChanged).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateLaneRouting).toHaveBeenCalledWith(env, 1, 7);
    expect(mocks.invalidateLaneRouting).toHaveBeenCalledWith(env, 1, 8);
  });

  it('is a no-op for no lanes or no env', async () => {
    await publishLaneStaffingChanged(env, dbReturning([{ projectId: 7 }]), 1, []);
    await publishLaneStaffingChanged(undefined, dbReturning([{ projectId: 7 }]), 1, ['l1']);
    expect(mocks.broadcastProjectChanged).not.toHaveBeenCalled();
  });
});
