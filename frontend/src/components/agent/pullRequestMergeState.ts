import type { PullRequestDetail } from '@/lib/builderforceApi';

/** Explain provider state that must be resolved before the merge action is safe. */
export function getMergeBlockReason(detail: PullRequestDetail | null): string | null {
  if (!detail?.supported) return null;
  if (detail.draft) return 'Mark this pull request ready for review on the provider before merging.';
  if (detail.state && detail.state !== 'open') return `This pull request is ${detail.state} and cannot be merged.`;
  if (detail.mergeableState === 'dirty') return 'Resolve merge conflicts on the provider before merging.';
  if (detail.mergeableState === 'behind') return 'Update the pull request branch with the base branch before merging.';
  if (detail.mergeableState === 'blocked') return 'Complete the required reviews, checks, conversations, or branch rules on the provider before merging.';
  if (detail.mergeable === false) {
    return `The provider reports that this pull request is not mergeable${detail.mergeableState ? ` (${detail.mergeableState})` : ''}. Open it on the provider for the required action.`;
  }
  if (detail.allowedMergeMethods?.length === 0) return 'This repository has no pull-request merge strategies enabled.';
  return null;
}
