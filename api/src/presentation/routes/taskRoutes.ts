import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { TaskService } from '../../application/task/TaskService';
import { TaskPriority, AgentType, TaskStatus } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { auditEvents, projects, specs, taskSpecs, tasks } from '../../infrastructure/database/schema';
import { AuditEventType } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { ensureTaskPrdRecord, linkSpecToTask } from '../../application/prd/taskPrd';

/** Minimal shape of the agentHost relay Durable Object namespace binding. */
type RelayNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
};

/**
 * On task → Done, tell the agent host that ran it to finalize the shared ticket
 * workspace: commit the accumulated changes, push the branch, and open a PR.
 * Best-effort + background — never blocks the PATCH. Only the assigned host holds
 * the workspace, so a finalize without one is a no-op.
 */
async function dispatchTaskFinalize(
  env: HonoEnv['Bindings'],
  db: Db,
  tenantId: number,
  taskId: number,
  agentHostId: number | null,
  title: string,
): Promise<void> {
  if (agentHostId == null) return;
  const relay = (env as unknown as { AGENT_HOST_RELAY?: RelayNamespace }).AGENT_HOST_RELAY;
  if (!relay) return;
  const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId).catch(() => null);
  try {
    const stub = relay.get(relay.idFromName(String(agentHostId)));
    await stub.fetch('https://relay.internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'task.finalize',
        taskId,
        title,
        repo: repoRef ? { repoId: repoRef.repoId, defaultBranch: repoRef.defaultBranch } : null,
      }),
    });
  } catch { /* host offline / relay miss — branch can be finalized manually */ }
}

export function createTaskRoutes(taskService: TaskService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/tasks?project_id=1
  router.get('/', async (c) => {
    const projectIdParam = c.req.query('project_id');
    const projectId = projectIdParam ? Number(projectIdParam) : undefined;
    const tasks = await taskService.listTasks(c.get('tenantId'), projectId);
    return c.json({ tasks: tasks.map(t => t.toPlain()) });
  });

  // GET /api/tasks/:id
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const task = await taskService.getTask(id);
    return c.json(task.toPlain());
  });

  // POST /api/tasks
  router.post('/', async (c) => {
    const body = await c.req.json<{
      projectId: number;
      title: string;
      description?: string | null;
      priority?: TaskPriority;
      assignedAgentType?: AgentType | null;
      assignedAgentHostId?: number | null;
      assignedAgentRef?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      persona?: string | null;
    }>();
    const task = await taskService.createTask(body, c.get('tenantId'));
    return c.json(task.toPlain(), 201);
  });

  // PATCH /api/tasks/:id
  router.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{
      title?: string;
      description?: string | null;
      status?: string;
      priority?: TaskPriority;
      assignedAgentType?: AgentType | null;
      assignedAgentHostId?: number | null;
      assignedAgentRef?: string | null;
      githubPrUrl?: string | null;
      githubPrNumber?: number | null;
      startDate?: string | null;
      dueDate?: string | null;
      persona?: string | null;
      archived?: boolean;
    }>();
    const task = await taskService.updateTask(id, body);

    // On transition to Done, finalize the ticket workspace → commit + PR.
    if (body.status === TaskStatus.DONE) {
      const plain = task.toPlain() as { assignedAgentHostId?: number | null; title?: string };
      c.executionCtx.waitUntil(
        dispatchTaskFinalize(c.env, db, c.get('tenantId'), id, plain.assignedAgentHostId ?? null, plain.title ?? ''),
      );
    }

    // record audit event for the status of this task change
    try {
      await db.insert(auditEvents).values({
        tenantId: c.get('tenantId'),
        userId:   (c as any).get('userId') ?? null,
        eventType: AuditEventType.TASK_UPDATED,
        resourceType: 'task',
        resourceId: String(id),
        metadata: JSON.stringify(body),
      });
    } catch {
      // ignore failures to avoid blocking the main flow
    }

    return c.json(task.toPlain());
  });

  // POST /api/tasks/:id/move — reassign a task to another project ("board").
  router.post('/:id/move', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ projectId: number }>();
    const task = await taskService.moveTask(id, body.projectId, c.get('tenantId'));

    try {
      await db.insert(auditEvents).values({
        tenantId: c.get('tenantId'),
        userId:   (c as any).get('userId') ?? null,
        eventType: AuditEventType.TASK_UPDATED,
        resourceType: 'task',
        resourceId: String(id),
        metadata: JSON.stringify({ movedToProjectId: body.projectId, key: task.key }),
      });
    } catch {
      // ignore failures to avoid blocking the main flow
    }

    return c.json(task.toPlain());
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    await taskService.deleteTask(id);
    return c.body(null, 204);
  });

  // ── Task ↔ PRD links (many-to-many via task_specs, 0098) ──────────────────
  //
  // A task references 1..N project PRDs, one optional primary (the canonical PRD
  // the executing agent reads/writes). Every query is tenant-scoped by joining
  // projects (tasks carry no tenant_id of their own).

  /** Verify the task belongs to the tenant; returns its row or null. */
  async function loadTenantTask(taskId: number, tenantId: number) {
    const [row] = await db
      .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, description: tasks.description })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)));
    return row ?? null;
  }

  // GET /api/tasks/:id/specs — list the PRDs linked to this task.
  router.get('/:id/specs', async (c) => {
    const taskId = Number(c.req.param('id'));
    const tenantId = c.get('tenantId');
    if (!(await loadTenantTask(taskId, tenantId))) return c.json({ error: 'Task not found' }, 404);
    const rows = await db
      .select({
        id: specs.id, goal: specs.goal, status: specs.status, prd: specs.prd,
        projectId: specs.projectId, isPrimary: taskSpecs.isPrimary,
        createdAt: specs.createdAt, updatedAt: specs.updatedAt,
      })
      .from(taskSpecs)
      .innerJoin(specs, eq(specs.id, taskSpecs.specId))
      .where(eq(taskSpecs.taskId, taskId))
      .orderBy(desc(taskSpecs.isPrimary), desc(specs.updatedAt));
    return c.json({ specs: rows });
  });

  // POST /api/tasks/:id/specs — attach an existing project PRD ({ specId, isPrimary? }).
  router.post('/:id/specs', async (c) => {
    const taskId = Number(c.req.param('id'));
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{ specId: string; isPrimary?: boolean }>();
    if (!(await loadTenantTask(taskId, tenantId))) return c.json({ error: 'Task not found' }, 404);
    const [spec] = await db.select({ id: specs.id }).from(specs).where(and(eq(specs.id, body.specId), eq(specs.tenantId, tenantId)));
    if (!spec) return c.json({ error: 'PRD not found' }, 404);
    await linkSpecToTask(db, { taskId, specId: body.specId, tenantId, isPrimary: body.isPrimary ?? false });
    return c.json({ ok: true }, 201);
  });

  // POST /api/tasks/:id/specs/generate — draft + attach a PRD for a PRD-less task.
  router.post('/:id/specs/generate', async (c) => {
    const taskId = Number(c.req.param('id'));
    const tenantId = c.get('tenantId');
    const task = await loadTenantTask(taskId, tenantId);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    const ensured = await ensureTaskPrdRecord(db, c.env, {
      taskId, tenantId, projectId: task.projectId,
      title: task.title, description: task.description ?? null,
      agentLabel: 'Product Manager',
    });
    if (!ensured) return c.json({ error: 'PRD generation failed' }, 502);
    return c.json({ specId: ensured.specId, prd: ensured.prd, status: ensured.status });
  });

  // POST /api/tasks/:id/specs/:specId/primary — mark a linked PRD as the primary.
  router.post('/:id/specs/:specId/primary', async (c) => {
    const taskId = Number(c.req.param('id'));
    const specId = c.req.param('specId');
    const tenantId = c.get('tenantId');
    if (!(await loadTenantTask(taskId, tenantId))) return c.json({ error: 'Task not found' }, 404);
    await linkSpecToTask(db, { taskId, specId, tenantId, isPrimary: true });
    return c.json({ ok: true });
  });

  // DELETE /api/tasks/:id/specs/:specId — detach a PRD from the task.
  router.delete('/:id/specs/:specId', async (c) => {
    const taskId = Number(c.req.param('id'));
    const specId = c.req.param('specId');
    const tenantId = c.get('tenantId');
    if (!(await loadTenantTask(taskId, tenantId))) return c.json({ error: 'Task not found' }, 404);
    await db.delete(taskSpecs).where(and(eq(taskSpecs.taskId, taskId), eq(taskSpecs.specId, specId)));
    return c.body(null, 204);
  });

  // POST /api/tasks/next
  // Atomically claim the next ready task in this tenant's workspace and
  // transition it to in_progress. Returns the task or null if none available.
  router.post('/next', async (c) => {
    const task = await taskService.dequeueNextReady(c.get('tenantId'));
    if (task) {
      // record that the task was claimed
      try {
        await db.insert(auditEvents).values({
          tenantId: c.get('tenantId'),
          userId: null,
          eventType: AuditEventType.TASK_UPDATED,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: JSON.stringify({ claimed: true, status: task.status }),
        });
      } catch {
        // ignore errors
      }
    }
    return c.json({ task: task ? task.toPlain() : null });
  });

  return router;
}
