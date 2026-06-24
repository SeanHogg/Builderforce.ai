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
 */
export function createToolRoutes(toolService: ToolService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Public definitions need no cache (static in-memory data, no DB round-trip).
  router.get('/', (c) => c.json({ tools: toolService.list() }));

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

  // Data-driven ("from your data") result — telemetry-derived, manager+.
  router.get('/:id/data-driven', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 90), 7), 365);
    const result = await toolService.getDataDriven(c.env as Env, tenantId, c.req.param('id'), days);
    return result ? c.json({ result, days }) : c.json({ error: 'No data-driven mode for this tool' }, 404);
  });

  // Save a run — recomputed server-side, persisted to the workspace.
  router.post('/:id/save', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ input?: Record<string, number>; kind?: 'self' | 'data' }>();
    const saved = await toolService.saveRun(c.env as Env, {
      tenantId, toolId: c.req.param('id'), kind: body.kind === 'data' ? 'data' : 'self', input: body.input ?? {}, createdBy: userId,
    });
    return saved ? c.json({ run: saved }, 201) : c.json({ error: 'Unknown tool or no data available' }, 404);
  });

  router.get('/:id/runs', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const runs = await toolService.listRuns(c.env as Env, tenantId, c.req.param('id'));
    return c.json({ runs });
  });

  return router;
}
