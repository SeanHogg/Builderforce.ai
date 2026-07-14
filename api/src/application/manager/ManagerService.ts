/**
 * ManagerService — the AI Manager's per-project coordination pass.
 *
 * A designated manager (an AI agent OR a human) — and, by default, the tenant-wide
 * system service — reviews a project's board and does the judgement work the
 * mechanical autonomous sweep cannot:
 *   1. VALUE   — backfill business value (RICE-informed AI score, heuristic fallback)
 *                on every unscored ticket, so ranking has something to sort by.
 *   2. RANK    — order the backlog by priority × value × due-date urgency and persist
 *                each ticket's `manager_rank` (what the priority-aware dispatcher and
 *                the board default-sort read). Fixes "items not ordered in priority".
 *   3. ASSIGN  — give unowned work to the best-fit teammate/agent (so nothing sits
 *                invisible to autonomy).
 *   4. PR      — CONDUCT (open) PRs for finished work and MERGE + CLOSE open PRs per
 *                the project's PR authority policy.
 *   5. DISPATCH— kick the top-ranked runnable tickets NOW (in priority order) so the
 *                team keeps moving without waiting for the next cron tick.
 *
 * Every action is journalled to `manager_actions` so a human can see — and trust —
 * exactly what the manager did and why. Reused by the cron sweep (all projects) and
 * the "Run manager now" endpoint (one project), so both agree on the behaviour.
 *
 * Best-effort + isolated: every step is wrapped so one failing ticket can't abort
 * the pass, and each mutation is idempotent (re-scoring/re-ranking is a no-op-ish
 * overwrite; merge dedupes on an already-merged PR), so overlapping runs are safe.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import {
  tasks, boards, swimlanes, swimlaneAgentAssignments, pullRequests,
  projectManagerConfigs, managerActions, projects, featureScores,
} from '../../infrastructure/database/schema';
import { TaskStatus, TaskPriority } from '../../domain/shared/types';
import { notSystemTask } from '../task/taskScope';
import { rankBacklog, type RankableTask, type TaskPriorityTier } from './prioritize';
import {
  heuristicBusinessValue, riceBusinessValueFromFeature, normalizeFeatureName,
  type FeatureScoreRow, type ScoredValue,
} from './businessValue';
import { scoreBusinessValueAI } from './businessValueAI';
import {
  resolveEffectiveManagerPolicy, resolveManagerAssignee,
  type EffectiveManagerPolicy, type ManagerConfigRow,
} from './managerPolicy';
import { resolveManagerIdentity } from './managerIdentity';
import { resolveManagerTypeById, normalizeManagerType } from './managerTypes';
import { listActiveManagerDirectives } from './managerDirectives';
import { RoleAssignmentService, type AssigneeKind } from '../kanban/roleAssignmentService';
import { recommendTopAssignee } from '../metrics/assigneeRecommender';
import { producerRoleForActionType } from '../kanban/roleCapability';
import { mergeRecordedPullRequest, updateRecordedPullRequestBranch } from '../repos/mergeRecordedPr';
import { pollPrCiStatus } from '../repos/pollPrCiStatus';
import { dispatchTaskFinalize } from '../../presentation/routes/taskRoutes';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import { TicketAuditService } from '../audit/ticketAuditService';
import { recordActivity, cloudAgentActor, SYSTEM_ACTOR } from '../activity/activityLog';

/** Non-terminal statuses whose tickets the manager grooms/ranks/assigns. */
const NON_TERMINAL: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED,
];
/** Statuses an agent could pick up (Blocked waits on a dependency, not an agent). */
const RUNNABLE: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW,
];

/** Per-run bounds (cost + storm guards). The backlog paces itself across runs. */
const MAX_AI_SCORES_PER_RUN = 8;   // LLM calls — the rest fall back to the free heuristic
const MAX_RANKED = 300;
const MAX_ASSIGNMENTS_PER_RUN = 15;
const MAX_PR_ACTIONS_PER_RUN = 20;
const MAX_DISPATCHES_PER_RUN = 12;
const MAX_AUDITS_PER_RUN = 40;

export interface ManagerRunSummary {
  projectId: number;
  skipped: boolean;
  reason?: string;
  scored: number;
  ranked: number;
  assigned: number;
  prsConducted: number;
  prsMerged: number;
  dispatched: number;
  /** Tickets audited for role/diagnostic coverage, and how many were flagged. */
  audited: number;
  flagged: number;
}

// ── config store ────────────────────────────────────────────────────────────

/** A stored config row plus its last-run stamp (the surface shows both). */
export type ManagerConfigRowWithMeta = ManagerConfigRow & { lastRunAt: Date | null };

/** Load a project's manager config row (null when it has none → tenant default). */
export async function getManagerConfigRow(
  db: Db, tenantId: number, projectId: number,
): Promise<ManagerConfigRowWithMeta | null> {
  const [row] = await db
    .select({
      managerRef: projectManagerConfigs.managerRef,
      enabled: projectManagerConfigs.enabled,
      prMergePolicy: projectManagerConfigs.prMergePolicy,
      autoAssign: projectManagerConfigs.autoAssign,
      autoBusinessValue: projectManagerConfigs.autoBusinessValue,
      autoPrioritize: projectManagerConfigs.autoPrioritize,
      managerType: projectManagerConfigs.managerType,
      lastRunAt: projectManagerConfigs.lastRunAt,
    })
    .from(projectManagerConfigs)
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/** The effective (row-over-default) policy for a project. */
export async function getEffectiveManagerPolicy(
  db: Db, tenantId: number, projectId: number,
): Promise<EffectiveManagerPolicy> {
  return resolveEffectiveManagerPolicy(await getManagerConfigRow(db, tenantId, projectId));
}

/** Upsert a project's manager config (the designation + policy). */
export async function upsertManagerConfig(
  db: Db,
  tenantId: number,
  projectId: number,
  patch: Partial<Pick<ManagerConfigRow, 'managerRef' | 'enabled' | 'prMergePolicy' | 'autoAssign' | 'autoBusinessValue' | 'autoPrioritize' | 'managerType'>>,
): Promise<ManagerConfigRow> {
  const now = new Date();
  await db
    .insert(projectManagerConfigs)
    .values({
      tenantId, projectId,
      managerRef: patch.managerRef ?? null,
      enabled: patch.enabled ?? true,
      prMergePolicy: patch.prMergePolicy ?? 'immediate',
      autoAssign: patch.autoAssign ?? true,
      autoBusinessValue: patch.autoBusinessValue ?? true,
      autoPrioritize: patch.autoPrioritize ?? true,
      managerType: normalizeManagerType(patch.managerType),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectManagerConfigs.tenantId, projectManagerConfigs.projectId],
      set: {
        ...(patch.managerRef !== undefined ? { managerRef: patch.managerRef } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.prMergePolicy !== undefined ? { prMergePolicy: patch.prMergePolicy } : {}),
        ...(patch.autoAssign !== undefined ? { autoAssign: patch.autoAssign } : {}),
        ...(patch.autoBusinessValue !== undefined ? { autoBusinessValue: patch.autoBusinessValue } : {}),
        ...(patch.autoPrioritize !== undefined ? { autoPrioritize: patch.autoPrioritize } : {}),
        ...(patch.managerType !== undefined ? { managerType: normalizeManagerType(patch.managerType) } : {}),
        updatedAt: now,
      },
    });
  return (await getManagerConfigRow(db, tenantId, projectId))!;
}

/** Append a manager decision to the audit feed. Best-effort. `runTaskId` links the
 *  decision to the board task representing a manual run (null for cron sweeps). */
export async function recordManagerAction(
  db: Db,
  a: { tenantId: number; projectId: number; taskId?: number | null; runTaskId?: number | null; actionType: string; summary: string; detail?: unknown },
): Promise<void> {
  try {
    await db.insert(managerActions).values({
      tenantId: a.tenantId,
      projectId: a.projectId,
      taskId: a.taskId ?? null,
      runTaskId: a.runTaskId ?? null,
      actionType: a.actionType,
      summary: a.summary.slice(0, 500),
      detail: a.detail !== undefined ? JSON.stringify(a.detail).slice(0, 4000) : null,
    });
  } catch {
    /* the audit feed is best-effort — a write miss must not fail the pass */
  }
}

/** The newest manager actions for a project (the activity feed). */
export async function listManagerActions(
  db: Db, tenantId: number, projectId: number, limit = 50,
): Promise<Array<{ id: string; taskId: number | null; ticketKey: string | null; ticketTitle: string | null; actionType: string; summary: string; detail: string | null; createdAt: Date }>> {
  return db
    .select({
      id: managerActions.id, taskId: managerActions.taskId, actionType: managerActions.actionType,
      ticketKey: tasks.key, ticketTitle: tasks.title,
      summary: managerActions.summary, detail: managerActions.detail, createdAt: managerActions.createdAt,
    })
    .from(managerActions)
    .leftJoin(tasks, eq(tasks.id, managerActions.taskId))
    .where(and(eq(managerActions.tenantId, tenantId), eq(managerActions.projectId, projectId)))
    .orderBy(desc(managerActions.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
}

// ── run task (board visibility for a manual run) ─────────────────────────────

/**
 * Mint the board task that REPRESENTS a manual "Run manager now" pass — assigned to
 * the designated manager, opened in-progress. The manager's decisions this pass link
 * back to it (`manager_actions.run_task_id`) and {@link finalizeManagerRunTask} closes
 * it with the run summary, so a human can see what the manager did, by whom, and when.
 *
 * A controlled raw insert on purpose (NOT `TaskService.createTask`): this is a
 * coordination chore, so it must skip the on-assign Epic-decompose / agent
 * auto-dispatch hooks that would otherwise try to "execute" it as codeable work. The
 * `source = 'manager'` marker also short-circuits the shared auto-run evaluator, so
 * no dispatcher ever picks it up. Best-effort: a miss returns null and the pass still
 * runs (just without a board card).
 */
export async function createManagerRunTask(
  db: Db,
  args: { tenantId: number; projectId: number; policy: EffectiveManagerPolicy },
): Promise<number | null> {
  const { tenantId, projectId, policy } = args;
  try {
    // A Worker can be evicted after starting a pass but before its finally block
    // closes the visibility card. Reconcile those orphaned/open cards first so the
    // Manager surface never accumulates multiple active passes.
    const now = new Date();
    await db.update(tasks).set({
      status: TaskStatus.BLOCKED,
      description: 'Closed before a newer backlog management pass started; the prior background run did not report completion.',
      lastWorkedAt: now,
      updatedAt: now,
    }).where(and(
      eq(tasks.projectId, projectId),
      eq(tasks.source, 'manager'),
      inArray(tasks.status, [TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW]),
    ));

    const [project] = await db
      .select({ key: projects.key })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (!project) return null;

    const baseSeq = await nextProjectKeySeqBase(db, projectId);
    const assignee = resolveManagerAssignee(policy.managerRef);
    // Retry on a key collision (a concurrent create) by walking the sequence forward.
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = `${project.key}-${String(baseSeq + attempt).padStart(3, '0')}`;
      try {
        const [row] = await db
          .insert(tasks)
          .values({
            projectId,
            key,
            title: 'Backlog management pass',
            description:
              'The AI Manager is grooming this backlog — scoring business value, ranking the work, assigning owners, and shepherding pull requests. Its decisions stream to the Manager activity feed.',
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.LOW,
            // `source = 'manager'` marks this a coordination chore: excluded from the
            // manager's own grooming set and from every auto-run dispatcher.
            source: 'manager',
            // KTLO keeps it off the innovation-allocation lens; it is operational upkeep.
            allocationCategory: 'ktlo',
            allocationCategorySource: 'agent',
            assignedUserId: assignee.assignedUserId,
            assignedAgentRef: assignee.assignedAgentRef,
            assignedAgentHostId: assignee.assignedAgentHostId,
            startDate: now,
            lastWorkedAt: now,
            updatedAt: now,
          })
          .returning({ id: tasks.id });
        return row?.id ?? null;
      } catch {
        /* likely a unique-key collision — try the next sequence number */
      }
    }
    return null;
  } catch {
    return null; // a run-task miss must never block the pass
  }
}

/** Close a manager run task with the pass summary (done on success, blocked on a
 *  hard failure). Best-effort — the pass result stands regardless. */
export async function finalizeManagerRunTask(
  db: Db,
  args: { taskId: number; summary: ManagerRunSummary; ok: boolean },
): Promise<void> {
  const { taskId, summary, ok } = args;
  try {
    const now = new Date();
    const line =
      `Scored ${summary.scored} · ranked ${summary.ranked} · assigned ${summary.assigned} · ` +
      `PRs ${summary.prsConducted + summary.prsMerged} · dispatched ${summary.dispatched} · ` +
      `audited ${summary.audited}${summary.flagged ? ` (${summary.flagged} flagged)` : ''}.`;
    await db
      .update(tasks)
      .set({
        status: ok ? TaskStatus.DONE : TaskStatus.BLOCKED,
        description: ok
          ? `Backlog management pass complete. ${line}`
          : `Backlog management pass ended early. ${line}`,
        completedAt: ok ? now : null,
        lastWorkedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId));
  } catch {
    /* best-effort */
  }
}

/** Next gap-safe key sequence base for a project (mirrors TaskRepository.maxKeySeqByProject). */
async function nextProjectKeySeqBase(db: Db, projectId: number): Promise<number> {
  const [seqRow] = await db
    .select({
      value: sql<number>`COALESCE(MAX(CASE WHEN regexp_replace(${tasks.key}, '^.*-', '') ~ '^[0-9]+$'
        THEN CAST(regexp_replace(${tasks.key}, '^.*-', '') AS INTEGER) END), 0)`,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
  return Number(seqRow?.value ?? 0) + 1;
}

// ── coaching → discrete task ─────────────────────────────────────────────────

/** `tasks.source` marker for a one-off task a human handed the manager via coaching. */
export const COACHING_TASK_SOURCE = 'coaching';

/**
 * Turn a coaching turn into a DISCRETE task the manager executes ONCE — the "assign a
 * task to the manager" half of a coaching session (vs a standing directive that reshapes
 * every pass). Unlike a manager RUN task (`source='manager'`, a non-runnable coordination
 * card), this is a real, dispatchable, high-priority ticket OWNED by the designated
 * manager, so the manager's own dispatch step (or the autonomous executor) picks it up
 * like any assigned work. Best-effort: a miss returns null and coaching still records the
 * intent. Shared by the Manager-tab coach box and the `manager.coach` chat tool.
 */
export async function createManagerCoachingTask(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; directive: string; createdBy?: string | null; submittedBy?: string },
): Promise<number | null> {
  const { tenantId, projectId } = args;
  const directive = args.directive.trim();
  if (directive.length < 3) return null;
  try {
    const [project] = await db
      .select({ key: projects.key })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (!project) return null;

    const policy = await getEffectiveManagerPolicy(db, tenantId, projectId);
    const assignee = resolveManagerAssignee(policy.managerRef);
    const baseSeq = await nextProjectKeySeqBase(db, projectId);
    const title = (directive.split('\n', 1)[0] ?? directive).trim().slice(0, 120) || 'Manager task';
    const now = new Date();

    let taskId: number | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = `${project.key}-${String(baseSeq + attempt).padStart(3, '0')}`;
      try {
        const [row] = await db
          .insert(tasks)
          .values({
            projectId, key, title,
            description: directive,
            status: TaskStatus.TODO,
            priority: TaskPriority.HIGH,
            // A REAL, dispatchable work item (NOT source='manager', which is non-runnable),
            // owned by the manager so autonomy executes it once.
            source: COACHING_TASK_SOURCE,
            assignedUserId: assignee.assignedUserId,
            assignedAgentRef: assignee.assignedAgentRef,
            assignedAgentHostId: assignee.assignedAgentHostId,
            startDate: now, lastWorkedAt: now, updatedAt: now,
          })
          .returning({ id: tasks.id });
        taskId = row?.id ?? null;
        break;
      } catch { /* likely a unique-key collision — try the next sequence number */ }
    }
    if (taskId == null) return null;

    // Immediacy: if the manager is an agent and the lane is staffed, start now — else the
    // manager's next pass (step 5 dispatch) picks up the assigned runnable ticket anyway.
    try {
      await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId, projectId, taskId, status: TaskStatus.TODO,
        submittedBy: args.submittedBy ?? `coach:${args.createdBy ?? 'human'}`,
      });
    } catch { /* dispatch is best-effort; autonomy still picks it up */ }
    return taskId;
  } catch {
    return null;
  }
}

// ── roster sync (a manager IS a team member holding its type's role) ──────────

/** Map a manager designation ref to a roster assignee, reusing the ONE ref decoder.
 *  Null for the system service (not a team member → holds no roster role). */
function managerRefToRosterAssignee(managerRef: string | null): { kind: AssigneeKind; ref: string } | null {
  const a = resolveManagerAssignee(managerRef);
  if (a.assignedUserId) return { kind: 'human', ref: a.assignedUserId };
  if (a.assignedAgentRef) return { kind: 'agent', ref: a.assignedAgentRef };
  if (a.assignedAgentHostId != null) return { kind: 'agent', ref: String(a.assignedAgentHostId) };
  return null;
}

/**
 * Keep the roster in sync with a manager designation: the manager is a team member and
 * its TYPE is the roster ROLE it fills (managerTypes → roleCatalog). When the designation
 * or its type changes, MOVE the manager's project-scoped role pin from the previous role
 * to the new one — reversing only OUR own prior pin (exact assignee + prior role) so an
 * unrelated human-made assignment is never touched. Best-effort: a roster miss never
 * blocks saving the manager config.
 */
export async function syncManagerRosterRole(
  env: Env, db: Db, tenantId: number, projectId: number,
  prior: { managerRef: string | null; managerType: string } | null,
  next: { managerRef: string | null; managerType: string },
): Promise<void> {
  try {
    const svc = new RoleAssignmentService(db);
    const nextAssignee = managerRefToRosterAssignee(next.managerRef);
    const nextRoleKey = (await resolveManagerTypeById(env, db, tenantId, next.managerType)).roleKey;

    if (prior) {
      const priorAssignee = managerRefToRosterAssignee(prior.managerRef);
      const priorRoleKey = (await resolveManagerTypeById(env, db, tenantId, prior.managerType)).roleKey;
      const changed =
        !nextAssignee || !priorAssignee ||
        priorAssignee.kind !== nextAssignee.kind || priorAssignee.ref !== nextAssignee.ref ||
        priorRoleKey !== nextRoleKey;
      if (priorAssignee && priorRoleKey && changed) {
        const scoped = await svc.listForScope(env, tenantId, projectId);
        const stale = scoped.find((a) =>
          a.roleKey === priorRoleKey && a.assigneeKind === priorAssignee.kind && a.assigneeRef === priorAssignee.ref);
        if (stale) await svc.remove(env, tenantId, stale.id);
      }
    }

    // Pin the current manager to its role (idempotent). Skip the system service (no
    // assignee) and a type with no catalog role (e.g. Service Desk → roleKey null).
    if (nextAssignee && nextRoleKey) {
      await svc.create(env, tenantId, null, {
        roleKey: nextRoleKey, assigneeKind: nextAssignee.kind, assigneeRef: nextAssignee.ref, projectId,
      });
    }
  } catch { /* roster sync is best-effort */ }
}

// ── the pass ────────────────────────────────────────────────────────────────

/**
 * Flush drizzle write statements in chunked batches. neon-http has no interactive
 * transaction; `db.batch` is the unit that collapses many statements into few HTTP
 * round-trips — turning a 200+ ticket grooming pass from 200+ sequential writes (which
 * risks Worker eviction mid-pass) into a handful of batch calls. Best-effort per
 * chunk: a failing batch falls back to individual writes so one bad row can't lose the
 * rest, and the whole helper never throws (the pass result stands regardless).
 */
async function flushBatched(db: Db, ops: unknown[], chunkSize = 50): Promise<void> {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    try {
      await db.batch(chunk as unknown as Parameters<typeof db.batch>[0]);
    } catch {
      for (const op of chunk) { try { await (op as Promise<unknown>); } catch { /* skip this write */ } }
    }
  }
}

interface ManagedTaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  businessValue: number | null;
  businessValueSource: string | null;
  dueDate: Date | null;
  storyPoints: number | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  gitBranch: string | null;
  githubPrUrl: string | null;
  createdAt: Date;
}

async function loadManagedTasks(db: Db, projectId: number): Promise<ManagedTaskRow[]> {
  return db
    .select({
      id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status,
      priority: tasks.priority, businessValue: tasks.businessValue, businessValueSource: tasks.businessValueSource,
      dueDate: tasks.dueDate, storyPoints: tasks.storyPoints,
      assignedUserId: tasks.assignedUserId, assignedAgentRef: tasks.assignedAgentRef,
      assignedAgentHostId: tasks.assignedAgentHostId, gitBranch: tasks.gitBranch, githubPrUrl: tasks.githubPrUrl,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL),
      // The manager never grooms/ranks/audits its OWN run tasks (source = 'manager').
      notSystemTask,
    ))
    .orderBy(asc(tasks.createdAt))
    .limit(MAX_RANKED);
}

/**
 * Load the project's PMO {@link featureScores} keyed by normalized name, plus the
 * project's max RICE score (for relative 0-100 normalization). Lets the manager fold
 * a human's deliberate RICE estimate into a ticket's business value (source 'rice')
 * BEFORE spending an LLM call — a matched PMO score outranks the AI/heuristic path.
 */
async function loadFeatureScoreIndex(
  db: Db, tenantId: number, projectId: number,
): Promise<{ byName: Map<string, FeatureScoreRow>; maxScore: number }> {
  const rows = await db
    .select({
      name: featureScores.name, reach: featureScores.reach, impact: featureScores.impact,
      confidence: featureScores.confidence, effort: featureScores.effort, score: featureScores.score,
    })
    .from(featureScores)
    .where(and(
      eq(featureScores.tenantId, tenantId),
      or(eq(featureScores.projectId, projectId), isNull(featureScores.projectId)),
    ))
    .limit(500);
  const byName = new Map<string, FeatureScoreRow>();
  let maxScore = 0;
  for (const r of rows) {
    const key = normalizeFeatureName(r.name);
    if (key && !byName.has(key)) byName.set(key, r as FeatureScoreRow);
    if (r.score != null && Number.isFinite(r.score)) maxScore = Math.max(maxScore, r.score);
  }
  return { byName, maxScore };
}

function toRankable(t: ManagedTaskRow): RankableTask {
  return {
    taskId: t.id,
    priority: (['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium') as TaskPriorityTier,
    businessValue: t.businessValue,
    dueDate: t.dueDate,
    status: t.status,
    createdAt: t.createdAt,
  };
}

/**
 * Run the manager pass for one project. `submittedBy` labels dispatched runs (e.g.
 * 'system:manager-cron' or 'manager:<userId>'). Returns a summary of what it did.
 */
export async function runManagerForProject(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; submittedBy?: string; runTaskId?: number | null; dispatch?: boolean },
): Promise<ManagerRunSummary> {
  const { tenantId, projectId } = args;
  const submittedBy = args.submittedBy ?? 'system:manager';
  // DISPATCH ownership: on the cron path the always-on autonomous executor
  // ({@link runAutonomousExecutionSweep}) runs on the SAME tick and is the single
  // dispatcher of ranked/assigned work — so the manager cron sweep does its judgement
  // (value/rank/assign/PR/audit) but SKIPS step 5 to avoid the double-scan noted in the
  // gap register. A manual "Run manager now" (or any non-cron caller) still dispatches
  // immediately so a human sees work start the instant they click. Callers may force
  // either way via `dispatch`.
  const shouldDispatch = args.dispatch ?? (submittedBy !== 'system:manager-cron');
  // The board task representing this run (manual runs only) — every decision below
  // links to it so the run task shows exactly what this pass changed.
  const runTaskId = args.runTaskId ?? null;
  const summary: ManagerRunSummary = {
    projectId, skipped: false, scored: 0, ranked: 0, assigned: 0, prsConducted: 0, prsMerged: 0, dispatched: 0,
    audited: 0, flagged: 0,
  };

  const policy = await getEffectiveManagerPolicy(db, tenantId, projectId);
  if (!policy.enabled) return { ...summary, skipped: true, reason: 'disabled' };

  // Resolve the designated manager AS an identity — a named cloud agent scores the
  // backlog with its own persona (and is credited in the feed). System/human managers
  // resolve to the neutral system identity (no persona), so nothing changes for them.
  const identity = await resolveManagerIdentity(db, tenantId, policy);

  // The manager's JUDGEMENT prompt = its DOMAIN TYPE framing (Development / QA /
  // Service Desk / DevOps / …) + any standing human COACHING directives (project-
  // scoped AND tenant-wide) + the designated agent's own persona. This ONE composed
  // directive is what makes a "QA manager" score differently from a "DevOps manager"
  // and makes coaching actually steer the pass. Fed to scoreBusinessValueAI below.
  const managerType = await resolveManagerTypeById(env, db, tenantId, policy.managerType);
  const coachingDirectives = await listActiveManagerDirectives(db, tenantId, projectId).catch(() => []);
  const composedDirective =
    [
      managerType.directive,
      ...coachingDirectives.map((d) => `Standing directive from the team: ${d.directive}`),
      identity.personaDirective,
    ]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join('\n\n') || null;

  const now = Date.now();
  let managed = await loadManagedTasks(db, projectId);

  // 1. VALUE — backfill business value on unscored, non-manual tickets. ---------
  // The scoring decision is sequential (AI for the first few, free heuristic for the
  // rest) but the WRITES are collected and flushed in batches: a 200+ ticket backlog
  // would otherwise fire 200+ sequential neon-http round-trips here and risk the
  // Worker being evicted mid-pass. See flushBatched.
  if (policy.autoBusinessValue) {
    const unscored = managed.filter((t) => t.businessValue == null && t.businessValueSource !== 'manual');
    // A human's deliberate PMO RICE estimate (feature_scores) is the highest-trust
    // non-manual source — fold it in first so we never burn an LLM call on a ticket
    // the product team already scored.
    const featureIndex = unscored.length > 0
      ? await loadFeatureScoreIndex(db, tenantId, projectId)
      : { byName: new Map<string, FeatureScoreRow>(), maxScore: 0 };
    let aiBudget = MAX_AI_SCORES_PER_RUN;
    const writeOps: unknown[] = [];
    const stampedAt = new Date();
    for (const t of unscored) {
      try {
        const riceMatch = featureIndex.byName.get(normalizeFeatureName(t.title));
        let value: ScoredValue;
        if (riceMatch) {
          value = riceBusinessValueFromFeature(riceMatch, featureIndex.maxScore);
        } else {
          const scored = aiBudget > 0
            ? (await scoreBusinessValueAI(env, { title: t.title, description: t.description }, composedDirective))
            : null;
          if (scored) aiBudget -= 1;
          value = scored ?? heuristicBusinessValue(toRankable(t), now, t.storyPoints);
        }
        writeOps.push(
          db.update(tasks)
            .set({ businessValue: value.score, businessValueRationale: value.rationale, businessValueSource: value.source, updatedAt: stampedAt })
            .where(eq(tasks.id, t.id)),
        );
        writeOps.push(
          db.insert(managerActions).values({
            tenantId, projectId, taskId: t.id, runTaskId, actionType: 'score_value',
            summary: `Scored business value ${value.score}/100 — ${value.rationale}`.slice(0, 500),
            detail: JSON.stringify({ score: value.score, source: value.source }).slice(0, 4000),
          }),
        );
        // Reflect locally so ranking below sees the fresh score.
        t.businessValue = value.score;
        summary.scored += 1;
      } catch { /* skip this ticket */ }
    }
    await flushBatched(db, writeOps);
  }

  // 2. RANK — order the backlog and persist manager_rank (batched writes). -------
  if (policy.autoPrioritize && managed.length > 0) {
    const ranked = rankBacklog(managed.map(toRankable), now);
    await flushBatched(db, ranked.map((r) => db.update(tasks).set({ managerRank: r.rank }).where(eq(tasks.id, r.taskId))));
    summary.ranked = ranked.length;
    const top = ranked.slice(0, 5).map((r) => {
      const t = managed.find((m) => m.id === r.taskId);
      return { rank: r.rank, taskId: r.taskId, title: t?.title ?? '', score: r.score };
    });
    await recordManagerAction(db, {
      tenantId, projectId, runTaskId, actionType: 'prioritize',
      summary: `Ranked ${ranked.length} tickets by priority × value × urgency.`,
      detail: { top },
    });
  }

  // 3. ASSIGN — give unowned runnable tickets to the best-fit teammate/agent. ----
  if (policy.autoAssign) {
    const unowned = managed
      .filter((t) => RUNNABLE.includes(t.status) && !t.assignedUserId && !t.assignedAgentRef && t.assignedAgentHostId == null)
      .slice(0, MAX_ASSIGNMENTS_PER_RUN);
    for (const t of unowned) {
      try {
        // Role-aware: constrain the pick to the ticket's producer role (from its
        // technical action-type) so a coding ticket never lands on a role-incapable
        // owner (the #467 root cause). No constraint when the type implies no role.
        const roleKey = producerRoleForActionType((t as { actionType?: string | null }).actionType);
        const pick = await recommendTopAssignee(env, db, projectId, roleKey ? { roleKey } : {});
        if (!pick) continue;
        const set: Record<string, unknown> = { assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null, updatedAt: new Date() };
        let label = '';
        if (pick.memberKind === 'human') { set.assignedUserId = pick.memberRef; label = `teammate ${pick.memberRef}`; }
        else if (pick.memberKind === 'cloud_agent') { set.assignedAgentRef = pick.memberRef; label = `agent ${pick.memberRef}`; }
        else { const hid = Number(pick.memberRef); if (Number.isFinite(hid)) { set.assignedAgentHostId = hid; label = `host agent ${hid}`; } }
        if (!label) continue;
        await db.update(tasks).set(set).where(eq(tasks.id, t.id));
        summary.assigned += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'assign',
          summary: `Assigned "${t.title}" to ${label}.`,
          detail: { memberKind: pick.memberKind, memberRef: pick.memberRef },
        });
      } catch { /* skip */ }
    }
  }

  // 4. PR — conduct (open) PRs for finished work, then merge/close per policy. ---
  await coordinatePullRequests(env, db, runtimeService, { tenantId, projectId, policy, managed, summary, runTaskId });

  // 5. DISPATCH — kick the top-ranked runnable tickets NOW, in priority order. ---
  // Skipped on the cron path (the autonomous executor sweep owns dispatch there — see
  // shouldDispatch above). Re-read so rank + fresh assignments are reflected; the
  // dispatcher (idempotent) still gates each ticket on gate/capability/live-run.
  if (shouldDispatch) {
  const runnable = await db
    .select({ id: tasks.id, status: tasks.status, managerRank: tasks.managerRank })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, RUNNABLE),
      or(sql`${tasks.assignedAgentRef} is not null`, sql`${tasks.assignedAgentHostId} is not null`),
    ))
    .orderBy(sql`${tasks.managerRank} asc nulls last`, asc(tasks.updatedAt))
    .limit(MAX_DISPATCHES_PER_RUN);
  for (const t of runnable) {
    try {
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId, projectId, taskId: t.id, status: t.status, submittedBy,
      });
      if (started) {
        summary.dispatched += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'dispatch',
          summary: `Started work on ticket #${t.id} (rank ${t.managerRank ?? '—'}).`,
        });
      }
    } catch { /* skip */ }
  }
  }

  // 6. AUDIT — check each managed ticket for role/diagnostic coverage and flag any
  // that skipped a required role or diagnostic (pillar 1). Recomputes the ticket
  // audit ledger; flagged tickets already recorded a 'flag' manager action inside.
  {
    const auditService = new TicketAuditService(db);
    for (const t of managed.slice(0, MAX_AUDITS_PER_RUN)) {
      try {
        const result = await auditService.computeAudit(env, tenantId, t.id);
        summary.audited += 1;
        if (result.status === 'flagged') summary.flagged += 1;
      } catch { /* skip this ticket */ }
    }
  }

  // Credit the acting identity: when a specific agent is the manager, journal that it
  // ran (with its persona/model) so the feed attributes the pass to the teammate, not
  // an anonymous "system". No noise for the default system manager.
  if (identity.agentRef && (summary.scored || summary.ranked || summary.assigned || summary.dispatched)) {
    await recordManagerAction(db, {
      tenantId, projectId, runTaskId, actionType: 'manage',
      summary: `${identity.label} managed the board${identity.personaDirective ? ' with its persona' : ''}.`,
      detail: { managerRef: policy.managerRef, model: identity.model, hasPersona: !!identity.personaDirective },
    });
  }

  // AUDIT: one per-pass event on the unified activity log so a human on ANY screen
  // (the activity/audit timeline, cross-surface) can see the manager took action —
  // not just someone sitting on the Manager tab. One summary event per pass (not one
  // per scored ticket) keeps the audit trail meaningful, not flooded. Attributed to
  // the actual manager agent when one is designated, else the system "AI Manager".
  // Best-effort (recordActivity never throws). Skipped on an idle pass (nothing done).
  const didSomething =
    summary.scored || summary.ranked || summary.assigned ||
    summary.dispatched || summary.prsConducted || summary.prsMerged || summary.flagged;
  if (didSomething) {
    const actor = identity.agentRef
      ? cloudAgentActor(identity.agentRef, identity.label || 'AI Manager')
      : { ...SYSTEM_ACTOR, name: 'AI Manager' };
    await recordActivity(env, db, {
      tenantId, projectId, actor,
      verb: 'manager.pass',
      targetType: 'project', targetId: projectId,
      summary:
        `Managed the backlog — scored ${summary.scored}, ranked ${summary.ranked}, ` +
        `assigned ${summary.assigned}, dispatched ${summary.dispatched}, ` +
        `PRs ${summary.prsConducted + summary.prsMerged}` +
        `${summary.flagged ? `, flagged ${summary.flagged}` : ''}.`,
      metadata: {
        scored: summary.scored, ranked: summary.ranked, assigned: summary.assigned,
        dispatched: summary.dispatched, prsConducted: summary.prsConducted,
        prsMerged: summary.prsMerged, flagged: summary.flagged,
        trigger: submittedBy, managerType: policy.managerType, coachingApplied: coachingDirectives.length,
      },
    });
  }

  // Stamp the run so the surface + cadence can show "last managed …".
  await db.update(projectManagerConfigs)
    .set({ lastRunAt: new Date() })
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .catch(() => {});

  return summary;
}

/**
 * PR coordination for one project:
 *   • CONDUCT — a finished-but-parked ticket (in review, has a branch, no PR, no live
 *     run) gets advanced to Done under any non-'queue' policy, opening its PR through
 *     the shared finalize path.
 *   • MERGE   — open PRs are merged + closed per policy: 'immediate' merges now,
 *     'on_green' merges only once CI is green, 'queue' leaves them for a human.
 */
async function coordinatePullRequests(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  ctx: {
    tenantId: number; projectId: number; policy: EffectiveManagerPolicy;
    managed: ManagedTaskRow[]; summary: ManagerRunSummary; runTaskId: number | null;
  },
): Promise<void> {
  const { tenantId, projectId, policy, managed, summary, runTaskId } = ctx;

  // CONDUCT: open PRs for review-complete cloud tickets (skip under 'queue').
  if (policy.prMergePolicy !== 'queue') {
    const reviewReady = managed
      .filter((t) => t.status === TaskStatus.IN_REVIEW && t.assignedAgentRef && t.gitBranch && !t.githubPrUrl)
      .slice(0, MAX_PR_ACTIONS_PER_RUN);
    // One scan for in-flight runs across ALL review-ready tasks instead of a
    // listByTask() round-trip per task (N+1). listActiveByTasks already filters
    // to the non-terminal statuses (the former ACTIVE_EXEC set), so any task with
    // a returned execution still has a live run.
    const liveExecs = reviewReady.length
      ? await runtimeService.listActiveByTasks(reviewReady.map((t) => t.id))
      : [];
    const liveTaskIds = new Set<number>(liveExecs.map((e) => e.taskId as unknown as number));
    for (const t of reviewReady) {
      try {
        if (liveTaskIds.has(t.id)) continue; // still working — leave it
        await db.update(tasks)
          .set({ status: TaskStatus.DONE, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
        await dispatchTaskFinalize(env as never, db, tenantId, t.id, {
          assignedAgentHostId: t.assignedAgentHostId,
          assignedAgentRef: t.assignedAgentRef,
          gitBranch: t.gitBranch,
          githubPrUrl: t.githubPrUrl,
          title: t.title,
        });
        summary.prsConducted += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
          summary: `Review complete — opened PR for "${t.title}".`,
        });
      } catch { /* skip */ }
    }
  }

  // MERGE + CLOSE open PRs per policy.
  if (policy.prMergePolicy === 'queue') return;
  const openPrs = await db
    .select({
      id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId,
      buildStatus: pullRequests.buildStatus, repoId: pullRequests.repoId, updatedAt: pullRequests.updatedAt,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.tenantId, tenantId), eq(pullRequests.projectId, projectId), eq(pullRequests.status, 'open')))
    .limit(MAX_PR_ACTIONS_PER_RUN);
  const activePrRuns = openPrs.some((pr) => pr.taskId != null)
    ? await runtimeService.listActiveByTasks(openPrs.flatMap((pr) => pr.taskId == null ? [] : [pr.taskId])).catch(() => [])
    : [];
  const activePrTaskIds = new Set<number>(activePrRuns.map((e) => e.taskId as unknown as number));
  for (const pr of openPrs) {
    try {
      // A previous conflict-resolution run owns this branch until it finishes.
      if (pr.taskId != null && activePrTaskIds.has(pr.taskId)) continue;

      // Always integrate the latest base first. This prevents a queue of agent PRs
      // from all being merged against the same stale main revision.
      const prepared = await updateRecordedPullRequestBranch(db, env, { tenantId, prId: pr.id });
      if (!prepared.ok) {
        const task = pr.taskId == null ? null : managed.find((t) => t.id === pr.taskId) ?? null;
        let recoveryStarted = false;
        if (prepared.code === 'conflict' && task && (task.assignedAgentRef || task.assignedAgentHostId != null)) {
          const recoveryNote = `\n\n[Manager recovery] PR #${pr.number ?? '?'} conflicts with the latest base branch. Sync the latest base, resolve every conflict while preserving both sets of intended changes, run the relevant checks, and update the existing PR.`;
          await db.update(tasks).set({
            status: TaskStatus.IN_PROGRESS,
            completedAt: null,
            description: task.description?.includes('[Manager recovery]')
              ? task.description
              : `${task.description ?? ''}${recoveryNote}`.trim(),
            updatedAt: new Date(),
          }).where(eq(tasks.id, task.id));
          recoveryStarted = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
            tenantId, projectId, taskId: task.id, status: TaskStatus.IN_PROGRESS,
            submittedBy: `manager:conflict-resolution:${policy.managerRef ?? 'system'}`,
          });
        }
        await recordManagerAction(db, {
          tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: 'flag',
          summary: recoveryStarted
            ? `PR #${pr.number ?? '?'} conflicts with the latest base; started its ticket agent to resolve and update it.`
            : `Could not update PR #${pr.number ?? '?'} from the latest base: ${prepared.error}`,
          detail: { code: prepared.code, recoveryStarted },
        });
        continue;
      }
      if (prepared.updated) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: 'sync_pr',
          summary: `Updated PR #${pr.number ?? '?'} with the latest base branch before merge.`,
        });
        // Both GitHub updates and GitLab rebases are accepted asynchronously. Never
        // race the provider by merging the old head in this pass. The next manager
        // pass observes the current head; on-green also polls CI for that new commit.
        continue;
      }
      // 'on_green' waits for CI to pass. Don't depend on the inbound CI webhook — POLL
      // the provider's live status ourselves (self-trigger), persisting the verdict, so
      // an on_green PR merges even on a repo with no webhook installed. 'immediate'
      // policy skips the poll (it merges regardless of CI).
      if (policy.prMergePolicy === 'on_green') {
        const live = await pollPrCiStatus(env, db, tenantId, pr);
        if (live !== 'success') continue; // still pending or red — leave it for the next tick
      }
      const result = await mergeRecordedPullRequest(db, env, {
        tenantId, prId: pr.id, method: 'squash', mergedBy: `manager:${policy.managerRef ?? 'system'}`,
      });
      if (!result.ok) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: 'flag',
          summary: `Could not merge PR #${pr.number ?? '?'}: ${result.error}`,
          detail: { code: result.code },
        });
        continue;
      }
      summary.prsMerged += 1;
      // Ticket completion now happens inside mergeRecordedPullRequest (the shared
      // merge core), so the manager, the human "Approve & Merge" and the green-CI
      // auto-merge all complete the ticket via the ONE completeTaskOnMerge path —
      // which also records the lifecycle transition/DORA the old direct update skipped.
      await recordManagerAction(db, {
        tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: 'merge_pr',
        summary: `Merged & closed PR #${pr.number ?? '?'}${result.merged ? '' : ' (already up to date)'} — ticket done.`,
        detail: { sha: result.sha },
      });
    } catch { /* skip */ }
  }
}

/**
 * A project is "auto-staffed" when its board has ANY swimlane agent assignment —
 * used by the sweep as a cheap superset filter for projects the manager should even
 * look at when there is no explicit config row. (A project with an explicit enabled
 * config always qualifies regardless.)
 */
export async function projectHasBoardStaffing(db: Db, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(swimlaneAgentAssignments)
    .innerJoin(swimlanes, eq(swimlanes.id, swimlaneAgentAssignments.swimlaneId))
    .innerJoin(boards, eq(boards.id, swimlanes.boardId))
    .where(eq(boards.projectId, projectId))
    .limit(1);
  return !!row;
}
