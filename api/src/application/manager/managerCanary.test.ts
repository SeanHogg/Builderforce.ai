import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { DEFAULT_MANAGER_POLICY, resolveEffectiveManagerPolicy, type ManagerConfigRow } from './managerPolicy';

const journal = vi.fn(async () => true);
vi.mock('./managerActionJournal', () => ({
  recordManagerActionOnChange: (...a: unknown[]) => journal(...(a as [])),
  stateFingerprint: (parts: unknown[]) => parts.join('|'),
}));

import { CANARY_WOULD_MERGE_ACTION, holdMergeForCanary } from './managerCanary';

const db = {} as Db;
const subject = { tenantId: 1, projectId: 2, prId: 'pr-1', prNumber: 7, taskId: 9 };

beforeEach(() => journal.mockClear());

describe('canary mode', () => {
  it('is OFF by default in the policy', () => {
    expect(DEFAULT_MANAGER_POLICY.canary).toBe(false);
    expect(resolveEffectiveManagerPolicy(null).canary).toBe(false);
  });

  it('is a project-level switch that the policy fold carries through', () => {
    const row = {
      managerRef: null, enabled: true, prMergePolicy: 'on_green', autoAssign: true, autoBusinessValue: true,
      autoPrioritize: true, managerType: 'general', canary: true,
    } as ManagerConfigRow;
    expect(resolveEffectiveManagerPolicy(row).canary).toBe(true);
  });

  it('lets the merge proceed untouched when canary is off (nothing journalled)', async () => {
    expect(await holdMergeForCanary(db, false, subject)).toBe(false);
    expect(journal).not.toHaveBeenCalled();
  });

  it('skips the merge when canary is on and journals what it would have merged', async () => {
    expect(await holdMergeForCanary(db, true, subject)).toBe(true);
    expect(journal).toHaveBeenCalledTimes(1);
    const [, entry] = journal.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ actionType: CANARY_WOULD_MERGE_ACTION, prId: 'pr-1', taskId: 9, projectId: 2 });
    expect(String(entry.summary)).toContain('would have merged PR #7');
  });
});
