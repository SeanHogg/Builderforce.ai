import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { TaskService } from '../../application/task/TaskService';
import { TaskPriority, AgentType, TaskStatus, TaskType } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { auditEvents, projects, specs, taskSpecs, tasks, tenantMembers, users } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { addDependency, deleteDependency, listProjectDependencies, isDepType } from '../../application/task/taskDependencies';
import { invalidateCompletedByAssignee } from './reportRoutes';
import { AuditEventType } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { openTaskPullRequest } from '../../application/repos/openTaskPullRequest';
import { ensureTaskPrdRecord, linkSpecToTask } from '../../application/prd/taskPrd';
import { recordStatusTransition } from '../../application/task/taskLifecycle';

/** Minimal shape of the agentHost relay Durable Object namespace binding. */
type RelayNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
};

/** The task fields the Done-transition finalize needs to pick host vs cloud path. */
type FinalizeTask = {
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
  gitBranch?: string | null;
  githubPrUrl?: string | null;
  title?: string | null;
};

/**
 * On task → Done, finalize the ticket: commit the accumulated changes, push the
 * branch, and open a PR. Best-effort + background — never blocks the PATCH.
 *
 * Two finalize surfaces, picked by who the task is assigned to:
 *  - Self-hosted host (`assignedAgentHostId`): the host holds the on-disk ticket
 *    workspace, so we relay it a `task.finalize` message and IT commits/pushes/PRs.
 *  - Cloud agent (`assignedAgentRef`): there is no on-disk workspace — the agent
 *    committed each `write_file` straight onto the ticket branch via the provider
 *    API during the run, so the branch is already pushed. We just open the PR
 *    server-side from that branch. Guarded on `gitBranch` (nothing committed → no
 *    PR) and a missing `githubPrUrl` (the inline run-end finalize may have already
 *    opened it — never double-open).
 * A task with neither assignee is a no-op.
 */
async function dispatchTaskFinalize(
  env: HonoEnv['Bindings'],
  db: Db,
  tenantId: number,
  taskId: number,
  task: FinalizeTask,
): Promise<void> {
  const title = task.title ?? '';

  if (task.assignedAgentHostId != null) {
    const relay = (env as unknown as { AGENT_HOST_RELAY?: RelayNamespace }).AGENT_HOST_RELAY;
    if (!relay) return;
    const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId).catch(() => null);
    try {
      const stub = relay.get(relay.idFromName(String(task.assignedAgentHostId)));
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
    return;
  }

  // Cloud agent: open the PR from the already-pushed ticket branch. Skip when the
  // agent never committed (no branch) or a PR already exists (inline finalize).
  if (task.assignedAgentRef && task.gitBranch && !task.githubPrUrl) {
    const e = env as unknown as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = e.INTEGRATION_ENCRYPTION_SECRET ?? e.JWT_SECRET ?? '';
    try {
      await openTaskPullRequest(db, secret, tenantId, taskId, { branch: task.gitBranch, title }, env);
    } catch { /* best-effort — PR can be opened manually from the pushed branch */ }
  }
}

export function createTaskRoutes(taskService: TaskService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Bump the project's epic-tree cache version so the next /:id/tree read reloads.
  // Any task write (create/update/decompose/move/delete) can reshape a tree, so
  // every mutation calls this. Best-effort — a stale tree self-heals on the KV TTL.
  const bumpTreeVersion = (env: Env, projectId: number | null | undefined): Promise<void> =>
    projectId == null
      ? Promise.resolve()
      : bumpCacheVersion(env, `task-tree-version:project:${projectId}`).catch(() => {});

  // Parse a positive-int ?project= param, else undefined.
  const parseProjectId = (raw: string | undefined): number | undefined => {
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  // GET /api/tasks?project_id=1
  router.get('/', async (c) => {
    const projectIdParam = c.req.query('project_id');
    const projectId = projectIdParam ? Number(projectIdParam) : undefined;
    const tasks = await taskService.listTasks(c.get('tenantId'), projectId);
    return c.json({ tasks: tasks.map(t => t.toPlain()) });
  });

  // GET /api/tasks/assignees — the team members (humans) a task can be assigned to.
  // Agents/cloud agents come from their own endpoints; this fills in the human side
  // so the assignee picker can offer "humans AND agents are one team". Registered
  // before `/:id` so the static path isn't captured as a task id.
  //
  // Cached read-through (tenant membership changes rarely). Invalidated on member
  // add/remove via invalidateTaskAssignees() in tenantRoutes.ts so a new teammate
  // appears immediately; the KV TTL (5 min) is just the backstop.
  router.get('/assignees', async (c) => {
    const tenantId = c.get('tenantId');
    const members = await getOrSetCached(
      c.env as Env,
      `task-assignees:tenant:${tenantId}`,
      async () => {
        const rows = await db
          .select({
            id: users.id,
            displayName: users.displayName,
            username: users.username,
            email: users.email,
          })
          .from(tenantMembers)
          .innerJoin(users, eq(users.id, tenantMembers.userId))
          .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));
        return rows.map((r) => ({
          id: r.id,
          name: r.displayName || r.username || r.email,
        }));
      },
    );
    return c.json({ members });
  });

  // ── Task dependency edges (DAG; migration 0121) ───────────────────────────
  // Static/two-segment dependency paths are registered before `/:id` so they are
  // not captured as a task id.

  // GET /api/tasks/dependencies?project=<id> — all precedence edges in a project.
  // Cached via a per-project version token (the edge keyspace is unbounded), bumped
  // on every add/delete below.
  router.get('/dependencies', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = parseProjectId(c.req.query('project'));
    if (projectId === undefined) return c.json({ error: 'project is required' }, 400);
    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
    if (!proj) return c.json({ error: 'project not found' }, 404);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, `task-deps-version:project:${projectId}`);
    const dependencies = await getOrSetCached(
      env,
      `task-deps:project:${projectId}:v:${ver}`,
      () => listProjectDependencies(db, projectId),
    );
    return c.json({ dependencies });
  });

  // DELETE /api/tasks/dependencies/:edgeId — remove one precedence edge.
  router.delete('/dependencies/:edgeId', async (c) => {
    const edgeId = Number(c.req.param('edgeId'));
    const row = await deleteDependency(db, c.get('tenantId'), edgeId);
    if (!row) return c.json({ error: 'not found' }, 404);
    await bumpCacheVersion(c.env as Env, `task-deps-version:project:${row.projectId}`).catch(() => {});
    return c.body(null, 204);
  });

  // GET /api/tasks/:id
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const task = await taskService.getTask(id);
    return c.json(task.toPlain());
  });

  // GET /api/tasks/:id/tree — an Epic and its direct child tasks (parent/child
  // tree for the board). Children carry their own assignees (the Epic is just the
  // planning container), so the board can render the breakdown under the Epic.
  router.get('/:id/tree', async (c) => {
    const id = Number(c.req.param('id'));
    const env = c.env as Env;
    // Cheap PK read of the project so the cache key/version resolve without
    // loading the whole tree on a hit; the full tree is built only on a miss.
    const [row] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!row) return c.json({ error: 'not found' }, 404);
    const ver = await getCacheVersion(env, `task-tree-version:project:${row.projectId}`);
    const payload = await getOrSetCached(
      env,
      `task-tree:project:${row.projectId}:epic:${id}:v:${ver}`,
      async () => {
        const { epic, children } = await taskService.getEpicTree(id);
        return { epic: epic.toPlain(), children: children.map((t) => t.toPlain()) };
      },
    );
    return c.json(payload);
  });

  // POST /api/tasks/:id/dependencies — add a precedence edge where `:id` is the
  // SUCCESSOR (it depends on / is blocked by `predecessorTaskId`). Rejects cycles
  // and cross-project edges at write time (see taskDependencies.addDependency).
  router.post('/:id/dependencies', async (c) => {
    const successorTaskId = Number(c.req.param('id'));
    const body = await c.req.json<{ predecessorTaskId?: number; depType?: string }>();
    const predecessorTaskId = Number(body.predecessorTaskId);
    if (!Number.isFinite(predecessorTaskId) || predecessorTaskId <= 0) {
      return c.json({ error: 'predecessorTaskId is required' }, 400);
    }
    if (body.depType !== undefined && !isDepType(body.depType)) {
      return c.json({ error: 'invalid depType' }, 400);
    }
    const result = await addDependency(db, c.get('tenantId'), successorTaskId, predecessorTaskId, body.depType);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    await bumpCacheVersion(c.env as Env, `task-deps-version:project:${result.edge.projectId}`).catch(() => {});
    return c.json(result.edge, 201);
  });

  // POST /api/tasks/:id/decompose — explicitly turn a task into an Epic and fan
  // its children out (the "Break into subtasks" board action). The on-assign hook
  // does this automatically when an agent is assigned; this is the manual trigger.
  router.post('/:id/decompose', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{
      children: Array<{
        title: string;
        description?: string | null;
        priority?: TaskPriority;
        assignedUserId?: string | null;
        assignedAgentHostId?: number | null;
        assignedAgentRef?: string | null;
      }>;
    }>();
    if (!Array.isArray(body.children) || body.children.length === 0) {
      return c.json({ error: 'children is required and must be non-empty' }, 400);
    }
    const epic = await taskService.decomposeEpic(id, body.children);
    const children = (await taskService.getEpicTree(id)).children;
    await bumpTreeVersion(c.env as Env, epic.toPlain().projectId);
    return c.json({ epic: epic.toPlain(), children: children.map(t => t.toPlain()) }, 201);
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
      assignedUserId?: string | null;
      taskType?: TaskType;
      parentTaskId?: number | null;
      startDate?: string | null;
      dueDate?: string | null;
      persona?: string | null;
    }>();
    const task = await taskService.createTask(body, c.get('tenantId'));
    await bumpTreeVersion(c.env as Env, task.toPlain().projectId);
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
      taskType?: TaskType;
      parentTaskId?: number | null;
      sprintId?: string | null;
      assignedAgentType?: AgentType | null;
      assignedAgentHostId?: number | null;
      assignedAgentRef?: string | null;
      assignedUserId?: string | null;
      githubPrUrl?: string | null;
      githubPrNumber?: number | null;
      startDate?: string | null;
      dueDate?: string | null;
      persona?: string | null;
      archived?: boolean;
    }>();
    // Capture the pre-update status so a status change can be recorded as a lane
    // transition (the metrics keystone, migration 0117). Cheap PK read; only when
    // the PATCH actually carries a status.
    const prevStatus = body.status !== undefined
      ? (await db.select({ status: tasks.status, projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, id)).limit(1))[0]
      : undefined;

    const task = await taskService.updateTask(id, body);
    // A PATCH can change parent/sprint/title/status — any of which reshapes a tree.
    await bumpTreeVersion(c.env as Env, task.toPlain().projectId);

    // Any status write can change which tasks fall in the completed-by-assignee
    // window (moved into OR out of a done-class lane), so bust that rollup's
    // per-tenant cache token. Best-effort — a stale rollup self-heals on the KV TTL.
    if (body.status !== undefined) {
      await invalidateCompletedByAssignee(c.env as Env, c.get('tenantId')).catch(() => {});
      // ROI time metrics (completed count, cycle time, throughput) move with status.
      await bumpCacheVersion(c.env as Env, `roi-version:tenant:${c.get('tenantId')}`).catch(() => {});
    }

    // Record the lane move + fold it into the task's lifecycle counters
    // (redo/reopen/completed_at). Best-effort, off the request path.
    if (prevStatus && body.status !== undefined && body.status !== prevStatus.status) {
      c.executionCtx.waitUntil(
        recordStatusTransition(c.env as Env, db, {
          tenantId:    c.get('tenantId'),
          projectId:   prevStatus.projectId,
          taskId:      id,
          fromStatus:  prevStatus.status,
          toStatus:    body.status,
          actorUserId: (c as any).get('userId') ?? null,
        }).catch(() => {}),
      );
    }

    // On transition to Done, finalize the ticket → commit + PR (host relay or
    // cloud server-side; see dispatchTaskFinalize).
    if (body.status === TaskStatus.DONE) {
      const plain = task.toPlain();
      c.executionCtx.waitUntil(
        dispatchTaskFinalize(c.env, db, c.get('tenantId'), id, {
          assignedAgentHostId: plain.assignedAgentHostId,
          assignedAgentRef: plain.assignedAgentRef,
          gitBranch: plain.gitBranch,
          githubPrUrl: plain.githubPrUrl,
          title: plain.title,
        }),
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
    // The task leaves one project's tree and joins another's — bump both.
    const [before] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, id)).limit(1);
    const task = await taskService.moveTask(id, body.projectId, c.get('tenantId'));
    await bumpTreeVersion(c.env as Env, before?.projectId);
    await bumpTreeVersion(c.env as Env, body.projectId);

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
    const [before] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, id)).limit(1);
    await taskService.deleteTask(id);
    await bumpTreeVersion(c.env as Env, before?.projectId);
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
      const plain = task.toPlain();
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
      // dequeue moved the ticket ready → in_progress without a PATCH; record the
      // lane transition so pickup-latency / cycle metrics see the claim.
      c.executionCtx.waitUntil(
        recordStatusTransition(c.env as Env, db, {
          tenantId: c.get('tenantId'),
          projectId: plain.projectId,
          taskId: plain.id,
          fromStatus: TaskStatus.READY,
          toStatus: TaskStatus.IN_PROGRESS,
          actorUserId: null,
        }).catch(() => {}),
      );
    }
    return c.json({ task: task ? task.toPlain() : null });
  });

  return router;
}
