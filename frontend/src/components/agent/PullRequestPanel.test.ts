import { describe, expect, it } from 'vitest';
import { getMergeBlockReason } from './pullRequestMergeState';
import type { PullRequestDetail } from '@/lib/builderforceApi';

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    supported: true, state: 'open', merged: false, draft: false,
    mergeable: true, mergeableState: 'clean', allowedMergeMethods: ['squash', 'merge', 'rebase'],
    additions: 1, deletions: 0, changedFiles: 1, checks: 'success', checksTotal: 1,
    ...overrides,
  };
}

describe('getMergeBlockReason', () => {
  it('blocks draft pull requests', () => {
    expect(getMergeBlockReason(detail({ draft: true }))).toContain('ready for review');
  });

  it('gives an actionable conflict message', () => {
    expect(getMergeBlockReason(detail({ mergeable: false, mergeableState: 'dirty' }))).toContain('Resolve merge conflicts');
  });

  it('blocks provider requirements even when the test merge itself is clean', () => {
    expect(getMergeBlockReason(detail({ mergeable: true, mergeableState: 'blocked' }))).toContain('required reviews');
  });

  it('allows a clean pull request and unknown provider detail', () => {
    expect(getMergeBlockReason(detail())).toBeNull();
    expect(getMergeBlockReason(null)).toBeNull();
  });
});
