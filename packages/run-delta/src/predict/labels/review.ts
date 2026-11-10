/**
 * predict/labels/review.ts — the `review-rejected` label (PRD 41 §D1): a review of the run's pull request (PRD 23)
 * requests changes, observed until the pull request closes; and the panel-action labels (`finding-actioned`,
 * `finding-marked-wrong`, `finding-waived`, C11), which are final the moment they are taken. Pure.
 */

import { LABELLER_VERSION, type RunOutcomeLabel } from '../contract.js';
import { windowedLabel } from './window.js';

export interface ReviewInput {
    /** Absent: the run has no pull request, nothing to label. */
    pr?: { number: number; closedAt?: string };
    reviews: ReadonlyArray<{ state: 'approved' | 'changes_requested' | 'commented' | 'dismissed'; at: string }>;
    now: string;
}

export function labelReviewRejected(input: ReviewInput): RunOutcomeLabel | undefined {
    if (!input.pr) return undefined;
    const closedAt = input.pr.closedAt;
    const rejected = input.reviews
        .filter((r) => r.state === 'changes_requested' && Date.parse(r.at) <= Date.parse(input.now))
        .filter((r) => closedAt === undefined || Date.parse(r.at) <= Date.parse(closedAt))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    return windowedLabel({
        kind: 'review-rejected', now: input.now, ...(closedAt ? { windowEndsAt: closedAt } : {}),
        ...(rejected ? { event: { at: rejected.at, evidence: { pr: input.pr.number } } } : { evidence: { pr: input.pr.number } }),
    });
}

export type FindingActionKind = 'finding-actioned' | 'finding-marked-wrong' | 'finding-waived';

/** A panel action on one of the run's findings: final and true at once. `ruleId` and the lineage key are codes. */
export function labelFindingAction(kind: FindingActionKind, at: string, evidence: { ruleId: string; lineage: string }): RunOutcomeLabel {
    return { kind, value: true, status: 'final', eventAt: at, evidence: { ...evidence }, labellerVersion: LABELLER_VERSION[kind], computedAt: at };
}
