import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ToolService } from '../../application/tools/ToolService';
import type { AuditRunner } from '../../application/tools/AuditRunner';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { listSystemAudits } from '../../application/tools/systemAudits';
import { maybeAutoRunOnLaneEntry } from './taskRoutes';

/**
 * Diagnostics & Tools routes.
 *
 * `GET /` (list), `GET /:id` (definition), and `POST /:id/compute` are PUBLIC —
 * the free, logged-out preview. Compute is pure math/scoring over user-supplied
 * input (no tenant data), so it is safe to run without an account. Saving a run
 * and listing history require auth + a leadership (manager+) role, matching the
 * "free to preview, account to save" model.
 *
 * Diagnostics can also be run AGAINST A PROJECT (pass `projectId`): those runs
 * are tracked into a per-project rating (`GET /projects/:projectId/score`) that
 * rolls up to the workspace (`GET /rollup`).
 */
export function createToolRoutes(
  toolService: ToolService,
  auditRunner: AuditRunner,
  db: Db,
  runtimeService: RuntimeService,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // Public definitions need no cache (static in-memory data, no DB round-trip).
  router.get('/', (c) => c.json({ tools: toolService.list() }));

  // ── System audits (SOC 2, Architecture, Quality, PM Vision) — the onboarding
  //    "run an audit → get a report" surface. Registered before `/:id` so the
  //    static `audits` segment wins over the `:id` param. ────────────────────

  // List the audit types (public — powers the onboarding wizard + marketing).
  router.get('/audits', (c) => c.json({ audits: listSystemAudits() }));

  // Run an audit against a project: scores a report (deterministic), records it
  // as a project diagnostic, notifies the user, and files the agent remediation
  // ticket (best-effort). Manager+.
  router.post('/audits/:auditId/run', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const auditId = c.req.param('auditId');
    const body = await c.req.json<{ projectId?: number }>().catch(() => ({} as { projectId?: number }));
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId)) return c.json({ error: 'projectId is required' }, 400);

    const secret = (c.env as Env).INTEGRATION_ENCRYPTION_SECRET ?? (c.env as Env).JWT_SECRET ?? '';
    const outcome = await auditRunner.runAudit(c.env as Env, sql(c.env), { tenantId, projectId, auditId, userId, secret });
    if (!outcome) return c.json({ error: 'Unknown audit' }, 404);

    // Fire the existing lane-autorun trigger for every remediation ticket filed
    // (one per gap when the audit is ticketPerFinding, else the single bundled
    // ticket). Kept alive past the response via waitUntil, exactly like taskRoutes.
    const remediationTasks = outcome.agentTasks ?? (outcome.agentTask ? [outcome.agentTask] : []);
    for (const task of remediationTasks) {
      c.executionCtx.waitUntil(
        maybeAutoRunOnLaneEntry(c.env as Env, db, runtimeService, {
          tenantId, projectId, taskId: task.taskId, status: task.status, submittedBy: userId,
        }).catch(() => false),
      );
    }
    return c.json(outcome, 201);
  });

  // ── Project / tenant rating — registered before `/:id` so the static segments
  //    win over the `:id` param. Read-only diagnostic SCORES (SOC 2 / Quality
  //    readiness, remediation status) are viewer-safe: every workspace member,
  //    not just managers, sees their project's diagnostics strip. (Running an
  //    audit + the raw finding tickets remain manager/role-gated elsewhere.) ────
  router.get('/rollup', authMiddleware, requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json(await toolService.getTenantRollup(c.env as Env, tenantId));
  });

  router.get('/projects/:projectId/score', authMiddleware, requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);
    return c.json(await toolService.getProjectScore(c.env as Env, tenantId, projectId));
  });

  router.get('/:id', (c) => {
    const def = toolService.getDefinition(c.req.param('id'));
    return def ? c.json({ tool: def }) : c.json({ error: 'Unknown tool' }, 404);
  });

  // Public free compute — no tenant data, pure scoring.
  router.post('/:id/compute', async (c) => {
    const body = await c.req.json<{ input?: Record<string, number> }>().catch(() => ({ input: {} }));
    const result = toolService.compute(c.req.param('id'), body.input ?? {});
    return result ? c.json({ result }) : c.json({ error: 'Unknown tool' }, 404);
  });

  // Data-driven ("from your data") result — telemetry-derived, manager+. Optional
  // `projectId` scopes it to one project.
  router.get('/:id/data-driven', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 90), 7), 365);
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const result = await toolService.getDataDriven(c.env as Env, tenantId, c.req.param('id'), days, projectId);
    return result ? c.json({ result, days }) : c.json({ error: 'No data-driven mode for this tool' }, 404);
  });

  // Save a run — recomputed server-side, persisted to the workspace (or project).
  router.post('/:id/save', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ input?: Record<string, number>; kind?: 'self' | 'data'; projectId?: number | null }>();
    const saved = await toolService.saveRun(c.env as Env, {
      tenantId,
      toolId: c.req.param('id'),
      kind: body.kind === 'data' ? 'data' : 'self',
      input: body.input ?? {},
      projectId: body.projectId ?? null,
      createdBy: userId,
    });
    return saved ? c.json({ run: saved }, 201) : c.json({ error: 'Unknown tool or no data available' }, 404);
  });

  router.get('/:id/runs', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const runs = await toolService.listRuns(c.env as Env, tenantId, c.req.param('id'), projectId);
    return c.json({ runs });
  });

  return router;
}
