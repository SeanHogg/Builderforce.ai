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
 * artifacts have gone stale. This file owns only the HTTP shape of it.
 *
 *   POST /projects/:projectId/architect     Create the Architect task + start the run (DEVELOPER+)
 *   GET  /runs/:runId                       Poll one run's stage/progress          (VIEWER+)
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { repoAnalysisRuns } from '../../infrastructure/database/schema';
import { TaskService } from '../../application/task/TaskService';
import { TenantRole } from '../../domain/shared/types';
import { startArchitectAnalysis } from '../../application/repos/architectRunner';
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

  return router;
}
