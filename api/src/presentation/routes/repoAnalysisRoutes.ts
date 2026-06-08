/**
 * Repo-analysis routes — /api/repo-analysis
 *
 * The Architect capability. It no longer has its own page: a signed-in user
 * launches it from a project, which creates a real **Task** on that project's
 * board and runs the analysis cloud-side in AnalysisRunnerDO (one stage per
 * alarm() tick). The board reflects progress via the linked `executions` row,
 * and the finished analysis is written back as a **PRD** (a spec with
 * kind='architecture'). A repo must be mapped first — otherwise the run is
 * refused (the same "cannot execute without a repo" rule as every other task).
 *
 *   POST /projects/:projectId/architect     Create the Architect task + start the run (DEVELOPER+)
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { executions, projects, repoAnalysisRuns, tenants } from '../../infrastructure/database/schema';
import { RepoService } from '../../application/repos/RepoService';
import { TaskService } from '../../application/task/TaskService';
import { TaskStatus, TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Resolve the tenant's effective plan for the analysis token budget. */
async function resolveEffectivePlan(db: Db, tenantId: number): Promise<string> {
  const [row] = await db
    .select({ plan: tenants.plan, billingStatus: tenants.billingStatus, premiumOverride: tenants.premiumOverride })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row) return 'free';
  if (row.premiumOverride) return 'pro';
  if ((row.plan === 'pro' || row.plan === 'teams') && row.billingStatus === 'active') return row.plan;
  return 'free';
}

export function createRepoAnalysisRoutes(db: Db, taskService: TaskService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const repoService = new RepoService(db, async () => false); // listRepos only; no PR dispatch here

  router.use('*', authMiddleware);

  // ── POST /projects/:projectId/architect ────────────────────────────────────
  // Spin up an Architect Task on the project board and kick off the analysis run.
  router.post('/projects/:projectId/architect', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    if (!c.env.ANALYSIS_RUNNER) {
      return c.json({ error: 'Repo analysis is not enabled on this deployment.' }, 503);
    }

    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    // A task cannot execute until a repo is mapped to the project — refuse early,
    // before creating any task/execution rows.
    const repos = await repoService.listRepos(projectId, tenantId);
    if (repos.length === 0) {
      return c.json({ error: 'no_repo', message: 'Map at least one repository to this project before running an analysis.' }, 409);
    }

    const effectivePlan = await resolveEffectivePlan(db, tenantId);

    // 1) Create the board Task (it owns the lifecycle the user sees) and move it
    //    into the In Progress lane.
    const created = await taskService.createTask(
      {
        projectId,
        title: 'Architecture Analysis',
        description: 'Repository architecture analysis — diagnostic, modernization recommendation, 4+1 views, anti-patterns and design principles. Result is written back as a PRD.',
      },
      tenantId,
    );
    const task = await taskService.updateTask(created.id, { status: TaskStatus.IN_PROGRESS });

    // 2) A runtime execution row tied to the task, so the board shows it running.
    const [execution] = await db
      .insert(executions)
      .values({
        taskId: task.id,
        tenantId,
        segmentId: segmentId ?? undefined,
        submittedBy: userId ?? 'system',
        status: 'running',
        startedAt: new Date(),
      })
      .returning({ id: executions.id });

    // 3) The analysis run row (mirrors status/progress for the DO) + kick the DO.
    const [run] = await db
      .insert(repoAnalysisRuns)
      .values({
        tenantId,
        segmentId: segmentId ?? undefined,
        projectId,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        effectivePlan,
        triggeredBy: userId ?? null,
      })
      .returning();
    if (!run) return c.json({ error: 'Failed to create analysis run' }, 500);

    const stub = c.env.ANALYSIS_RUNNER.get(c.env.ANALYSIS_RUNNER.idFromName(run.id));
    await stub.fetch('https://do/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.id,
        projectId,
        tenantId,
        segmentId: segmentId ?? null,
        effectivePlan,
        triggeredBy: userId ?? null,
        projectName: project.name,
        repoIds: repos.map((r) => r.id),
        taskId: task.id,
        executionId: execution?.id ?? null,
      }),
    });

    return c.json({ task: task.toPlain(), executionId: execution?.id ?? null, run }, 202);
  });

  return router;
}
