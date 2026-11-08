/**
 * recordTaskPullRequest — the ONE "a PR now exists for this task" write: the `pull_requests` row AND the task's
 * PR stamp (`gitBranch`, `githubPrUrl`, `githubPrNumber`) in a SINGLE transaction.
 *
 * Done separately, a failure between the two leaves a row no card shows or a stamp with no row to approve. The
 * stamp is also what settles the single-PR claim (`claimTaskPrOpen` refuses once `githubPrUrl` is set), so it is
 * never written without the row it names. Used by every path that opens the task's PR: the Done-drag
 * (`openTaskPullRequest`), the run-end finalize, and the early draft (`ci/draftPrPorts`).
 */
import { eq } from 'drizzle-orm';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { upsertPullRequestRow, type RecordPullRequestInput } from './recordPullRequestRow';

export type RecordTaskPullRequestInput = RecordPullRequestInput & { taskId: number; number: number; url: string; branchName: string };

/** Upsert the PR row (on the provider identity) and stamp the task together; returns the row plus `written` (false: the row was already merged/closed, left untouched, and the task NOT stamped). Throws (and writes neither) on failure. */
export async function recordTaskPullRequest(db: Db, input: RecordTaskPullRequestInput) {
  return inTransaction(db, async (tx) => {
    const { row, written } = await upsertPullRequestRow(tx, input);
    // A row the reconciler already settled (merged/closed) was left untouched: the task must not be stamped with a PR whose
    // record this write did not make (the stamp would name a dead PR and settle the single-PR claim for good).
    if (written) {
      await tx.update(tasks)
        .set({ gitBranch: input.branchName, githubPrUrl: input.url, githubPrNumber: input.number, updatedAt: new Date() })
        .where(scopedToTenant(tasks, input.tenantId, eq(tasks.id, input.taskId)));
    }
    return { ...row, written };
  });
}
