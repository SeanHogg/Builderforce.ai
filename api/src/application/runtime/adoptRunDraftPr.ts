/**
 * adoptRunDraftPr — the run-end finalize's side of the early draft PR (`ci/draftPrForCi`).
 *
 * A run with no sandbox may have opened its PR as a draft to get a build, so at finalize the task's
 * single-PR claim is already taken by the PLATFORM. The PR is recognised from its durable marker
 * (`pull_requests.platform_draft_execution_id`, written with the row and the task's PR stamp —
 * `findPlatformDraftPullRequest`), not from telemetry: a draft opened by an earlier execution of the same task on
 * the same branch is adoptable too, and so is one a human already marked ready while the run was live (its row is
 * `open`, the marker still set). A row WITHOUT the marker is never adopted: a human's PR, or a draft a human
 * converted back, keeps its title and body and stays a lost claim.
 * Adopting takes it out of draft, gives it the normal finalize title and body, and hands the finalize the
 * PR as if it had just opened it — so the summary comment, the check run and `prOpened` all follow.
 *
 * `recovered` is a PR the finalize's own create resolved to after RETAKING a dead claim, which the provider reports as
 * a draft: the draft of an earlier open that died before it was recorded. It is recorded here (row, stamp and marker
 * in one write) and then adopted like any other.
 *
 * Marking it ready can fail (provider hiccup, a missing permission). The PR is adopted anyway and its row is still
 * flipped to `open`: the approval flow, the merge sweep and the manager read `open`, and a PR they cannot see is worse
 * than one still marked draft on the provider. The failure is reported, and the marker is KEPT: the orphan sweep
 * (`sweepOrphanedDraftPrs`) selects the `open` + marker row and retries the mark-ready (status only, never the
 * PR's text) — for a marked row only, so a human's draft is never fought over.
 *
 * Only finding/recording can throw (the finalize treats that as "no draft"); the telemetry after them cannot.
 */
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { markReadyForReview } from '../repos/createPullRequest';
import { findPlatformDraftPullRequest, markPlatformDraftOpen, PLATFORM_DRAFT_STATUS } from '../repos/platformDraftPullRequest';
import { recordTaskPullRequest } from '../repos/recordTaskPullRequest';
import { recordCloudToolEvent } from './cloudToolEvents';

const SOURCE = 'application/runtime/adoptRunDraftPr.ts';

export async function adoptRunDraftPr(
  db: Db,
  a: {
    tenantId: number; cloudAgentRef: string | undefined; executionId: number; taskId: number;
    repoCtx: Pick<TicketRepoContext, 'provider' | 'host' | 'owner' | 'repo' | 'token' | 'branch' | 'repoId' | 'segmentId' | 'projectId' | 'base'>;
    /** The finalize's own title and body (`runPullRequestText`). */
    text: { title: string; body: string };
    /** A draft the finalize's create resolved to after retaking a dead claim (see above). */
    recovered?: { number: number; url: string };
  },
): Promise<{ number: number; url: string; rowId: string } | null> {
  const { repoId, segmentId, projectId, base, ...repoCtx } = a.repoCtx;
  let draft = await findPlatformDraftPullRequest(db, { tenantId: a.tenantId, taskId: a.taskId, repoId: repoId ?? null, branch: repoCtx.branch });
  if (!draft && a.recovered) {
    const row = await recordTaskPullRequest(db, {
      tenantId: a.tenantId, segmentId, projectId, repoId, taskId: a.taskId, provider: repoCtx.provider,
      number: a.recovered.number, url: a.recovered.url, branchName: repoCtx.branch, baseBranch: base,
      status: PLATFORM_DRAFT_STATUS, platformDraftExecutionId: a.executionId,
    });
    // A row the reconciler already settled (merged/closed) was left untouched and the task not stamped: that is no draft of ours.
    if (!row.written) return null;
    draft = { id: row.id, number: a.recovered.number, url: a.recovered.url, status: PLATFORM_DRAFT_STATUS };
  }
  if (!draft) return null;
  const adopted = { number: draft.number, url: draft.url, rowId: draft.id };
  try {
    const ready = await markReadyForReview({ ...repoCtx, number: draft.number, text: a.text });
    // The row follows the PR into the readers' view whether or not the provider call worked.
    await markPlatformDraftOpen(db, a.tenantId, draft.id, ready.ok);
    if (!ready.ok) {
      reportCaughtError(new Error(`could not mark PR #${draft.number} ready for review: ${ready.reason}`), {
        source: SOURCE, operation: 'markReadyForReview',
        context: { details: { tenantId: a.tenantId, executionId: a.executionId, taskId: a.taskId, number: draft.number } },
      });
    }
    await recordCloudToolEvent(db, {
      tenantId: a.tenantId, cloudAgentRef: a.cloudAgentRef, executionId: a.executionId,
      toolName: 'pr_ready_for_review', category: 'tool', detail: { number: draft.number, ready: ready.ok },
      result: ready.ok ? `PR #${draft.number} is ready for review` : `PR #${draft.number} adopted but left as a draft on the provider: ${ready.reason}`,
    });
  } catch (error) {
    // Adoption itself stands: a failed row flip or timeline note must not turn into "no draft" in the finalize.
    reportCaughtError(error, { source: SOURCE, operation: 'adoptRunDraftPr' });
  }
  return adopted;
}
