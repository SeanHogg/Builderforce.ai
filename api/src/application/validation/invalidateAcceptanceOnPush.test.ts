import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveRepoLinks: vi.fn(),
  invalidateStaleAcceptance: vi.fn(async (..._a: unknown[]) => [] as number[]),
}));
vi.mock('../contributors/activityIngest', () => ({ resolveRepoLinks: mocks.resolveRepoLinks }));
vi.mock('../kanban/validatorSlotBridge', () => ({ invalidateStaleAcceptance: mocks.invalidateStaleAcceptance }));

import { invalidateAcceptanceOnPush } from './invalidateAcceptanceOnPush';

function dbWith(rowsPerSelect: unknown[][]) {
  return {
    select: () => {
      const rows = rowsPerSelect.shift() ?? [];
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = () => Promise.resolve(rows);
      return c;
    },
  } as never;
}

const env = {} as never;
const args = { repoFullName: 'o/r', prNumber: 4, headSha: 'abc123' };

beforeEach(() => { mocks.resolveRepoLinks.mockReset(); mocks.invalidateStaleAcceptance.mockClear(); });

describe('invalidateAcceptanceOnPush', () => {
  it('ignores a push with no head or a non-integer PR number', async () => {
    expect(await invalidateAcceptanceOnPush(env, dbWith([]), { ...args, headSha: '' })).toEqual([]);
    expect(await invalidateAcceptanceOnPush(env, dbWith([]), { ...args, prNumber: 1.5 })).toEqual([]);
    expect(mocks.resolveRepoLinks).not.toHaveBeenCalled();
  });

  it('hands each tenant\'s linked tickets the new head and collects the reopened tasks', async () => {
    mocks.resolveRepoLinks.mockResolvedValue([
      { tenantId: 1, projectId: 10 },
      { tenantId: 2, projectId: null },
      { tenantId: 3, projectId: 30 },
    ]);
    mocks.invalidateStaleAcceptance.mockResolvedValueOnce([5]).mockResolvedValueOnce([9]);
    const db = dbWith([[{ taskId: 5 }], [{ taskId: 9 }]]);
    expect(await invalidateAcceptanceOnPush(env, db, args)).toEqual([5, 9]);
    expect(mocks.invalidateStaleAcceptance).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateStaleAcceptance).toHaveBeenNthCalledWith(1, env, db, 1, [{ taskId: 5, headSha: 'abc123' }]);
    expect(mocks.invalidateStaleAcceptance).toHaveBeenNthCalledWith(2, env, db, 3, [{ taskId: 9, headSha: 'abc123' }]);
  });
});
