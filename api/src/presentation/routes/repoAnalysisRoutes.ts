/**
 * Repo-analysis routes — /api/repo-analysis
 *
 * The Architect / Digital-Transformation tool. A signed-in user with a project
 * that has at least one mapped repo runs an analysis; the work executes
 * cloud-side in AnalysisRunnerDO (one stage per alarm() tick) and the frontend
 * polls the run for status + artifacts.
 *
 *   POST /projects/:projectId/runs          Kick off an analysis (DEVELOPER+)
 *   GET  /projects/:projectId/runs          Run history for a project
 *   GET  /runs/:id                          Run status + artifacts + evidence (poll)
 *   GET  /runs/:id/artifacts/:kind          One artifact (full body + structured data)
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  projects,
  repoAnalysisArtifacts,
  repoAnalysisEvidence,
  repoAnalysisRuns,
  tenants,
} from '../../infrastructure/database/schema';
import { RepoService } from '../../application/repos/RepoService';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const ARTIFACT_KINDS = ['diagnostic', 'recommendation', 'business', 'arch_4plus1', 'antipatterns', 'principles'];

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

export function createRepoAnalysisRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const repoService = new RepoService(db, async () => false); // listRepos only; no PR dispatch here

  router.use('*', authMiddleware);

  // ── POST /projects/:projectId/runs ─────────────────────────────────────────
  router.post('/projects/:projectId/runs', requireRole(TenantRole.DEVELOPER), async (c) => {
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

    const repos = await repoService.listRepos(projectId, tenantId);
    if (repos.length === 0) {
      return c.json({ error: 'no_repo', message: 'Map at least one repository to this project before running an analysis.' }, 409);
    }

    const effectivePlan = await resolveEffectivePlan(db, tenantId);

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

    // Kick the Durable Object: it writes its cursor and arms the first alarm.
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
      }),
    });

    return c.json({ run }, 202);
  });

  // ── GET /projects/:projectId/runs ──────────────────────────────────────────
  router.get('/projects/:projectId/runs', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const runs = await db
      .select()
      .from(repoAnalysisRuns)
      .where(and(eq(repoAnalysisRuns.projectId, projectId), eq(repoAnalysisRuns.tenantId, tenantId)))
      .orderBy(desc(repoAnalysisRuns.createdAt))
      .limit(limit);
    return c.json({ runs, total: runs.length });
  });

  // ── GET /runs/:id ──────────────────────────────────────────────────────────
  router.get('/runs/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [run] = await db
      .select()
      .from(repoAnalysisRuns)
      .where(and(eq(repoAnalysisRuns.id, id), eq(repoAnalysisRuns.tenantId, tenantId)));
    if (!run) return c.json({ error: 'Run not found' }, 404);

    const artifacts = await db
      .select({
        id: repoAnalysisArtifacts.id,
        kind: repoAnalysisArtifacts.kind,
        title: repoAnalysisArtifacts.title,
        status: repoAnalysisArtifacts.status,
        model: repoAnalysisArtifacts.model,
        tokens: repoAnalysisArtifacts.tokens,
        updatedAt: repoAnalysisArtifacts.updatedAt,
      })
      .from(repoAnalysisArtifacts)
      .where(eq(repoAnalysisArtifacts.runId, id));

    const evidence = await db
      .select({
        id: repoAnalysisEvidence.id,
        repoId: repoAnalysisEvidence.repoId,
        provider: repoAnalysisEvidence.provider,
        defaultBranch: repoAnalysisEvidence.defaultBranch,
        status: repoAnalysisEvidence.status,
        tokenEstimate: repoAnalysisEvidence.tokenEstimate,
      })
      .from(repoAnalysisEvidence)
      .where(eq(repoAnalysisEvidence.runId, id));

    // Keep the artifact list in canonical order for the tabbed viewer.
    artifacts.sort((a, b) => ARTIFACT_KINDS.indexOf(a.kind) - ARTIFACT_KINDS.indexOf(b.kind));
    return c.json({ run, artifacts, evidence });
  });

  // ── GET /runs/:id/artifacts/:kind ──────────────────────────────────────────
  router.get('/runs/:id/artifacts/:kind', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const kind = c.req.param('kind');
    const [run] = await db
      .select({ id: repoAnalysisRuns.id })
      .from(repoAnalysisRuns)
      .where(and(eq(repoAnalysisRuns.id, id), eq(repoAnalysisRuns.tenantId, tenantId)));
    if (!run) return c.json({ error: 'Run not found' }, 404);

    const [artifact] = await db
      .select()
      .from(repoAnalysisArtifacts)
      .where(and(eq(repoAnalysisArtifacts.runId, id), eq(repoAnalysisArtifacts.kind, kind)));
    if (!artifact) return c.json({ error: 'Artifact not found' }, 404);
    return c.json({ artifact });
  });

  return router;
}
