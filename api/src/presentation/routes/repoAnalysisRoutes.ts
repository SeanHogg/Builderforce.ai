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
 * WHAT starting an analysis is lives in `application/repos/architectRunner.ts`,
 * because the RFP freshness gate starts the same run when a proposal's deep
 * artifacts have gone stale. Repairing one lives there for the same reason. This
 * file owns only the HTTP shape of it.
 *
 *   POST /projects/:projectId/architect     Create the Architect task + start the run (DEVELOPER+)
 *   GET  /projects/:projectId/latest-run    The project's last run + what a retry covers (VIEWER+)
 *   GET  /runs/:runId                       Poll one run's stage/progress          (VIEWER+)
 *   POST /runs/:runId/retry                 Re-queue that run's failed artifacts   (DEVELOPER+)
 *
 * None of the reads here are read-through cached, and deliberately so: both
 * return a live mirror of a Durable-Object state machine that advances on
 * `alarm()` ticks which never pass through this Worker, so there is no write on
 * this side to invalidate on and a cached copy would only ever show a stale
 * stage while the run moves underneath it.
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { repoAnalysisRuns } from '../../infrastructure/database/schema';
import { TaskService } from '../../application/task/TaskService';
import { TenantRole } from '../../domain/shared/types';
import {
  loadLatestArchitectRun,
  retryArchitectAnalysis,
  startArchitectAnalysis,
} from '../../application/repos/architectRunner';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createRepoAnalysisRoutes(db: Db, taskService: TaskService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);

  // ── POST /projects/:projectId/architect ────────────────────────────────────
  // Spin up an Architect Task on the project board and kick off the analysis run.
  router.post('/projects/:projectId/architect', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    const started = await startArchitectAnalysis(c.env as Env, db, taskService, {
      tenantId, projectId, segmentId: segmentId ?? null, userId: userId ?? null,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });

    if (!started.ok) {
      if (started.reason === 'not_enabled') return c.json({ error: 'Repo analysis is not enabled on this deployment.' }, 503);
      if (started.reason === 'project_not_found') return c.json({ error: 'Project not found' }, 404);
      if (started.reason === 'no_repo') {
        return c.json({ error: 'no_repo', message: 'Map at least one repository to this project before running an analysis.' }, 409);
      }
      return c.json({ error: 'Failed to create analysis run' }, 500);
    }

    return c.json({ taskId: started.taskId, executionId: started.executionId, runId: started.runId }, 202);
  });

  // ── GET /projects/:projectId/latest-run ────────────────────────────────────
  // The project's most recent run and, crucially, which artifacts a retry would
  // re-queue. This is what lets a surface offer "retry the failed sections"
  // instead of only ever offering a full — and far more expensive — re-run.
  // `{ run: null }` when the project has never been analysed.
  router.get('/projects/:projectId/latest-run', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    const run = await loadLatestArchitectRun(db, tenantId, projectId);
    return c.json({ run });
  });

  // ── GET /runs/:runId ───────────────────────────────────────────────────────
  // The run's own progress. Read by anything waiting on a deep analysis — the
  // project view and the RFP proposal whose roster is being re-grounded — so
  // neither has to reach into the runs table itself.
  router.get('/runs/:runId', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const runId = c.req.param('runId');
    const [row] = await db
      .select({
        id: repoAnalysisRuns.id,
        projectId: repoAnalysisRuns.projectId,
        status: repoAnalysisRuns.status,
        stage: repoAnalysisRuns.stage,
        progress: repoAnalysisRuns.progress,
        createdAt: repoAnalysisRuns.createdAt,
      })
      .from(repoAnalysisRuns)
      .where(and(eq(repoAnalysisRuns.id, runId), eq(repoAnalysisRuns.tenantId, tenantId)))
      .limit(1);
    if (!row) return c.json({ error: 'Run not found' }, 404);
    return c.json(row);
  });

  // ── POST /runs/:runId/retry ────────────────────────────────────────────────
  // Re-run the artifacts this run failed on (and the ones it withheld that the
  // tenant's plan now covers). Same run, same evidence — so it costs the LLM
  // calls for the broken sections only, and never a second crawl of the repos.
  //
  // 409 while the run is still moving: the state machine will write those rows
  // itself, and a second writer racing it is exactly what the (run_id, kind)
  // uniqueness is there to make unnecessary. 400 when there is nothing to redo.
  router.post('/runs/:runId/retry', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const runId = c.req.param('runId');

    const retried = await retryArchitectAnalysis(c.env as Env, db, {
      tenantId, runId, userId: userId ?? null,
    });

    if (!retried.ok) {
      if (retried.reason === 'not_enabled') return c.json({ error: 'Repo analysis is not enabled on this deployment.' }, 503);
      if (retried.reason === 'run_not_found') return c.json({ error: 'Run not found' }, 404);
      if (retried.reason === 'run_in_progress') {
        return c.json({ error: 'run_in_progress', message: 'This analysis is still running — wait for it to finish before retrying.' }, 409);
      }
      return c.json({ error: 'nothing_to_retry', message: 'Every section of this analysis is already generated, or the remaining ones need a plan upgrade.' }, 400);
    }

    return c.json({ runId: retried.runId, kinds: retried.kinds }, 202);
  });

  return router;
}
