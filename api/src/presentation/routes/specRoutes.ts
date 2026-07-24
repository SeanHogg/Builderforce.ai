/**
 * Specs routes – /api/specs
 *
 * Specs are structured planning documents produced by the BuilderForce Agents /spec command.
 * They store PRD, architecture spec, and task list as structured fields.
 *
 * P1-1: Spec / Planning Storage API
 *
 * POST   /api/specs                    Create or upsert a spec (agentHost API key or tenant JWT)
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
import { specs, workflows, projects, tasks } from '../../infrastructure/database/schema';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import { linkSpecToTask } from '../../application/prd/taskPrd';
import { bumpTicketSearchVersion } from '../../infrastructure/cache/readThroughCache';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type SpecsHonoEnv = HonoEnv;

export function createSpecRoutes(db: Db): Hono<SpecsHonoEnv> {
  const router = new Hono<SpecsHonoEnv>();

  // POST /api/specs – create/upsert a spec
  // Accepts either tenant JWT (from portal) or agentHost API key (?agentHostId=&key=).
  router.post('/', async (c) => {
    let tenantId: number;
    let agentHostId: number | null = null;

    // Try agentHost API key auth first (for automated pushes from the agentHost runtime)
    const agentHostIdParam = Number(c.req.query('agentHostId') ?? '');
    const apiKey = c.req.query('key');
    if (!Number.isNaN(agentHostIdParam) && agentHostIdParam > 0 && apiKey) {
      const agentHost = await verifyAgentHostApiKey(db, agentHostIdParam, apiKey);
      if (!agentHost) return c.text('Unauthorized', 401);
      tenantId = agentHost.tenantId;
      agentHostId = agentHost.id;
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
      status?:    'draft' | 'ready' | 'in_progress' | 'complete';
      kind?:      string;
      prd?:       string;
      archSpec?:  string;
      taskList?:  unknown;
      /** When present, link this spec to the task as its primary PRD (agent write-back). */
      taskId?:    number;
    }>();

    if (!body.goal?.trim()) return c.json({ error: 'goal is required' }, 400);

    const specId = body.id ?? crypto.randomUUID();
    const now = new Date();

    // Cross-tenant upsert guard: the caller supplies body.id and the conflict target
    // is the global specs.id PK, so without this check a caller could overwrite
    // another tenant's spec by guessing its id. Only reject on an id that already
    // exists under a different tenant; a novel id creates a fresh row as normal.
    if (body.id) {
      const [existing] = await db.select({ tenantId: specs.tenantId }).from(specs).where(eq(specs.id, specId));
      if (existing && existing.tenantId !== tenantId) return c.json({ error: 'Spec not found' }, 404);
    }

    await db
      .insert(specs)
      .values({
        id:        specId,
        tenantId,
        projectId: body.projectId ?? null,
        agentHostId,
        goal:      body.goal.trim(),
        status:    body.status ?? 'draft',
        kind:      body.kind ?? 'feature',
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
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          prd:       body.prd ?? null,
          archSpec:  body.archSpec ?? null,
          taskList:  body.taskList != null ? JSON.stringify(body.taskList) : null,
          updatedAt: now,
        },
      });

    // Agent write-back: link the pushed spec to its task as the primary PRD, so
    // "agents update the task's PRD as they work" lands on the task's linked spec.
    if (body.taskId != null) {
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.id, body.taskId), eq(projects.tenantId, tenantId)));
      if (task) await linkSpecToTask(db, { taskId: body.taskId, specId, tenantId, isPrimary: true });
    }

    // A spec is a link-picker ticket kind — orphan the chat↔ticket typeahead cache.
    await bumpTicketSearchVersion(c.env as Env, tenantId);

    const [row] = await db.select().from(specs).where(eq(specs.id, specId));
    return c.json(row, 201);
  });

  // All remaining routes require tenant JWT
  router.use('*', authMiddleware);

  // GET /api/specs?projectId=
  router.get('/', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const kind      = c.req.query('kind') || null;

    const filters = [eq(specs.tenantId, tenantId)];
    if (projectId != null) filters.push(eq(specs.projectId, projectId));
    if (kind != null) filters.push(eq(specs.kind, kind));
    const rows = await db.select().from(specs).where(and(...filters));

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
      status?:   'draft' | 'ready' | 'in_progress' | 'complete';
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
