/**
 * ingestRepoCiEvent — feed a target repo's CI/deploy result back to the cloud
 * execution that produced the change, and validate the POST-MERGE build.
 *
 * Two correlation paths:
 *   1. Pre-merge: an event on a `builderforce/task-<id>` branch is recorded on that
 *      task's latest execution; when the operator gates shipping on green CI
 *      (`CLOUD_AUTOMERGE_REQUIRE_GREEN`) a successful build merges the branch.
 *   2. Post-merge: an event on the DEPLOY branch (e.g. `main`) is correlated by its
 *      head SHA to the merged PR we recorded that `merge_sha` for. We record the
 *      build outcome on the task and, on FAILURE, return an `autoFix` intent so the
 *      caller dispatches a fix run (capped at MAX_AUTOFIX_ATTEMPTS per task).
 *
 * Best-effort: never throws (a webhook must always 200 to stop retries). The actual
 * fix-run dispatch is performed by the caller (it owns the request/execution
 * context); this module only DECIDES and returns the intent.
 */
import { and, count, desc, eq } from 'drizzle-orm';
import { executions, tasks, projects, toolAuditEvents } from '../../infrastructure/database/schema';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutofixOnBuildFailure, MAX_AUTOFIX_ATTEMPTS } from '../repos/mergeBranchToBase';
import { ticketBranchName, markPullRequestMergedByTask, findMergedPullRequestBySha, setPullRequestBuildStatus } from '../repos/recordPullRequestRow';
import { fetchBuildError } from './fetchBuildError';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface RepoCiEvent {
  /** GitHub event name, e.g. 'check_suite' | 'deployment_status' | 'workflow_run' | 'status'. */
  eventType: string;
  /** Head branch the event is for. */
  branch: string | null;
  sha: string | null;
  /** Normalized outcome: 'success' | 'failure' | 'pending' | null. */
  outcome: 'success' | 'failure' | 'pending' | null;
  /** Raw provider state/conclusion for the audit detail. */
  rawState: string | null;
  targetUrl: string | null;
  /** Provider run id (GitHub Actions `workflow_run.id`) — for the failed-step fetch. */
  runId: number | null;
}

const TASK_BRANCH_RE = /^builderforce\/task-(\d+)\b/;

/** Telemetry toolName recorded per dispatched auto-fix run (the loop-guard counts these). */
export const AUTOFIX_DISPATCH_EVENT = 'autofix.dispatch';

export interface AutoFixIntent {
  taskId: number;
  tenantId: number;
  /** 1-based attempt number being dispatched (≤ MAX_AUTOFIX_ATTEMPTS). */
  attempt: number;
  /** JSON payload carrying the remediation context for the fix run's prompt. */
  payload: string;
}

export interface IngestResult {
  processed: boolean;
  reason?: string;
  taskId?: number;
  executionId?: number;
  merged?: boolean;
  buildStatus?: 'success' | 'failure' | 'pending';
  /** When set, the caller should dispatch a fix run for this task. */
  autoFix?: AutoFixIntent;
}

/** The task's latest execution id (the run that produced the branch/PR). */
async function latestExecutionId(db: Db, taskId: number, tenantId: number): Promise<number | undefined> {
  const [exec] = await db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.taskId, taskId), eq(executions.tenantId, tenantId)))
    .orderBy(desc(executions.id))
    .limit(1);
  return exec?.id;
}

/** How many auto-fix runs have already been dispatched for this task (loop-guard). */
async function autofixAttemptsSoFar(db: Db, taskId: number, tenantId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(toolAuditEvents)
    .innerJoin(executions, eq(executions.id, toolAuditEvents.executionId))
    .where(and(
      eq(executions.taskId, taskId),
      eq(executions.tenantId, tenantId),
      eq(toolAuditEvents.toolName, AUTOFIX_DISPATCH_EVENT),
    ));
  return row?.n ?? 0;
}

/** Best-effort: never throws (a webhook must always 200 to stop retries). */
export async function ingestRepoCiEvent(
  db: Db,
  env: Env,
  secret: string,
  evt: RepoCiEvent,
): Promise<IngestResult> {
  try {
    const m = evt.branch ? TASK_BRANCH_RE.exec(evt.branch) : null;
    return m
      ? await ingestPreMergeEvent(db, env, secret, evt, Number(m[1]))
      : await ingestPostMergeEvent(db, env, secret, evt);
  } catch (e) {
    return { processed: false, reason: e instanceof Error ? e.message : 'ingest failed' };
  }
}

/** Path 1 — an event on the ticket branch (pre-merge): record + optional green merge. */
async function ingestPreMergeEvent(db: Db, env: Env, secret: string, evt: RepoCiEvent, taskId: number): Promise<IngestResult> {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId, assignedAgentRef: tasks.assignedAgentRef, tenantId: projects.tenantId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return { processed: false, reason: `no task #${taskId}` };

  const execId = await latestExecutionId(db, taskId, task.tenantId);

  const result = `${evt.outcome ?? evt.rawState ?? 'unknown'}${evt.targetUrl ? ` · ${evt.targetUrl}` : ''}`;
  await db.insert(toolAuditEvents).values({
    tenantId: task.tenantId, agentHostId: null, cloudAgentRef: task.assignedAgentRef ?? null,
    executionId: execId ?? null, sessionKey: execId ? `exec:${execId}` : `task:${taskId}`,
    toolName: evt.eventType === 'deployment_status' ? 'deploy.status' : `ci.${evt.eventType}`,
    category: 'ci',
    args: JSON.stringify({ branch: evt.branch, sha: evt.sha, state: evt.rawState, url: evt.targetUrl }),
    result: result.slice(0, 300), ts: new Date(),
  }).catch(() => { /* telemetry best-effort */ });

  // Gated shipping: merge only on green. Default-off — the cloud loop merges
  // immediately unless this flag is set (then the green CI/deploy ships it here).
  let merged = false;
  if (evt.outcome === 'success' && cloudAutoMergeRequiresGreen(env)) {
    const repoRef = await resolveDefaultRepoForTask(db, task.tenantId, taskId);
    if (repoRef) {
      const resolved = await resolveRepoCredential(db, secret, task.tenantId, repoRef.repoId);
      if (!isResolveError(resolved) && evt.branch === ticketBranchName(taskId)) {
        const base = (resolved.repo.defaultBranch ?? 'main').trim();
        const mr = await mergeBranchToBase({
          provider: resolved.repo.provider, host: resolved.repo.host,
          owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
          base, head: evt.branch, message: `Task #${taskId}: merge on green CI (BuilderForce)`,
        });
        merged = mr.ok;
        // Stamp the merge SHA so the resulting deploy-branch build correlates back.
        if (mr.ok) await markPullRequestMergedByTask(db, task.tenantId, taskId, { mergeSha: mr.sha ?? null }).catch(() => {});
      }
    }
  }

  return { processed: true, taskId, executionId: execId, merged };
}

/** Path 2 — an event on the deploy branch (post-merge): validate + maybe auto-fix. */
async function ingestPostMergeEvent(db: Db, env: Env, secret: string, evt: RepoCiEvent): Promise<IngestResult> {
  if (!evt.sha) return { processed: false, reason: 'no sha to correlate' };
  if (evt.outcome !== 'success' && evt.outcome !== 'failure') {
    return { processed: false, reason: `outcome '${evt.outcome ?? 'none'}' not actionable` };
  }

  const pr = await findMergedPullRequestBySha(db, evt.sha);
  if (!pr || pr.taskId == null) return { processed: false, reason: 'no merged PR for this sha' };

  const taskId = pr.taskId;
  const tenantId = pr.tenantId;
  const [task] = await db
    .select({ assignedAgentRef: tasks.assignedAgentRef })
    .from(tasks).where(eq(tasks.id, taskId)).limit(1);

  await setPullRequestBuildStatus(db, pr.id, evt.outcome).catch(() => {});
  const execId = await latestExecutionId(db, taskId, tenantId);

  await db.insert(toolAuditEvents).values({
    tenantId, agentHostId: null, cloudAgentRef: task?.assignedAgentRef ?? null,
    executionId: execId ?? null, sessionKey: execId ? `exec:${execId}` : `task:${taskId}`,
    toolName: 'build.result', category: 'ci',
    args: JSON.stringify({ branch: evt.branch, sha: evt.sha, runId: evt.runId, url: evt.targetUrl }),
    result: `post-merge build ${evt.outcome}${evt.targetUrl ? ` · ${evt.targetUrl}` : ''}`.slice(0, 300),
    ts: new Date(),
  }).catch(() => {});

  if (evt.outcome === 'success') {
    return { processed: true, taskId, executionId: execId, buildStatus: 'success' };
  }

  // FAILURE → auto-fix (if enabled and under the per-task attempt cap).
  if (!cloudAutofixOnBuildFailure(env)) {
    return { processed: true, taskId, executionId: execId, buildStatus: 'failure', reason: 'auto-fix disabled' };
  }
  const priorAttempts = await autofixAttemptsSoFar(db, taskId, tenantId);
  if (priorAttempts >= MAX_AUTOFIX_ATTEMPTS) {
    await db.insert(toolAuditEvents).values({
      tenantId, agentHostId: null, cloudAgentRef: task?.assignedAgentRef ?? null,
      executionId: execId ?? null, sessionKey: execId ? `exec:${execId}` : `task:${taskId}`,
      toolName: 'build.needs_human', category: 'ci',
      args: JSON.stringify({ sha: evt.sha, attempts: priorAttempts }),
      result: `auto-fix exhausted after ${priorAttempts} attempt(s) — needs human`, ts: new Date(),
    }).catch(() => {});
    return { processed: true, taskId, executionId: execId, buildStatus: 'failure', reason: 'auto-fix attempts exhausted' };
  }

  // Build the remediation context (failed jobs/steps) for the fix run's prompt.
  let buildErrorSummary = `The post-merge build failed.${evt.targetUrl ? ` See: ${evt.targetUrl}` : ''}`;
  if (pr.repoId && evt.runId) {
    const resolved = await resolveRepoCredential(db, secret, tenantId, pr.repoId);
    if (!isResolveError(resolved)) {
      const be = await fetchBuildError(env, {
        provider: resolved.repo.provider, host: resolved.repo.host,
        owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
        runId: evt.runId, runUrl: evt.targetUrl,
      });
      buildErrorSummary = be.summary;
    }
  }

  const attempt = priorAttempts + 1;
  const payload = JSON.stringify({
    remediation: { kind: 'build_failure', attempt, maxAttempts: MAX_AUTOFIX_ATTEMPTS, buildError: buildErrorSummary, runUrl: evt.targetUrl },
  });

  return {
    processed: true, taskId, executionId: execId, buildStatus: 'failure',
    autoFix: { taskId, tenantId, attempt, payload },
  };
}
