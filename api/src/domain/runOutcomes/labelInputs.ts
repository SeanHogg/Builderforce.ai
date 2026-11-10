/**
 * What the server knows about a run's pull request, mapped onto the pure labellers' inputs
 * (`labelCiRedAfterMerge`, `labelReviewRejected` in `@builderforce/run-delta/predict`).
 * The RULES live in those labellers; this module only says which recorded facts are the
 * merge, the post-merge CI runs and the reviews. Pure.
 *
 * WHAT IS RECORDED (and so what these inputs can honestly say):
 *   • A merge records ONE `deployment_events` row for the PR (`recordMergeDeployment`). A
 *     failing post-merge build marks that row a failure, and a later green does not clear
 *     the flag — so the FIRST post-merge failure is still seen after a fix went green.
 *   • `pull_requests` holds ONE build status per PR. A merged PR's `success` with its merge
 *     deployment not failed is the concluded run seen on the merge.
 *   • The CI run is dated from the merge deployment's time, never `pull_requests.updated_at`:
 *     that column moves on any write to the row, so it dates nothing.
 *   • No merge deployment, or no concluded status, means no concluded CI run was ever
 *     observed: there is NO input and no label — a censored null would otherwise finalize to
 *     "not red" on no evidence at all.
 *   • Reviews are the PRD 23 role sign-offs on the PR's ticket (`ticket_role_signoffs`).
 */

import type { labelCiRedAfterMerge, labelReviewRejected } from '@builderforce/run-delta/predict';

/** One recorded pull request a run's commits may have landed through. */
export interface RunPullRequest {
  id: string;
  number: number | null;
  taskId: number | null;
  /** draft | open | merged | closed */
  status: string;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  mergeSha: string | null;
  /** null | pending | success | failure */
  buildStatus: string | null;
  /** The PR's merge deployment (`deployment_events`), or null when none was recorded. */
  mergeDeployment: RunMergeDeployment | null;
}

/** A PR's merge deployment: when it was recorded, and whether a post-merge build failed it. */
export interface RunMergeDeployment {
  at: Date;
  failed: boolean;
}

/** A PRD 23 sign-off on the PR's ticket. */
export interface RunReviewSignoff {
  /** approved | changes_requested | waived | delegated */
  verdict: string;
  createdAt: Date;
}

/** Exactly the labellers' own input types, so a contract change fails to compile here. */
export type CiLabelInput = Parameters<typeof labelCiRedAfterMerge>[0];
export type ReviewLabelInput = Parameters<typeof labelReviewRejected>[0];
type CiConclusion = CiLabelInput['ciRuns'][number]['conclusion'];

/** When a PR stopped accepting the run's commits: its merge, its close, or never (still open). */
function closedAt(pr: RunPullRequest): Date | null {
  if (pr.status === 'merged') return pr.mergedAt ?? pr.updatedAt;
  if (pr.status === 'closed') return pr.updatedAt;
  return null;
}

/**
 * The pull request a run's commits landed through: of the PRs recorded for its branch, the
 * EARLIEST one still open (or closed / merged) at or after the run's last commit. A branch
 * re-used for a later PR therefore never claims an earlier run's PR, nor the reverse.
 */
export function pickRunPullRequest(prs: readonly RunPullRequest[], lastCommittedAt: Date): RunPullRequest | undefined {
  return [...prs]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .find((pr) => {
      const end = closedAt(pr);
      return end === null || end.getTime() >= lastCommittedAt.getTime();
    });
}

/** The first concluded post-merge run of a merged PR, or null when none was observed. */
function firstConcludedRun(pr: RunPullRequest): CiConclusion | null {
  if (!pr.mergeDeployment) return null;
  if (pr.mergeDeployment.failed) return 'failure';
  return pr.buildStatus === 'success' ? 'success' : null;
}

/**
 * The CI labeller's input for a run whose PR is `pr`, or undefined when there is nothing to
 * label: no merged PR, or no concluded CI run observed on its merge. The one run is dated from
 * the merge deployment (never before the merge itself, so a clock skew between the two writes
 * cannot drop it out of the window).
 */
export function ciLabelInput(pr: RunPullRequest | undefined, changedPaths: readonly string[], now: Date): CiLabelInput | undefined {
  if (!pr || pr.status !== 'merged' || !pr.mergedAt || !pr.mergeSha) return undefined;
  const conclusion = firstConcludedRun(pr);
  if (!conclusion || !pr.mergeDeployment) return undefined;
  const at = new Date(Math.max(pr.mergeDeployment.at.getTime(), pr.mergedAt.getTime()));
  return {
    merge: { commitSha: pr.mergeSha, mergedAt: pr.mergedAt.toISOString() },
    ciRuns: [{ commitSha: pr.mergeSha, at: at.toISOString(), conclusion }],
    changedPaths: [...changedPaths],
    now: now.toISOString(),
  };
}

/** Sign-off verdicts that are reviews; waived / delegated are not a reviewer's judgement. */
const REVIEW_STATE: Readonly<Record<string, ReviewLabelInput['reviews'][number]['state']>> = {
  approved: 'approved',
  changes_requested: 'changes_requested',
};

/** The review labeller's input for a run whose PR is `pr`; only sign-offs from the PR's life count. */
export function reviewLabelInput(pr: RunPullRequest | undefined, signoffs: readonly RunReviewSignoff[], now: Date): ReviewLabelInput {
  const base = { reviews: [] as ReviewLabelInput['reviews'], now: now.toISOString() };
  if (!pr || pr.number === null) return base;
  const end = closedAt(pr);
  const reviews = signoffs
    .filter((s) => s.createdAt.getTime() >= pr.createdAt.getTime() && REVIEW_STATE[s.verdict] !== undefined)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((s) => ({ state: REVIEW_STATE[s.verdict]!, at: s.createdAt.toISOString() }));
  return { ...base, pr: { number: pr.number, ...(end ? { closedAt: end.toISOString() } : {}) }, reviews };
}
