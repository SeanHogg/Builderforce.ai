import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Manager routes — /api/manager
 *
 * The human-facing surface for the AI Manager. A human manager sees + drives the
 * SAME concepts the AI manager acts on: the effective policy + designation, the
 * priority-ranked backlog, the coordination stats, the decision activity feed, and
 * a "run the manager now" button. Every read is tenant-scoped to the project.
 *
 *   GET   /api/manager/defaults             workspace-wide autonomy defaults + resolved policy
 *   PATCH /api/manager/defaults             set the workspace defaults (MANAGER)
 *   GET   /api/manager/:projectId           config + policy + stats + ranked backlog
 *   PUT   /api/manager/:projectId           designate a manager + tune policy (MANAGER)
 *   POST  /api/manager/:projectId/run       run the manager pass now (MANAGER)
 *   GET   /api/manager/:projectId/activity  the decision audit feed
 *   GET   /api/manager/:projectId/stalls    the stuck-ticket register (0367)
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
  getTenantManagerDefaults, upsertTenantManagerDefaults, type TenantManagerDefaultsPatch,
} from '../../application/manager/ManagerService';
import { getStallRegister } from '../../application/manager/stallWatch';
import { getStallCensus } from '../../application/manager/stallCensus';
import { listSystemicFindings } from '../../application/manager/systemicDiagnosis';
import {
  normalizePrMergePolicy, resolveTenantManagerDefaults, DEFAULT_MANAGER_POLICY,
  AGENT_REASSIGN_IDLE_HOURS_RANGE, AGENT_REASSIGN_MAX_PER_SESSION_RANGE,
} from '../../application/manager/managerPolicy';
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

  // ── workspace (tenant) autonomy defaults (migration 0363) ─────────────────
  //
  // Registered BEFORE '/:projectId' so the literal segment is never swallowed by the
  // param route. The three-tier fold means these two endpoints and the per-project ones
  // describe the SAME policy at different scopes, resolved by the one shared function.

  /**
   * A TRI-STATE body field. `undefined` = "the caller didn't mention it, leave it alone";
   * `null` = "clear this workspace opinion, fall back to the hardcoded default"; a
   * boolean = an explicit workspace opinion. Anything else is ignored rather than
   * coerced, so a malformed field can never silently widen or narrow authority.
   */
  function triStateBool(v: unknown): boolean | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return typeof v === 'boolean' ? v : undefined;
  }

  /**
   * A TRI-STATE numeric body field (0365). Same three-way contract as
   * {@link triStateBool}, plus a range clamp — an out-of-range or non-numeric value is
   * IGNORED rather than clamped, because silently rewriting "reassign after 0 hours" to
   * the minimum would grant more autonomy than the operator typed.
   */
  function triStateNumber(v: unknown, range: { min: number; max: number }): number | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    const n = Math.round(v);
    return n >= range.min && n <= range.max ? n : undefined;
  }

  type DefaultsBody = {
    enabled?: boolean | null;
    prMergePolicy?: string | null;
    autoAssign?: boolean | null;
    autoBusinessValue?: boolean | null;
    autoPrioritize?: boolean | null;
    autoSchedule?: boolean | null;
    requireSignoffToComplete?: boolean | null;
    allowAutoMerge?: boolean | null;
    allowUnattendedCeremonies?: boolean | null;
    allowAgentReassignment?: boolean | null;
    agentReassignIdleHours?: number | null;
    agentReassignMaxPerSession?: number | null;
  };

  /**
   * The workspace posture, in three parts, all resolved SERVER-SIDE by the one shared fold:
   *   • `defaults`      — the raw stored opinions (nulls included, so the UI can tell
   *                       "not set" from "set to the same value as the default").
   *   • `policy`        — what a project with no config row of its own gets.
   *   • `builtinPolicy` — the tier BELOW this one, i.e. what a field left unset resolves
   *                       to. Sent explicitly so the "Use default → currently X" hint is
   *                       never computed on the client; folding tiers in two places is how
   *                       a surface ends up promising something the manager won't do.
   */
  const defaultsPayload = (defaults: Awaited<ReturnType<typeof getTenantManagerDefaults>>) => ({
    defaults,
    policy: resolveTenantManagerDefaults(defaults),
    builtinPolicy: DEFAULT_MANAGER_POLICY,
  });

  // GET /api/manager/defaults — read-through cached inside getTenantManagerDefaults and
  // invalidated by the PATCH below.
  router.get('/defaults', async (c) => {
    const tenantId = c.get('tenantId');
    return c.json(defaultsPayload(await getTenantManagerDefaults(db, tenantId, c.env as Env)));
  });

  // PATCH /api/manager/defaults — set the workspace defaults (managers only). Same role
  // gate as the per-project PUT: whoever may grant a project merge authority may grant it
  // workspace-wide.
  router.patch('/defaults', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const userId = (c as { get(k: 'userId'): string | undefined }).get('userId');
    const body = await c.req.json<DefaultsBody>().catch(() => ({} as DefaultsBody));

    const patch: TenantManagerDefaultsPatch = {};
    const bools = [
      'enabled', 'autoAssign', 'autoBusinessValue', 'autoPrioritize', 'autoSchedule',
      'requireSignoffToComplete', 'allowAutoMerge',
      'allowUnattendedCeremonies', 'allowAgentReassignment',
    ] as const;
    for (const key of bools) {
      const v = triStateBool(body[key]);
      if (v !== undefined) patch[key] = v;
    }
    const idle = triStateNumber(body.agentReassignIdleHours, AGENT_REASSIGN_IDLE_HOURS_RANGE);
    if (idle !== undefined) patch.agentReassignIdleHours = idle;
    const cap = triStateNumber(body.agentReassignMaxPerSession, AGENT_REASSIGN_MAX_PER_SESSION_RANGE);
    if (cap !== undefined) patch.agentReassignMaxPerSession = cap;
    if (body.prMergePolicy !== undefined) {
      patch.prMergePolicy = body.prMergePolicy === null || body.prMergePolicy === ''
        ? null
        : normalizePrMergePolicy(body.prMergePolicy);
    }

    const defaults = await upsertTenantManagerDefaults(db, tenantId, patch, {
      updatedBy: userId ?? null,
      env: c.env as Env,
    });
    const payload = defaultsPayload(defaults);

    // Autonomy posture is a governance change — record WHO changed it on the shared
    // audit timeline, not just in the row's updated_by.
    await recordActivity(c.env as Env, db, {
      tenantId,
      actor: await resolveActorFromContext(c.env as Env, db, c as never),
      verb: 'manager.defaults.update',
      targetType: 'tenant', targetId: tenantId,
      summary: `Updated the workspace AI Manager defaults (merge authority: ${payload.policy.allowAutoMerge ? 'granted' : 'withheld'}).`,
      metadata: { patch },
    }).catch((error) => { /* the timeline is best-effort — never fail the write */ 
      reportCaughtError(error, { source: "presentation/routes/managerRoutes.ts", operation: "createManagerRoutes" });
    });

    return c.json(payload);
  });

  // GET /api/manager/:projectId — config + effective policy + coordination stats +
  // the priority-ranked backlog the manager produced. Not cached (live state).
  router.get('/:projectId', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // `policy` is the full three-tier fold; `tenantPolicy` (below) is the tier this
    // project INHERITS — both resolved by the shared fold, so the project form can label a
    // control "inherited from the workspace: X" WITHOUT re-implementing precedence.
    const [config, policy, tenantDefaults] = await Promise.all([
      getManagerConfigRow(db, tenantId, projectId),
      getEffectiveManagerPolicy(db, tenantId, projectId, c.env as Env),
      getTenantManagerDefaults(db, tenantId, c.env as Env),
    ]);

    // Coordination stats (small aggregate queries).
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        unscored: sql<number>`count(*) filter (where ${tasks.businessValue} is null)::int`,
        unranked: sql<number>`count(*) filter (where ${tasks.managerRank} is null)::int`,
        // Work with NO place on the timeline (0364) — the number that made the planning
        // spine read "no dates" from top to bottom, now visible before a human notices it.
        undated: sql<number>`count(*) filter (where ${tasks.startDate} is null and ${tasks.dueDate} is null)::int`,
        unowned: sql<number>`count(*) filter (where ${tasks.assignedUserId} is null and ${tasks.assignedAgentRef} is null and ${tasks.assignedAgentHostId} is null)::int`,
        // Role/diagnostic coverage, read off the denormalised verdict on the task —
        // free here (same aggregate) rather than a second pass over ticket_audits.
        flagged: sql<number>`count(*) filter (where ${tasks.auditStatus} = 'flagged')::int`,
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
      /** What this project inherits when its own row says nothing (the workspace tier,
       *  resolved). NOT the same as `policy`, which already includes this project's row. */
      tenantPolicy: resolveTenantManagerDefaults(tenantDefaults),
      stats: {
        total: counts?.total ?? 0,
        unscored: counts?.unscored ?? 0,
        unranked: counts?.unranked ?? 0,
        undated: counts?.undated ?? 0,
        unowned: counts?.unowned ?? 0,
        openPullRequests: prCount?.open ?? 0,
        flagged: counts?.flagged ?? 0,
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
      autoSchedule?: boolean;
      managerType?: string;
      requireSignoffToComplete?: boolean;
      /** Tri-state (0363): true/false = an explicit project decision, null = inherit the
       *  workspace default, absent = leave whatever is stored alone. */
      allowAutoMerge?: boolean | null;
      /** Ceremony autonomy (0365) — all tri-state, for the same reason. */
      allowUnattendedCeremonies?: boolean | null;
      allowAgentReassignment?: boolean | null;
      agentReassignIdleHours?: number | null;
      agentReassignMaxPerSession?: number | null;
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
      ...(body.autoSchedule !== undefined ? { autoSchedule: !!body.autoSchedule } : {}),
      ...(body.managerType !== undefined ? { managerType: normalizeManagerType(body.managerType) } : {}),
      ...(body.requireSignoffToComplete !== undefined ? { requireSignoffToComplete: !!body.requireSignoffToComplete } : {}),
      // NOT coerced with `!!` — null must survive as "inherit the workspace tier", which
      // `!!null === false` would silently turn into "this project refuses merge authority".
      ...(triStateBool(body.allowAutoMerge) !== undefined ? { allowAutoMerge: triStateBool(body.allowAutoMerge) } : {}),
      // Ceremony autonomy (0365) — tri-state for the same reason as allowAutoMerge.
      ...(triStateBool(body.allowUnattendedCeremonies) !== undefined
        ? { allowUnattendedCeremonies: triStateBool(body.allowUnattendedCeremonies) } : {}),
      ...(triStateBool(body.allowAgentReassignment) !== undefined
        ? { allowAgentReassignment: triStateBool(body.allowAgentReassignment) } : {}),
      ...(triStateNumber(body.agentReassignIdleHours, AGENT_REASSIGN_IDLE_HOURS_RANGE) !== undefined
        ? { agentReassignIdleHours: triStateNumber(body.agentReassignIdleHours, AGENT_REASSIGN_IDLE_HOURS_RANGE) } : {}),
      ...(triStateNumber(body.agentReassignMaxPerSession, AGENT_REASSIGN_MAX_PER_SESSION_RANGE) !== undefined
        ? { agentReassignMaxPerSession: triStateNumber(body.agentReassignMaxPerSession, AGENT_REASSIGN_MAX_PER_SESSION_RANGE) } : {}),
    });

    // A manager is a team member: keep its roster role in lock-step with its type.
    await syncManagerRosterRole(c.env as Env, db, tenantId, projectId,
      prior ? { managerRef: prior.managerRef, managerType: prior.managerType } : null,
      { managerRef: config.managerRef, managerType: config.managerType });

    const policy = await getEffectiveManagerPolicy(db, tenantId, projectId, c.env as Env);
    const tenantPolicy = resolveTenantManagerDefaults(await getTenantManagerDefaults(db, tenantId, c.env as Env));
    return c.json({ config, policy, tenantPolicy });
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
    const policy = await getEffectiveManagerPolicy(db, tenantId, projectId, c.env as Env);
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
      } catch (error) {
        /* the pass is best-effort + idempotent; a failure just means the next run
           (manual or cron) resumes where this left off. */
      
        reportCaughtError(error, { source: "presentation/routes/managerRoutes.ts", operation: "createManagerRoutes" });
      }
      if (runTaskId != null) {
        await finalizeManagerRunTask(db, {
          taskId: runTaskId,
          ok,
          // An all-zero summary for a pass that threw before producing one. Every field
          // of ManagerRunSummary must appear: the compiler is the only thing that
          // catches a new counter being added without a zero here, and a missing one
          // would surface as an undefined count on the run card.
          summary: summary ?? {
            projectId, skipped: !ok, scored: 0, ranked: 0, scheduled: 0, assigned: 0,
            prsConducted: 0, prsMerged: 0, dispatched: 0, audited: 0, flagged: 0, remediated: 0, remediationDeferred: 0,
            stalled: 0, unstuck: 0, escalated: 0, stallsResolved: 0, staleRunTasksClosed: 0,
            censusStalled: 0, censusTopCause: null, systemicFindings: 0, systemicTicketsCreated: 0,
            truncated: [],
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

  // GET /api/manager/:projectId/stalls — the STUCK-TICKET REGISTER (0367).
  //
  // What the manager currently cannot finish, why, what it has tried, and which ones
  // it has handed back to a human. Distinct from /activity, which is the stream of
  // decisions taken: this is the standing list of work that is not moving. Read-only
  // and served through the shared read-through cache (the manager pass invalidates it
  // on every write), so a polled panel never reaches the database.
  router.get('/:projectId/stalls', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const register = await getStallRegister(c.env as Env, db, { tenantId, projectId });
    return c.json(register);
  });

  // GET /api/manager/:projectId/census — the FULL-COVERAGE stall census (0373).
  //
  // /stalls is the per-ticket register, and it is bounded by what the deep triage stage
  // has had budget to diagnose (max 12 tickets per project per pass). That bound made
  // the register's own `byCause` summary a sample rather than a census — measured on one
  // tenant, 755 stalled tickets against 44 register rows, with the sample's top cause
  // reading `unknown` while the true largest cohort was 313 tickets sharing one cause.
  //
  // This endpoint answers the question the register cannot: across EVERY ticket, what is
  // stuck and what do they share? Plus the systemic findings the manager has raised from
  // it — a cohort it judged a platform defect, with the ticket it filed. Read-only and
  // served through the shared read-through cache (the manager pass invalidates it), so a
  // polled panel never reaches the database.
  router.get('/:projectId/census', async (c) => {
    const tenantId = c.get('tenantId');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || !(await ownProject(tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const [census, findings] = await Promise.all([
      getStallCensus(c.env as Env, db, { tenantId, projectId }),
      listSystemicFindings(db, { tenantId, projectId }),
    ]);
    return c.json({ ...census, findings });
  });

  return router;
}
