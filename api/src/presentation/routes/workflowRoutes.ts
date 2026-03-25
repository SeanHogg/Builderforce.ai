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
import { workflows, workflowTasks, coderclawInstances, telemetrySpans } from '../../infrastructure/database/schema';
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

/** Resolve a claw from Bearer token + X-Claw-Id header (used by workflow-telemetry forwarding). */
async function verifyBearerClaw(db: Db, authHeader: string | undefined, clawIdHeader: string | undefined): Promise<{ id: number; tenantId: number } | null> {
  if (!authHeader?.startsWith('Bearer ') || !clawIdHeader) return null;
  const key = authHeader.slice(7);
  const id = Number(clawIdHeader);
  if (!Number.isFinite(id) || id <= 0) return null;
  return verifyClawApiKey(db, id, key);
}

export function createWorkflowRoutes(db: Db): Hono<WorkflowHonoEnv> {
  const router = new Hono<WorkflowHonoEnv>();

  // POST /api/workflows – register a workflow
  // Accepts Bearer token + X-Claw-Id header (preferred, used by workflow-telemetry),
  // claw API key (?clawId=&key=), or tenant JWT.
  router.post('/', async (c) => {
    let tenantId: number;
    let resolvedClawId: number | null = null;

    const bearerClaw = await verifyBearerClaw(db, c.req.header('Authorization'), c.req.header('X-Claw-Id'));
    if (bearerClaw) {
      tenantId = bearerClaw.tenantId;
      resolvedClawId = bearerClaw.id;
    } else {
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
      id?:          string;
      agentRole:    string;
      description:  string;
      input?:       string;
      dependsOn?:   string[];
      status?:      'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      startedAt?:   string;
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
      status:      body.status ?? 'pending',
      ...(body.startedAt !== undefined ? { startedAt: new Date(body.startedAt) } : {}),
      createdAt:   now,
      updatedAt:   now,
    });

    const [row] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId));
    return c.json(row, 201);
  });

  // GET /api/workflows/:id/graph – task dependency graph (P4-1)
  // Builds a DAG from telemetry spans stored by CoderClaw workflow-telemetry module.
  router.get('/:id/graph', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const workflowId = c.req.param('id');

    // Verify ownership
    const [wf] = await db
      .select({ id: workflows.id, status: workflows.status })
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    // Load all telemetry spans for this workflow
    const spans = await db
      .select()
      .from(telemetrySpans)
      .where(and(eq(telemetrySpans.tenantId, tenantId), eq(telemetrySpans.workflowId, workflowId)));

    // Group spans by taskId; build one node per task
    const taskMap = new Map<string, {
      id: string;
      description: string | null;
      agentRole: string | null;
      status: 'pending' | 'running' | 'completed' | 'failed';
      durationMs?: number;
      model?: string;
      estimatedCostUsd?: number;
      startedAt?: string;
      completedAt?: string;
      startTs?: Date;
      endTs?: Date;
    }>();

    for (const span of spans) {
      if (!span.taskId) continue;
      const existing = taskMap.get(span.taskId);

      // Determine status from span kind
      let statusFromSpan: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
      if (span.kind === 'task.start') statusFromSpan = 'running';
      else if (span.kind === 'task.end') statusFromSpan = 'completed';
      else if (span.kind === 'task.error') statusFromSpan = 'failed';

      const estimatedCostUsd = span.estimatedCostUsd != null
        ? span.estimatedCostUsd / 100_000
        : undefined;

      if (!existing) {
        taskMap.set(span.taskId, {
          id: span.taskId,
          description: span.description ?? null,
          agentRole: span.agentRole ?? null,
          status: statusFromSpan,
          durationMs: span.durationMs ?? undefined,
          model: span.model ?? undefined,
          estimatedCostUsd,
          startTs: span.kind === 'task.start' ? span.ts : undefined,
          endTs: (span.kind === 'task.end' || span.kind === 'task.error') ? span.ts : undefined,
        });
      } else {
        // Merge: later spans (task.end/error) override status
        if (statusFromSpan === 'completed' || statusFromSpan === 'failed') {
          existing.status = statusFromSpan;
        } else if (statusFromSpan === 'running' && existing.status === 'pending') {
          existing.status = statusFromSpan;
        }
        if (span.durationMs != null) existing.durationMs = span.durationMs;
        if (span.model) existing.model = span.model;
        if (estimatedCostUsd != null) {
          existing.estimatedCostUsd = (existing.estimatedCostUsd ?? 0) + estimatedCostUsd;
        }
        if (span.kind === 'task.start' && !existing.startTs) existing.startTs = span.ts;
        if ((span.kind === 'task.end' || span.kind === 'task.error') && !existing.endTs) existing.endTs = span.ts;
      }
    }

    // Also load workflow tasks from the tasks table for dependency edges
    const dbTasks = await db
      .select()
      .from(workflowTasks)
      .where(eq(workflowTasks.workflowId, workflowId));

    // Merge db task metadata into the span-derived nodes
    for (const t of dbTasks) {
      const existing = taskMap.get(t.id);
      if (existing) {
        if (!existing.description && t.description) existing.description = t.description;
        if (!existing.agentRole && t.agentRole) existing.agentRole = t.agentRole;
        // DB status takes precedence when set
        if (t.status) existing.status = t.status as 'pending' | 'running' | 'completed' | 'failed';
        if (t.startedAt && !existing.startTs) existing.startTs = t.startedAt;
        if (t.completedAt && !existing.endTs) existing.endTs = t.completedAt;
      } else {
        taskMap.set(t.id, {
          id: t.id,
          description: t.description,
          agentRole: t.agentRole,
          status: (t.status ?? 'pending') as 'pending' | 'running' | 'completed' | 'failed',
          startTs: t.startedAt ?? undefined,
          endTs: t.completedAt ?? undefined,
        });
      }
    }

    // Build nodes
    const nodes = Array.from(taskMap.values()).map((n) => ({
      id: n.id,
      label: (n.description ?? n.id).slice(0, 80),
      role: n.agentRole ?? 'unknown',
      status: n.status,
      durationMs: n.durationMs,
      model: n.model,
      estimatedCostUsd: n.estimatedCostUsd,
      startedAt: n.startTs?.toISOString(),
      completedAt: n.endTs?.toISOString(),
    }));

    // Build edges from dependency info in workflow_tasks
    const edges: Array<{ from: string; to: string }> = [];
    for (const t of dbTasks) {
      if (!t.dependsOn) continue;
      let deps: string[];
      try {
        deps = JSON.parse(t.dependsOn) as string[];
      } catch {
        continue;
      }
      for (const dep of deps) {
        if (typeof dep === 'string' && dep) {
          edges.push({ from: dep, to: t.id });
        }
      }
    }

    return c.json({
      workflowId,
      status: wf.status,
      nodes,
      edges,
    });
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
