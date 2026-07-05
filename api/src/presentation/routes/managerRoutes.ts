/**
 * Manager routes — /api/manager
 *
 * The human-facing surface for the AI Manager. A human manager sees + drives the
 * SAME concepts the AI manager acts on: the effective policy + designation, the
 * priority-ranked backlog, the coordination stats, the decision activity feed, and
 * a "run the manager now" button. Every read is tenant-scoped to the project.
 *
 *   GET  /api/manager/:projectId           config + policy + stats + ranked backlog
 *   PUT  /api/manager/:projectId           designate a manager + tune policy (MANAGER)
 *   POST /api/manager/:projectId/run        run the manager pass now (MANAGER)
 *   GET  /api/manager/:projectId/activity   the decision audit feed
 */
import { Hono } from 'hono';
import { and, eq, sql, asc, desc, inArray } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole, TaskStatus } from '../../domain/shared/types';
import { projects, tasks, pullRequests } from '../../infrastructure/database/schema';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import {
  getManagerConfigRow, getEffectiveManagerPolicy, upsertManagerConfig,
  listManagerActions, runManagerForProject, createManagerRunTask, finalizeManagerRunTask,
} from '../../application/manager/ManagerService';
import { normalizePrMergePolicy } from '../../application/manager/managerPolicy';
import { notSystemTask, SYSTEM_TASK_SOURCE_MANAGER } from '../../application/task/taskScope';

const NON_TERMINAL: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED,
];

export function createManagerRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Verify the project belongs to the caller's tenant; returns it or null. */
  async function ownProject(tenantId: number, projectId: number) {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return p ?? null;
  }

  // GET /api/manager/:projectId — config + effective policy + coordination stats +
  // the priority-ranked backlog the manager produced. Not cached (live state).
  router.get('/:projectId', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const [config, policy] = await Promise.all([
      getManagerConfigRow(db, tenantId, projectId),
      getEffectiveManagerPolicy(db, tenantId, projectId),
    ]);

    // Coordination stats (small aggregate queries).
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        unscored: sql<number>`count(*) filter (where ${tasks.businessValue} is null)::int`,
        unranked: sql<number>`count(*) filter (where ${tasks.managerRank} is null)::int`,
        unowned: sql<number>`count(*) filter (where ${tasks.assignedUserId} is null and ${tasks.assignedAgentRef} is null and ${tasks.assignedAgentHostId} is null)::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL), notSystemTask));

    const [prCount] = await db
      .select({ open: sql<number>`count(*)::int` })
      .from(pullRequests)
      .where(and(eq(pullRequests.tenantId, tenantId), eq(pullRequests.projectId, projectId), eq(pullRequests.status, 'open')));

    // The ranked backlog (what the team should work next, in order).
    const backlog = await db
      .select({
        id: tasks.id, key: tasks.key, title: tasks.title, status: tasks.status, priority: tasks.priority,
        businessValue: tasks.businessValue, businessValueRationale: tasks.businessValueRationale,
        managerRank: tasks.managerRank, dueDate: tasks.dueDate,
        assignedUserId: tasks.assignedUserId, assignedAgentRef: tasks.assignedAgentRef, assignedAgentHostId: tasks.assignedAgentHostId,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL), notSystemTask))
      .orderBy(sql`${tasks.managerRank} asc nulls last`, asc(tasks.updatedAt))
      .limit(30);

    const actions = await listManagerActions(db, tenantId, projectId, 30);

    // The manager's OWN run tasks (source = 'manager') — every "Backlog management
    // pass" the manager kicked off, surfaced with its owner + status so a human can
    // see the manager's open / in-progress / done work, not just its decisions.
    const runTasks = await db
      .select({
        id: tasks.id, key: tasks.key, title: tasks.title, status: tasks.status, summary: tasks.description,
        assignedUserId: tasks.assignedUserId, assignedAgentRef: tasks.assignedAgentRef, assignedAgentHostId: tasks.assignedAgentHostId,
        createdAt: tasks.createdAt, completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), eq(tasks.source, SYSTEM_TASK_SOURCE_MANAGER)))
      .orderBy(desc(tasks.createdAt))
      .limit(20);

    return c.json({
      config: config ?? null,
      policy,
      stats: {
        total: counts?.total ?? 0,
        unscored: counts?.unscored ?? 0,
        unranked: counts?.unranked ?? 0,
        unowned: counts?.unowned ?? 0,
        openPullRequests: prCount?.open ?? 0,
        lastRunAt: config?.lastRunAt ?? null,
      },
      backlog,
      actions,
      runTasks,
    });
  });

  // PUT /api/manager/:projectId — designate a manager + tune policy (managers only).
  router.put('/:projectId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    type ConfigBody = {
      managerRef?: string | null;
      enabled?: boolean;
      prMergePolicy?: string;
      autoAssign?: boolean;
      autoBusinessValue?: boolean;
      autoPrioritize?: boolean;
    };
    const body = (await c.req.json<ConfigBody>().catch(() => ({} as ConfigBody)));

    const config = await upsertManagerConfig(db, tenantId, projectId, {
      ...(body.managerRef !== undefined ? { managerRef: body.managerRef === '' ? null : body.managerRef } : {}),
      ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
      ...(body.prMergePolicy !== undefined ? { prMergePolicy: normalizePrMergePolicy(body.prMergePolicy) } : {}),
      ...(body.autoAssign !== undefined ? { autoAssign: !!body.autoAssign } : {}),
      ...(body.autoBusinessValue !== undefined ? { autoBusinessValue: !!body.autoBusinessValue } : {}),
      ...(body.autoPrioritize !== undefined ? { autoPrioritize: !!body.autoPrioritize } : {}),
    });
    const policy = await getEffectiveManagerPolicy(db, tenantId, projectId);
    return c.json({ config, policy });
  });

  // POST /api/manager/:projectId/run — run the manager pass now (managers only).
  // The pass is heavy: LLM business-value scoring plus hundreds of sequential
  // neon-http round-trips across ranking, assignment, PR coordination and per-ticket
  // audits. Running it inside the request blows the Worker wall-time budget and the
  // request is evicted before it can respond — the UI hangs on "Managing…" forever.
  // Instead we kick it off in the background and acknowledge immediately; the pass
  // journals each decision to `manager_actions` as it goes, which the surface polls
  // (via GET /:projectId + /:projectId/activity) to stream live activity.
  router.post('/:projectId/run', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const userId = (c as { get(k: 'userId'): string | undefined }).get('userId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const policy = await getEffectiveManagerPolicy(db, tenantId, projectId);
    if (!policy.enabled) {
      return c.json({ started: false, reason: 'disabled' as const });
    }
    c.executionCtx.waitUntil((async () => {
      // A manual run is a first-class, owned, status-tracked board task: mint it
      // in-progress, run the pass (its decisions link back to the task), then close
      // it with the summary. Cron sweeps pass no run task (feed-only) to avoid one
      // card per project per tick.
      const runTaskId = await createManagerRunTask(db, { tenantId, projectId, policy });
      let summary: Awaited<ReturnType<typeof runManagerForProject>> | null = null;
      let ok = false;
      try {
        summary = await runManagerForProject(c.env as Env, db, runtimeService, {
          tenantId, projectId, submittedBy: `manager:${userId ?? 'human'}`, runTaskId,
        });
        ok = true;
      } catch {
        /* the pass is best-effort + idempotent; a failure just means the next run
           (manual or cron) resumes where this left off. */
      }
      if (runTaskId != null) {
        await finalizeManagerRunTask(db, {
          taskId: runTaskId,
          ok,
          summary: summary ?? {
            projectId, skipped: !ok, scored: 0, ranked: 0, assigned: 0,
            prsConducted: 0, prsMerged: 0, dispatched: 0, audited: 0, flagged: 0,
          },
        });
      }
    })());
    return c.json({ started: true });
  });

  // GET /api/manager/:projectId/activity — the decision audit feed.
  router.get('/:projectId/activity', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const limit = Number(c.req.query('limit')) || 50;
    const actions = await listManagerActions(db, tenantId, projectId, limit);
    return c.json({ actions });
  });

  return router;
}
