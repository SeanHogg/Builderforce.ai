import { describe, it, expect } from 'vitest';
import { retainsDetail, stateFingerprint } from './managerActionJournal';

const base = { tenantId: 1, projectId: 11, actionType: 'assign', summary: 's' };

/**
 * `manager_actions` measured 593 MB holding ~24 MB of real data. The driver is the
 * every-5-minute cross-tenant sweep storing a `detail` blob (capped at 4000 chars) on
 * rows nothing reads, so cron feed rows now store `summary` only.
 *
 * The retention rule is declared per action type rather than inferred from
 * `run_task_id IS NULL`, because the obvious column-based rule would have silently
 * broken the PR merge ceiling — see DETAIL_READING_ACTIONS.
 */
describe('retainsDetail', () => {
  it('drops detail on a cron feed row — the bloat driver', () => {
    expect(retainsDetail({ ...base, runTaskId: null }, false)).toBe(false);
  });

  it('keeps detail for a MANUAL run, which a human asked for and is bounded', () => {
    expect(retainsDetail({ ...base, runTaskId: 42 }, false)).toBe(true);
  });

  /**
   * The case a `run_task_id IS NULL` rule would have got wrong. `merge_blocked` is
   * cron-written with a null run task, and ManagerService's PR-loop ceiling counts
   * blocked reports with `detail NOT LIKE '%"reason":"conflict_exhausted"%'`. Drop that
   * payload and every historical block reads as still-terminal, withholding merge
   * authority on a backlog that should have revived.
   */
  it('keeps detail for merge_blocked even on a cron pass — its detail is PARSED', () => {
    expect(retainsDetail({ ...base, actionType: 'merge_blocked', runTaskId: null }, false)).toBe(true);
  });

  /** The fingerprint markers live IN `detail` and ARE the state-dedupe contract. */
  it('keeps detail for a STATE row, whose markers are the dedupe contract', () => {
    expect(retainsDetail({ ...base, runTaskId: null }, true)).toBe(true);
  });
});

describe('stateFingerprint', () => {
  it('is stable and order-sensitive', () => {
    expect(stateFingerprint(['a', 'b'])).toBe(stateFingerprint(['a', 'b']));
    expect(stateFingerprint(['a', 'b'])).not.toBe(stateFingerprint(['b', 'a']));
  });
});
