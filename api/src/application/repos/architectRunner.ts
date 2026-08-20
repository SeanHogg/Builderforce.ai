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
 *
 * Repair lives here too — `retryArchitectAnalysis` re-queues only the artifacts a
 * finished run failed or withheld, and `loadLatestArchitectRun` is how a surface
 * finds out whether there is anything to repair. Both are the same shape of
 * decision as starting one, so they belong beside it rather than in a route.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  executions, projects, repoAnalysisArtifacts, repoAnalysisRuns, tenants,
} from '../../infrastructure/database/schema';
import { partitionRetryableArtifacts } from '../repoanalysis/analysisPlan';
import type { ArtifactKind } from '../repoanalysis/types';
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
  | { ok: true; runId: string; taskId: number; executionId: number | null }
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
    taskId: task.id,
    status: TaskStatus.IN_PROGRESS,
    submittedBy: args.userId ?? 'system:repo-analysis',
  });
  if (args.waitUntil) args.waitUntil(lane);
  else await lane.catch(() => undefined);

  return { ok: true, runId: run.id, taskId: task.id, executionId: execution?.id ?? null };
}

// ── Repairing a finished run ─────────────────────────────────────────────────
//
// A run rarely fails whole: one artifact's model call times out, or the tenant
// was on Free when it ran and four kinds were recorded `skipped`. Re-running the
// Architect from scratch would re-crawl every repository and re-spend the whole
// token budget to reproduce artifacts that are already good. Repairing is
// therefore its own operation — same run, same evidence, only the broken kinds.

/** The run statuses that mean "the state machine still owns this run". */
const IN_PROGRESS_STATUSES = new Set(['queued', 'fetching', 'analyzing', 'writing_back']);

/** Why a retry could not be started — each maps to a different caller answer. */
export type ArchitectRetryRefusal =
  | 'not_enabled'
  | 'run_not_found'
  | 'run_in_progress'
  | 'nothing_to_retry';

export type ArchitectRetryResult =
  | { ok: true; runId: string; kinds: ArtifactKind[] }
  | { ok: false; reason: ArchitectRetryRefusal };

/** One run's repair-relevant state, as a surface needs it to decide what to offer. */
export interface ArchitectRunSummary {
  runId: string;
  projectId: number;
  status: string;
  stage: string | null;
  progress: number;
  /** Kinds a retry would re-queue right now — empty means "nothing to retry". */
  retryableKinds: ArtifactKind[];
  /** Kinds still `skipped` that this tenant's plan does NOT cover (the upsell). */
  lockedKinds: ArtifactKind[];
  createdAt: string | null;
  finishedAt: string | null;
}

/**
 * The project's most recent analysis run plus what a retry would cover.
 *
 * Deliberately NOT read-through cached. The row is a live mirror of a state
 * machine advanced by Durable-Object `alarm()` ticks that never pass through
 * this layer, so there is no write here to invalidate on — a cached copy would
 * simply show a stale stage while the run moves. Same reasoning as the existing
 * `GET /runs/:runId` poll.
 */
export async function loadLatestArchitectRun(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<ArchitectRunSummary | null> {
  const [run] = await db
    .select({
      id: repoAnalysisRuns.id,
      projectId: repoAnalysisRuns.projectId,
      status: repoAnalysisRuns.status,
      stage: repoAnalysisRuns.stage,
      progress: repoAnalysisRuns.progress,
      createdAt: repoAnalysisRuns.createdAt,
      finishedAt: repoAnalysisRuns.finishedAt,
    })
    .from(repoAnalysisRuns)
    .where(and(eq(repoAnalysisRuns.tenantId, tenantId), eq(repoAnalysisRuns.projectId, projectId)))
    .orderBy(desc(repoAnalysisRuns.createdAt))
    .limit(1);
  if (!run) return null;

  const rows = await db
    .select({ kind: repoAnalysisArtifacts.kind, status: repoAnalysisArtifacts.status })
    .from(repoAnalysisArtifacts)
    .where(and(eq(repoAnalysisArtifacts.runId, run.id), eq(repoAnalysisArtifacts.tenantId, tenantId)));

  const plan = await resolveAnalysisPlan(db, tenantId);
  const { retryable, locked } = partitionRetryableArtifacts(rows, plan);
  const busy = IN_PROGRESS_STATUSES.has(run.status);

  return {
    runId: run.id,
    projectId: run.projectId,
    status: run.status,
    stage: run.stage ?? null,
    progress: run.progress,
    // A running state machine will still write these rows itself; offering a
    // retry mid-flight would race it, so the surface is told there is nothing.
    retryableKinds: busy ? [] : retryable,
    lockedKinds: locked,
    createdAt: run.createdAt ? run.createdAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

/**
 * Re-queue a finished run's failed (and newly-affordable skipped) artifacts.
 *
 * Kicks the SAME Durable Object the run was driven by — `idFromName(runId)` is
 * stable — with a `/retry` op that re-enters the machine at `analyzing`. The
 * unique (run_id, kind) constraint makes every artifact write an upsert, so a
 * retry that itself dies mid-way and is retried again cannot duplicate a row.
 */
export async function retryArchitectAnalysis(
  env: Env,
  db: Db,
  args: { tenantId: number; runId: string; userId?: string | null },
): Promise<ArchitectRetryResult> {
  const { tenantId, runId } = args;
  if (!env.ANALYSIS_RUNNER) return { ok: false, reason: 'not_enabled' };

  const [run] = await db
    .select({
      id: repoAnalysisRuns.id,
      projectId: repoAnalysisRuns.projectId,
      segmentId: repoAnalysisRuns.segmentId,
      status: repoAnalysisRuns.status,
      triggeredBy: repoAnalysisRuns.triggeredBy,
    })
    .from(repoAnalysisRuns)
    .where(and(eq(repoAnalysisRuns.id, runId), eq(repoAnalysisRuns.tenantId, tenantId)))
    .limit(1);
  if (!run) return { ok: false, reason: 'run_not_found' };
  if (IN_PROGRESS_STATUSES.has(run.status)) return { ok: false, reason: 'run_in_progress' };

  const rows = await db
    .select({ kind: repoAnalysisArtifacts.kind, status: repoAnalysisArtifacts.status })
    .from(repoAnalysisArtifacts)
    .where(and(eq(repoAnalysisArtifacts.runId, run.id), eq(repoAnalysisArtifacts.tenantId, tenantId)));

  const effectivePlan = await resolveAnalysisPlan(db, tenantId);
  const { retryable } = partitionRetryableArtifacts(rows, effectivePlan);
  if (retryable.length === 0) return { ok: false, reason: 'nothing_to_retry' };

  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, run.projectId), eq(projects.tenantId, tenantId)));
  if (!project) return { ok: false, reason: 'run_not_found' };

  const stub = env.ANALYSIS_RUNNER.get(env.ANALYSIS_RUNNER.idFromName(run.id));
  await stub.fetch('https://do/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: run.id,
      projectId: run.projectId,
      tenantId,
      segmentId: run.segmentId ?? null,
      effectivePlan,
      triggeredBy: args.userId ?? run.triggeredBy ?? null,
      projectName: project.name,
      kinds: retryable,
    }),
  });

  return { ok: true, runId: run.id, kinds: retryable };
}
