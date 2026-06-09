/**
 * ingestRepoCiEvent — feed a target repo's CI/deploy result back to the cloud
 * execution that produced the change.
 *
 * The cloud agent ships by pushing a `builderforce/task-<id>` branch (and, by
 * default, auto-merging it). The downstream CI/CF-Pages build/deploy result was
 * previously invisible in the portal. This correlates an incoming GitHub
 * check/deploy webhook back to the task → its latest execution and records it as
 * a `tool_audit_event`, so the build/deploy outcome shows on that execution's
 * Logs/Timeline (attributable by `execution_id` + `cloud_agent_ref`).
 *
 * When the operator opts into gated shipping (`CLOUD_AUTOMERGE_REQUIRE_GREEN`),
 * the cloud loop does NOT auto-merge on finish; instead a successful CI/deploy
 * here merges the ticket branch into the deploy branch — "merge only on green".
 */
import { and, desc, eq } from 'drizzle-orm';
import { executions, tasks, projects, toolAuditEvents } from '../../infrastructure/database/schema';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen } from '../repos/mergeBranchToBase';
import { ticketBranchName } from '../repos/commitFileAsPendingChange';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface RepoCiEvent {
  /** GitHub event name, e.g. 'check_suite' | 'deployment_status' | 'workflow_run' | 'status'. */
  eventType: string;
  /** Head branch the event is for. We only act on `builderforce/task-<id>` branches. */
  branch: string | null;
  sha: string | null;
  /** Normalized outcome: 'success' | 'failure' | 'pending' | null. */
  outcome: 'success' | 'failure' | 'pending' | null;
  /** Raw provider state/conclusion for the audit detail. */
  rawState: string | null;
  targetUrl: string | null;
}

const TASK_BRANCH_RE = /^builderforce\/task-(\d+)\b/;

export interface IngestResult {
  processed: boolean;
  reason?: string;
  taskId?: number;
  executionId?: number;
  merged?: boolean;
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
    if (!m) return { processed: false, reason: 'not a builderforce task branch' };
    const taskId = Number(m[1]);

    const [task] = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        assignedAgentRef: tasks.assignedAgentRef,
        tenantId: projects.tenantId,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return { processed: false, reason: `no task #${taskId}` };

    // Correlate to the run that produced the branch: the task's latest execution.
    const [exec] = await db
      .select({ id: executions.id })
      .from(executions)
      .where(and(eq(executions.taskId, taskId), eq(executions.tenantId, task.tenantId)))
      .orderBy(desc(executions.id))
      .limit(1);

    const result = `${evt.outcome ?? evt.rawState ?? 'unknown'}${evt.targetUrl ? ` · ${evt.targetUrl}` : ''}`;
    await db.insert(toolAuditEvents).values({
      tenantId:      task.tenantId,
      agentHostId:   null,
      cloudAgentRef: task.assignedAgentRef ?? null,
      executionId:   exec?.id ?? null,
      sessionKey:    exec ? `exec:${exec.id}` : `task:${taskId}`,
      toolName:      evt.eventType === 'deployment_status' ? 'deploy.status' : `ci.${evt.eventType}`,
      category:      'ci',
      args:          JSON.stringify({ branch: evt.branch, sha: evt.sha, state: evt.rawState, url: evt.targetUrl }),
      result:        result.slice(0, 300),
      ts:            new Date(),
    }).catch(() => { /* telemetry best-effort */ });

    // Gated shipping: merge only on green. Default-off — the cloud loop merges
    // immediately unless this flag is set (then the green CI/deploy ships it here).
    let merged = false;
    if (evt.outcome === 'success' && cloudAutoMergeRequiresGreen(env)) {
      const repoRef = await resolveDefaultRepoForTask(db, task.tenantId, taskId);
      if (repoRef) {
        const resolved = await resolveRepoCredential(db, secret, task.tenantId, repoRef.repoId);
        if (!isResolveError(resolved)) {
          const base = (resolved.repo.defaultBranch ?? 'main').trim();
          // Only merge the dedicated ticket branch, never an arbitrary green branch.
          if (evt.branch === ticketBranchName(taskId)) {
            const mr = await mergeBranchToBase({
              provider: resolved.repo.provider, host: resolved.repo.host,
              owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
              base, head: evt.branch,
              message: `Task #${taskId}: merge on green CI (BuilderForce)`,
            });
            merged = mr.ok;
          }
        }
      }
    }

    return { processed: true, taskId, executionId: exec?.id, merged };
  } catch (e) {
    return { processed: false, reason: e instanceof Error ? e.message : 'ingest failed' };
  }
}
