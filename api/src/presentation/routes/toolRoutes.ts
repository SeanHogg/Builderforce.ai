import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { ToolService } from '../../application/tools/ToolService';

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
export function createToolRoutes(toolService: ToolService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Public definitions need no cache (static in-memory data, no DB round-trip).
  router.get('/', (c) => c.json({ tools: toolService.list() }));

  // ── Project / tenant rating (auth, manager+) — registered before `/:id` so the
  //    static segments win over the `:id` param. ──────────────────────────────
  router.get('/rollup', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json(await toolService.getTenantRollup(c.env as Env, tenantId));
  });

  router.get('/projects/:projectId/score', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
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
