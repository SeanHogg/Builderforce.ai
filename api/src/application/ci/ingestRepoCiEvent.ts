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
import { ticketBranchName } from '../repos/commitFileAsPendingChange';
import { markPullRequestMergedByTask, findMergedPullRequestBySha, findOpenPullRequestByTask, findOpenPullRequestByProject, setPullRequestBuildStatus } from '../repos/recordPullRequestRow';
import { completeTaskOnMerge } from '../task/taskLifecycle';
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
  /** Provider run id (GitHub Actions `workflow_run.id`, GitLab `pipeline.id`) — for the failed-step fetch. */
  runId: number | null;
  /**
   * Pre-merge auto-fix eligibility override. A ticket-branch failure only burns an
   * auto-fix attempt when the event is an AUTHORITATIVE whole-build conclusion — on
   * GitHub that is exactly "has a workflow_run id", which is why this defaults to
   * `runId != null`. Providers whose terminal build event carries no numeric run id
   * (Bitbucket commit statuses) set this explicitly so they are genuinely eligible
   * rather than silently skipped.
   */
  authoritative?: boolean;
}

const TASK_BRANCH_RE = /^builderforce\/task-(\d+)\b/;
/** The IDE bridge's branch (`repoBridge.designerBranch`) — a PROJECT, not a task. */
const DESIGNER_BRANCH_RE = /^builderforce\/designer-(\d+)\b/;

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
  /** Owning tenant of the correlated task (set whenever `taskId` is). */
  tenantId?: number;
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

/**
 * Apply a build OUTCOME (success | failure) to a PR row + telemetry, and decide
 * whether to dispatch an auto-fix run. Shared by BOTH the pre-merge (ticket-branch)
 * and post-merge (deploy-branch) paths so a failing build is surfaced — and fed back
 * to the agent — identically in either phase:
 *   - persist `build_status` (+ the failure REASON) on the PR row so the ticket's
 *     Pull Request tab shows WHY the build is red (not just transient telemetry),
 *   - record a prominent `build.result` event the run's Logs/Timeline read, and
 *   - on failure (when eligible + under the per-task attempt cap) return an auto-fix
 *     intent carrying the build error so the agent fixes the REAL failing build.
 */
async function applyBuildOutcome(
  db: Db,
  env: Env,
  secret: string,
  ctx: {
    phase: 'pre_merge' | 'post_merge';
    taskId: number;
    tenantId: number;
    execId?: number;
    agentRef: string | null;
    pr: { id: string; repoId: string | null };
    evt: RepoCiEvent;
    /** Post-merge always allows auto-fix; pre-merge only on an authoritative
     *  workflow_run conclusion (has a runId) so the many per-check events on a PR
     *  branch don't each burn an auto-fix attempt. */
    allowAutoFix: boolean;
  },
): Promise<IngestResult> {
  const { phase, taskId, tenantId, execId, agentRef, pr, evt } = ctx;
  const outcome = evt.outcome as 'success' | 'failure';
  const phaseLabel = phase === 'pre_merge' ? 'PR-branch build' : 'post-merge build';

  // FAILURE → pull the failing jobs/steps so we can persist + hand them to the agent.
  let buildError: string | null = null;
  if (outcome === 'failure') {
    buildError = `The ${phaseLabel} failed.${evt.targetUrl ? ` See: ${evt.targetUrl}` : ''}`;
    if (pr.repoId && evt.runId) {
      const resolved = await resolveRepoCredential(db, secret, tenantId, pr.repoId);
      if (!isResolveError(resolved)) {
        const be = await fetchBuildError(env, {
          provider: resolved.repo.provider, host: resolved.repo.host,
          owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
          runId: evt.runId, runUrl: evt.targetUrl,
        });
        buildError = be.summary;
      }
    }
  }

  // Persist on the PR row so the in-product Pull Request tab renders status + reason.
  await setPullRequestBuildStatus(db, pr.id, outcome, buildError).catch(() => {});

  await db.insert(toolAuditEvents).values({
    tenantId, agentHostId: null, cloudAgentRef: agentRef,
    executionId: execId ?? null, sessionKey: execId ? `exec:${execId}` : `task:${taskId}`,
    toolName: 'build.result', category: 'ci',
    args: JSON.stringify({ phase, branch: evt.branch, sha: evt.sha, runId: evt.runId, url: evt.targetUrl }),
    result: `${phaseLabel} ${outcome}${evt.targetUrl ? ` · ${evt.targetUrl}` : ''}`.slice(0, 300),
    ts: new Date(),
  }).catch(() => {});

  if (outcome === 'success') {
    return { processed: true, taskId, tenantId, executionId: execId, buildStatus: 'success' };
  }

  // FAILURE → auto-fix (if eligible, enabled, and under the per-task attempt cap).
  if (!ctx.allowAutoFix) {
    return { processed: true, taskId, tenantId, executionId: execId, buildStatus: 'failure', reason: 'event not auto-fix eligible' };
  }
  if (!cloudAutofixOnBuildFailure(env)) {
    return { processed: true, taskId, tenantId, executionId: execId, buildStatus: 'failure', reason: 'auto-fix disabled' };
  }
  const priorAttempts = await autofixAttemptsSoFar(db, taskId, tenantId);
  if (priorAttempts >= MAX_AUTOFIX_ATTEMPTS) {
    await db.insert(toolAuditEvents).values({
      tenantId, agentHostId: null, cloudAgentRef: agentRef,
      executionId: execId ?? null, sessionKey: execId ? `exec:${execId}` : `task:${taskId}`,
      toolName: 'build.needs_human', category: 'ci',
      args: JSON.stringify({ phase, sha: evt.sha, attempts: priorAttempts }),
      result: `auto-fix exhausted after ${priorAttempts} attempt(s) — needs human`, ts: new Date(),
    }).catch(() => {});
    return { processed: true, taskId, tenantId, executionId: execId, buildStatus: 'failure', reason: 'auto-fix attempts exhausted' };
  }

  const attempt = priorAttempts + 1;
  const payload = JSON.stringify({
    remediation: { kind: 'build_failure', phase, attempt, maxAttempts: MAX_AUTOFIX_ATTEMPTS, buildError, runUrl: evt.targetUrl },
  });
  return {
    processed: true, taskId, tenantId, executionId: execId, buildStatus: 'failure',
    autoFix: { taskId, tenantId, attempt, payload },
  };
}

/** Best-effort: never throws (a webhook must always 200 to stop retries). */
export async function ingestRepoCiEvent(
  db: Db,
  env: Env,
  secret: string,
  evt: RepoCiEvent,
): Promise<IngestResult> {
  try {
    const task = evt.branch ? TASK_BRANCH_RE.exec(evt.branch) : null;
    if (task) return await ingestPreMergeEvent(db, env, secret, evt, Number(task[1]));
    // Designer/Mobile PRs come from the IDE bridge, not a ticket. They previously
    // fell through to the post-merge path, which correlates by merged-PR SHA and
    // so matched nothing — meaning an IDE-opened PR showed no build status at all.
    const designer = evt.branch ? DESIGNER_BRANCH_RE.exec(evt.branch) : null;
    if (designer) return await ingestDesignerEvent(db, env, secret, evt, Number(designer[1]));
    return await ingestPostMergeEvent(db, env, secret, evt);
  } catch (e) {
    return { processed: false, reason: e instanceof Error ? e.message : 'ingest failed' };
  }
}

/**
 * Path 1b — an event on an IDE bridge branch (`builderforce/designer-<projectId>`).
 *
 * Same goal as the ticket path — the PR row carries the build verdict and the
 * reason, so the IDE can show whether the pushed workspace actually builds — but
 * deliberately WITHOUT the auto-fix dispatch: there is no ticket and no assigned
 * agent to hand a failing build to. A human opened this PR from the IDE, so the
 * feedback belongs on screen, not in an agent run.
 */
async function ingestDesignerEvent(
  db: Db,
  env: Env,
  secret: string,
  evt: RepoCiEvent,
  projectId: number,
): Promise<IngestResult> {
  const [project] = await db
    .select({ id: projects.id, tenantId: projects.tenantId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { processed: false, reason: `no project #${projectId}` };

  if (evt.outcome !== 'success' && evt.outcome !== 'failure') {
    return { processed: false, reason: 'not a terminal build outcome' };
  }

  const pr = await findOpenPullRequestByProject(db, project.tenantId, projectId);
  if (!pr) return { processed: false, reason: `no open PR for project #${projectId}` };

  const outcome = evt.outcome;
  let buildError: string | null = null;
  if (outcome === 'failure') {
    buildError = `The PR-branch build failed.${evt.targetUrl ? ` See: ${evt.targetUrl}` : ''}`;
    if (pr.repoId && evt.runId) {
      const resolved = await resolveRepoCredential(db, secret, project.tenantId, pr.repoId);
      if (!isResolveError(resolved)) {
        const be = await fetchBuildError(env, {
          provider: resolved.repo.provider, host: resolved.repo.host,
          owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
          runId: evt.runId, runUrl: evt.targetUrl,
        });
        buildError = be.summary;
      }
    }
  }

  await setPullRequestBuildStatus(db, pr.id, outcome, buildError).catch(() => {});

  await db.insert(toolAuditEvents).values({
    tenantId: project.tenantId, agentHostId: null, cloudAgentRef: null,
    executionId: null, sessionKey: `project:${projectId}`,
    toolName: 'build.result', category: 'ci',
    args: JSON.stringify({ branch: evt.branch, sha: evt.sha, projectId }),
    result: (outcome === 'success' ? 'PR-branch build passed' : (buildError ?? 'PR-branch build failed')).slice(0, 300),
    ts: new Date(),
  }).catch(() => { /* telemetry best-effort */ });

  return { processed: true, tenantId: project.tenantId, buildStatus: outcome };
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

  // Stamp the build outcome + REASON on the agent's open PR row (so the ticket shows
  // WHY CI is red before merge) and, on an authoritative failure, dispatch an auto-fix
  // run so the agent fixes the build it doesn't yet know it broke. Only runs when the
  // agent has actually opened a PR for the task; otherwise we keep the bare event above.
  let buildResult: IngestResult | null = null;
  if (evt.outcome === 'success' || evt.outcome === 'failure') {
    const pr = await findOpenPullRequestByTask(db, task.tenantId, taskId);
    if (pr) {
      buildResult = await applyBuildOutcome(db, env, secret, {
        phase: 'pre_merge', taskId, tenantId: task.tenantId, execId,
        agentRef: task.assignedAgentRef ?? null, pr: { id: pr.id, repoId: pr.repoId },
        evt, allowAutoFix: evt.authoritative ?? evt.runId != null,
      });
    }
  }

  // Gated shipping: merge only on green. Default-off — the cloud loop merges
  // immediately unless this flag is set (then the green CI/deploy ships it here).
  let merged = false;
  if (evt.outcome === 'success' && cloudAutoMergeRequiresGreen(env)) {
    const repoRef = await resolveDefaultRepoForTask(db, task.tenantId, taskId);
    if (repoRef) {
      const resolved = await resolveRepoCredential(db, secret, task.tenantId, repoRef.repoId);
      const ticketBranch = ticketBranchName(taskId);
      if (!isResolveError(resolved) && evt.branch === ticketBranch) {
        const base = (resolved.repo.defaultBranch ?? 'main').trim();
        const mr = await mergeBranchToBase({
          provider: resolved.repo.provider, host: resolved.repo.host,
          owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
          base, head: ticketBranch, message: `Task #${taskId}: merge on green CI (BuilderForce)`,
        });
        merged = mr.ok;
        // Stamp the merge SHA so the resulting deploy-branch build correlates back.
        if (mr.ok) {
          await markPullRequestMergedByTask(db, task.tenantId, taskId, { mergeSha: mr.sha ?? null }).catch(() => {});
          // Merge on green → ticket complete (same completion path as the human/manager merge).
          await completeTaskOnMerge(env, db, { tenantId: task.tenantId, taskId }).catch(() => {});
        }
      }
    }
  }

  // Carry the build status + any auto-fix intent (failure) up to the webhook, which
  // owns the run dispatch — same contract the post-merge path returns.
  return { processed: true, taskId, tenantId: task.tenantId, executionId: execId, merged, buildStatus: buildResult?.buildStatus, autoFix: buildResult?.autoFix };
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

  const execId = await latestExecutionId(db, taskId, tenantId);

  // Merge & deploy → ticket complete: a SUCCESSFUL post-merge deploy is the final
  // "it shipped" signal, so complete the ticket here too (idempotent — a no-op if an
  // earlier merge path already completed it). A deploy FAILURE leaves it open and
  // drives auto-fix below.
  if (evt.outcome === 'success') {
    await completeTaskOnMerge(env, db, { tenantId, taskId }).catch(() => {});
  }

  // Post-merge always allows auto-fix (a deploy failure is authoritative even without
  // a runId — e.g. deployment_status events). Same outcome + reason + intent contract
  // as the pre-merge path, via the shared helper.
  return applyBuildOutcome(db, env, secret, {
    phase: 'post_merge', taskId, tenantId, execId,
    agentRef: task?.assignedAgentRef ?? null, pr: { id: pr.id, repoId: pr.repoId },
    evt, allowAutoFix: true,
  });
}
