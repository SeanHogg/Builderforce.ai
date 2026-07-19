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
  recordManagerAction, createManagerCoachingTask, syncManagerRosterRole,
} from '../../application/manager/ManagerService';
import { normalizePrMergePolicy } from '../../application/manager/managerPolicy';
import { resolveManagerTypesForTenant, normalizeManagerType } from '../../application/manager/managerTypes';
import {
  addManagerDirective, listManagerDirectives, setManagerDirectiveStatus,
  type ManagerDirectiveStatus,
} from '../../application/manager/managerDirectives';
import { notSystemTask, SYSTEM_TASK_SOURCE_MANAGER } from '../../application/task/taskScope';
import { getTenantTokenAvailability } from '../../application/llm/tenantTokenAvailability';
import { recordActivity, resolveActorFromContext } from '../../application/activity/activityLog';

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

    // Autonomy health: the cron manager sweep + the autonomous executor BOTH gate on
    // the tenant's token budget and silently skip a tenant that's out of it — so a
    // capped tenant sees its board freeze (no ranking, no assignment, no dispatch, no
    // Evermind learning) with no on-surface reason, and only manual "Run manager now"
    // (which does NOT token-gate) still works. Surface the gate verdict so a stale
    // "last managed" reads as "autonomy paused — out of tokens", not a silent break.
    // Fail OPEN (treat an unknown as "has budget") — same contract as the sweep.
    const tokenAvailability = await getTenantTokenAvailability(db, tenantId, undefined, c.env as Env).catch(() => null);
    const autonomy = {
      tokenBlocked: tokenAvailability ? !tokenAvailability.hasTokens : false,
      reason: tokenAvailability?.reason ?? null,
      effectivePlan: tokenAvailability?.effectivePlan ?? null,
    };

    // The manager-type catalog: built-in domains PLUS one type per tenant CUSTOM job
    // role (id `role:<key>`) — so a manager's type and its roster role are one concept.
    // Built-ins carry their roster roleKey; the UI localizes their label/description by
    // id, and renders custom types by the (already tenant-authored) label/description.
    const managerTypes = (await resolveManagerTypesForTenant(c.env as Env, db, tenantId).catch(() => []))
      .map((mt) => ({ id: mt.id, roleKey: mt.roleKey, builtin: mt.builtin, label: mt.label, description: mt.description }));
    const directives = await listManagerDirectives(db, tenantId, projectId, 50).catch(() => []);

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
      autonomy,
      managerTypes,
      directives,
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
      managerType?: string;
    };
    const body = (await c.req.json<ConfigBody>().catch(() => ({} as ConfigBody)));

    // Capture the designation BEFORE the upsert so the roster sync can move the
    // manager's role pin if the manager (or its type) changed.
    const prior = await getManagerConfigRow(db, tenantId, projectId);

    const config = await upsertManagerConfig(db, tenantId, projectId, {
      ...(body.managerRef !== undefined ? { managerRef: body.managerRef === '' ? null : body.managerRef } : {}),
      ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
      ...(body.prMergePolicy !== undefined ? { prMergePolicy: normalizePrMergePolicy(body.prMergePolicy) } : {}),
      ...(body.autoAssign !== undefined ? { autoAssign: !!body.autoAssign } : {}),
      ...(body.autoBusinessValue !== undefined ? { autoBusinessValue: !!body.autoBusinessValue } : {}),
      ...(body.autoPrioritize !== undefined ? { autoPrioritize: !!body.autoPrioritize } : {}),
      ...(body.managerType !== undefined ? { managerType: normalizeManagerType(body.managerType) } : {}),
    });

    // A manager is a team member: keep its roster role in lock-step with its type.
    await syncManagerRosterRole(c.env as Env, db, tenantId, projectId,
      prior ? { managerRef: prior.managerRef, managerType: prior.managerType } : null,
      { managerRef: config.managerRef, managerType: config.managerType });

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
    // Mint/reconcile the run task before acknowledging. createManagerRunTask closes
    // any orphaned prior pass first, so a new pass never starts while older manager
    // cards still appear open.
    const runTaskId = await createManagerRunTask(db, { tenantId, projectId, policy });
    c.executionCtx.waitUntil((async () => {
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
            prsConducted: 0, prsMerged: 0, dispatched: 0, audited: 0, flagged: 0, remediated: 0,
          },
        });
      }
    })());
    return c.json({ started: true });
  });

  // POST /api/manager/:projectId/coach — the human coaches the manager (managers only).
  // Two modes share one entry:
  //   • mode 'directive' (default) — STANDING guidance the background pass honors on
  //     EVERY run (see ManagerService's composed directive). `scope: 'tenant'` applies it
  //     to every project the manager runs; default is this project. `expiresInDays`
  //     time-boxes it so it self-retires.
  //   • mode 'task' — a DISCRETE task the manager executes ONCE (owned by the designated
  //     manager, dispatchable) — the "assign a task to the manager" half of a session.
  // Either way it is recorded to the manager feed + the unified audit timeline.
  router.post('/:projectId/coach', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const userId = (c as { get(k: 'userId'): string | undefined }).get('userId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    type CoachBody = { directive?: string; scope?: 'project' | 'tenant'; mode?: 'directive' | 'task'; expiresInDays?: number };
    const body = await c.req.json<CoachBody>().catch(() => ({} as CoachBody));
    const directive = (body.directive ?? '').trim();
    if (directive.length < 3) return c.json({ error: 'directive is required' }, 400);
    const mode = body.mode === 'task' ? 'task' : 'directive';
    const actor = await resolveActorFromContext(c.env as Env, db, c as never);

    // mode 'task' — spawn a one-off ticket the manager executes once.
    if (mode === 'task') {
      const taskId = await createManagerCoachingTask(c.env as Env, db, runtimeService, {
        tenantId, projectId, directive, createdBy: userId ?? null,
      });
      if (taskId == null) return c.json({ error: 'could not create task' }, 500);
      await recordManagerAction(db, {
        tenantId, projectId, taskId, actionType: 'flag',
        summary: `Coaching task: “${directive.slice(0, 200)}”.`,
      });
      await recordActivity(c.env as Env, db, {
        tenantId, projectId, actor,
        verb: 'manager.coach',
        targetType: 'task', targetId: taskId,
        summary: `Assigned the manager a task: ${directive.slice(0, 280)}`,
        metadata: { mode: 'task' },
      });
      return c.json({ mode: 'task', taskId, started: true });
    }

    // mode 'directive' — standing guidance, optionally scoped tenant-wide + time-boxed.
    const scopeProjectId = body.scope === 'tenant' ? null : projectId;
    const days = Number(body.expiresInDays);
    const expiresAt = Number.isFinite(days) && days > 0
      ? new Date(Date.now() + Math.min(365, days) * 86_400_000)
      : null;

    const id = await addManagerDirective(db, {
      tenantId, projectId: scopeProjectId, directive, createdBy: userId ?? null, source: 'coach', expiresAt,
    });
    if (!id) return c.json({ error: 'could not record directive' }, 500);

    // Surface it in the manager feed + the cross-surface audit timeline.
    await recordManagerAction(db, {
      tenantId, projectId, actionType: 'flag',
      summary: `Coaching: “${directive.slice(0, 200)}”${scopeProjectId == null ? ' (workspace-wide)' : ''}.`,
    });
    await recordActivity(c.env as Env, db, {
      tenantId, projectId: scopeProjectId ?? projectId,
      actor,
      verb: 'manager.coach',
      targetType: 'project', targetId: projectId,
      summary: `Coached the manager: ${directive.slice(0, 280)}`,
      metadata: { scope: scopeProjectId == null ? 'tenant' : 'project', mode: 'directive', expiresAt: expiresAt?.toISOString() ?? null },
    });
    return c.json({ mode: 'directive', id, started: true });
  });

  // GET /api/manager/:projectId/directives — the standing coaching directives.
  router.get('/:projectId/directives', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const directives = await listManagerDirectives(db, tenantId, projectId, Number(c.req.query('limit')) || 50);
    return c.json({ directives });
  });

  // PATCH /api/manager/:projectId/directives/:id — retire a directive (managers only).
  router.patch('/:projectId/directives/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    const directiveId = c.req.param('id');
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const body = await c.req.json<{ status?: string }>().catch(() => ({} as { status?: string }));
    const status: ManagerDirectiveStatus = body.status === 'done' ? 'done' : 'dismissed';
    const ok = await setManagerDirectiveStatus(db, tenantId, directiveId, status);
    if (!ok) return c.json({ error: 'directive not found' }, 404);
    return c.json({ ok: true, status });
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
