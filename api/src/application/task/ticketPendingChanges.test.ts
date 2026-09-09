import { describe, expect, it } from 'vitest';
import { decideTicketPendingChanges, needsDeliveryAttention } from './ticketPendingChanges';
import type { ListBranchCommitsResult } from '../repos/branchLifecycle';

/** A readable commit listing with `n` commits ahead. */
const ahead = (n: number, truncated = false): ListBranchCommitsResult => ({
  ok: true,
  truncated,
  commits: Array.from({ length: n }, (_, i) => ({
    sha: `sha${i}`,
    message: `commit ${i}`,
    authorName: 'agent',
  })),
});

const base = { defaultBranch: 'main' as const };

describe('decideTicketPendingChanges', () => {
  it('reports none when the ticket has no branch', () => {
    expect(decideTicketPendingChanges({ ...base, branch: null, prState: 'none', commits: null }))
      .toMatchObject({ hasPendingChanges: false, state: 'none', branch: null, aheadCount: 0 });
  });

  it('treats a branch equal to base as holding nothing of its own', () => {
    expect(decideTicketPendingChanges({ ...base, branch: 'refs/heads/main', prState: 'none', commits: ahead(9) }))
      .toMatchObject({ hasPendingChanges: false, state: 'none' });
  });

  it('reports landed for a merged PR WITHOUT consulting commits', () => {
    // Residue commits left on the branch after a merge must not read as pending.
    const result = decideTicketPendingChanges({
      ...base, branch: 'builderforce/task-89', prState: 'merged', commits: ahead(8),
    });
    expect(result).toMatchObject({ hasPendingChanges: false, state: 'landed', aheadCount: 0 });
    expect(result.reason).toContain('merged');
  });

  it('never reports none when the evidence could not be read', () => {
    const unreadable = decideTicketPendingChanges({
      ...base,
      branch: 'builderforce/task-58',
      prState: 'none',
      commits: { ok: false, code: 'provider_error', reason: 'github 502: bad gateway' },
    });
    expect(unreadable).toMatchObject({ hasPendingChanges: false, state: 'unknown', aheadCount: null });
    expect(unreadable.reason).toContain('bad gateway');

    // Not attempted is also unknown — never a claim of cleanliness.
    expect(decideTicketPendingChanges({ ...base, branch: 'x', prState: 'none', commits: null }))
      .toMatchObject({ state: 'unknown', aheadCount: null });
  });

  it('reports none for a branch with nothing ahead of base', () => {
    expect(decideTicketPendingChanges({ ...base, branch: 'codex/manager-reliability', prState: 'none', commits: ahead(0) }))
      .toMatchObject({ hasPendingChanges: false, state: 'none', aheadCount: 0 });
  });

  it('flags an open or draft PR as pending review', () => {
    for (const prState of ['open', 'draft'] as const) {
      expect(decideTicketPendingChanges({ ...base, branch: 'b', prState, commits: ahead(3) }))
        .toMatchObject({ hasPendingChanges: true, state: 'in_review', aheadCount: 3 });
    }
  });

  it('flags a CLOSED-unmerged PR with commits as abandoned — the ticket-65 case', () => {
    // #65: status done, prState closed, 17 commits still on the branch.
    const result = decideTicketPendingChanges({
      ...base, branch: 'builderforce/task-65', prState: 'closed', commits: ahead(17),
    });
    expect(result).toMatchObject({ hasPendingChanges: true, state: 'abandoned', aheadCount: 17 });
    expect(result.reason).toContain('CLOSED without merging');
  });

  it('flags commits with no PR at all as unmerged', () => {
    expect(decideTicketPendingChanges({ ...base, branch: 'work/platform-residuals', prState: 'none', commits: ahead(6) }))
      .toMatchObject({ hasPendingChanges: true, state: 'unmerged', aheadCount: 6 });
  });

  it('treats a truncated listing as a positive answer and marks the count a floor', () => {
    const result = decideTicketPendingChanges({
      ...base, branch: 'b', prState: 'none', commits: ahead(1000, true),
    });
    expect(result).toMatchObject({ hasPendingChanges: true, state: 'unmerged', truncated: true });
    expect(result.reason).toContain('1000+ commits');
  });

  it('pluralizes a single commit without a floor marker', () => {
    expect(decideTicketPendingChanges({ ...base, branch: 'b', prState: 'none', commits: ahead(1) }).reason)
      .toContain('1 commit ahead');
  });

  it('answers without a base branch rather than throwing', () => {
    expect(decideTicketPendingChanges({ defaultBranch: null, branch: 'b', prState: 'none', commits: ahead(2) }))
      .toMatchObject({ hasPendingChanges: true, state: 'unmerged' });
  });
});

describe('needsDeliveryAttention', () => {
  it('calls out work nothing is carrying forward', () => {
    expect(needsDeliveryAttention('unmerged')).toBe(true);
    expect(needsDeliveryAttention('abandoned')).toBe(true);
  });

  it('does not alert on healthy in-flight review, landed, clean or unknown', () => {
    // An open PR IS pending, but a review is already moving it — alerting here would
    // make every healthy ticket an alert.
    expect(needsDeliveryAttention('in_review')).toBe(false);
    expect(needsDeliveryAttention('landed')).toBe(false);
    expect(needsDeliveryAttention('none')).toBe(false);
    expect(needsDeliveryAttention('unknown')).toBe(false);
  });
});
