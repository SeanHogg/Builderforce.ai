/**
 * Workflow routes – /api/workflows
 *
 * Workflows are structured execution records for orchestrated multi-step plans.
 *
 * P1-2: Workflow Execution Portal API
 *
 * POST   /api/workflows                  Register a workflow (push from agentHost or portal)
 * GET    /api/workflows                  List workflows (filterable by status, type, agentHost)
 * GET    /api/workflows/:id              Get workflow detail + tasks
 * PATCH  /api/workflows/:id              Update status / description
 * GET    /api/workflows/:id/tasks        List tasks for a workflow
 * POST   /api/workflows/:id/tasks        Add a task to a workflow
 * PATCH  /api/workflows/:id/tasks/:tid   Update individual task state
 */
import { Hono } from 'hono';
import { eq, and, asc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { workflows, workflowTasks, telemetrySpans, projects, agentHosts } from '../../infrastructure/database/schema';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';
import {
  resolveHostAuth,
  verifyAgentHostApiKey,
  verifyBearerAgentHost,
} from '../../infrastructure/auth/agentHostAuth';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type WorkflowHonoEnv = HonoEnv;

export function createWorkflowRoutes(db: Db): Hono<WorkflowHonoEnv> {
  const router = new Hono<WorkflowHonoEnv>();

  // POST /api/workflows – register a workflow
  // Accepts Bearer token + X-AgentHost-Id header (preferred, used by workflow-telemetry),
  // agentHost API key (?agentHostId=&key=), or tenant JWT.
  router.post('/', async (c) => {
    let tenantId: number;
    let resolvedAgentHostId: number | null = null;

    const bearerAgentHost = await verifyBearerAgentHost(db, c.req.header('Authorization'), c.req.header('X-AgentHost-Id'));
    if (bearerAgentHost) {
      tenantId = bearerAgentHost.tenantId;
      resolvedAgentHostId = bearerAgentHost.id;
    } else {
      const agentHostIdParam = Number(c.req.query('agentHostId') ?? '');
      const apiKey = c.req.query('key');
      if (!Number.isNaN(agentHostIdParam) && agentHostIdParam > 0 && apiKey) {
        const agentHost = await verifyAgentHostApiKey(db, agentHostIdParam, apiKey);
        if (!agentHost) return c.text('Unauthorized', 401);
        tenantId = agentHost.tenantId;
        resolvedAgentHostId = agentHost.id;
      } else {
        await authMiddleware(c, async () => {});
        const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
        if (!tid) return c.text('Unauthorized', 401);
        tenantId = tid as number;
      }
    }

    const body = await c.req.json<{
      id?:           string;
      agentHostId?:       number;
      projectId?:    number | null;
      specId?:       string;
      workflowType?: 'feature' | 'bugfix' | 'refactor' | 'planning' | 'adversarial' | 'custom';
      status?:       'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      description?:  string;
    }>();

    const effectiveAgentHostId = resolvedAgentHostId ?? body.agentHostId;
    if (!effectiveAgentHostId) return c.json({ error: 'agentHostId is required' }, 400);

    const workflowId = body.id ?? crypto.randomUUID();
    const now = new Date();

    // Cross-tenant upsert guard: the caller supplies body.id and the conflict target
    // is the global workflows.id PK, so without this check a caller could overwrite
    // another tenant's workflow by guessing its id. Only reject on an id that already
    // exists under a different tenant; a novel id creates a fresh row as normal.
    if (body.id) {
      const [existing] = await db.select({ tenantId: workflows.tenantId }).from(workflows).where(eq(workflows.id, workflowId));
      if (existing && existing.tenantId !== tenantId) return c.json({ error: 'Workflow not found' }, 404);
    }

    await db
      .insert(workflows)
      .values({
        id:           workflowId,
        tenantId,
        agentHostId:       effectiveAgentHostId,
        projectId:    body.projectId ?? null,
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
          ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
          updatedAt:    now,
          completedAt:  body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled' ? now : null,
        },
      });

    const [row] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    return c.json(row, 201);
  });

  // ── AgentHost execution loop (host-authed; registered before the tenant JWT
  //    middleware so a agentHost can claim + report portal-authored workflows) ──

  // POST /api/workflows/claim — a agentHost claims the oldest pending workflow
  // assigned to it (created by the workflow-definition run endpoint), flipping it
  // to running and returning its compiled tasks so the host's orchestrator can
  // execute them (LLM-logic nodes natively, agent nodes via its runtimes).
  router.post('/claim', async (c) => {
    const host = await resolveHostAuth(db, c);
    if (!host) return c.text('Unauthorized', 401);

    const [next] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.agentHostId, host.id), eq(workflows.status, 'pending')))
      .orderBy(asc(workflows.createdAt))
      .limit(1);
    if (!next) return c.json({ workflow: null });

    // Race guard: only claim if still pending.
    const [claimed] = await db
      .update(workflows)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(eq(workflows.id, next.id), eq(workflows.status, 'pending')))
      .returning();
    if (!claimed) return c.json({ workflow: null });

    const tasks = await db.select().from(workflowTasks).where(eq(workflowTasks.workflowId, next.id));
    return c.json({ workflow: claimed, tasks });
  });

  // POST /api/workflows/:id/host-result — a agentHost reports terminal task
  // results + the final workflow status after executing a claimed workflow.
  router.post('/:id/host-result', async (c) => {
    const host = await resolveHostAuth(db, c);
    if (!host) return c.text('Unauthorized', 401);
    const id = c.req.param('id');

    const [wf] = await db
      .select({ id: workflows.id, agentHostId: workflows.agentHostId })
      .from(workflows)
      .where(eq(workflows.id, id));
    if (!wf || wf.agentHostId !== host.id) return c.json({ error: 'Workflow not found' }, 404);

    const body = await c.req.json<{
      tasks?: Array<{ id: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; output?: string; error?: string }>;
      status?: 'running' | 'completed' | 'failed' | 'cancelled';
    }>();
    const now = new Date();
    const isTerminal = (s: string) => s === 'completed' || s === 'failed' || s === 'cancelled';

    for (const t of body.tasks ?? []) {
      await db
        .update(workflowTasks)
        .set({
          status: t.status,
          ...(t.output !== undefined ? { output: t.output } : {}),
          ...(t.error !== undefined ? { error: t.error } : {}),
          ...(t.status === 'running' ? { startedAt: now } : {}),
          ...(isTerminal(t.status) ? { completedAt: now } : {}),
          updatedAt: now,
        })
        .where(and(eq(workflowTasks.id, t.id), eq(workflowTasks.workflowId, id)));
    }

    if (body.status) {
      await db
        .update(workflows)
        .set({ status: body.status, ...(isTerminal(body.status) ? { completedAt: now } : {}), updatedAt: now })
        .where(eq(workflows.id, id));
    }

    return c.json({ ok: true });
  });

  // All remaining routes require tenant JWT
  router.use('*', authMiddleware);

  // GET /api/workflows?status=&workflowType=&agentHostId=&projectId=
  // Rows are enriched with projectName + agentHostName so the Workflows cards can
  // show the associated project/agent without an N+1 follow-up per workflow.
  router.get('/', async (c) => {
    const tenantId      = c.get('tenantId') as number;
    const statusFilter  = c.req.query('status');
    const typeFilter    = c.req.query('workflowType');
    const agentHostIdFilter  = c.req.query('agentHostId') ? Number(c.req.query('agentHostId')) : null;
    const projectIdFilter    = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;

    let rows = await db
      .select({
        id:           workflows.id,
        agentHostId:  workflows.agentHostId,
        projectId:    workflows.projectId,
        specId:       workflows.specId,
        workflowType: workflows.workflowType,
        status:       workflows.status,
        description:  workflows.description,
        createdAt:    workflows.createdAt,
        completedAt:  workflows.completedAt,
        updatedAt:    workflows.updatedAt,
        projectName:  projects.name,
        agentHostName: agentHosts.name,
      })
      .from(workflows)
      .leftJoin(projects, eq(workflows.projectId, projects.id))
      .leftJoin(agentHosts, eq(workflows.agentHostId, agentHosts.id))
      .where(eq(workflows.tenantId, tenantId));

    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (typeFilter)   rows = rows.filter((r) => r.workflowType === typeFilter);
    if (agentHostIdFilter != null) rows = rows.filter((r) => r.agentHostId === agentHostIdFilter);
    if (projectIdFilter != null) rows = rows.filter((r) => r.projectId === projectIdFilter);

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
      projectId?:   number | null;
    }>();

    const now = new Date();
    await db
      .update(workflows)
      .set({
        ...(body.status      !== undefined ? { status: body.status } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.projectId   !== undefined ? { projectId: body.projectId } : {}),
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
  // Builds a DAG from telemetry spans stored by BuilderForce Agents workflow-telemetry module.
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
        ? span.estimatedCostUsd / MILLICENTS_PER_USD
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
