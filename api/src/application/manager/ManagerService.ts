import { reportCaughtError } from '../observability/caughtErrorReporter';
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
 *   2.5 SCHEDULE — place every UNDATED ticket on the timeline in rank order, honouring
 *                the project's task_dependencies DAG (0364). Ranking says what comes
 *                first; this says WHEN, which is what the planning spine, the Gantt,
 *                the calendar — and step 2's own urgency term — actually read.
 *   3. ASSIGN  — give unowned work to the best-fit teammate/agent (so nothing sits
 *                invisible to autonomy).
 *   4. PR      — CONDUCT (open) PRs for finished work. MERGING is NOT here: it is its
 *                own registry sweep (`application/repos/prMergeSweep.ts`) with its own
 *                budget, because a mechanical provider-bound loop measured at 93% of
 *                this pass must not be able to starve the judgement it sits inside.
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
import { cronSweepEnabled, readCronControls } from '../runtime/cronControls';
import type { RuntimeService } from '../runtime/RuntimeService';
import {
  tasks, boards, swimlanes, pullRequests,
  projectManagerConfigs, managerActions, managerRuns, managerStallWatch, projects, featureScores, taskFileChanges,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskStatus, TaskPriority, NON_TERMINAL_TASK_STATUSES } from '../../domain/shared/types';
import { notSystemTask } from '../task/taskScope';
import { nextProjectKeySeqBase } from '../task/taskKeys';
import { rankBacklog, type RankableTask, type TaskPriorityTier } from './prioritize';
import { listProjectDependencies } from '../task/taskDependencies';
import { scheduleItems, estimateDaysFromStoryPoints } from '../planning/scheduleWork';
import { assigneeKeyOf, loadSchedulingContext } from '../planning/schedulingContext';
import { planVerdictCounts, summarizePlanVerdict } from '../planning/planVerdict';
import {
  heuristicBusinessValue, riceBusinessValueFromFeature, normalizeFeatureName,
  type FeatureScoreRow, type ScoredValue,
} from './businessValue';
import { scoreBusinessValueAI } from './businessValueAI';
import {
  resolveManagerAssignee,
  type EffectiveManagerPolicy, type ManagerConfigRow,
} from './managerPolicy';
// The policy ROWS live in their own leaf store so the census (which must consult the
// policy) can read it without a static cycle back through this module — see
// managerPolicyStore.ts. Re-exported here because this module has always been the
// manager's public surface and every existing caller imports them from it.
export {
  getManagerConfigRow, getTenantManagerDefaults, upsertTenantManagerDefaults,
  getEffectiveManagerPolicy, getProjectManagerState, upsertManagerConfig,
  type ManagerConfigRowWithMeta, type TenantManagerDefaultsPatch,
} from './managerPolicyStore';
import { getEffectiveManagerPolicy, getManagerConfigRow, getProjectManagerState } from './managerPolicyStore';
import { countPrMergesSince, recordManagerAction, recordManagerActionOnChange, stateFingerprint } from './managerActionJournal';
import { resolveManagerIdentity } from './managerIdentity';
import { resolveManagerTypeById } from './managerTypes';
import { listActiveManagerDirectives } from './managerDirectives';
import { RoleAssignmentService, type AssigneeKind } from '../kanban/roleAssignmentService';
import { assignTicketOwner } from './assignOwner';
import { classifySignoffOwnership, resolveRequiredSignoffGate } from '../kanban/signoffGate';
import { driveOutstandingSignoffs } from '../kanban/driveSignoffs';
import { decideTicketReadiness, type CompletionShape, type TicketPrState } from './evaluateTicketReadiness';
import { normalizeBuildStatus, pickCurrentPr } from '../../domain/task/buildStatus';
import { classifyDeliverablePaths } from '../delivery/deliverableEvidence';
import {
  runStallTriage, loadBulkSignals, describeTriageDeferral,
  MAX_TRIAGE_DISPATCHES_PER_RUN, TRIAGE_PASS_STATE_KEY,
} from './triageStage';
import { computeStallCensus, invalidateStallCensus } from './stallCensus';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import {
  staffUnfilledLanes, describeLaneStaffing, distinctTaskShapes,
  laneStaffingFingerprint, BOARD_STAFFING_STATE_KEY,
} from './staffUnfilledLanes';
import { loadPassRotation, savePassRotation } from './passRotation';
import { invalidateDailyDigest } from './dailyDigest';
import { raiseSystemicFindings } from './systemicDiagnosis';
import { dispatchTaskFinalize } from '../../presentation/routes/taskRoutes';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import { TicketAuditService } from '../audit/ticketAuditService';
import { coordinateTicket } from './coordinateTicket';
import {
  createTickDispatchBudget, tenantDispatchReserver, MAX_TENANT_DISPATCHES_PER_TICK,
  type DispatchReserver, type TickDispatchBudget,
} from '../runtime/tickDispatchBudget';
import { recordActivity, cloudAgentActor, SYSTEM_ACTOR } from '../activity/activityLog';
import { completeTaskOnMerge } from '../task/taskLifecycle';

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

// ── THE PASS BUDGET LIVES IN ITS OWN LEAF MODULE ────────────────────────────────
// `passBudget.ts`. It was extracted when the PR merge loop became its own registry
// sweep (`application/repos/prMergeSweep.ts`): that sweep is bounded by the same
// budget with the same "check between units, never mid-write" contract, and a sweep in
// `repos/` should not have to import this 2,500-line module for a clock. Re-exported
// here because every existing caller imports these from ManagerService.
export {
  MANAGER_PASS_BUDGET_MS, MANAGER_TRIAGE_RESERVE_MS, MIN_DISPATCH_WINDOW_MS,
  createPassBudget, type PassBudget,
} from './passBudget';
import {
  MANAGER_PASS_BUDGET_MS, MANAGER_TRIAGE_RESERVE_MS, MIN_DISPATCH_WINDOW_MS,
  createPassBudget, type PassBudget,
} from './passBudget';

const MAX_DISPATCHES_PER_RUN = 12;
const MAX_AUDITS_PER_RUN = 40;
/** Coordinator ticks per pass — each can rewind a lane + start a run, so pace them. */
const MAX_REMEDIATIONS_PER_RUN = 10;
/** Time for a merged remediation to deploy and affect the next census before a still-live
 * cohort is treated as failed verification and its objective is reopened. */
const SYSTEMIC_VERIFICATION_GRACE_MS = 30 * 60_000;

// ── THE PR ACTION VOCABULARY MOVED TO THE JOURNAL ───────────────────────────────
// `managerActionJournal.ts`. The merge loop that WROTE these types is now its own
// registry sweep (`application/repos/prMergeSweep.ts`), and this pass only READS the
// result — so the constants belong to the journal both of them share rather than to
// either. Re-exported because existing callers (and the ceiling contract test) import
// `PR_ACTION_TYPES` from here.
export {
  PR_ACTION_TYPES, MERGE_BLOCKED_ACTION, MERGE_FAILED_ACTION, PR_CONFLICT_ACTION,
} from './managerActionJournal';

export interface ManagerRunSummary {
  projectId: number;
  skipped: boolean;
  reason?: string;
  scored: number;
  ranked: number;
  /** Previously-undated tickets this pass placed on the timeline (0364). */
  scheduled: number;
  assigned: number;
  prsConducted: number;
  prsMerged: number;
  dispatched: number;
  /** Tickets audited for role/diagnostic coverage, and how many were flagged. */
  audited: number;
  flagged: number;
  /** Flagged tickets the manager actually acted on (Coordinator moved or dispatched). */
  remediated: number;
  /** Flagged tickets left for the next pass because the per-pass cap was hit. */
  remediationDeferred: number;
  /** Tickets diagnosed as STALLED this pass (see `stallTriage`). */
  stalled: number;
  /** Stalled tickets the manager applied its own remedy to. */
  unstuck: number;
  /** Stalled tickets handed to a human — the manager's remedy is not working. */
  escalated: number;
  /** Previously-stalled tickets that started moving again, closing their register row. */
  stallsResolved: number;
  /** Orphaned "backlog management pass" cards this pass closed (see {@link reapStaleManagerRunTasks}). */
  staleRunTasksClosed: number;
  /**
   * Stalled tickets across the WHOLE project, from the bulk census — not the bounded
   * `stalled` count above.
   *
   * Both are reported because they answer different questions and conflating them is
   * what hid the problem: `stalled` is how many the deep stage diagnosed this pass (max
   * 12), `censusStalled` is how many there actually are. When the second is an order of
   * magnitude larger than the first, per-ticket remediation cannot keep up — which is
   * precisely the condition the systemic stage exists to detect.
   */
  censusStalled: number;
  /** The largest stall cohort's cause — "what is holding up the most work". */
  censusTopCause: string | null;
  /** Systemic findings raised this pass (a cohort judged a platform defect). */
  systemicFindings: number;
  /** Platform-fix tickets those findings opened. */
  systemicTicketsCreated: number;
  /**
   * Stages this pass SHED because it ran out of wall-clock (see MANAGER_PASS_BUDGET_MS).
   * Empty on a complete pass.
   *
   * This field exists because a truncated pass and a complete one used to be
   * indistinguishable: the pass was evicted mid-PR-loop for two weeks, and because the
   * closing row was never written at all, nothing anywhere said so. Reporting an honest
   * "I did not get to triage" is the difference between a manager that is behind and a
   * manager that appears to have found nothing wrong.
   */
  truncated: string[];
}


// The journal WRITER lives in its own leaf store — `recordManagerActionOnChange` has to
// read the feed before writing to it, and this module is where nearly every writer lives.
// Re-exported because ManagerService has always been the manager's public surface and
// every existing caller imports it from here (same arrangement as managerPolicyStore).
export {
  recordManagerAction, recordManagerActionOnChange, stateFingerprint,
  type ManagerActionInput,
} from './managerActionJournal';
import { laneAgentAssignments, laneJoinOn } from '../swimlane/laneAgentAssignments';

export interface ManagerActionRow {
  id: string; taskId: number | null; ticketKey: string | null; ticketTitle: string | null;
  actionType: string; summary: string; detail: string | null; createdAt: Date;
}

/**
 * The newest manager actions for a project (the activity feed).
 *
 * A 'flag' is a STATE ("this ticket is missing these checks"), not an event, so it
 * is written only when the verdict actually changes (`verdictSignature`) — the feed
 * carries one row per distinct verdict, not one per pass. Historical duplicates were
 * collapsed by migration 0344, so this read needs no de-duplication.
 */
export async function listManagerActions(
  db: Db, tenantId: number, projectId: number, limit = 50,
): Promise<ManagerActionRow[]> {
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
/**
 * The statuses a manager run task can be sitting in while it still looks "open" on
 * the board. Shared by the reaper and the pre-create reconcile so both agree.
 */
const OPEN_RUN_TASK_STATUSES: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW,
];

/**
 * A manager pass runs inside a Worker invocation and cannot legitimately take
 * anywhere near this long — the platform's own execution wall is far below it. So an
 * open run task older than this did not "take a while", it DIED: the Worker was
 * evicted between minting the visibility card and the finally block that closes it.
 */
export const STALE_RUN_TASK_MS = 30 * 60_000;

/**
 * Close manager run tasks that are still open but can no longer be running.
 *
 * WHY THIS IS ITS OWN FUNCTION, CALLED FROM THE PASS
 * This reconcile used to live only inside {@link createManagerRunTask} — meaning it ran
 * only when a human clicked "Run manager now". Cron passes never mint a run task, so
 * they never reaped one either. A pass whose Worker died therefore left an
 * "In progress" card on the Manager surface until the next MANUAL run, however long
 * that took: an observed card sat in progress for SEVEN DAYS while cron passes ran
 * successfully every five minutes the whole time.
 *
 * `olderThanMs = 0` closes every open card (what the pre-create reconcile wants —
 * a new pass supersedes any older one regardless of age). A positive value closes
 * only cards too old to still be live, which is what the pass itself wants: it must
 * never reap the card representing the pass currently running.
 */
export async function reapStaleManagerRunTasks(
  db: Db,
  args: { projectId: number; olderThanMs: number },
): Promise<number> {
  try {
    const now = new Date();
    const rows = await db.update(tasks).set({
      status: TaskStatus.BLOCKED,
      description: 'Closed before a newer backlog management pass started; the prior background run did not report completion.',
      lastWorkedAt: now,
      updatedAt: now,
    }).where(and(eq(tasks.projectId, args.projectId), eq(tasks.source, 'manager'), inArray(tasks.status, OPEN_RUN_TASK_STATUSES), ...(args.olderThanMs > 0
        ? [sql`${tasks.updatedAt} < ${new Date(now.getTime() - args.olderThanMs)}`]
        : []))).returning({ id: tasks.id });
    return rows.length;
  } catch {
    return 0; // reconciling a visibility card must never fail a pass
  }
}

export async function createManagerRunTask(
  db: Db,
  args: { tenantId: number; projectId: number; policy: EffectiveManagerPolicy },
): Promise<number | null> {
  const { tenantId, projectId, policy } = args;
  try {
    // A Worker can be evicted after starting a pass but before its finally block
    // closes the visibility card. Reconcile those orphaned/open cards first so the
    // Manager surface never accumulates multiple active passes. A NEW pass supersedes
    // any older one, so this closes them all regardless of age.
    const now = new Date();
    await reapStaleManagerRunTasks(db, { projectId, olderThanMs: 0 });

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
      } catch (error) {
        /* likely a unique-key collision — try the next sequence number */
      
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "createManagerRunTask" });
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
  args: { taskId: number; summary: ManagerRunSummary; ok: boolean; tenantId?: number; segmentId?: string | null },
): Promise<void> {
  const { taskId, summary, ok } = args;
  try {
    const now = new Date();
    const line =
      `Scored ${summary.scored} · ranked ${summary.ranked} · assigned ${summary.assigned} · ` +
      `PRs ${summary.prsConducted + summary.prsMerged} · dispatched ${summary.dispatched} · ` +
      `audited ${summary.audited}${summary.flagged ? ` (${summary.flagged} flagged)` : ''}` +
      // A pass that shed stages says WHICH, on the run card itself. The diagnostics
      // report parses this line, so the truncation reaches the operator on the same
      // surface that used to show a bounded pass as a clean one.
      `${summary.truncated?.length ? ` · deferred: ${summary.truncated.join(', ')}` : ''}.`;
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

    // ── THE SAME OUTCOME, AS DATA (migration 1082) ────────────────────────────
    //
    // The sentence above is for a human reading the run card. This row is for every
    // query that used to be impossible: "did this pass change anything?" (the manager's
    // load-bearing failure mode, previously detected by regexing that sentence), "how
    // many passes scored anything this month?", and the pass-history chart. Written
    // beside the description rather than instead of it, and upserted on `run_task_id` so
    // a retried finalize cannot produce two rows for one pass.
    const tenantId = args.tenantId ?? await resolveRunTaskTenant(db, taskId);
    if (tenantId != null) {
      await db.insert(managerRuns).values({
        tenantId,
        segmentId: args.segmentId ?? null,
        projectId: summary.projectId,
        runTaskId: taskId,
        ok,
        changed: managerPassChangedSomething(summary),
        shedStages: summary.truncated?.length ? summary.truncated.join(',') : null,
        summary,
        createdAt: now,
      }).onConflictDoUpdate({
        target: [managerRuns.runTaskId],
        set: {
          ok,
          changed: managerPassChangedSomething(summary),
          shedStages: summary.truncated?.length ? summary.truncated.join(',') : null,
          summary,
          createdAt: now,
        },
      });
    }
  } catch (error) {
    /* best-effort */
  
    reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "finalizeManagerRunTask" });
  }
}

/**
 * Did this pass CHANGE anything? PURE.
 *
 * The manager's most consequential failure is a pass that runs to completion, reports
 * success, and moves nothing — every counter zero. It used to be detected by regexing
 * the run card's English summary, which meant the detection depended on the wording of a
 * UI string. This is the same question asked of the structure.
 *
 * A SKIPPED pass is not "unchanged" — it never ran, so it is excluded from the judgement
 * by being marked `changed: false` alongside `ok`, and read together those two say
 * "nothing happened because nothing was attempted".
 */
export function managerPassChangedSomething(s: ManagerRunSummary): boolean {
  if (s.skipped) return false;
  return (
    s.scored > 0 || s.ranked > 0 || s.scheduled > 0 || s.assigned > 0
    || s.prsConducted > 0 || s.prsMerged > 0 || s.dispatched > 0
    || s.flagged > 0 || s.remediated > 0
    || s.unstuck > 0 || s.escalated > 0 || s.stallsResolved > 0
    || s.systemicFindings > 0 || s.systemicTicketsCreated > 0
    || s.staleRunTasksClosed > 0
  );
}

/** The tenant that owns a run task, for callers that finalize without one in hand. */
async function resolveRunTaskTenant(db: Db, taskId: number): Promise<number | null> {
  const [row] = await db
    .select({ tenantId: projects.tenantId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.tenantId ?? null;
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
  args: {
    tenantId: number; projectId: number; directive: string;
    createdBy?: string | null; submittedBy?: string;
    /** Explicit title. Defaults to the directive's first line (the coaching behaviour). */
    title?: string;
    /**
     * `tasks.task_type`. The systemic-findings path files `'gap'` so a platform defect
     * groups with the diagnostics engine's existing gap tickets instead of looking like
     * ordinary feature work. Defaults to `'task'` — the column default, i.e. exactly the
     * coaching behaviour before this parameter existed.
     */
    taskType?: 'task' | 'gap';
    /**
     * Fire the lane trigger the moment the ticket is created. Default true — a human
     * coaching the manager ("go do this") means it now.
     *
     * Systemic findings opt in: their measured remediation is an executable recovery
     * objective, assigned to an agent below and verified by subsequent censuses.
     */
    autoDispatch?: boolean;
    /** Force this work onto an executable agent. Used by systemic remediation, where
     * assigning the fix back to a person would recreate the human dead end it diagnoses. */
    autoAssignAgent?: boolean;
  },
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

    const policy = await getEffectiveManagerPolicy(db, tenantId, projectId, env);
    const assignee = resolveManagerAssignee(policy.managerRef);
    const baseSeq = await nextProjectKeySeqBase(db, projectId);
    const title = (args.title ?? directive.split('\n', 1)[0] ?? directive).trim().slice(0, 120) || 'Manager task';
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
            taskType: args.taskType ?? 'task',
            assignedUserId: assignee.assignedUserId,
            assignedAgentRef: assignee.assignedAgentRef,
            assignedAgentHostId: assignee.assignedAgentHostId,
            startDate: now, lastWorkedAt: now, updatedAt: now,
          })
          .returning({ id: tasks.id });
        taskId = row?.id ?? null;
        break;
      } catch (error) { /* likely a unique-key collision — try the next sequence number */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "createManagerCoachingTask" });
      }
    }
    if (taskId == null) return null;

    if (args.autoAssignAgent) {
      await assignTicketOwner(env, db, {
        projectId, taskId, actionType: 'code', agentOnly: true, roleKeyOverride: 'developer',
      });
    }

    // Immediacy: if the manager is an agent and the lane is staffed, start now — else the
    // manager's next pass (step 5 dispatch) picks up the assigned runnable ticket anyway.
    if (args.autoDispatch !== false) {
      try {
        // dispatch-budget: exempt — a HUMAN filed this coaching directive and expects to
        // see work start on the click. The autonomous tick ceiling governs the cron
        // sweeps, not a person's explicit action, exactly as "Run now" overrides a
        // breaker. It is bounded by the human, not by a loop.
        await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId, status: TaskStatus.TODO,
          submittedBy: args.submittedBy ?? `coach:${args.createdBy ?? 'human'}`,
        });
      } catch (error) { /* dispatch is best-effort; autonomy still picks it up */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "createManagerCoachingTask" });
      }
    }
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
  } catch (error) { /* roster sync is best-effort */ 
    reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "syncManagerRosterRole" });
  }
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
      for (const op of chunk) { try { await (op as Promise<unknown>); } catch (error) { /* skip this write */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "flushBatched" });
      } }
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
  /** Needed by the SCHEDULE pass: a ticket is "unscheduled" only when BOTH are null. */
  startDate: Date | null;
  dueDate: Date | null;
  storyPoints: number | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  gitBranch: string | null;
  githubPrUrl: string | null;
  createdAt: Date;
  /** Needed by the review evaluation to answer "was this supposed to produce code?". */
  taskType: string | null;
  actionType: string | null;
  /** Read by the stall census to recognise a non-executable or unapproved-feedback ticket. */
  source: string | null;
  /** The rank already persisted — the RANK stage writes only the tickets whose rank moved. */
  managerRank: number | null;
}

/**
 * The tickets one pass may groom, rank, audit and triage — capped at {@link MAX_RANKED}.
 *
 * ── WHY THE ORDER IS NOT `created_at asc` ────────────────────────────────────────
 * It was, and a fixed cap over a fixed order is a window that never moves. On project 11
 * (676 open tickets, cap 300) the SAME 300 oldest tickets were loaded every pass, forever:
 * they were long since scored and owned, so every pass reported `scored 0 · assigned 0`
 * and completed successfully — while 375 unscored and 339 unowned tickets sat outside the
 * window with no path to ever entering it. The manager was not failing to groom the
 * backlog; it could not SEE the part of the backlog that needed grooming. Two capabilities
 * (`autoBusinessValue`, `autoAssign`) reported healthy and did nothing for 14 days.
 *
 * Open stall-register rows come first because triage must grade remedies it already
 * attempted before discovering more work. Without that carry-forward, a project with
 * more unowned tickets than the window can exclude its oldest reset/sign-off remedies
 * forever. After those accountability rows, the window is ordered by GROOMING NEED —
 * unscored, then unowned — and only then by least-recently-touched.
 */
export function managedTasksQuery(db: Db, projectId: number) {
  return db
    .select({
      id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status,
      priority: tasks.priority, businessValue: tasks.businessValue, businessValueSource: tasks.businessValueSource,
      startDate: tasks.startDate, dueDate: tasks.dueDate, storyPoints: tasks.storyPoints,
      assignedUserId: tasks.assignedUserId, assignedAgentRef: tasks.assignedAgentRef,
      assignedAgentHostId: tasks.assignedAgentHostId, gitBranch: tasks.gitBranch, githubPrUrl: tasks.githubPrUrl,
      createdAt: tasks.createdAt, taskType: tasks.taskType, actionType: tasks.actionType,
      source: tasks.source,
      // The rank ALREADY PERSISTED, so the RANK stage can write only what changed
      // rather than re-stamping an identical order every five minutes. One column on a
      // query the pass already runs — see the stage for what it was costing.
      managerRank: tasks.managerRank,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL_TASK_STATUSES), // The manager never grooms/ranks/audits its OWN run tasks (source = 'manager').
      notSystemTask))
    .orderBy(
      sql`case when exists (
        select 1 from ${managerStallWatch}
        where ${managerStallWatch.taskId} = ${tasks.id}
          and ${managerStallWatch.resolvedAt} is null
      ) then 0 else 1 end`,
      sql`case when ${tasks.businessValue} is null then 0 else 1 end`,
      sql`case when ${tasks.assignedUserId} is null and ${tasks.assignedAgentRef} is null and ${tasks.assignedAgentHostId} is null then 0 else 1 end`,
      asc(tasks.updatedAt),
      asc(tasks.createdAt),
    )
    .limit(MAX_RANKED);
}

/**
 * Exported as a QUERY (not just its rows) so the window's ordering can be rendered with
 * `.toSQL()` and asserted without a database. The defect it replaced was invisible in the
 * result shape and visible only in the ORDER BY, so that is what the test has to read.
 */
async function loadManagedTasks(db: Db, projectId: number): Promise<ManagedTaskRow[]> {
  return managedTasksQuery(db, projectId);
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

/**
 * Managed tickets per lane key (= status), for the WHOLE project.
 *
 * Deliberately not derived from the pass's managed window: that is capped at
 * {@link MAX_RANKED}, so a count taken from it understates every lane and can drop a
 * lane to zero — and a zero-count lane is filtered out of the staffing report entirely,
 * which would hide the exact gap the report exists to name.
 */
async function laneTicketCountsByStatus(db: Db, projectId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ status: tasks.status, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), // The same set `loadManagedTasks` windows over, so the count answers the same
      // question the window samples rather than a slightly different one.
      inArray(tasks.status, NON_TERMINAL_TASK_STATUSES)))
    .groupBy(tasks.status)
    .catch((error) => {
      reportCaughtError(error, { source: 'application/manager/ManagerService.ts', operation: 'laneTicketCountsByStatus' });
      return [] as Array<{ status: string; n: number }>;
    });
  return new Map(rows.map((r) => [r.status, Number(r.n) || 0]));
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
  args: {
    tenantId: number; projectId: number; submittedBy?: string; runTaskId?: number | null; dispatch?: boolean;
    /**
     * The TICK's shared per-tenant dispatch ceiling. Every site in this pass that can
     * start a billable run reserves against it BEFORE starting — see
     * {@link tenantDispatchReserver} for the accounting bug that made passing the raw
     * counter and updating it afterwards insufficient.
     *
     * Absent (a manual run, a test) ⇒ a private budget, which preserves standalone
     * behaviour exactly as `tickDispatchBudget` documents.
     */
    dispatchBudget?: TickDispatchBudget;
    /** Platform PR kill switch; omitted callers resolve it from KV. */
    prManagementEnabled?: boolean;
  },
): Promise<ManagerRunSummary> {
  const { tenantId, projectId } = args;
  const runs = tenantDispatchReserver(args.dispatchBudget ?? createTickDispatchBudget(), tenantId);
  const submittedBy = args.submittedBy ?? 'system:manager';
  // DISPATCH ownership: on the cron path the always-on autonomous executor
  // ({@link runAutonomousExecutionSweep}) runs on the SAME tick and is the single
  // dispatcher of ranked/assigned work — so the manager cron sweep does its judgement
  // (value/rank/assign/PR/audit) but SKIPS step 5 to avoid the double-scan noted in the
  // gap register. A manual "Run manager now" (or any non-cron caller) still dispatches
  // immediately so a human sees work start the instant they click. Callers may force
  // either way via `dispatch`.
  const shouldDispatch = args.dispatch ?? (submittedBy !== 'system:manager-cron');
  const prManagementEnabled = args.prManagementEnabled
    ?? cronSweepEnabled(await readCronControls(env), 'pr-ticket-reconciler');
  // The board task representing this run (manual runs only) — every decision below
  // links to it so the run task shows exactly what this pass changed.
  const runTaskId = args.runTaskId ?? null;
  const summary: ManagerRunSummary = {
    projectId, skipped: false, scored: 0, ranked: 0, scheduled: 0, assigned: 0, prsConducted: 0, prsMerged: 0, dispatched: 0,
    audited: 0, flagged: 0, remediated: 0, remediationDeferred: 0,
    stalled: 0, unstuck: 0, escalated: 0, stallsResolved: 0, staleRunTasksClosed: 0,
    censusStalled: 0, censusTopCause: null, systemicFindings: 0, systemicTicketsCreated: 0,
    truncated: [],
  };

  const { policy, managed: projectIsManaged, lastRunAt: previousPassAt } = await getProjectManagerState(db, tenantId, projectId, env);
  // THE OPT-IN, checked on the manual path too. The sweep filters unconfigured projects
  // out in SQL, but "Run manager now" reaches this function directly — and the two must
  // give the same answer, or a button would manage a project the schedule refuses to.
  // See `isProjectManaged`: a project with no config row of its own folds to the
  // hardcoded `enabled: true` default, which is a statement about defaults, not consent.
  if (!projectIsManaged) return { ...summary, skipped: true, reason: 'unconfigured' };
  if (!policy.enabled) return { ...summary, skipped: true, reason: 'disabled' };

  // 0. REAP — close orphaned "backlog management pass" cards from passes whose Worker
  // died. This runs on EVERY pass (cron included), not just when a human clicks Run:
  // the reconcile used to live only in `createManagerRunTask`, so a dead pass's card
  // stayed "In progress" until the next MANUAL run — observed at seven days while cron
  // ran fine every five minutes throughout. Age-bounded so it can never reap the card
  // belonging to the pass running right now.
  summary.staleRunTasksClosed = await reapStaleManagerRunTasks(db, {
    projectId, olderThanMs: STALE_RUN_TASK_MS,
  });

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
  // The pass's wall-clock budget, established AFTER policy resolution (a disabled
  // project returns before it) and before the first stage. See MANAGER_PASS_BUDGET_MS.
  const budget = createPassBudget(now);
  // WHOSE TURN IT IS. When the previous pass ran out of wall-clock before a stage, this
  // one runs ONLY the stages it starved and the rest yield their turn — the guarantee the
  // reserve alone could not keep against a unit larger than the reserve itself. See
  // `passRotation.ts` for the measurement that made a reservation insufficient.
  const rotation = await loadPassRotation(env, tenantId, projectId);
  /**
   * Run `stage` unless the rotation is holding this pass for a starved one. A yielded
   * stage is still reported on the closing row (a silent skip is the failure this whole
   * budget exists to end) but is NOT fed back into the rotation — it was told to wait, it
   * did not run out of time. See `carryOverRotation`.
   */
  const mayRunStage = (stage: string): boolean => {
    if (!prManagementEnabled && stage === 'pr_conduct') return false;
    if (rotation.mayRun(stage)) return true;
    rotation.skip(stage);
    budget.shed(stage);
    return false;
  };
  /** As above, and also false once the discretionary window is spent. */
  const mayStartStage = (stage: string): boolean => {
    if (budget.over()) { budget.shed(stage); return false; }
    return mayRunStage(stage);
  };
  let managed = await loadManagedTasks(db, projectId);

  // The pass's own setup: the rotation read plus `loadManagedTasks` — a 300-row window
  // whose ORDER BY carries a correlated EXISTS over `manager_stall_watch`. Timed like a
  // stage because it is one, and because it runs before anything can be shed.
  budget.mark('load');
  // 0.5 STAFF THE BOARD'S UNFILLED LIFECYCLE ROLES — the cohort fix, ahead of every
  // discretionary stage and outside the rotation.
  //
  // `managed_no_role` was the single largest stall cause on the measured board: 293 of 678
  // stalled tickets, none of which can dispatch at all because their stage authorises a
  // role that binds to no agent. The remedy already existed and was already correct, but
  // it lived only inside a PER-TICKET triage remedy — capped per pass, and in the stage
  // that gets shed — so a project-scope fix could not reach a project-scope problem.
  //
  // The cause is per-LANE, and a board has a few dozen lanes rather than 678 tickets, so
  // it is asked once here: three queries, no writes in the steady state, and a couple of
  // writes when a role is genuinely unfillable. NOT rotatable and NOT budget-shed —
  // everything downstream is blocked on it, and it is cheap enough that shedding it would
  // save nothing worth having.
  const board = await findCanonicalBoard(db, projectId, tenantId);
  if (board) {
    const laneStaffing = await staffUnfilledLanes(env, db, {
      tenantId, projectId, boardId: board.id, hiresUsed: 0,
      // The board's OWN ticket shapes, from the managed set already in hand (0382).
      // Without them the sweep probes a single synthetic plain task, and every
      // requirement scoped to another ticket type or gated by a condition is invisible
      // — which is how 293 tickets sat on `managed_no_role` while this stage reported
      // nothing to do. Deduplicated to a handful of pairs, so it costs no query.
      taskShapes: distinctTaskShapes(managed),
      // What each lane's gap is COSTING. Keyed by STATUS, because that is how a ticket
      // maps to a lane (`swimlanes.key === task.status`); `tasks` carries no swimlane
      // column.
      //
      // From its OWN aggregate, not from `managed`. That set is capped at MAX_RANKED
      // (300 of this project's 712 managed tickets), so counting from it both understates
      // every lane AND — because a lane with a zero count is filtered out entirely —
      // could hide a lane whose tickets all fall outside the window. One indexed GROUP BY
      // over a column the pass already filters on is the right price for a number the
      // whole finding is judged on.
      laneTicketCounts: await laneTicketCountsByStatus(db, projectId),
      // The 0386 grant. Off by default, so the sweep REPORTS an unconfigured lane and
      // leaves it alone — staffing one starts every ticket sitting in it, and the platform
      // cannot tell an intake lane left empty on purpose from one left empty by accident.
      allowAutoStaffLanes: policy.allowAutoStaffLanes,
    });
    const staffingDetail = describeLaneStaffing(laneStaffing);
    if (staffingDetail) {
      summary.remediated += laneStaffing.filled.length;
      const action = {
        tenantId, projectId, taskId: null, runTaskId, actionType: 'assign',
        summary: staffingDetail,
        detail: {
          unfilledRoleKeys: laneStaffing.unfilledRoleKeys,
          filled: laneStaffing.filled.map((f) => ({ roleKey: f.roleKey, action: f.action, agentName: f.agentName })),
          unfillable: laneStaffing.unfillable.map((u) => u.roleKey),
          // The gap with no role key — the reason this decision did not exist at all
          // while 305 tickets sat undispatchable. Carries the lane, why, and the cost.
          unauthorizedLanes: laneStaffing.unauthorizedLanes,
          hires: laneStaffing.hires,
          error: laneStaffing.error,
        },
      };
      // ── EVENT OR STATE? ─────────────────────────────────────────────────────────
      // A sweep that WROTE something (pinned a role, hired for one) is an event: it
      // happened once, at a time, and it belongs in the feed every time it happens. A
      // sweep that only reported — the common case, and the only case while
      // `allowAutoStaffLanes` is off — is a STATE, and re-journalling an unchanged state
      // every five minutes is the measured `decision_loop`: the same 317-ticket verdict
      // three times in the last 30 decisions. Reported once, then again the moment the
      // lanes, their counts, their reason or the sweep's own error actually change.
      if (laneStaffing.filled.length > 0) await recordManagerAction(db, action);
      else await recordManagerActionOnChange(db, {
        ...action,
        stateKey: BOARD_STAFFING_STATE_KEY,
        fingerprint: laneStaffingFingerprint(laneStaffing),
      });
    }
  }

  budget.mark('board_staffing');
  // 1. VALUE — backfill business value on unscored, non-manual tickets. ---------
  // The scoring decision is sequential (AI for the first few, free heuristic for the
  // rest) but the WRITES are collected and flushed in batches: a 200+ ticket backlog
  // would otherwise fire 200+ sequential neon-http round-trips here and risk the
  // Worker being evicted mid-pass. See flushBatched.
  if (policy.autoBusinessValue && mayRunStage('value')) {
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
      // Checked between tickets, never mid-write: the collected `writeOps` are flushed
      // below whatever happens, so shedding here loses only the tickets not yet scored.
      // Up to MAX_AI_SCORES_PER_RUN of these iterations make an LLM call, so this is a
      // genuinely unbounded-latency stage sitting at the very front of the pass.
      if (budget.over()) { budget.shed('value'); break; }
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
            .where(scopedToTenant(tasks, tenantId, eq(tasks.id, t.id))),
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
      } catch (error) { /* skip this ticket */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
      }
    }
    await flushBatched(db, writeOps);
  }

  budget.mark('value');
  // 2. RANK — order the backlog and persist manager_rank (batched writes). -------
  //
  // ── WRITE THE DIFF, NOT THE ORDER ────────────────────────────────────────────
  // This stage re-stamped `manager_rank` on ALL 300 windowed tickets every pass, and it
  // is neither rotatable nor budget-shed — so it spent its full cost before every stage
  // that actually moves a ticket. On a settled backlog the order does not change: project
  // 11, 2026-07-30, journalled `Ranked 300 tickets…` seven times in thirty decisions with
  // a byte-identical top five (score 123.15 each time), which the diagnostics correctly
  // reported as a `decision_loop`. That is ~86,000 no-op UPDATE round-trips a day on one
  // project, on neon-http, on a five-minute path.
  //
  // What it cost is visible in the same capture: three of the last six passes shed EVERY
  // remaining stage — `["value","assign","systemic","pr_conduct","pr_merge","audit",
  // "triage"]` at `elapsedMs` 20405 and 24610 against a 20s budget. The budget was gone
  // before `value`, and RANK is the only expensive thing ahead of it.
  //
  // Ranking is pure derived data (priority × value × urgency), so re-deriving it is free
  // and only the WRITES are worth avoiding. Persisting just the tickets whose rank
  // actually moved turns the steady state into zero writes and zero round-trips, while a
  // genuinely reordered backlog still lands in full. The journal follows the same rule —
  // a decision re-taken every pass with an identical outcome is noise that buries the
  // ones that mattered.
  if (policy.autoPrioritize && managed.length > 0) {
    const ranked = rankBacklog(managed.map(toRankable), now);
    const previousRank = new Map(managed.map((t) => [t.id, t.managerRank]));
    const moved = ranked.filter((r) => previousRank.get(r.taskId) !== r.rank);
    if (moved.length) {
      await flushBatched(db, moved.map((r) => db.update(tasks).set({ managerRank: r.rank }).where(scopedToTenant(tasks, tenantId, eq(tasks.id, r.taskId)))));
    }
    summary.ranked = moved.length;
    if (moved.length) {
      const top = ranked.slice(0, 5).map((r) => {
        const t = managed.find((m) => m.id === r.taskId);
        return { rank: r.rank, taskId: r.taskId, title: t?.title ?? '', score: r.score };
      });
      await recordManagerAction(db, {
        tenantId, projectId, runTaskId, actionType: 'prioritize',
        summary: `Re-ranked ${moved.length} of ${ranked.length} tickets by priority × value × urgency.`,
        detail: { top, reranked: moved.length, windowed: ranked.length },
      });
    }
    // Ranking reorders `managed` for the SCHEDULE pass below, which places work in
    // rank order — the manager's own judgement of what comes first is what decides
    // what gets the earliest window.
    const rankOf = new Map(ranked.map((r) => [r.taskId, r.rank]));
    managed = [...managed].sort(
      (a, b) => (rankOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  budget.mark('rank');
  // 2.5 SCHEDULE — place unscheduled work on the TIMELINE (0364). ----------------
  // The pass that never existed. Ranking answers "what first"; nothing answered
  // "WHEN" or "AFTER WHAT", so `start_date`/`due_date` were null on every ticket the
  // system created — which is why the planning spine rendered "no dates" at every
  // level, and why this pass's OWN urgency term (urgencyScore, above) was scoring an
  // always-null column.
  //
  // Deliberately conservative: it only fills tickets that have NEITHER date, so a
  // human's (or an Epic fan-out's) dates are never overwritten; it schedules in rank
  // order, honouring the project's `task_dependencies` DAG through the same shared
  // planner the Epic fan-out uses; and it sizes each item from its story points when
  // estimated. Idempotent — a second pass finds nothing left unscheduled.
  if (policy.autoSchedule) {
    const unscheduled = managed.filter((t) => t.startDate == null && t.dueDate == null);
    if (unscheduled.length > 0) {
      try {
        const edges = await listProjectDependencies(db, projectId);
        const inScope = new Set(unscheduled.map((t) => t.id));
        // An already-dated predecessor still constrains its successor, so the planner
        // sees every managed ticket — but only the unscheduled ones are WRITTEN.
        const anchorById = new Map(managed.map((t) => [t.id, t]));
        // The constraints the pure planner cannot fetch: the tenant's working week
        // and holidays, each owner's real load, and the sprint cadence. Without them
        // this pass stacked every ticket on one person into the same week and drew
        // work across shutdown days nobody was going to be there for.
        const context = await loadSchedulingContext(env, db, tenantId, projectId).catch((error) => {
          reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "loadSchedulingContext" });
          return null;
        });
        const items = managed.map((t) => ({
          key: String(t.id),
          estimateDays: estimateDaysFromStoryPoints(t.storyPoints),
          afterKeys: edges
            .filter((e) => e.successorTaskId === t.id && anchorById.has(e.predecessorTaskId))
            .map((e) => String(e.predecessorTaskId)),
          assigneeKey: assigneeKeyOf(t),
        }));
        const plan = scheduleItems(items, {
          anchor: new Date(now),
          calendar: context?.calendar,
          capacity: context?.capacity,
          sprints: context?.sprints,
        });
        const writes: unknown[] = [];
        const stampedAt = new Date();
        for (const t of unscheduled) {
          const window = plan.windows.get(String(t.id));
          if (!window) continue;
          writes.push(
            db.update(tasks)
              .set({ startDate: window.startDate, dueDate: window.endDate, updatedAt: stampedAt })
              .where(scopedToTenant(tasks, tenantId, eq(tasks.id, t.id))),
          );
          // Reflect locally so later steps in THIS pass see the fresh window.
          t.startDate = window.startDate;
          t.dueDate = window.endDate;
          summary.scheduled += 1;
        }
        await flushBatched(db, writes);
        if (summary.scheduled > 0) {
          const span = plan.span;
          await recordManagerAction(db, {
            tenantId, projectId, runTaskId, actionType: 'schedule',
            summary:
              `Scheduled ${summary.scheduled} previously-undated ${summary.scheduled === 1 ? 'ticket' : 'tickets'} ` +
              `in rank order${span ? ` across ${span.startDate.toISOString().slice(0, 10)} → ${span.endDate.toISOString().slice(0, 10)}` : ''}` +
              `${edges.length ? `, honouring ${edges.length} dependency ${edges.length === 1 ? 'edge' : 'edges'}` : ''}.`,
            detail: {
              scheduled: summary.scheduled,
              dependencyEdges: edges.length,
              from: span?.startDate.toISOString() ?? null,
              to: span?.endDate.toISOString() ?? null,
              // The FULL planner verdict, through the same primitive the Epic fan-out
              // uses. This used to record `cyclic` alone, so a compressed or
              // overrunning plan left no trace anywhere — two journals with two
              // different ideas of what a plan verdict is, and neither complete.
              ...planVerdictCounts(summarizePlanVerdict(plan)),
              // Owners the plan had to queue behind their own existing work — the
              // evidence for "this date is late because one person is the constraint".
              capacityDeferredTaskIds: plan.capacityDeferred.filter((k) => inScope.has(Number(k))),
            },
          });
        }
      } catch (error) { /* scheduling is best-effort; the rest of the pass stands */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
      }
    }
  }

  budget.mark('schedule');
  // 3. ASSIGN — give unowned runnable tickets to the best-fit teammate/agent. ----
  if (policy.autoAssign && mayRunStage('assign')) {
    const unowned = managed
      .filter((t) => RUNNABLE.includes(t.status) && !t.assignedUserId && !t.assignedAgentRef && t.assignedAgentHostId == null)
      .slice(0, MAX_ASSIGNMENTS_PER_RUN);
    for (const t of unowned) {
      if (budget.over()) { budget.shed('assign'); break; }
      try {
        // Role-aware pick + persist — the ONE implementation shared with the stall
        // triage stage, whose `unassigned` remedy is exactly this (see assignOwner.ts).
        const pick = await assignTicketOwner(env, db, {
          projectId, taskId: t.id, actionType: t.actionType,
        });
        if (!pick.assigned) continue;
        summary.assigned += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'assign',
          summary: `Assigned "${t.title}" to ${pick.label}.`,
          detail: { memberKind: pick.memberKind, memberRef: pick.memberRef },
        });
      } catch (error) { /* skip */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
      }
    }
  }

  budget.mark('assign');
  // 3.5 CENSUS + SYSTEMIC DIAGNOSIS — full-coverage measurement, deliberately EARLY. ---
  //
  // WHY IT RUNS HERE AND NOT AT THE END. It was originally the last stage, after triage,
  // which is where it logically belongs — and it never executed once. A manager pass runs
  // inside a Worker invocation with a hard time budget, and on a real project (11: 673
  // tickets, 354 open PRs) the pass is EVICTED partway through: `manager_actions` shows
  // triage journalling every few minutes, while the `manager.pass` activity row that
  // closes a pass has not been written since 2026-07-13 and `lastRunAt` sat 6 hours
  // stale. Everything positioned after the PR/merge loop was in a dead zone.
  //
  // So the ordering rule is: MEASUREMENT before EXPENSIVE ACTION. This stage is pure
  // diagnosis — a handful of set-based queries and at most two model calls — and it is
  // the stage that answers "what is actually wrong with this project", so it must not be
  // the first thing starved by a slow merge loop. It also has no dependency on anything
  // stage 4+ produces (unlike triage, which needs `conductedTaskIds`).
  //
  // The bulk signals it loads are handed to triage below, so paying for them early costs
  // nothing overall — the same reads, just earlier in the pass.
  const censusSignals = await loadBulkSignals(db, runtimeService, {
    tenantId, projectId, taskIds: managed.map((t) => t.id),
  }).catch(() => null);
  {
    const census = censusSignals
      ? await computeStallCensus(db, {
        tenantId, projectId, tasks: managed, shared: censusSignals, env,
        // The pass's own effective policy — the census must classify by the same rules
        // triage remedies by, or the two halves of the same report disagree (0380).
        policy: { requireSignoff: policy.requireSignoffToComplete },
      }).catch(() => null)
      : null;

    if (census) {
      summary.censusStalled = census.stalled;
      summary.censusTopCause = census.cohorts[0]?.cause ?? null;

      // The census itself is set-based arithmetic and always runs — measurement is the
      // one thing a truncated pass must not lose. The DIAGNOSIS below spends up to
      // MAX_FINDINGS_PER_PASS model calls, so it is shed like any other optional work;
      // the cohorts are still recorded, and the next pass raises the finding.
      const systemic = !mayStartStage('systemic')
        ? { findings: [], ticketsCreated: 0, resolved: 0, journal: [] }
        : await raiseSystemicFindings(env, db, runtimeService, {
        tenantId, projectId, census,
        personaDirective: identity.personaDirective,
        // ONE ticket-creation path for the whole manager — the same primitive the
        // coaching route uses, so a systemic ticket is staffed, keyed and dispatched
        // exactly like any other manager-created work.
        createTicket: (directive, title) => createManagerCoachingTask(env, db, runtimeService, {
          tenantId, projectId, directive, title,
          // Groups with the diagnostics engine's existing platform-gap tickets rather
          // than looking like ordinary feature work.
          taskType: 'gap',
          // A systemic finding is an executable recovery objective. Assign it to a
          // developer agent and start it now; the finding itself remains open until a
          // later production census proves the cohort collapsed.
          autoAssignAgent: true,
          autoDispatch: true,
          submittedBy: `manager:systemic:${policy.managerRef ?? 'system'}`,
        }),
        ensureTicket: async (taskId) => {
          const [current] = await db.select({
            status: tasks.status,
            actionType: tasks.actionType,
            assignedUserId: tasks.assignedUserId,
            assignedAgentRef: tasks.assignedAgentRef,
            assignedAgentHostId: tasks.assignedAgentHostId,
            completedAt: tasks.completedAt,
          }).from(tasks).where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId), eq(tasks.projectId, projectId))).limit(1);
          if (!current) return false;

          // The implementation ticket reaching Done is not proof that production is
          // fixed. If the cohort still exists in this census, re-open the objective and
          // let the agent continue from the failed verification result.
          let status = current.status;
          if (!NON_TERMINAL_TASK_STATUSES.includes(status as never)) {
            if (current.completedAt
              && Date.now() - current.completedAt.getTime() < SYSTEMIC_VERIFICATION_GRACE_MS) {
              return true;
            }
            status = TaskStatus.TODO;
            await db.update(tasks).set({
              status, completedAt: null, updatedAt: new Date(),
            }).where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)));
          }

          if (!current.assignedAgentRef && current.assignedAgentHostId == null) {
            await assignTicketOwner(env, db, {
              projectId, taskId, actionType: current.actionType,
              agentOnly: true, roleKeyOverride: 'developer',
            });
          }

          // Review is owned by the merge/deploy path. Runnable implementation states
          // are idempotently re-evaluated here; live-run/cooldown/breaker gates remain.
          if (status !== TaskStatus.IN_REVIEW) {
            // Systemic verification shares the same tenant-wide dispatch ceiling as
            // every other manager stage. Reserve before invoking the canonical trigger;
            // release the slot when its idempotency/gating checks decline to start.
            const { refused, result: started } = await runs.spend(
              () => maybeAutoRunOnLaneEntry(env, db, runtimeService, {
                tenantId, projectId, taskId, status,
                submittedBy: `manager:systemic-verify:${policy.managerRef ?? 'system'}`,
              }),
              (value) => value === true,
            ).catch(() => ({ refused: false, result: false }));
            return !refused && started === true;
          }
          return true;
        },
      });

      summary.systemicFindings = systemic.findings.length;
      summary.systemicTicketsCreated = systemic.ticketsCreated;
      for (const entry of systemic.journal) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: entry.taskId, runTaskId,
          actionType: 'systemic', summary: entry.summary, detail: entry.detail,
        });
      }
      await invalidateStallCensus(env, tenantId, projectId).catch(() => undefined);
    }
  }

  budget.mark('census');
  // 4. PR — conduct (open) PRs for finished work, then merge/close per policy. ---
  // Records which tickets it acted on so the TRIAGE stage below can diagnose them
  // without re-applying a remedy the review pass just applied.
  // This is the stage that evicts the pass: each PR does provider round-trips, and 354
  // of them will not fit in one invocation however high MAX_PR_ACTIONS_PER_RUN is set.
  // It now stops at the budget instead of running until the isolate dies.
  const conductedTaskIds = new Set<number>();
  await coordinatePullRequests(env, db, runtimeService, {
    tenantId, projectId, policy, managed, summary, runTaskId, conductedTaskIds, budget, runs, mayRunStage,
  });

  // WHAT LANDED, READ FROM THE JOURNAL THE MERGE SWEEP WRITES (see `countPrMergesSince`).
  // The pass no longer merges anything — `application/repos/prMergeSweep.ts` does, on its
  // own budget — but "what shipped since I last looked" is still part of what a manager
  // accounts for, so the number stays on the closing row. One indexed COUNT, and only for
  // a project that has been passed before (a first pass has no window to attribute).
  summary.prsMerged = await countPrMergesSince(db, { tenantId, projectId, since: previousPassAt });

  budget.mark('pr');
  // 5. DISPATCH — kick the top-ranked runnable tickets NOW, in priority order. ---
  // Skipped on the cron path (the autonomous executor sweep owns dispatch there — see
  // shouldDispatch above). Re-read so rank + fresh assignments are reflected; the
  // dispatcher (idempotent) still gates each ticket on gate/capability/live-run.
  if (shouldDispatch && mayRunStage('dispatch')) {
  const runnable = await db
    .select({ id: tasks.id, status: tasks.status, managerRank: tasks.managerRank })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, RUNNABLE),
      or(sql`${tasks.assignedAgentRef} is not null`, sql`${tasks.assignedAgentHostId} is not null`)))
    .orderBy(sql`${tasks.managerRank} asc nulls last`, asc(tasks.updatedAt))
    .limit(MAX_DISPATCHES_PER_RUN);
  for (const t of runnable) {
    if (budget.over()) { budget.shed('dispatch'); break; }
    try {
      // Reserve-then-dispatch. The slot is taken before the trigger is called and handed
      // straight back if it declines, so the tenant ceiling bounds what this stage
      // actually starts rather than being reconciled against it afterwards.
      const { refused, result: started } = await runs.spend(
        () => maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: t.id, status: t.status, submittedBy,
        }),
        (v) => v === true,
      );
      // Out of tenant budget for the whole tick — no later ticket can fare better.
      if (refused) { budget.shed('dispatch'); break; }
      if (started) {
        summary.dispatched += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'dispatch',
          summary: `Started work on ticket #${t.id} (rank ${t.managerRank ?? '—'}).`,
        });
      }
    } catch (error) { /* skip */
      reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
    }
  }
  }

  budget.mark('dispatch');
  // 6. AUDIT + REMEDIATE — check each managed ticket for role/diagnostic coverage
  // (pillar 1), then CLOSE what it finds. A flagged ticket is one missing a required
  // role owner or reviewer, so the manager drives the Coordinator over it: the tick
  // rewinds to the earliest unmet stage, resolves the role-capable participant and
  // dispatches them. Detecting the gap and only journalling it strands the ticket —
  // the flag feed was a dead end, and staffing the gap is exactly the manager's job.
  if (mayRunStage('audit')) {
    const auditService = new TicketAuditService(db);
    for (const t of managed.slice(0, MAX_AUDITS_PER_RUN)) {
      // The stage that sat between the two budget-guarded regions with no guard of its
      // own: 40 audits plus coordinator ticks that each rewind a lane and can start a
      // run. An unguarded stage here defeats the whole budget, because the pass can still
      // be evicted before it reaches its closing journal — which is the failure the
      // budget exists to end, not merely to reduce.
      if (budget.over()) { budget.shed('audit'); break; }
      try {
        const result = await auditService.computeAudit(env, tenantId, t.id);
        summary.audited += 1;
        if (result.status !== 'flagged') continue;
        summary.flagged += 1;
        if (!policy.autoAssign) continue;
        // Pacing is honest, not silent: a flagged ticket past the per-pass cap is
        // COUNTED as deferred so the surface can say "N waiting for the next pass"
        // instead of looking like the manager ignored it.
        if (summary.remediated >= MAX_REMEDIATIONS_PER_RUN) { summary.remediationDeferred += 1; continue; }

        // ── GIVE IT AN OWNER FIRST ────────────────────────────────────────────────
        //
        // `coordinateTicket` rewinds the lane and asks the lane gate to dispatch the
        // missing role; it never touches `assigned_user_id` / `assigned_agent_ref`. On a
        // project whose lanes are unstaffed the gate cannot dispatch anything, so the
        // stage's ONLY lasting effect was moving tickets backwards, pass after pass,
        // while `unowned` never fell. The journal line stopped CLAIMING staffing it had
        // not done, but a flagged ticket still needed the `assign` path to actually gain
        // an owner.
        //
        // Free: `assignTicketOwner` is a pick + one UPDATE, no run, so it costs nothing
        // against the run budget and runs even when that budget is exhausted. It is the
        // SAME implementation the assign stage and stall triage use, so a ticket cannot
        // acquire a different owner depending on which stage reached it first.
        const alreadyOwned = t.assignedUserId != null || t.assignedAgentRef != null || t.assignedAgentHostId != null;
        let ownerAssigned: string | null = null;
        if (!alreadyOwned) {
          const owner = await assignTicketOwner(env, db, {
            projectId, taskId: t.id, actionType: t.actionType,
          });
          if (owner.assigned) {
            ownerAssigned = owner.label;
            summary.assigned += 1;
            await recordManagerAction(db, {
              tenantId, projectId, taskId: t.id, runTaskId, actionType: 'assign',
              summary: `Assigned "${t.title}" to ${owner.label} while remediating its coverage gaps.`,
              detail: { memberKind: owner.memberKind, memberRef: owner.memberRef, via: 'audit_remediation' },
            });
          }
        }

        // Coordination REWINDS and ADVANCES for free; only the run at the end is
        // billable. So the slot is reserved first and the coordination told whether it
        // may spend it — this stage used to start runs that no ceiling saw and no
        // counter reported, which is the same accounting hole the triage stage had.
        const spend = await runs.spend(
          () => coordinateTicket(env, db, runtimeService, { tenantId, taskId: t.id, dispatch: true }),
          (o) => o.dispatched,
        );
        // Out of tenant budget: still coordinate — the rewind and the advance are what
        // unblock the ticket and neither costs a run — but explicitly without the
        // dispatch, so `outcome.dispatched` reports what actually happened.
        const outcome = spend.result
          ?? await coordinateTicket(env, db, runtimeService, { tenantId, taskId: t.id, dispatch: false });
        if (outcome.dispatched) summary.dispatched += 1;
        // Only journal a coordination that CHANGED something (rewound the lane or
        // started the missing role's run). A no-op tick on an already-staffed ticket
        // must stay silent, or the feed refills with noise every pass.
        // Gaining an OWNER is itself a change worth journalling: on an unstaffed board it
        // is the only thing that ever happens to a flagged ticket, and treating it as a
        // no-op is what made the stage look inert for four captures.
        const moved = outcome.ok && (outcome.dispatched || outcome.status !== t.status || ownerAssigned != null);
        if (!moved) continue;
        summary.remediated += 1;
        const roles = [...new Set(result.missing.map((m) => m.ref))];
        // WORD IT AS WHAT HAPPENED. `coordinateTicket` never writes a ticket owner — it
        // rewinds the lane and asks the lane gate to dispatch the missing role. Calling
        // a bare rewind "Staffing …" told operators a ticket had been staffed when its
        // assignee column was still empty, which is exactly the contradiction that makes
        // the feed untrustworthy. Only a dispatch actually put someone on it.
        const checks = `${result.missing.length} unmet ${result.missing.length === 1 ? 'check' : 'checks'}`;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'coordinate',
          summary: outcome.dispatched
            ? `Staffed ${checks} on "${t.title}" — started ${roles.join(', ')}`
              + `${outcome.status !== t.status ? ` (moved to ${outcome.status})` : ''}.`
            : `Rewound "${t.title}" to ${outcome.status} for ${checks} — ${roles.join(', ')} still unfilled; `
              + (ownerAssigned
                ? `nothing was dispatched, but the ticket now belongs to ${ownerAssigned}.`
                : 'nothing was dispatched and the ticket has no owner yet.'),
          detail: {
            roles, missing: result.missing.length, fromStatus: t.status,
            toStatus: outcome.status, dispatched: outcome.dispatched,
            requiredOutstanding: outcome.requiredOutstanding,
            ...(ownerAssigned ? { ownerAssigned } : {}),
          },
        });
      } catch (error) { /* skip this ticket */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
      }
    }
    // Say so when the cap bit. One row per pass (not per deferred ticket) keeps the
    // pacing visible without recreating the flood this whole change removed.
    if (summary.remediationDeferred > 0) {
      await recordManagerAction(db, {
        tenantId, projectId, runTaskId, actionType: 'coordinate',
        summary:
          `Coordinated ${summary.remediated} flagged ${summary.remediated === 1 ? 'ticket' : 'tickets'} this pass — ` +
          `${summary.remediationDeferred} more queued for the next one (cap ${MAX_REMEDIATIONS_PER_RUN}/pass).`,
        detail: { remediated: summary.remediated, deferred: summary.remediationDeferred, cap: MAX_REMEDIATIONS_PER_RUN },
      });
    }
  }

  budget.mark('audit');
  // 7. TRIAGE — what has STOPPED MOVING, why, and what unsticks it. -------------
  // The stages above each act on a ticket for a reason of their own (score it, rank
  // it, staff it, merge its PR, audit its roles); none of them asks the question a
  // human PM asks first. Measured before this stage existed: 809 of 821 tickets
  // stalled, 466 never executed even once, and nothing in the system was accountable
  // for noticing. Every remedy applied here is RECORDED so the next pass can grade
  // whether it worked — an ineffective fix escalates instead of repeating, which is
  // the generalised cure for the 4058:1 sync-to-merge livelock. See stallTriage.ts.
  //
  // Reuses the bulk signals stage 3.5 already loaded, so its full-project measurement is
  // paid for once per pass rather than once per stage.
  // `exhausted()`, not `over()`: triage owns the reserved tail of the budget, so it runs
  // even on a pass whose discretionary stages were all shed. See
  // MANAGER_TRIAGE_RESERVE_MS for why an always-last stage on a plain deadline is a stage
  // that never runs at all.
  // The rotation is deliberately NOT consulted here: triage is yielded TO, never yielded
  // (see YIELDABLE_STAGES). It runs whenever the reserve reaches it; the rotation's whole
  // job is to make sure the reserve is still there when it does.
  if (budget.exhausted()) {
    // Triage is the most valuable stage AND the most expensive, so it is the one that
    // must never be silently dropped. Say so explicitly on the register rather than
    // letting a truncated pass read as "nothing was stuck". Reaching here means even the
    // reserved slice was gone before the stage started — a genuinely overrun pass, not
    // the routine starvation the reserve exists to prevent.
    budget.shed('triage');
    await recordManagerAction(db, {
      tenantId, projectId, runTaskId, actionType: 'triage',
      summary: `Stall triage skipped this pass — the whole ${Math.round(MANAGER_PASS_BUDGET_MS / 1000)}s pass budget, including the ${Math.round(MANAGER_TRIAGE_RESERVE_MS / 1000)}s reserved for triage, was already spent when it was reached. The stages that overran it yield their turn on the next pass.`,
      detail: {
        budgetMs: MANAGER_PASS_BUDGET_MS, reserveMs: MANAGER_TRIAGE_RESERVE_MS,
        elapsedMs: budget.elapsedMs(), truncated: budget.truncated,
        // WHERE the budget went, not merely that it went. Without this the only way to
        // find the expensive stage is to infer it from which stages got shed, which is
        // how the wrong stage was blamed twice. See `PassBudget.mark`.
        stageMs: budget.timings,
      },
    }).catch(() => undefined);
  } else {
    const triage = await runStallTriage(env, db, runtimeService, {
      tenantId, projectId, managed, conductedTaskIds,
      ...(censusSignals ? { signals: censusSignals } : {}),
      // Same dispatch-ownership rule step 5 follows: on the cron path the autonomous
      // executor is the single dispatcher, so triage staffs and coordinates but does
      // not race it to start a run it would start anyway.
      ownsDispatch: shouldDispatch,
      // The tenant's shared tick ceiling, so triage cannot outspend the executor and the
      // other sweeps drawing on the same pool.
      runs,
      // The pass's wall-clock budget (0382). Triage is the stage the reserve is held FOR,
      // so it measures itself against `exhausted()` rather than the early discretionary
      // cutoff — and with a time bound in place its per-pass ticket ceiling could be
      // raised from 12 to 60 without risking an evicted Worker.
      budget,
      policy: {
        requireSignoffToComplete: policy.requireSignoffToComplete,
        prMergePolicy: policy.prMergePolicy,
        allowAutoMerge: policy.allowAutoMerge,
        autoAssign: policy.autoAssign,
        managerRef: policy.managerRef,
      },
    }).catch(() => null);
    if (triage) {
      summary.stalled = triage.stalled;
      summary.unstuck = triage.unstuck;
      summary.escalated = triage.escalated;
      summary.stallsResolved = triage.resolved;
      // Runs triage started are REAL dispatches: counting them here is what makes the
      // sweep reserve them against the tenant's shared per-tick budget, so this stage
      // cannot quietly outspend the executor drawing on the same pool.
      summary.dispatched += triage.dispatched;
      for (const entry of triage.journal) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: entry.taskId, runTaskId,
          actionType: entry.detail.escalated ? 'escalate' : 'triage',
          summary: entry.summary,
          detail: entry.detail,
        });
      }
      // ── THE PASS'S CEILING PICTURE — a STATE, written when it changes ──────────
      //
      // Say so when a cap bit: a bounded pass that reports nothing reads as "the manager
      // looked and everything was fine", which is the false clean bill of health this
      // stage exists to stop. But saying it EVERY pass is its own defect — measured on
      // project 11, 2026-07-31: the identical sentence 7× in the last 30 decisions
      // (10:55:23 → 11:25:30), which the report's `decision_loop` finding then reported as
      // a manager stuck in a loop while every pass was in fact unsticking a DIFFERENT
      // ticket (-106, -145, -066, -209 — each already journalled on its own row). The
      // ceiling picture is a state; the work is the per-ticket rows above.
      //
      // Written unconditionally rather than only when `deferred > 0`, because the CLEAR is
      // exactly as informative as the block: with an on-change writer, a summary that only
      // ever reports a deferral leaves the last one standing as the current answer forever.
      // `latestStateDecision` is how the surface reads it back regardless of age.
      await recordManagerActionOnChange(db, {
        tenantId, projectId, runTaskId, actionType: 'triage',
        summary:
          `Unstuck ${triage.unstuck} of ${triage.stalled} stalled ${triage.stalled === 1 ? 'ticket' : 'tickets'} this pass`
          // The clause is driven by the COUNT, never by whether a cause was recorded —
          // see `describeTriageDeferral` for the sentence that contradicted its own
          // detail when it was the other way round.
          + describeTriageDeferral(triage.deferred, triage.deferredReason, {
            perPass: MAX_TRIAGE_DISPATCHES_PER_RUN, perTenantTick: MAX_TENANT_DISPATCHES_PER_TICK,
          }),
        detail: {
          stalled: triage.stalled, unstuck: triage.unstuck, deferred: triage.deferred,
          escalated: triage.escalated, dispatched: triage.dispatched,
          deferredReason: triage.deferredReason,
          dispatchCap: MAX_TRIAGE_DISPATCHES_PER_RUN,
          tenantTickCap: MAX_TENANT_DISPATCHES_PER_TICK,
          ownsDispatch: shouldDispatch,
        },
        stateKey: TRIAGE_PASS_STATE_KEY,
        fingerprint: stateFingerprint([
          triage.stalled, triage.unstuck, triage.deferred, triage.escalated,
          triage.dispatched, triage.deferredReason ?? '', shouldDispatch,
        ]),
      });
    }
  }
  budget.mark('triage');

  // Credit the acting identity: when a specific agent is the manager, journal that it
  // ran (with its persona/model) so the feed attributes the pass to the teammate, not
  // an anonymous "system". No noise for the default system manager.
  if (identity.agentRef && (summary.scored || summary.ranked || summary.scheduled || summary.assigned || summary.dispatched)) {
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
  //
  // A TRUNCATED pass always journals, even if it achieved nothing else: "I ran out of
  // time before triage" is the single most important thing this row can say, and it is
  // exactly what was missing for the two weeks the pass was being evicted here.
  summary.truncated = budget.truncated;
  // HAND THE NEXT PASS ITS TURN. Only stages shed for WALL-CLOCK are carried over — a
  // stage this pass yielded was told to wait, and feeding it back would make the two sets
  // chase each other forever with neither completing. Best-effort: a lost cursor costs one
  // unrotated pass, never correctness.
  await savePassRotation(env, tenantId, projectId, rotation, budget.truncated);
  const didSomething =
    summary.scored || summary.ranked || summary.scheduled || summary.assigned ||
    summary.dispatched || summary.prsConducted || summary.prsMerged || summary.flagged ||
    summary.stalled || summary.unstuck || summary.escalated || summary.staleRunTasksClosed ||
    summary.truncated.length > 0;
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
        `${summary.scheduled ? `scheduled ${summary.scheduled}, ` : ''}` +
        `assigned ${summary.assigned}, dispatched ${summary.dispatched}, ` +
        `PRs ${summary.prsConducted + summary.prsMerged}` +
        `${summary.flagged ? `, flagged ${summary.flagged}` : ''}` +
        `${summary.remediated ? `, staffed ${summary.remediated}` : ''}` +
        `${summary.remediationDeferred ? ` (${summary.remediationDeferred} deferred)` : ''}` +
        `${summary.stalled ? `, stuck ${summary.stalled}` : ''}` +
        `${summary.unstuck ? ` (unstuck ${summary.unstuck})` : ''}` +
        `${summary.escalated ? `, escalated ${summary.escalated}` : ''}` +
        `${summary.stallsResolved ? `, cleared ${summary.stallsResolved}` : ''}` +
        // The census figure is stated whenever it EXCEEDS what the pass diagnosed, which
        // is the honest reading of a bounded stage: "I looked at 12 of 313" must never
        // render as "12 are stuck".
        `${summary.censusStalled > summary.stalled ? `, ${summary.censusStalled} stalled in total (top cause: ${summary.censusTopCause ?? 'unknown'})` : ''}` +
        `${summary.systemicTicketsCreated ? `, opened ${summary.systemicTicketsCreated} platform ${summary.systemicTicketsCreated === 1 ? 'ticket' : 'tickets'}` : ''}` +
        // A pass that ran out of budget must SAY so. A truncated pass that reads
        // identically to a complete one is how the manager reported health it had not
        // verified for two weeks.
        `${summary.truncated.length ? ` — pass budget spent after ${Math.round(budget.elapsedMs() / 1000)}s, deferred: ${summary.truncated.join(', ')}` : ''}.`,
      metadata: {
        scored: summary.scored, ranked: summary.ranked, scheduled: summary.scheduled, assigned: summary.assigned,
        dispatched: summary.dispatched, prsConducted: summary.prsConducted,
        prsMerged: summary.prsMerged, flagged: summary.flagged,
        remediated: summary.remediated, remediationDeferred: summary.remediationDeferred,
        stalled: summary.stalled, unstuck: summary.unstuck, escalated: summary.escalated,
        stallsResolved: summary.stallsResolved, staleRunTasksClosed: summary.staleRunTasksClosed,
        censusStalled: summary.censusStalled, censusTopCause: summary.censusTopCause,
        systemicFindings: summary.systemicFindings, systemicTicketsCreated: summary.systemicTicketsCreated,
        truncated: summary.truncated, passMs: budget.elapsedMs(), passBudgetMs: MANAGER_PASS_BUDGET_MS,
        stageMs: budget.timings,
        trigger: submittedBy, managerType: policy.managerType, coachingApplied: coachingDirectives.length,
      },
    });
  }

  // Stamp the run so the surface + cadence can show "last managed …".
  await db.update(projectManagerConfigs)
    .set({ lastRunAt: new Date() })
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .catch((error) => {
      reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
    });

  // A pass IS the manager's half of "what did you accomplish today" — every decision it
  // just journalled belongs in today's digest, so drop the cached answer rather than
  // making a human wait out its TTL to see the run they triggered.
  await invalidateDailyDigest(env, tenantId, projectId).catch(() => undefined);

  return summary;
}

/**
 * PR CONDUCT for one project: a finished-but-parked ticket (in review, has a branch, no
 * PR, no live run) is advanced to Done under any non-'queue' policy, opening its PR
 * through the shared finalize path.
 *
 * MERGING used to be the second half of this function and is now its own registry sweep
 * (`application/repos/prMergeSweep.ts`) — see the note at the end of the body for the
 * measurement that split them.
 */
async function coordinatePullRequests(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  ctx: {
    tenantId: number; projectId: number; policy: EffectiveManagerPolicy;
    managed: ManagedTaskRow[]; summary: ManagerRunSummary; runTaskId: number | null;
    /** Populated with every ticket this stage acted on, so TRIAGE does not double-act. */
    conductedTaskIds: Set<number>;
    /** The pass's wall-clock budget — checked between tickets, never mid-write. */
    budget: PassBudget;
    /** The tenant's shared per-tick RUN ceiling. Every billable start reserves first. */
    runs: DispatchReserver;
    /**
     * Whose turn it is. Both PR stages are rotatable: they are the stages that starved
     * triage on the measured board, so they must be able to give up a turn to it.
     */
    mayRunStage: (stage: string) => boolean;
  },
): Promise<void> {
  const { tenantId, projectId, policy, managed, summary, runTaskId, conductedTaskIds, budget, runs } = ctx;

  // CONDUCT: complete review-ready tickets and open their PRs (skip under 'queue').
  //
  // SELF-GOVERNANCE (0362): this step is where the manager exercises completion
  // authority, so it is where unanimous sign-off is enforced. Previously it force-wrote
  // `status = DONE` for ANY in-review ticket with a branch, with no manifest check —
  // agent work was merged unreviewed. `requireSignoffToComplete` demands every REQUIRED
  // participation slot be satisfied first, and a ticket whose manifest has no required
  // slots never qualifies (signoffGate fails closed).
  //
  // IT IS A PROJECT SETTING, AND OFF BY DEFAULT SINCE 0380. `resolveRequiredSignoffGate`
  // is the one read that consults it: a project that has not opted in owes nothing, skips
  // the manifest read entirely, and completes on the deliverable + build checks alone.
  //
  // The eligibility filter also no longer requires `gitBranch`: a ticket can be real
  // work with nothing to merge (a decision, a doc, a non-code chore). Those used to sit
  // in review forever because only branch-bearing tickets were ever conducted. A
  // fully-signed-off ticket with no branch is now closed directly — there is simply no
  // PR to open for it.
  if (policy.prMergePolicy !== 'queue' && ctx.mayRunStage('pr_conduct')) {
    const reviewReady = managed
      .filter((t) => t.status === TaskStatus.IN_REVIEW)
      .slice(0, MAX_PR_ACTIONS_PER_RUN);
    // One scan for in-flight runs across ALL review-ready tasks instead of a
    // listByTask() round-trip per task (N+1). listActiveByTasks already filters
    // to the non-terminal statuses (the former ACTIVE_EXEC set), so any task with
    // a returned execution still has a live run.
    const liveExecs = reviewReady.length
      ? await runtimeService.listActiveByTasks(reviewReady.map((t) => t.id))
      : [];
    const liveTaskIds = new Set<number>(liveExecs.map((e) => e.taskId as unknown as number));
    // Build statuses for the whole review cohort in ONE query rather than a poll per
    // ticket (this loop runs every 5 minutes across every project).
    const reviewPrBuild = reviewReady.length
      ? await db
        .select({ taskId: pullRequests.taskId, buildStatus: pullRequests.buildStatus, status: pullRequests.status })
        .from(pullRequests)
        .where(and(
          eq(pullRequests.tenantId, tenantId),
          inArray(pullRequests.taskId, reviewReady.map((t) => t.id)),
        ))
        // NEWEST FIRST, so the "no open PR left" fallback below is the most recent
        // settled one rather than whatever the heap scan happened to yield last.
        .orderBy(desc(pullRequests.updatedAt))
      : [];
    const reviewFileRows = reviewReady.length
      ? await db.select({ taskId: taskFileChanges.taskId, path: taskFileChanges.path })
        .from(taskFileChanges)
        .where(and(
          eq(taskFileChanges.tenantId, tenantId),
          inArray(taskFileChanges.taskId, reviewReady.map((t) => t.id)),
        ))
      : [];
    const reviewPathsByTask = new Map<number, string[]>();
    for (const row of reviewFileRows) {
      reviewPathsByTask.set(row.taskId, [...(reviewPathsByTask.get(row.taskId) ?? []), row.path]);
    }
    // ── WHAT EACH REVIEW TICKET'S PULL REQUEST IS DOING ─────────────────────────────
    // An OPEN row wins over every other row a ticket has: a ticket can carry an old
    // closed PR and a live one, and it is the live one that decides both whether there is
    // anything left to land and whose build verdict matters. Reading "the last row the
    // scan happened to return" is how a settled PR's green build could speak for an open
    // PR that had not built at all.
    // The rule itself is `pickCurrentPr` (domain/task/buildStatus.ts) — the same one the
    // board card's build badge is derived through, so the ticket and its card can never
    // disagree about which pull request speaks for it.
    const prRowsByTask = new Map<number, typeof reviewPrBuild>();
    for (const r of reviewPrBuild) {
      if (r.taskId == null) continue;
      const list = prRowsByTask.get(r.taskId);
      if (list) list.push(r);
      else prRowsByTask.set(r.taskId, [r]);
    }
    const prByTask = new Map<number, { state: TicketPrState; buildStatus: string | null }>();
    for (const [taskId, rows] of prRowsByTask) {
      const current = pickCurrentPr(rows);
      if (!current) continue;
      prByTask.set(taskId, {
        state: current.status === 'open' ? 'open' : 'settled',
        buildStatus: current.buildStatus,
      });
    }

    for (const t of reviewReady) {
      // BETWEEN tickets, never mid-ticket: a conduct/merge already begun always
      // completes, so shedding work can never leave a half-applied action.
      if (budget.over()) { budget.shed('pr_conduct'); break; }
      try {
        // THE EVALUATION. Four questions, one verdict, one recorded action — see
        // `evaluateTicketReadiness`. Every outcome is journalled, including the ones
        // that do nothing, because the old silent `continue` is precisely how 280
        // tickets sat in review for up to 19 days with no explanation anywhere.
        const signoff = await resolveRequiredSignoffGate(env, db, {
          tenantId, taskId: t.id, requireSignoff: policy.requireSignoffToComplete,
        });
        const pr = prByTask.get(t.id);
        const readiness = decideTicketReadiness({
          taskType: t.taskType,
          actionType: t.actionType,
          hasBranch: !!t.gitBranch,
          // The RECORDED pull request decides this, not `tasks.github_pr_url`: that column
          // is stamped when a PR opens and never cleared, so it cannot tell an open PR
          // from one that merged weeks ago. A ticket carrying the URL with no row left is
          // 'settled' — there is no pull request for the merge stage to act on.
          prState: pr?.state ?? (t.githubPrUrl ? 'settled' : 'none'),
          hasAssignee: !!t.assignedAgentRef || t.assignedAgentHostId != null,
          buildStatus: normalizeBuildStatus(pr?.buildStatus),
          hasLiveRun: liveTaskIds.has(t.id),
          deliverableEvidence: reviewPathsByTask.has(t.id)
            ? classifyDeliverablePaths(reviewPathsByTask.get(t.id)!)
            : (!t.gitBranch && !pr ? 'none' : 'unknown'),
          signoff,
          requireSignoff: policy.requireSignoffToComplete,
          requireGreenBuild: policy.prMergePolicy === 'on_green',
        });

        if (readiness.action === 'wait_for_run' || readiness.action === 'wait_for_build') {
          continue; // transient by definition — re-evaluated next pass, no noise
        }
        // Past the transient checks this pass WILL act on the ticket — here or, for an
        // open PR, in the merge stage below — so claim it: TRIAGE still diagnoses and
        // registers it (the stuck list must be complete) but must not re-apply a remedy
        // on top of the one about to run. That matters most for `await_merge`: triage's
        // `resolve_conflict` remedy starts a BILLABLE run against the same branch the
        // merge queue is already working.
        conductedTaskIds.add(t.id);

        // AN OPEN PULL REQUEST STILL HAS TO LAND. Not completed here, and not journalled
        // here either: the merge stage immediately below is the single writer for a PR's
        // fate (merged, conflicting, or retired to a human), and duplicating that verdict
        // once per review ticket per pass would add up to 20 rows every five minutes to a
        // table already growing ~3.5k rows a day per project.
        if (readiness.action === 'await_merge') continue;

        // Expected a deliverable and there is none, or the build is red: this ticket is
        // not reviewable, it is unfinished. Send it BACK to implementation and start its
        // agent — the behaviour whose absence let implementable work rot in review.
        if (readiness.action === 'return_to_implementation' || readiness.action === 'return_build_failed') {
          await db.update(tasks)
            .set({ status: TaskStatus.IN_PROGRESS, completedAt: null, updatedAt: new Date() })
            .where(scopedToTenant(tasks, tenantId, eq(tasks.id, t.id), eq(tasks.status, TaskStatus.IN_REVIEW)));
          // The RETURN is a state change and always happens; the restart is billable, so
          // it reserves first. A ticket returned but not restarted is picked up by the
          // executor's next tick — strictly better than silently outspending the ceiling.
          const restarted = (await runs.spend(
            () => maybeAutoRunOnLaneEntry(env, db, runtimeService, {
              tenantId, projectId, taskId: t.id, status: TaskStatus.IN_PROGRESS,
              submittedBy: `manager:review-return:${policy.managerRef ?? 'system'}`,
            }).catch(() => false),
            (v) => v === true,
          )).result === true;
          if (restarted) summary.dispatched += 1;
          await recordManagerAction(db, {
            tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
            summary: `Returned "${t.title}" to implementation — ${readiness.detail}`,
            detail: { action: readiness.action, expectsCode: readiness.expectsCode, restarted },
          });
          continue;
        }

        // Sign-offs outstanding: ASK for them. Dispatching the owing role is what closes
        // the accountability loop — without it the manifest just accumulates `assigned`
        // slots forever (measured: 487 required slots, 0 ever satisfied).
        if (readiness.action === 'drive_signoff') {
          // Asking a reviewer to sign off IS a billable run, so it reserves first. Out of
          // budget the ask is deferred to the next tick, and the journal below says
          // exactly that instead of claiming the ticket is merely "held in review".
          const spend = await runs.spend(
            () => driveOutstandingSignoffs(env, db, runtimeService, {
              tenantId, projectId, task: t, signoff, managerRef: policy.managerRef,
            }),
            (d) => d.asked.length > 0,
          );
          const drive = spend.result ?? {
            asked: [] as string[],
            blockedDetail: 'The workspace has used its dispatch budget for this tick; the sign-off ask goes out on the next one.',
            ownership: classifySignoffOwnership(signoff.outstanding),
          };
          summary.dispatched += drive.asked.length;
          await recordManagerAction(db, {
            tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
            summary: drive.asked.length
              ? `Requested sign-off on "${t.title}" from ${drive.asked.join(', ')} — ${readiness.detail}`
              // "Held in review" alone was unactionable and, worse, indistinguishable
              // from a ticket whose reviewer WAS asked. Say why nothing was asked.
              : `Held "${t.title}" in review — ${readiness.detail}${drive.blockedDetail ? ` ${drive.blockedDetail}` : ''}`,
            detail: {
              action: readiness.action,
              signoffGate: signoff.reason,
              requiredCount: signoff.requiredCount,
              satisfiedCount: signoff.satisfiedCount,
              // Carry the ASSIGNEE, not just the role. "Waiting on Architect" reads as a
              // staffed ticket; "Waiting on Architect (nobody assigned)" is the fact.
              outstanding: signoff.outstanding.map((o) => ({
                roleKey: o.roleKey,
                roleName: o.roleName,
                state: o.state,
                assigneeKind: o.assigneeKind,
                assigneeName: o.assigneeName,
              })),
              unstaffedCount: drive.ownership.unstaffed.length,
              humanOwedCount: drive.ownership.humanOwed.length,
              dispatchableCount: drive.ownership.dispatchable.length,
              // Agent-owed but NO LONGER ASKABLE — the agent finished its runs without
              // ever recording a verdict. Reported separately because it is subtracted
              // from `dispatchableCount`, and a reader watching that number fall with no
              // stated reason would read it as slots being satisfied.
              exhaustedCount: drive.ownership.exhausted.length,
              dispatchedTo: drive.asked,
            },
          });
          continue;
        }

        // readiness.action === 'complete' — every check passed, including "there is
        // nothing left to land". WHICH closure applies is decided by the pure evaluator
        // (`CompletionShape`), not re-derived here: the inline `hasBranch && !hasPr` this
        // replaces was used to choose whether to OPEN a pull request and then reported as
        // if it also meant there was nothing to MERGE, which is how ticket -085 was
        // journalled "(no branch to merge)" 78ms before its own PR #103 was retired.
        const canOpenPr = readiness.completion === 'open_pr';
        // ── THROUGH THE ONE COMPLETION PATH, NOT A SECOND `db.update` ───────────────
        // This was `db.update(tasks).set({ status: DONE, completedAt: now })`, which
        // stamps the ticket and records NO lane hop — and `task_status_transitions` is
        // the only place the schema names who moved a ticket. The digest reads
        // `completed_at` for its headline and transitions for everything else, so the
        // two disagreed outright: project 11, 2026-07-31 reported **11 tickets finished,
        // 0 forward lane moves (by people: 0 · by agents: 0), and every contributor at
        // `finished=0`** — three numbers describing the same eleven events, two of them
        // empty. The missing rows also cost the lifecycle ledger and the autonomy audit,
        // which read transitions rather than the stamp.
        //
        // `completeTaskOnMerge` is the shared path that already closes exactly this gap
        // — its own header says it exists because "the plain db.update the manager used
        // skipped the metrics". A second completion path was the whole defect, so this
        // one is deleted rather than taught to record its own hop: the ordinals, the
        // backward test, the done-class fold, the idempotent already-done check and the
        // producer-fallback attribution all stay in one place.
        await completeTaskOnMerge(env, db, {
          tenantId, taskId: t.id,
          // Named so the fallback does not have to guess; `resolveCompletionActor`
          // credits the ticket's most recent executor when this is absent, which is the
          // right answer on a managed board where the assignee is the Coordinator.
          actorAgentRef: t.assignedAgentRef,
          actorAgentHostId: t.assignedAgentHostId,
        });
        if (canOpenPr) {
          await dispatchTaskFinalize(env as never, db, tenantId, t.id, {
            assignedAgentHostId: t.assignedAgentHostId,
            assignedAgentRef: t.assignedAgentRef,
            gitBranch: t.gitBranch,
            githubPrUrl: t.githubPrUrl,
            title: t.title,
          });
          summary.prsConducted += 1;
        }
        // ONE SENTENCE PER CLOSURE. "(no branch to merge)" used to be printed for all of
        // them, and it was true for exactly one — a reader could not tell a genuinely
        // empty ticket from one closing on top of an unmerged branch.
        const CLOSURE: Record<Exclude<CompletionShape, 'open_pr'>, string> = {
          no_deliverable: `Closed "${t.title}" — no branch and no pull request, so there was nothing to merge.`,
          pr_settled: `Closed "${t.title}" — its pull request has already landed.`,
          branch_unopened: `Closed "${t.title}" — branch ${t.gitBranch} was never opened as a pull request and no agent is assigned to open one, so nothing was merged.`,
        };
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
          summary: canOpenPr
            ? `${readiness.detail} Opened PR for "${t.title}".`
            : `${readiness.detail} ${CLOSURE[(readiness.completion ?? 'no_deliverable') as Exclude<CompletionShape, 'open_pr'>]}`,
          detail: {
            action: readiness.action,
            completion: readiness.completion,
            signoffGate: signoff.reason,
            requiredCount: signoff.requiredCount,
            satisfiedCount: signoff.satisfiedCount,
            openedPr: canOpenPr,
          },
        });
      } catch (error) { /* skip */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "coordinatePullRequests" });
      }
    }
  }

  // ── THE MERGE LOOP IS NOT HERE ANY MORE ─────────────────────────────────────────
  // It is its own registry sweep: `application/repos/prMergeSweep.ts`, registered in
  // `cronSweeps.ts` beside `runBoardSyncSweep` with its own budget.
  //
  // WHY. Merging is mechanical, high-volume, provider-bound work whose cadence is set by
  // PR volume and provider latency — nothing to do with how often a backlog is worth
  // re-ranking or a stall worth re-triaging. Inside this pass it was 93% of the measured
  // wall-clock (project 11, 2026-07-30: `pr: 28839ms` of a 30888ms pass) and it starved
  // every stage behind it. The merge queue later bounded it to ~4s, which stopped the
  // bleeding without fixing the shape: the guarantee that triage still ran was a tuned
  // depth rather than a structural fact. Split out, the pass cannot be starved by PR
  // volume BY CONSTRUCTION.
  //
  // The pass still REPORTS what landed (`summary.prsMerged`) — it reads
  // `countPrMergesSince` off the journal the sweep writes. Reading the result is not the
  // same as doing the work, and that distinction is the whole point of the split.
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
    .from(laneAgentAssignments)
    .innerJoin(swimlanes, laneJoinOn(swimlanes.id))
    .innerJoin(boards, eq(boards.id, swimlanes.boardId))
    .where(eq(boards.projectId, projectId))
    .limit(1);
  return !!row;
}
