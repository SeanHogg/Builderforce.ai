/**
 * agentWorkflowRefresh — re-commit the current agent workflow to repos that are behind.
 *
 * WHY THIS EXISTS
 * The GitHub Actions surface can only be reconciled if a run says WHICH execution it
 * belongs to. `workflow_dispatch` returns 204 with no run id and the runs list does not
 * echo inputs, so the only correlator is the execution id stamped into `run-name` →
 * `display_title`. A repo still carrying a workflow committed before `run-name` existed
 * produces anonymous runs; `githubActionsReconcile` cannot attribute them, correctly
 * refuses to fail a possibly-live run, and every stranded dispatch on that repo falls
 * back to the 20-minute reaper's generic "silent run" message instead of a reason that
 * names a cause an operator can fix.
 *
 * The only remedy is for the repo to carry the current file. Before this sweep the sole
 * path there was a human noticing and pressing "Enable agent runs" again, once per repo —
 * a fix conditional on somebody knowing it was needed. This is the path that is not.
 *
 * ── One commit path, not two ────────────────────────────────────────────────────────
 * This sweep does NOT write to GitHub. It calls {@link ensureAgentWorkflow}, the same
 * function the enable endpoint calls, which is also the only place the revision is
 * stamped. A second commit helper here would be a second thing to keep in step with the
 * contents API's SHA-vs-create handling, the `workflow` scope failure mode, and the
 * presence-cache invalidation — all of which that function already gets right.
 *
 * ── Bounded and rate-aware ──────────────────────────────────────────────────────────
 * Each repo costs up to three GitHub subrequests (presence read, blob SHA read, PUT)
 * inside a Worker that shares its subrequest budget with every other cron job, so the
 * queue is drained {@link AGENT_WORKFLOW_REFRESH_MAX_PER_TICK} repos at a time, oldest
 * due first. Migration 1093 queued the entire existing population at once; it drains
 * over as many ticks as it takes rather than in one burst that would trip GitHub's
 * secondary rate limits and starve the sweeps that run beside it.
 *
 * ── Termination ─────────────────────────────────────────────────────────────────────
 * The queue column is the flag, and every outcome clears or defers it:
 *   • committed          → `ensureAgentWorkflow` stamps the revision and NULLs the due
 *   • never enabled      → due NULLed here; nothing to refresh, and a later enable stamps it
 *   • transient failure  → attempt counted, due pushed out by an exponential backoff
 *   • attempts exhausted → due NULLed; the credential cannot write workflows and retrying
 *                          forever would burn budget on a verdict that will not change
 * So a repo can leave the queue but never re-enter it on its own. Only a deliberate
 * revision bump (a one-line migration) puts it back.
 */
import { and, asc, eq, isNotNull, lte, or, sql } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ensureAgentWorkflow, githubActionsAvailable } from './githubActionsDispatch';
import { AGENT_WORKFLOW_REVISION } from './githubActionsWorkflow';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { projectRepositories } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

/** Repos re-committed per tick. Three GitHub subrequests each, shared budget. */
export const AGENT_WORKFLOW_REFRESH_MAX_PER_TICK = 10;

/**
 * Attempts before a repo is dropped from the queue.
 *
 * The dominant failure here is not transient: committing under `.github/workflows/`
 * needs the `workflow` PAT scope (or `workflows: write` on the App installation), which
 * a credential that pushes code perfectly well may simply not have. Three tries spread
 * over ~an hour distinguishes a rate limit from that, and then stops.
 */
export const AGENT_WORKFLOW_REFRESH_MAX_ATTEMPTS = 3;

/** Backoff before the next attempt, by attempts already made: 5min, 20min, (dropped). */
export function agentWorkflowRefreshBackoffMs(attemptsMade: number): number {
  return 5 * 60_000 * Math.pow(4, Math.max(0, attemptsMade - 1));
}

export interface AgentWorkflowRefreshResult {
  /** Queued repos examined this tick. */
  checked: number;
  /** Re-committed with the current workflow. */
  refreshed: number;
  /** Left the queue because the surface was never enabled on them. */
  skipped: number;
  /** Deferred for another attempt, or dropped after exhausting them. */
  deferred: number;
  dropped: number;
}

/** A repo whose committed workflow revision is behind. */
interface QueuedRepo {
  id: string;
  tenantId: number;
  attempts: number;
}

/**
 * Drain one tick of the workflow-refresh queue.
 *
 * Best-effort throughout: a repo that cannot be refreshed this tick is simply left for
 * the next one (or dropped), never allowed to fail the sweep — the surface's existing
 * behaviour without this sweep is the fallback, and it is a safe one.
 */
export async function runAgentWorkflowRefreshSweep(
  env: Env,
  nowMs = Date.now(),
): Promise<AgentWorkflowRefreshResult> {
  const db = buildDatabase(env);
  const result: AgentWorkflowRefreshResult = { checked: 0, refreshed: 0, skipped: 0, deferred: 0, dropped: 0 };

  const queued = await loadQueuedRepos(db, nowMs);
  if (queued.length === 0) return result;

  for (const repo of queued) {
    result.checked += 1;

    // A repo that never had the workflow has nothing to RE-commit, and committing one
    // here would silently enable a surface nobody chose. Cheap, cached, and the answer
    // the enable endpoint reads too.
    const enabled = await githubActionsAvailable(env, db, repo.tenantId, repo.id).catch(() => false);
    if (!enabled) {
      await clearQueue(db, repo, 'not enabled');
      result.skipped += 1;
      continue;
    }

    // The shared commit path. On success it stamps the revision and clears the queue
    // itself, so there is no second write to keep in step here.
    const written = await ensureAgentWorkflow(env, db, repo.tenantId, repo.id)
      .catch((error: unknown) => ({ ok: false as const, code: 'provider_error', reason: error instanceof Error ? error.message : String(error) }));

    if (written.ok) {
      result.refreshed += 1;
      continue;
    }

    const attempts = repo.attempts + 1;
    if (attempts >= AGENT_WORKFLOW_REFRESH_MAX_ATTEMPTS) {
      await clearQueue(db, repo, `giving up after ${attempts} attempts: ${written.code}`);
      result.dropped += 1;
      continue;
    }
    await deferQueue(db, repo, attempts, nowMs);
    result.deferred += 1;
  }

  return result;
}

/**
 * Repos due for a re-commit.
 *
 * Guarded on the revision as well as the due time so a repo that reached the current
 * revision by any other route (an operator pressing enable while it sat in the queue)
 * is skipped without a GitHub call rather than re-committing an identical file.
 */
async function loadQueuedRepos(db: Db, nowMs: number): Promise<QueuedRepo[]> {
  const rows = await db
    .select({
      id: projectRepositories.id,
      tenantId: projectRepositories.tenantId,
      attempts: projectRepositories.agentWorkflowRefreshAttempts,
    })
    .from(projectRepositories)
    .where(and(
      eq(projectRepositories.provider, 'github'),
      isNotNull(projectRepositories.agentWorkflowRefreshDue),
      lte(projectRepositories.agentWorkflowRefreshDue, new Date(nowMs)),
      or(
        sql`${projectRepositories.agentWorkflowRevision} IS NULL`,
        sql`${projectRepositories.agentWorkflowRevision} <> ${AGENT_WORKFLOW_REVISION}`,
      ),
    ))
    .orderBy(asc(projectRepositories.agentWorkflowRefreshDue))
    .limit(AGENT_WORKFLOW_REFRESH_MAX_PER_TICK)
    .catch(() => []);

  return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, attempts: r.attempts ?? 0 }));
}

/** Take a repo off the queue for good. The revision is deliberately NOT stamped: we did
 *  not commit anything, and claiming otherwise would hide the repo from a future bump. */
async function clearQueue(db: Db, repo: QueuedRepo, why: string): Promise<void> {
  await db
    .update(projectRepositories)
    .set({ agentWorkflowRefreshDue: null, updatedAt: new Date() })
    .where(and(eq(projectRepositories.id, repo.id), eq(projectRepositories.tenantId, repo.tenantId)))
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/agentWorkflowRefresh.ts', operation: 'clearQueue', context: { logMessage: '[agent-workflow-refresh] dequeue failed', details: { tenantId: repo.tenantId, repoId: repo.id, why, error } } }));
}

/** Push a repo out to its next attempt. */
async function deferQueue(db: Db, repo: QueuedRepo, attempts: number, nowMs: number): Promise<void> {
  await db
    .update(projectRepositories)
    .set({
      agentWorkflowRefreshAttempts: attempts,
      agentWorkflowRefreshDue: new Date(nowMs + agentWorkflowRefreshBackoffMs(attempts)),
      updatedAt: new Date(),
    })
    .where(and(eq(projectRepositories.id, repo.id), eq(projectRepositories.tenantId, repo.tenantId)))
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/agentWorkflowRefresh.ts', operation: 'deferQueue', context: { logMessage: '[agent-workflow-refresh] defer failed', details: { tenantId: repo.tenantId, repoId: repo.id, attempts, error } } }));
}
