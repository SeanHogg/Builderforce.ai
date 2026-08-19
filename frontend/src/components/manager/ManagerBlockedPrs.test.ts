import { describe, expect, it } from 'vitest';
import { closableRows } from './ManagerBlockedPrs';
import type { ManagerBlockedPr } from '@/lib/builderforceApi';

const pr = (over: Partial<ManagerBlockedPr>): ManagerBlockedPr => ({
  id: 'a', number: 1, url: null, taskId: 1, taskKey: 'BF-1', title: 't',
  businessValue: 5, taskStatus: 'in_progress', reason: 'merge_exhausted', blockedAt: null,
  ...over,
});

/**
 * The bulk action is destructive and irreversible on the provider, so the ONLY thing that
 * may be offered in bulk is the row a person would close without opening the branch: its
 * ticket already finished, so the work landed another way and only the branch is left.
 * Everything else in the pile is a judgement about unfinished work.
 */
describe('closableRows', () => {
  it('offers only the rows whose ticket already finished', () => {
    const rows = [
      pr({ id: 'done', taskStatus: 'done' }),
      pr({ id: 'wip', taskStatus: 'in_progress' }),
      pr({ id: 'review', taskStatus: 'in_review' }),
    ];
    expect(closableRows(rows).map((r) => r.id)).toEqual(['done']);
  });

  it('never offers a PR with no ticket at all — nothing says the work landed', () => {
    expect(closableRows([pr({ id: 'orphan', taskId: null, taskKey: null, taskStatus: null })])).toEqual([]);
  });

  it('is empty for an empty pile', () => {
    expect(closableRows([])).toEqual([]);
  });
});
