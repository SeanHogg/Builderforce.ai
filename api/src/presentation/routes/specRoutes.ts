/**
 * Specs routes – /api/specs
 *
 * Specs are structured planning documents produced by the coderClaw /spec command.
 * They store PRD, architecture spec, and task list as structured fields.
 *
 * P1-1: Spec / Planning Storage API
 *
 * POST   /api/specs                    Create or upsert a spec (claw API key or tenant JWT)
 * GET    /api/specs                    List specs for tenant (tenant JWT)
 * GET    /api/specs/:id                Get spec detail (tenant JWT)
 * PATCH  /api/specs/:id                Update spec status/content (tenant JWT)
 * DELETE /api/specs/:id                Archive spec (tenant JWT)
 * GET    /api/specs/:id/workflows      List workflows linked to this spec (tenant JWT)
 * POST   /api/specs/:id/workflows      Link an existing workflow to a spec (tenant JWT)
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { specs, workflows, coderclawInstances } from '../../infrastructure/database/schema';
import { verifySecret } from '../../infrastructure/auth/HashService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type SpecsHonoEnv = HonoEnv;

async function verifyClawApiKey(db: Db, id: number, key?: string | null): Promise<{ id: number; tenantId: number } | null> {
  if (!key) return null;
  const [claw] = await db
    .select({ id: coderclawInstances.id, tenantId: coderclawInstances.tenantId, apiKeyHash: coderclawInstances.apiKeyHash })
    .from(coderclawInstances)
    .where(eq(coderclawInstances.id, id));
  if (!claw) return null;
  const valid = await verifySecret(key, claw.apiKeyHash);
  return valid ? claw : null;
}

export function createSpecRoutes(db: Db): Hono<SpecsHonoEnv> {
  const router = new Hono<SpecsHonoEnv>();

  // POST /api/specs – create/upsert a spec
  // Accepts either tenant JWT (from portal) or claw API key (?clawId=&key=).
  router.post('/', async (c) => {
    let tenantId: number;
    let clawId: number | null = null;

    // Try claw API key auth first (for automated pushes from the claw runtime)
    const clawIdParam = Number(c.req.query('clawId') ?? '');
    const apiKey = c.req.query('key');
    if (!Number.isNaN(clawIdParam) && clawIdParam > 0 && apiKey) {
      const claw = await verifyClawApiKey(db, clawIdParam, apiKey);
      if (!claw) return c.text('Unauthorized', 401);
      tenantId = claw.tenantId;
      clawId = claw.id;
    } else {
      // Fall back to tenant JWT
      await authMiddleware(c, async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    const body = await c.req.json<{
      id?:        string;
      projectId?: number;
      goal:       string;
      status?:    'draft' | 'reviewed' | 'approved' | 'in_progress' | 'done';
      prd?:       string;
      archSpec?:  string;
      taskList?:  unknown;
    }>();

    if (!body.goal?.trim()) return c.json({ error: 'goal is required' }, 400);

    const specId = body.id ?? crypto.randomUUID();
    const now = new Date();

    await db
      .insert(specs)
      .values({
        id:        specId,
        tenantId,
        projectId: body.projectId ?? null,
        clawId,
        goal:      body.goal.trim(),
        status:    body.status ?? 'draft',
        prd:       body.prd ?? null,
        archSpec:  body.archSpec ?? null,
        taskList:  body.taskList != null ? JSON.stringify(body.taskList) : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [specs.id],
        set: {
          goal:      body.goal.trim(),
          status:    body.status ?? 'draft',
          prd:       body.prd ?? null,
          archSpec:  body.archSpec ?? null,
          taskList:  body.taskList != null ? JSON.stringify(body.taskList) : null,
          updatedAt: now,
        },
      });

    const [row] = await db.select().from(specs).where(eq(specs.id, specId));
    return c.json(row, 201);
  });

  // All remaining routes require tenant JWT
  router.use('*', authMiddleware);

  // GET /api/specs?projectId=
  router.get('/', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;

    const rows = projectId != null
      ? await db.select().from(specs).where(and(eq(specs.tenantId, tenantId), eq(specs.projectId, projectId)))
      : await db.select().from(specs).where(eq(specs.tenantId, tenantId));

    return c.json({ specs: rows });
  });

  // GET /api/specs/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db.select().from(specs).where(and(eq(specs.id, id), eq(specs.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Spec not found' }, 404);
    return c.json(row);
  });

  // PATCH /api/specs/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const body = await c.req.json<{
      goal?:     string;
      status?:   'draft' | 'reviewed' | 'approved' | 'in_progress' | 'done';
      prd?:      string;
      archSpec?: string;
      taskList?: unknown;
    }>();

    await db
      .update(specs)
      .set({
        ...(body.goal     !== undefined ? { goal: body.goal.trim() } : {}),
        ...(body.status   !== undefined ? { status: body.status } : {}),
        ...(body.prd      !== undefined ? { prd: body.prd } : {}),
        ...(body.archSpec !== undefined ? { archSpec: body.archSpec } : {}),
        ...(body.taskList !== undefined ? { taskList: JSON.stringify(body.taskList) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(specs.id, id), eq(specs.tenantId, tenantId)));

    const [row] = await db.select().from(specs).where(and(eq(specs.id, id), eq(specs.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Spec not found' }, 404);
    return c.json(row);
  });

  // DELETE /api/specs/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await db.delete(specs).where(and(eq(specs.id, id), eq(specs.tenantId, tenantId)));
    return c.body(null, 204);
  });

  // GET /api/specs/:id/workflows
  router.get('/:id/workflows', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const specId = c.req.param('id');

    // Verify spec exists in tenant
    const [spec] = await db.select({ id: specs.id }).from(specs).where(and(eq(specs.id, specId), eq(specs.tenantId, tenantId)));
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const rows = await db.select().from(workflows).where(and(eq(workflows.specId, specId), eq(workflows.tenantId, tenantId)));
    return c.json({ workflows: rows });
  });

  // POST /api/specs/:id/workflows – link an existing workflow to a spec
  router.post('/:id/workflows', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const specId = c.req.param('id');

    const [spec] = await db.select({ id: specs.id }).from(specs).where(and(eq(specs.id, specId), eq(specs.tenantId, tenantId)));
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const body = await c.req.json<{ workflowId: string }>();
    if (!body.workflowId) return c.json({ error: 'workflowId is required' }, 400);

    await db
      .update(workflows)
      .set({ specId, updatedAt: new Date() })
      .where(and(eq(workflows.id, body.workflowId), eq(workflows.tenantId, tenantId)));

    return c.json({ ok: true });
  });

  return router;
}
