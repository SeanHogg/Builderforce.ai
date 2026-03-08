/**
 * Workflow routes – /api/workflows
 *
 * Workflows are structured execution records for orchestrated multi-step plans.
 *
 * P1-2: Workflow Execution Portal API
 *
 * POST   /api/workflows                  Register a workflow (push from claw or portal)
 * GET    /api/workflows                  List workflows (filterable by status, type, claw)
 * GET    /api/workflows/:id              Get workflow detail + tasks
 * PATCH  /api/workflows/:id              Update status / description
 * GET    /api/workflows/:id/tasks        List tasks for a workflow
 * POST   /api/workflows/:id/tasks        Add a task to a workflow
 * PATCH  /api/workflows/:id/tasks/:tid   Update individual task state
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { workflows, workflowTasks, coderclawInstances } from '../../infrastructure/database/schema';
import { verifySecret } from '../../infrastructure/auth/HashService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type WorkflowHonoEnv = HonoEnv;

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

export function createWorkflowRoutes(db: Db): Hono<WorkflowHonoEnv> {
  const router = new Hono<WorkflowHonoEnv>();

  // POST /api/workflows – register a workflow
  // Accepts claw API key (?clawId=&key=) or tenant JWT.
  router.post('/', async (c) => {
    let tenantId: number;
    let resolvedClawId: number | null = null;

    const clawIdParam = Number(c.req.query('clawId') ?? '');
    const apiKey = c.req.query('key');
    if (!Number.isNaN(clawIdParam) && clawIdParam > 0 && apiKey) {
      const claw = await verifyClawApiKey(db, clawIdParam, apiKey);
      if (!claw) return c.text('Unauthorized', 401);
      tenantId = claw.tenantId;
      resolvedClawId = claw.id;
    } else {
      await authMiddleware(c, async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    const body = await c.req.json<{
      id?:           string;
      clawId?:       number;
      specId?:       string;
      workflowType?: 'feature' | 'bugfix' | 'refactor' | 'planning' | 'adversarial' | 'custom';
      status?:       'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      description?:  string;
    }>();

    const effectiveClawId = resolvedClawId ?? body.clawId;
    if (!effectiveClawId) return c.json({ error: 'clawId is required' }, 400);

    const workflowId = body.id ?? crypto.randomUUID();
    const now = new Date();

    await db
      .insert(workflows)
      .values({
        id:           workflowId,
        tenantId,
        clawId:       effectiveClawId,
        specId:       body.specId ?? null,
        workflowType: body.workflowType ?? 'custom',
        status:       body.status ?? 'pending',
        description:  body.description ?? null,
        createdAt:    now,
        updatedAt:    now,
      })
      .onConflictDoUpdate({
        target: [workflows.id],
        set: {
          status:       body.status ?? 'pending',
          description:  body.description ?? null,
          updatedAt:    now,
          completedAt:  body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled' ? now : null,
        },
      });

    const [row] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    return c.json(row, 201);
  });

  // All remaining routes require tenant JWT
  router.use('*', authMiddleware);

  // GET /api/workflows?status=&workflowType=&clawId=
  router.get('/', async (c) => {
    const tenantId      = c.get('tenantId') as number;
    const statusFilter  = c.req.query('status');
    const typeFilter    = c.req.query('workflowType');
    const clawIdFilter  = c.req.query('clawId') ? Number(c.req.query('clawId')) : null;

    let rows = await db.select().from(workflows).where(eq(workflows.tenantId, tenantId));

    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (typeFilter)   rows = rows.filter((r) => r.workflowType === typeFilter);
    if (clawIdFilter != null) rows = rows.filter((r) => r.clawId === clawIdFilter);

    return c.json({ workflows: rows });
  });

  // GET /api/workflows/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [wf] = await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, tenantId)));
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    const tasks = await db.select().from(workflowTasks).where(eq(workflowTasks.workflowId, id));
    return c.json({ ...wf, tasks });
  });

  // PATCH /api/workflows/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const body = await c.req.json<{
      status?:      'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      description?: string;
    }>();

    const now = new Date();
    await db
      .update(workflows)
      .set({
        ...(body.status      !== undefined ? { status: body.status } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled'
          ? { completedAt: now }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(workflows.id, id), eq(workflows.tenantId, tenantId)));

    const [row] = await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Workflow not found' }, 404);
    return c.json(row);
  });

  // GET /api/workflows/:id/tasks
  router.get('/:id/tasks', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [wf] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, tenantId)));
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    const tasks = await db.select().from(workflowTasks).where(eq(workflowTasks.workflowId, id));
    return c.json({ tasks });
  });

  // POST /api/workflows/:id/tasks – add a task to a workflow
  router.post('/:id/tasks', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const workflowId = c.req.param('id');

    const [wf] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    const body = await c.req.json<{
      id?:         string;
      agentRole:   string;
      description: string;
      input?:      string;
      dependsOn?:  string[];
    }>();

    if (!body.agentRole || !body.description) {
      return c.json({ error: 'agentRole and description are required' }, 400);
    }

    const taskId = body.id ?? crypto.randomUUID();
    const now = new Date();

    await db.insert(workflowTasks).values({
      id:          taskId,
      workflowId,
      agentRole:   body.agentRole,
      description: body.description,
      input:       body.input ?? null,
      dependsOn:   body.dependsOn ? JSON.stringify(body.dependsOn) : null,
      createdAt:   now,
      updatedAt:   now,
    });

    const [row] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId));
    return c.json(row, 201);
  });

  // PATCH /api/workflows/:id/tasks/:tid – update individual task state
  router.patch('/:id/tasks/:tid', async (c) => {
    const tenantId   = c.get('tenantId') as number;
    const workflowId = c.req.param('id');
    const taskId     = c.req.param('tid');

    const [wf] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    const body = await c.req.json<{
      status?:      'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      output?:      string;
      error?:       string;
      startedAt?:   string;
      completedAt?: string;
    }>();

    const now = new Date();
    await db
      .update(workflowTasks)
      .set({
        ...(body.status      !== undefined ? { status: body.status } : {}),
        ...(body.output      !== undefined ? { output: body.output } : {}),
        ...(body.error       !== undefined ? { error: body.error } : {}),
        // Explicit timestamps from body take precedence; auto-set only when not provided
        ...(body.startedAt !== undefined
          ? { startedAt: new Date(body.startedAt) }
          : (body.status === 'running' ? { startedAt: now } : {})),
        ...(body.completedAt !== undefined
          ? { completedAt: new Date(body.completedAt) }
          : (body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled'
            ? { completedAt: now }
            : {})),
        updatedAt: now,
      })
      .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.workflowId, workflowId)));

    const [row] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.workflowId, workflowId)));
    if (!row) return c.json({ error: 'Task not found' }, 404);
    return c.json(row);
  });

  return router;
}
