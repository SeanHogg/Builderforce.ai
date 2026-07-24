import { Hono, type Context } from 'hono';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { TaskService, type UpdateTaskDto } from '../../application/task/TaskService';
import { TaskPriority, AgentType, TaskStatus, TaskType } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { projects, specs, taskSpecs, tasks, tenantMembers, users } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { addDependency, deleteDependency, listProjectDependencies, isDepType } from '../../application/task/taskDependencies';
import { invalidateCompletedByAssignee } from './reportRoutes';
import { invalidateProjectsList } from './projectRoutes';
import { convertWorkItemType, ConvertError, type WorkItemKind } from '../../application/workitem/convertWorkItemType';
import type { Db } from '../../infrastructure/database/connection';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { openTaskPullRequest } from '../../application/repos/openTaskPullRequest';
import { ensureTaskPrdRecord, linkSpecToTask } from '../../application/prd/taskPrd';
import { recordStatusTransition } from '../../application/task/taskLifecycle';
import { recordActivity, resolveActorFromContext } from '../../application/activity/activityLog';
import { RuntimeService } from '../../application/runtime/RuntimeService';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import { recordCloudToolEvent } from '../../application/runtime/cloudAgentEngine';
import { evaluateTaskAutoRun, type AutoRunReason } from '../../application/swimlane/evaluateAutoRun';
import { maybeAutoRunOnLaneEntry } from '../../application/swimlane/laneEntryTrigger';
import { TicketParticipantsService } from '../../application/kanban/ticketParticipants';
import { SecurityTicketAccessService } from '../../application/security/SecurityTicketAccessService';
import { ChatTicketService } from '../../application/brain/ChatTicketService';
import { resolveTicketViewer } from '../../application/security/resolveTicketViewer';
import { executionTokenGate } from './executionTokenGate';
import { broadcastProjectChanged } from '../../infrastructure/relay/broadcastRoom';

/** Parse a swimlane assignment's `required_capabilities` (JSON array stored as
 *  text) into a clean string[]. Tolerates null / malformed / non-array values by
 *  returning [] (no requirement) so a bad row never blocks auto-run with a throw. */
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
/** Per-task linked-PRD counts via one grouped query [1266]. Best-effort: returns
 *  an empty map (not an error) where `task_specs` (migration 0098) isn't applied,
 *  so the board list never 500s on environments that haven't run it yet. */
async function countSpecsByTask(db: Db, taskIds: number[]): Promise<Map<number, number>> {
  if (taskIds.length === 0) return new Map();
  try {
    const rows = await db
      .select({ taskId: taskSpecs.taskId, n: count() })
      .from(taskSpecs)
      .where(inArray(taskSpecs.taskId, taskIds))
      .groupBy(taskSpecs.taskId);
    return new Map(rows.map((r) => [r.taskId, Number(r.n)]));
  } catch {
    return new Map();
  }
}

// Exported so the AI Manager (which advances review-complete tickets to Done under
// non-queue PR policy) opens the PR through the SAME finalize path the board does,
// rather than duplicating the commit/push/PR-open logic.
export async function dispatchTaskFinalize(
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
  // The duplicate-PR race (this human-drag vs. a concurrent inline run-end
  // finalize) is closed inside openTaskPullRequest by an atomic claim (0140); the
  // `!githubPrUrl` check below is just a cheap pre-filter, not the guard.
  if (task.assignedAgentRef && task.gitBranch && !task.githubPrUrl) {
    const e = env as unknown as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = e.INTEGRATION_ENCRYPTION_SECRET ?? e.JWT_SECRET ?? '';
    try {
      const res = await openTaskPullRequest(db, secret, tenantId, taskId, { branch: task.gitBranch, title }, env);
      // Uniform PR observability: emit a TASK-scoped `pr_opened` event (no live
      // execution on the Done-transition path) so a manually-completed cloud
      // ticket shows the same timeline event as an execution-finalized one. Keyed
      // to the agent ref so it surfaces in that agent's tool-audit timeline.
      if (res.ok) {
        await recordCloudToolEvent(db, {
          tenantId,
          cloudAgentRef: task.assignedAgentRef,
          executionId: null,
          sessionKey: `task:${taskId}`,
          toolName: 'pr_opened',
          category: 'tool',
          detail: { taskId, branch: task.gitBranch, source: 'done-finalize' },
          result: `opened PR #${res.number}${res.merged ? ' (auto-merged)' : ' — awaiting review'}`.slice(0, 300),
        });
      }
    } catch { /* best-effort — PR can be opened manually from the pushed branch */ }
  }
}

/**
 * The board autonomous trigger now lives in the APPLICATION layer
 * ({@link ../../application/swimlane/laneEntryTrigger}) so the non-HTTP writers
 * that land tickets in lanes (board-sync inbound, the QA finding router, the cron
 * sweeps, the MCP tools) can reach it without importing a route module. Re-exported
 * here verbatim so every existing import path (`presentation/routes/taskRoutes`)
 * keeps resolving; the routes below call the moved function.
 */
export { maybeAutoRunOnLaneEntry, onTaskLandedInLane } from '../../application/swimlane/laneEntryTrigger';

export function createTaskRoutes(taskService: TaskService, db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // The ONE place the board autonomous trigger is wired into the HTTP layer: a
  // ticket landing in a lane (created into it, or PATCHed into it by a board drag /
  // the brain / a raw API call) fires the SAME server-side trigger, kept alive past
  // the response via the request's `executionCtx`. Both the create and PATCH paths
  // funnel through here so neither can drift; the agent-advance path (a fourth
  // status-writer) reuses the same `maybeAutoRunOnLaneEntry` from the runtime layer.
  const fireLaneAutoRun = (c: Context<HonoEnv>, info: { projectId: number; taskId: number; status: string }): void => {
    c.executionCtx.waitUntil(
      maybeAutoRunOnLaneEntry(c.env as Env, db, runtimeService, {
        tenantId:    c.get('tenantId'),
        projectId:   info.projectId,
        taskId:      info.taskId,
        status:      info.status,
        submittedBy: (c as { get(k: 'userId'): string | undefined }).get('userId') ?? 'system:lane-auto',
      }),
    );
  };

  // Emit a ticket mutation onto the unified activity/audit stream, attributed to
  // whoever made the request (team member, external hire, or — for agent-token
  // paths — the system). Best-effort, off the response path (recordActivity never
  // throws). The ONE place ticket events reach the audit log, so create/update/
  // move/delete stay in lockstep.
  const emitTaskActivity = (
    c: Context<HonoEnv>,
    verb: string,
    o: { taskId: number; projectId?: number | null; title?: string | null; summary?: string | null; metadata?: Record<string, unknown> | null },
  ): void => {
    c.executionCtx.waitUntil((async () => {
      const actor = await resolveActorFromContext(c.env as Env, db, c);
      await recordActivity(c.env as Env, db, {
        tenantId:   c.get('tenantId'),
        segmentId:  (c as { get(k: 'segmentId'): string | undefined }).get('segmentId') ?? null,
        projectId:  o.projectId ?? null,
        actor,
        verb,
        targetType: 'task',
        targetId:   o.taskId,
        targetLabel: o.title ?? null,
        summary:    o.summary ?? null,
        metadata:   o.metadata ?? null,
      });
    })().catch(() => {}));
  };

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

  // GET /api/tasks?project_id=1&include_archived=true
  router.get('/', async (c) => {
    const projectIdParam = c.req.query('project_id');
    const projectId = projectIdParam ? Number(projectIdParam) : undefined;
    // Archived tasks are hidden by default (board/backlog/brain); opt in only
    // where the archive itself is the subject (e.g. the delete-project dialog).
    const includeArchived = c.req.query('include_archived') === 'true';
    const tasks = await taskService.listTasks(c.get('tenantId'), projectId, includeArchived);
    // Mask (don't drop) the access-restricted SECURITY tickets this viewer may not
    // see, via the one shared visibility gate — the item stays visible as a
    // "clearance needed" placeholder. No-op unless the list holds security tickets.
    const viewer = await resolveTicketViewer(c, db);
    const plain = await new SecurityTicketAccessService(db, c.env as Env)
      .applyVisibilityForViewer(c.get('tenantId'), viewer, tasks.map(t => t.toPlain() as unknown as Record<string, unknown>));
    // Augment each card with its linked-PRD count [1266] — one grouped query (no
    // N+1), and best-effort so it no-ops where task_specs (migration 0098) isn't
    // applied yet (the board still renders, just with no PRD dots).
    const ids = plain.map(t => Number(t.id)).filter(n => Number.isFinite(n));
    const specCounts = await countSpecsByTask(db, ids);
    return c.json({ tasks: plain.map(t => ({ ...t, specCount: specCounts.get(Number(t.id)) ?? 0 })) });
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
    if (!(await loadTenantTask(id, c.get('tenantId')))) return c.json({ error: 'Task not found' }, 404);
    const task = await taskService.getTask(id);
    const plain = task.toPlain() as unknown as Record<string, unknown>;
    // A SECURITY ticket the viewer isn't cleared for is returned MASKED (200) — its
    // existence is surfaced, its content redacted with `restricted: true`. Same shared
    // gate as the list.
    if (plain.taskType === TaskType.SECURITY) {
      const viewer = await resolveTicketViewer(c, db);
      const [masked] = await new SecurityTicketAccessService(db, c.env as Env)
        .applyVisibilityForViewer(c.get('tenantId'), viewer, [plain]);
      return c.json(masked ?? plain);
    }
    return c.json(plain);
  });

  // GET /api/tasks/:id/autorun-diagnostics — the board TRIAGE read: explains, for a
  // single ticket, whether the autonomous agent will run AND if not exactly why
  // (no agent, human gate, capability mismatch, already running, terminal/backlog
  // lane). Same evaluator the trigger uses, so the answer is authoritative. Not
  // cached — it reflects live execution status, which changes on every tick.
  router.get('/:id/autorun-diagnostics', async (c) => {
    const id = Number(c.req.param('id'));
    const row = await loadTenantTask(id, c.get('tenantId'));
    if (!row) return c.json({ error: 'Task not found' }, 404);
    const evaln = await evaluateTaskAutoRun(db, runtimeService, {
      tenantId:  c.get('tenantId'),
      projectId: row.projectId,
      taskId:    id,
      status:    row.status,
    });
    return c.json(evaln);
  });

  // POST /api/tasks/:id/run-now — manual TRIAGE trigger: dispatch the ticket's
  // owner / first-capable lane agent immediately, IGNORING the lane gate (an
  // explicit human click is itself the approval — so it works on a human-gated lane
  // too). 409 when a run is already live; 400 when no agent can run the ticket
  // (`reason` lets the UI explain what to fix). Reuses the one dispatcher.
  //
  // DEVELOPER+ — this starts a billable run, so it sits at the same dispatch tier as
  // every route in runtimeRoutes. It used to carry no role gate at all, which made
  // the UI's `runtime.execute` gate a UI-only lock a viewer could walk past by
  // calling the API directly.
  router.post('/:id/run-now', requireRole(TenantRole.DEVELOPER), async (c) => {
    const id = Number(c.req.param('id'));
    const row = await loadTenantTask(id, c.get('tenantId'));
    if (!row) return c.json({ error: 'Task not found' }, 404);
    const evaln = await evaluateTaskAutoRun(db, runtimeService, {
      tenantId:  c.get('tenantId'),
      projectId: row.projectId,
      taskId:    id,
      status:    row.status,
    });
    if (evaln.liveExecution) {
      return c.json({ error: 'A run is already in progress for this ticket.', reason: 'already_running' satisfies AutoRunReason, executionId: evaln.liveExecution.id }, 409);
    }
    // Token gate — no budget → no run. Shared adapter (same one submit-execution +
    // the board Run use), so the tenant-budget check and the superadmin bypass are
    // applied identically everywhere. Blocking here avoids creating a run that can't
    // make progress; the gateway would 429 the spend anyway.
    const tokenBlock = await executionTokenGate(c, db);
    if (tokenBlock) return tokenBlock;
    if (!evaln.candidate) {
      // Nothing to run as — surface the precise reason so the UI can prompt the fix
      // (assign an agent, staff the lane, or relax the capability requirement).
      const reason: AutoRunReason = evaln.reason === 'will_run' ? 'no_agent' : evaln.reason;
      return c.json({ error: 'No agent is configured to run this ticket. Assign a cloud agent (or staff this lane), then try again.', reason }, 400);
    }
    const payloadObj: { cloudAgentRef: string; model?: string; laneKey: string } = {
      cloudAgentRef: evaln.candidate.agentRef,
      laneKey:       row.status,
    };
    if (evaln.candidate.model) payloadObj.model = evaln.candidate.model;
    const executionId = await dispatchCloudRunForTask(
      c.env as Env, db, runtimeService, (p) => c.executionCtx.waitUntil(p),
      { taskId: id, tenantId: c.get('tenantId'), payload: JSON.stringify(payloadObj), submittedBy: (c as { get(k: 'userId'): string | undefined }).get('userId') ?? 'system:run-now' },
    );
    return c.json({ ok: true, executionId, agentRef: evaln.candidate.agentRef }, 202);
  });

  // GET /api/tasks/:id/tree — an Epic and its direct child tasks (parent/child
  // tree for the board). Children carry their own assignees (the Epic is just the
  // planning container), so the board can render the breakdown under the Epic.
  router.get('/:id/tree', async (c) => {
    const id = Number(c.req.param('id'));
    const env = c.env as Env;
    // Tenant-scoped PK read of the project so the cache key/version resolve without
    // loading the whole tree on a hit; the full tree is built only on a miss. The
    // join to projects.tenantId also prevents reading another tenant's Epic by id.
    const row = await loadTenantTask(id, c.get('tenantId'));
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
    if (!(await loadTenantTask(id, c.get('tenantId')))) return c.json({ error: 'Task not found' }, 404);
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
    // New child tasks change the project's task counts → bust the projects-list cache.
    await invalidateProjectsList(c.env as Env, c.get('tenantId')).catch(() => {});
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
    const created = task.toPlain();
    await bumpTreeVersion(c.env as Env, created.projectId);
    // A new task changes the project's task counts/dates → bust the projects-list cache.
    await invalidateProjectsList(c.env as Env, c.get('tenantId')).catch(() => {});
    // Push the new card to everyone watching this project's live board.
    c.executionCtx.waitUntil(broadcastProjectChanged(c.env?.SESSION_ROOM, c.get('tenantId'), created.projectId));

    // Autonomous trigger: a ticket CREATED straight into a lane with a configured
    // cloud agent (e.g. the brain drops a task into an agent-owned lane) must
    // auto-run just like one dragged in. Best-effort, off the response path.
    fireLaneAutoRun(c, { projectId: created.projectId, taskId: created.id, status: created.status });
    emitTaskActivity(c, 'task.created', {
      taskId: created.id, projectId: created.projectId, title: created.title,
      summary: `Created ${created.key ?? `#${created.id}`}`,
    });
    return c.json(created, 201);
  });

  // PATCH /api/tasks/:id
  router.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await loadTenantTask(id, c.get('tenantId')))) return c.json({ error: 'Task not found' }, 404);
    const body = await c.req.json<{
      title?: string;
      description?: string | null;
      status?: string;
      priority?: TaskPriority;
      taskType?: TaskType;
      parentTaskId?: number | null;
      sprintId?: string | null;
      releaseId?: string | null;
      storyPoints?: number | null;
      businessValue?: number | null;
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
    // A human setting business value on the board pins the source to 'manual' so the
    // AI Manager never overwrites the number (it only backfills unscored/AI tickets).
    if (body.businessValue !== undefined) {
      (body as UpdateTaskDto).businessValueSource = 'manual';
      if (body.businessValue !== null) {
        (body as UpdateTaskDto).businessValueRationale = 'Set by a team member.';
      }
    }
    // Capture the pre-update status + owner so a status change can be recorded as a
    // lane transition (the metrics keystone, migration 0117) AND an owner-agent
    // change can fire the autonomous trigger. Cheap PK read; only when the PATCH
    // carries a status and/or a reassignment.
    const prevStatus = (body.status !== undefined || body.assignedAgentRef !== undefined)
      ? (await db.select({ status: tasks.status, projectId: tasks.projectId, assignedAgentRef: tasks.assignedAgentRef }).from(tasks).where(eq(tasks.id, id)).limit(1))[0]
      : undefined;

    // Done gate (AC-2): on a lifecycle-managed board, block a move to a terminal lane
    // while any required participant is not completed-with-evidence — the board shows
    // the outstanding roles instead of letting an incomplete ticket reach Done.
    if (body.status !== undefined && prevStatus && body.status !== prevStatus.status) {
      const gate = await new TicketParticipantsService(db).doneGate(c.env as Env, c.get('tenantId') as number, id, body.status).catch(() => ({ blocked: false, outstanding: [] as string[] }));
      if (gate.blocked) {
        return c.json({ error: 'done_blocked', message: `Cannot move to Done — outstanding required roles: ${gate.outstanding.join(', ')}`, outstanding: gate.outstanding }, 409);
      }
    }

    const task = await taskService.updateTask(id, body);
    // A PATCH can change parent/sprint/title/status — any of which reshapes a tree.
    await bumpTreeVersion(c.env as Env, task.toPlain().projectId);
    // status/dueDate/startDate/archived all feed the projects-list aggregates → bust it.
    await invalidateProjectsList(c.env as Env, c.get('tenantId')).catch(() => {});
    // Live board: push the edit (status move, reassignment, field change) to every
    // client viewing this project so cards/lane chips update without a reload. The
    // auto-run queued below (lane entry) lands its own execution-lifecycle push, so
    // the freshly-assigned agent appears pending the moment its run row is created.
    c.executionCtx.waitUntil(broadcastProjectChanged(c.env?.SESSION_ROOM, c.get('tenantId'), task.toPlain().projectId));

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

      // Autonomous trigger: the ticket just ENTERED a new lane. If that lane has a
      // configured cloud agent (auto gate), start the run AS that agent. This is
      // the server-side source of truth — it fires no matter which client moved
      // the ticket (board drag, status dropdown, the brain, a raw API PATCH), so a
      // brain-created ticket moved to a To Do lane with an agent actually runs.
      fireLaneAutoRun(c, { projectId: prevStatus.projectId, taskId: id, status: body.status });
    }

    // Autonomous trigger on REASSIGNMENT: assigning a cloud agent as the ticket's
    // owner is itself a "go" — the owner agent should pick the ticket up in its
    // current (auto-gated) lane, even with no explicit swimlane staffing (see
    // withOwnerAgentFallback). Fire only when the owner ref actually CHANGED to a
    // non-null value AND the status did not also change in this PATCH (that path
    // already fired for the lane the ticket entered), so a single PATCH never
    // double-fires. The live-run idempotency guard makes a redundant fire a no-op.
    const statusChanged = !!prevStatus && body.status !== undefined && body.status !== prevStatus.status;
    const newAgentRef = typeof body.assignedAgentRef === 'string' ? body.assignedAgentRef.trim() : null;
    const agentReassigned = !!newAgentRef && !!prevStatus && newAgentRef !== (prevStatus.assignedAgentRef ?? null);
    if (!statusChanged && agentReassigned) {
      const plain = task.toPlain();
      fireLaneAutoRun(c, { projectId: plain.projectId, taskId: id, status: plain.status });
    }
    // Reassigning to a NEW cloud agent also brings it INTO the ticket's linked chats
    // (with a "starting work" notice) — independent of whether the lane/status changed —
    // so the conversation that spawned the ticket shows the agent picking it up. DRY with
    // the Brain MCP path (fireAgentAssignmentHandoff → ChatTicketService.onTicketAgentAssigned).
    if (agentReassigned && newAgentRef) {
      const plain = task.toPlain() as { taskType?: string };
      const kind = plain.taskType === 'epic' || plain.taskType === 'gap' ? plain.taskType : 'task';
      c.executionCtx.waitUntil(
        new ChatTicketService(db, c.env as Env)
          .onTicketAgentAssigned(c.get('tenantId'), kind, String(id), newAgentRef)
          .catch(() => {}),
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

    // Unified audit stream: classify the edit so the timeline reads meaningfully.
    const assignmentTouched = body.assignedUserId !== undefined || body.assignedAgentRef !== undefined || body.assignedAgentHostId !== undefined;
    const plainPatched = task.toPlain();
    const verb = statusChanged ? 'task.status_changed' : assignmentTouched ? 'task.assigned' : 'task.updated';
    emitTaskActivity(c, verb, {
      taskId: id,
      projectId: plainPatched.projectId,
      title: plainPatched.title,
      summary: statusChanged
        ? `Moved ${plainPatched.key ?? `#${id}`}: ${prevStatus?.status} → ${body.status}`
        : assignmentTouched
          ? `Reassigned ${plainPatched.key ?? `#${id}`}`
          : `Updated ${plainPatched.key ?? `#${id}`}`,
      metadata: statusChanged ? { fromStatus: prevStatus?.status, toStatus: body.status } : { fields: Object.keys(body) },
    });

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
    // The task count shifts between two projects → bust the projects-list cache.
    await invalidateProjectsList(c.env as Env, c.get('tenantId')).catch(() => {});
    // The card leaves one project's board and joins another's — push both.
    c.executionCtx.waitUntil(broadcastProjectChanged(c.env?.SESSION_ROOM, c.get('tenantId'), before?.projectId));
    c.executionCtx.waitUntil(broadcastProjectChanged(c.env?.SESSION_ROOM, c.get('tenantId'), body.projectId));

    emitTaskActivity(c, 'task.moved', {
      taskId: id, projectId: body.projectId, title: task.toPlain().title,
      summary: `Moved ${task.key ?? `#${id}`} to another project`,
      metadata: { fromProjectId: before?.projectId ?? null, toProjectId: body.projectId },
    });

    return c.json(task.toPlain());
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const before = await loadTenantTask(id, c.get('tenantId'));
    if (!before) return c.json({ error: 'Task not found' }, 404);
    await taskService.deleteTask(id);
    await bumpTreeVersion(c.env as Env, before?.projectId);
    // Deleting a task changes the project's task counts → bust the projects-list cache.
    await invalidateProjectsList(c.env as Env, c.get('tenantId')).catch(() => {});
    // Drop the card from every client viewing this project's live board.
    c.executionCtx.waitUntil(broadcastProjectChanged(c.env?.SESSION_ROOM, c.get('tenantId'), before?.projectId));
    emitTaskActivity(c, 'task.deleted', {
      taskId: id, projectId: before.projectId, title: before.title,
      summary: `Deleted task #${id}`,
    });
    return c.body(null, 204);
  });

  // POST /api/tasks/:id/convert-type — change a board item's type: task⇄epic, or
  // promote it to an OKR Objective (target='objective'). The reverse (objective →
  // board) lives on the pmo route since its id space is different. Shared logic in
  // convertWorkItemType so both callers + the MCP tool stay in lockstep.
  router.post('/:id/convert-type', async (c) => {
    const id = Number(c.req.param('id'));
    const before = await loadTenantTask(id, c.get('tenantId'));
    if (!before) return c.json({ error: 'Task not found' }, 404);
    const body = await c.req.json<{ target?: WorkItemKind }>();
    const target = body.target;
    if (target !== 'task' && target !== 'epic' && target !== 'objective') {
      return c.json({ error: 'target must be task|epic|objective' }, 400);
    }
    try {
      const result = await convertWorkItemType(
        { db, tasks: taskService, env: c.env as Env },
        { tenantId: c.get('tenantId'), segmentId: c.get('segmentId') as string, sourceKind: 'epic', sourceId: String(id), target },
      );
      c.executionCtx.waitUntil(broadcastProjectChanged(c.env?.SESSION_ROOM, c.get('tenantId'), before.projectId));
      return c.json(result);
    } catch (e) {
      if (e instanceof ConvertError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  // ── Task ↔ PRD links (many-to-many via task_specs, 0098) ──────────────────
  //
  // A task references 1..N project PRDs, one optional primary (the canonical PRD
  // the executing agent reads/writes). Every query is tenant-scoped by joining
  // projects (tasks carry no tenant_id of their own).

  /** Verify the task belongs to the tenant; returns its row or null. */
  async function loadTenantTask(taskId: number, tenantId: number) {
    const [row] = await db
      .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status, title: tasks.title, description: tasks.description })
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
      // record that the task was claimed (unified activity stream)
      emitTaskActivity(c, 'task.claimed', {
        taskId: plain.id, projectId: plain.projectId, title: plain.title,
        summary: `Claimed ${plain.key ?? `#${plain.id}`}`,
        metadata: { claimed: true, status: task.status },
      });
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
