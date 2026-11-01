/**
 * ciMergeQueueSignal — a CI verdict on a ticket's PR is work for the `pr-merge` sweep.
 *
 * `pr-merge` works each opted-in project's merge queue: it polls CI on the head, then merges, updates
 * from base, or retires the PR to a human. Its tick is KV-gated so Neon can autosuspend, which means
 * a PR that turns green or red between ticks waited for the 30-minute floor unless something armed
 * the gate. The PR-lifecycle webhook arms it for a PR entering or leaving the queue; this is the
 * other half — the build result that decides what happens to the head.
 *
 * Scoped to a PR that is actually WAITING in a queue: the event must correlate to a ticket's branch,
 * be a verdict rather than a "pending" progress ping, that ticket must still have an open pull
 * request, and its project must have opted into the manager's merge queue (the same enabled
 * `project_manager_configs` row the sweep selects projects by, joined in the SAME read). A CI event
 * for a repo with no such PR (the common case on a busy repo) signals nothing and costs one indexed
 * read at most — and none when no cron gate is bound.
 *
 * Provider-independent: `handleCiEventOutcome` calls it for GitHub, GitLab and Bitbucket alike.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectManagerConfigs, pullRequests } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { mergeQueueOptInOn } from '../repos/mergeQueueOptIn';
import { cronGateIsBound, signalPendingWork, type CronSignalEnv } from '../runtime/cronWorkSignal';
import type { IngestResult } from './ingestRepoCiEvent';

/** Does this ingest result describe a verdict on a ticket's open PR? Returns whether it signalled. */
export async function signalMergeQueueOnCiResult(
  env: CronSignalEnv,
  db: Db,
  res: Pick<IngestResult, 'taskId' | 'tenantId' | 'buildStatus' | 'merged'>,
): Promise<boolean> {
  // Not a ticket branch, an in-progress ping, or already merged by the ingest itself: nothing is waiting on a tick.
  if (res.taskId == null || res.tenantId == null) return false;
  if (res.buildStatus == null || res.buildStatus === 'pending' || res.merged) return false;
  if (!cronGateIsBound(env)) return false;
  try {
    const [open] = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .innerJoin(projectManagerConfigs, mergeQueueOptInOn())
      .where(scopedToTenant(pullRequests, res.tenantId, and(eq(pullRequests.taskId, res.taskId), eq(pullRequests.status, 'open'))))
      .limit(1);
    if (!open) return false;
    await signalPendingWork(env);
    return true;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/ci/ciMergeQueueSignal.ts', operation: 'signalMergeQueueOnCiResult',
      context: { logMessage: '[ci] merge-queue re-signal probe failed; floor sweep remains the backstop' },
    });
    return false;
  }
}
