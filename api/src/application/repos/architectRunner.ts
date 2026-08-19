/**
 * Start the Architect — the deep, LLM-driven `architecture-analysis` run.
 *
 * This was written inline in `repoAnalysisRoutes`, which made it a thing only a
 * human clicking "Analyse" could cause. The RFP freshness gate needs exactly the
 * same sequence — board task, execution row, run row, Durable Object kick, lane
 * trigger — so it moved down a layer instead of being written a second time.
 *
 * The route keeps owning HTTP (status codes, role gate); this owns what starting
 * an analysis IS. A caller that cannot start one gets a typed refusal rather than
 * an exception, because both callers have something better to do than fail: the
 * route answers 409, the RFP generator falls back to the last-known artifacts.
 */
import { and, eq } from 'drizzle-orm';
import {
  executions, projects, repoAnalysisRuns, tenants,
} from '../../infrastructure/database/schema';
import { RepoService } from '../repos/RepoService';
import type { TaskService } from '../task/TaskService';
import { TaskStatus, TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { resolveEffectivePlan as resolveTenantEffectivePlan } from '../../domain/tenant/effectivePlan';
import { onTaskLandedInLane } from '../swimlane/laneEntryTrigger';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Why an analysis could not be started — each maps to a different caller answer. */
export type ArchitectRefusal = 'not_enabled' | 'project_not_found' | 'no_repo' | 'run_not_created';

export type ArchitectStart =
  | { ok: true; runId: string; taskId: string; executionId: string | null }
  | { ok: false; reason: ArchitectRefusal };

export interface ArchitectStartArgs {
  tenantId: number;
  projectId: number;
  segmentId?: string | null;
  userId?: string | null;
  /** Defer the lane trigger when the caller has a request lifetime to hang it on. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * The tenant's effective plan for the analysis token budget. Honours an unexpired
 * trial (via the shared resolver) and the superadmin premium override.
 */
export async function resolveAnalysisPlan(db: Db, tenantId: number): Promise<string> {
  const [row] = await db
    .select({ plan: tenants.plan, billingStatus: tenants.billingStatus, trialEndsAt: tenants.trialEndsAt, premiumOverride: tenants.premiumOverride })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row) return 'free';
  if (row.premiumOverride) return 'pro';
  return resolveTenantEffectivePlan({
    plan: (row.plan as TenantPlan) ?? TenantPlan.FREE,
    billingStatus: (row.billingStatus as TenantBillingStatus) ?? TenantBillingStatus.NONE,
    trialEndsAt: row.trialEndsAt ?? null,
  });
}

/**
 * Create the Architect task on the project board and kick off the analysis run.
 *
 * The board Task owns the lifecycle a person sees, the `executions` row makes it
 * show as running, and `repoAnalysisRuns` mirrors stage/progress for the DO —
 * which then advances one stage per `alarm()` tick. Nothing here waits for the
 * result: the run is asynchronous by design, and callers poll the run row.
 */
export async function startArchitectAnalysis(
  env: Env,
  db: Db,
  taskService: TaskService,
  args: ArchitectStartArgs,
): Promise<ArchitectStart> {
  const { tenantId, projectId } = args;
  if (!env.ANALYSIS_RUNNER) return { ok: false, reason: 'not_enabled' };

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  if (!project) return { ok: false, reason: 'project_not_found' };

  // A task cannot execute until a repo is mapped to the project — refuse early,
  // before creating any task/execution rows.
  const repoService = new RepoService(db, async () => false); // listRepos only; no PR dispatch here
  const repos = await repoService.listRepos(projectId, tenantId);
  if (repos.length === 0) return { ok: false, reason: 'no_repo' };

  const effectivePlan = await resolveAnalysisPlan(db, tenantId);

  const created = await taskService.createTask(
    {
      projectId,
      title: 'Architecture Analysis',
      description: 'Repository architecture analysis — diagnostic, modernization recommendation, 4+1 views, anti-patterns and design principles. Result is written back as a PRD.',
    },
    tenantId,
  );
  const task = await taskService.updateTask(created.id, { status: TaskStatus.IN_PROGRESS });

  const [execution] = await db
    .insert(executions)
    .values({
      taskId: task.id,
      tenantId,
      segmentId: args.segmentId ?? undefined,
      submittedBy: args.userId ?? 'system',
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: executions.id });

  const [run] = await db
    .insert(repoAnalysisRuns)
    .values({
      tenantId,
      segmentId: args.segmentId ?? undefined,
      projectId,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      effectivePlan,
      triggeredBy: args.userId ?? null,
    })
    .returning();
  if (!run) return { ok: false, reason: 'run_not_created' };

  const stub = env.ANALYSIS_RUNNER.get(env.ANALYSIS_RUNNER.idFromName(run.id));
  await stub.fetch('https://do/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: run.id,
      projectId,
      tenantId,
      segmentId: args.segmentId ?? null,
      effectivePlan,
      triggeredBy: args.userId ?? null,
      projectName: project.name,
      repoIds: repos.map((r) => r.id),
      taskId: task.id,
      executionId: execution?.id ?? null,
    }),
  });

  // The analysis ticket is a ticket landing in a lane (In Progress) like any
  // other, so it goes through the ONE funnel rather than bypassing the trigger.
  // Normally a no-op: the `executions` row created above is live, so the
  // evaluation returns `already_running` and nothing is dispatched. It matters
  // when that row could NOT be created — the ticket then still gets the lane's
  // agent instead of sitting untouched until the cron backstop notices.
  const lane = onTaskLandedInLane(env, db, {
    tenantId,
    projectId,
    taskId: task.id as unknown as number,
    status: TaskStatus.IN_PROGRESS,
    submittedBy: args.userId ?? 'system:repo-analysis',
  });
  if (args.waitUntil) args.waitUntil(lane);
  else await lane.catch(() => undefined);

  return { ok: true, runId: run.id, taskId: task.id, executionId: execution?.id ?? null };
}
