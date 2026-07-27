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
  projectManagerConfigs, tenantManagerDefaults, managerActions, managerStallWatch, projects, featureScores,
} from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { TaskStatus, TaskPriority } from '../../domain/shared/types';
import { notSystemTask } from '../task/taskScope';
import { nextProjectKeySeqBase } from '../task/taskKeys';
import { rankBacklog, type RankableTask, type TaskPriorityTier } from './prioritize';
import { listProjectDependencies } from '../task/taskDependencies';
import { scheduleItems, estimateDaysFromStoryPoints } from '../planning/scheduleWork';
import {
  heuristicBusinessValue, riceBusinessValueFromFeature, normalizeFeatureName,
  type FeatureScoreRow, type ScoredValue,
} from './businessValue';
import { scoreBusinessValueAI } from './businessValueAI';
import {
  resolveTieredManagerPolicy, resolveManagerAssignee, normalizePrMergePolicy,
  type EffectiveManagerPolicy, type ManagerConfigRow, type TenantManagerDefaultsRow,
} from './managerPolicy';
import { resolveManagerIdentity } from './managerIdentity';
import { resolveManagerTypeById, normalizeManagerType } from './managerTypes';
import { listActiveManagerDirectives } from './managerDirectives';
import { RoleAssignmentService, type AssigneeKind } from '../kanban/roleAssignmentService';
import { assignTicketOwner } from './assignOwner';
import { resolveSignoffGate } from '../kanban/signoffGate';
import { driveOutstandingSignoffs } from '../kanban/driveSignoffs';
import { decideTicketReadiness } from './evaluateTicketReadiness';
import { runStallTriage, loadBulkSignals, MAX_TRIAGE_DISPATCHES_PER_RUN } from './triageStage';
import { isActionExhausted } from './stallTriage';
import { computeStallCensus, invalidateStallCensus } from './stallCensus';
import { invalidateDailyDigest } from './dailyDigest';
import { raiseSystemicFindings } from './systemicDiagnosis';
import { mergeRecordedPullRequest, updateRecordedPullRequestBranch } from '../repos/mergeRecordedPr';
import { pollPrCiStatus } from '../repos/pollPrCiStatus';
import { dispatchTaskFinalize } from '../../presentation/routes/taskRoutes';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import { TicketAuditService } from '../audit/ticketAuditService';
import { coordinateTicket } from './coordinateTicket';
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

/**
 * Wall-clock the whole pass may spend before it starts shedding OPTIONAL work to
 * guarantee it reaches its own closing journal.
 *
 * THE FAILURE THIS CLOSES. A pass runs inside ONE Worker invocation, and on a real
 * project (11: 673 tickets, 354 open PRs) it was being evicted partway through:
 * `manager_actions` showed triage journalling every few minutes while the `manager.pass`
 * activity row that CLOSES a pass had not been written since **2026-07-13**, and
 * `lastRunAt` sat 6 hours stale against a 5-minute cadence. Every stage after PR
 * coordination was in a dead zone, and — worse than the lost work — the pass never
 * recorded that it had been cut short. A truncated pass and a clean pass were
 * indistinguishable, so the manager reported health it had not verified.
 *
 * The census stage was moved ahead of the PR loop as a mitigation (see stage 3.5), but
 * reordering only decides WHO gets starved. This budget is the actual fix: past the
 * deadline the pass stops starting new optional work, records exactly which stage it
 * stopped at and why, and still writes its closing row. A short honest pass beats a long
 * silent one — and because the cadence is 5 minutes, the deferred work is picked up
 * almost immediately.
 *
 * 20s against a Worker CPU/wall ceiling comfortably above it: the point is to leave
 * room for the closing journal, not to run to the edge.
 */
export const MANAGER_PASS_BUDGET_MS = 20_000;

/**
 * Wall-clock held back from the discretionary stages and kept for TRIAGE (stage 7).
 *
 * ── THE FAILURE THIS CLOSES ──────────────────────────────────────────────────────
 * A plain deadline decides only WHO gets starved, and the answer was always the same
 * stage: triage runs last, so on any project where stages 1–6 exceed the budget it is
 * shed on EVERY pass, not occasionally. Measured on project 11 once the budget shipped —
 * every observed pass truncated `triage`, and its 12 stuck-register remedies sat at
 * `attempts=0` for 26 days. That is worse than no triage at all: because an attempt that
 * never happens cannot fail, the 3-attempt escalation ceiling is never reached either, so
 * nothing is worked AND nothing is handed to a human. The skip journal even promised "it
 * runs first on the next pass" — a rotation that did not exist, and could not, because
 * every pass restarts at stage 1.
 *
 * A reservation fixes it without a rotation cursor: the discretionary stages stop at
 * `budgetMs - MANAGER_TRIAGE_RESERVE_MS`, so triage always gets its slice and always makes
 * SOME progress. It is a floor, not a promise of completion — triage is itself bounded and
 * paces across passes — but a floor is what turns `attempts=0` forever into progress.
 */
export const MANAGER_TRIAGE_RESERVE_MS = 6_000;

/**
 * The pass's time budget. `over()` is checked BETWEEN units of optional work, never
 * mid-write — a stage that has started a mutation always finishes it, so the budget can
 * shed work but never leave a half-applied action.
 */
export interface PassBudget {
  /**
   * True when the DISCRETIONARY stages must stop. Fires early by
   * {@link MANAGER_TRIAGE_RESERVE_MS} so the reserved stage still has room to run.
   */
  over: () => boolean;
  /**
   * True when the WHOLE budget is gone — the reserved stage's own deadline. Only triage
   * checks this; everything else uses `over()`.
   */
  exhausted: () => boolean;
  elapsedMs: () => number;
  /** Stages that were skipped or cut short, in order — journalled on the closing row. */
  truncated: string[];
  /** Record that `stage` was shed, once per stage. Returns true the first time. */
  shed: (stage: string) => boolean;
}

export function createPassBudget(
  startedAt: number,
  budgetMs = MANAGER_PASS_BUDGET_MS,
  reserveMs = MANAGER_TRIAGE_RESERVE_MS,
): PassBudget {
  const truncated: string[] = [];
  // Clamped so a caller-supplied budget smaller than the reserve cannot invert the two
  // deadlines and make `over()` fire before the pass has started.
  const discretionaryMs = Math.max(0, budgetMs - Math.min(reserveMs, budgetMs));
  return {
    over: () => Date.now() - startedAt >= discretionaryMs,
    exhausted: () => Date.now() - startedAt >= budgetMs,
    elapsedMs: () => Date.now() - startedAt,
    truncated,
    shed: (stage: string) => {
      if (truncated.includes(stage)) return false;
      truncated.push(stage);
      return true;
    },
  };
}
const MAX_DISPATCHES_PER_RUN = 12;
const MAX_AUDITS_PER_RUN = 40;
/** Coordinator ticks per pass — each can rewind a lane + start a run, so pace them. */
const MAX_REMEDIATIONS_PER_RUN = 10;

/** `manager_actions.action_type` for "PR is ready but merge authority is withheld"
 *  (0363). Its own type — not 'flag' — so the surface can say "waiting on a human to
 *  merge" and the dedupe query can find prior reports for a PR in one indexed lookup.
 *  Must fit `action_type varchar(24)`. */
const MERGE_BLOCKED_ACTION = 'merge_blocked';

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
      autoSchedule: projectManagerConfigs.autoSchedule,
      managerType: projectManagerConfigs.managerType,
      requireSignoffToComplete: projectManagerConfigs.requireSignoffToComplete,
      allowAutoMerge: projectManagerConfigs.allowAutoMerge,
      allowUnattendedCeremonies: projectManagerConfigs.allowUnattendedCeremonies,
      allowAgentReassignment: projectManagerConfigs.allowAgentReassignment,
      agentReassignIdleHours: projectManagerConfigs.agentReassignIdleHours,
      agentReassignMaxPerSession: projectManagerConfigs.agentReassignMaxPerSession,
      lastRunAt: projectManagerConfigs.lastRunAt,
    })
    .from(projectManagerConfigs)
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

// ── workspace (tenant) tier ─────────────────────────────────────────────────

/** KV key for a tenant's workspace manager defaults (invalidated on every write). */
const tenantDefaultsCacheKey = (tenantId: number) => `manager-defaults:tenant:${tenantId}`;

/**
 * Load a tenant's workspace manager defaults (null when the workspace has never stated a
 * posture → the hardcoded defaults apply). Read through the shared cache when an `env` is
 * available: this row is read once per project on EVERY manager sweep tick, so an uncached
 * read multiplies one unchanging row by the project count every five minutes.
 */
export async function getTenantManagerDefaults(
  db: Db, tenantId: number, env?: Env,
): Promise<TenantManagerDefaultsRow | null> {
  const load = async (): Promise<TenantManagerDefaultsRow | null> => {
    const [row] = await db
      .select({
        enabled: tenantManagerDefaults.enabled,
        prMergePolicy: tenantManagerDefaults.prMergePolicy,
        autoAssign: tenantManagerDefaults.autoAssign,
        autoBusinessValue: tenantManagerDefaults.autoBusinessValue,
        autoPrioritize: tenantManagerDefaults.autoPrioritize,
        autoSchedule: tenantManagerDefaults.autoSchedule,
        requireSignoffToComplete: tenantManagerDefaults.requireSignoffToComplete,
        allowAutoMerge: tenantManagerDefaults.allowAutoMerge,
        // Ceremony autonomy (0365) rides the same tier and the same fold.
        allowUnattendedCeremonies: tenantManagerDefaults.allowUnattendedCeremonies,
        allowAgentReassignment: tenantManagerDefaults.allowAgentReassignment,
        agentReassignIdleHours: tenantManagerDefaults.agentReassignIdleHours,
        agentReassignMaxPerSession: tenantManagerDefaults.agentReassignMaxPerSession,
      })
      .from(tenantManagerDefaults)
      .where(eq(tenantManagerDefaults.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  };
  if (!env) return load();
  // `null` is a legitimate cached value here (most workspaces never set defaults), and
  // getOrSetCached treats a cached null as a miss — so cache a discriminated wrapper.
  const cached = await getOrSetCached<{ row: TenantManagerDefaultsRow | null }>(
    env, tenantDefaultsCacheKey(tenantId), async () => ({ row: await load() }), { kvTtlSeconds: 600 },
  );
  return cached.row;
}

/** Editable subset of the workspace defaults. `null` clears a field back to "no opinion". */
export type TenantManagerDefaultsPatch = Partial<TenantManagerDefaultsRow>;

/**
 * Upsert a tenant's workspace manager defaults and invalidate the cached read. Only the
 * keys present in `patch` are written, so a caller can express one opinion without
 * accidentally pinning the others (which is the whole point of the nullable columns).
 */
export async function upsertTenantManagerDefaults(
  db: Db,
  tenantId: number,
  patch: TenantManagerDefaultsPatch,
  opts?: { updatedBy?: string | null; env?: Env },
): Promise<TenantManagerDefaultsRow | null> {
  const now = new Date();
  const normalized: TenantManagerDefaultsPatch = {
    ...patch,
    // An explicit garbage policy string must not be persisted; an explicit null (clear
    // the opinion) must survive.
    ...(patch.prMergePolicy !== undefined
      ? { prMergePolicy: patch.prMergePolicy === null ? null : normalizePrMergePolicy(patch.prMergePolicy) }
      : {}),
  };
  await db
    .insert(tenantManagerDefaults)
    .values({
      tenantId,
      enabled: normalized.enabled ?? null,
      prMergePolicy: normalized.prMergePolicy ?? null,
      autoAssign: normalized.autoAssign ?? null,
      autoBusinessValue: normalized.autoBusinessValue ?? null,
      autoPrioritize: normalized.autoPrioritize ?? null,
      autoSchedule: normalized.autoSchedule ?? null,
      requireSignoffToComplete: normalized.requireSignoffToComplete ?? null,
      allowAutoMerge: normalized.allowAutoMerge ?? null,
      allowUnattendedCeremonies: normalized.allowUnattendedCeremonies ?? null,
      allowAgentReassignment: normalized.allowAgentReassignment ?? null,
      agentReassignIdleHours: normalized.agentReassignIdleHours ?? null,
      agentReassignMaxPerSession: normalized.agentReassignMaxPerSession ?? null,
      updatedBy: opts?.updatedBy ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantManagerDefaults.tenantId,
      set: {
        ...(normalized.enabled !== undefined ? { enabled: normalized.enabled } : {}),
        ...(normalized.prMergePolicy !== undefined ? { prMergePolicy: normalized.prMergePolicy } : {}),
        ...(normalized.autoAssign !== undefined ? { autoAssign: normalized.autoAssign } : {}),
        ...(normalized.autoBusinessValue !== undefined ? { autoBusinessValue: normalized.autoBusinessValue } : {}),
        ...(normalized.autoPrioritize !== undefined ? { autoPrioritize: normalized.autoPrioritize } : {}),
        ...(normalized.autoSchedule !== undefined ? { autoSchedule: normalized.autoSchedule } : {}),
        ...(normalized.requireSignoffToComplete !== undefined ? { requireSignoffToComplete: normalized.requireSignoffToComplete } : {}),
        ...(normalized.allowAutoMerge !== undefined ? { allowAutoMerge: normalized.allowAutoMerge } : {}),
        ...(normalized.allowUnattendedCeremonies !== undefined ? { allowUnattendedCeremonies: normalized.allowUnattendedCeremonies } : {}),
        ...(normalized.allowAgentReassignment !== undefined ? { allowAgentReassignment: normalized.allowAgentReassignment } : {}),
        ...(normalized.agentReassignIdleHours !== undefined ? { agentReassignIdleHours: normalized.agentReassignIdleHours } : {}),
        ...(normalized.agentReassignMaxPerSession !== undefined ? { agentReassignMaxPerSession: normalized.agentReassignMaxPerSession } : {}),
        ...(opts?.updatedBy !== undefined ? { updatedBy: opts.updatedBy } : {}),
        updatedAt: now,
      },
    });
  if (opts?.env) await invalidateCached(opts.env, tenantDefaultsCacheKey(tenantId));
  return getTenantManagerDefaults(db, tenantId);
}

/**
 * The EFFECTIVE policy for a project — the full three-tier fold
 * (hardcoded default ← workspace defaults ← project row), resolved by the one shared
 * pure function. `env` is optional so unit/legacy callers still work; when supplied the
 * workspace row is served from the read-through cache.
 */
export async function getEffectiveManagerPolicy(
  db: Db, tenantId: number, projectId: number, env?: Env,
): Promise<EffectiveManagerPolicy> {
  const [tenant, project] = await Promise.all([
    getTenantManagerDefaults(db, tenantId, env),
    getManagerConfigRow(db, tenantId, projectId),
  ]);
  return resolveTieredManagerPolicy({ tenant, project });
}

/** Upsert a project's manager config (the designation + policy). */
export async function upsertManagerConfig(
  db: Db,
  tenantId: number,
  projectId: number,
  patch: Partial<Pick<ManagerConfigRow, 'managerRef' | 'enabled' | 'prMergePolicy' | 'autoAssign' | 'autoBusinessValue' | 'autoPrioritize' | 'autoSchedule' | 'managerType' | 'requireSignoffToComplete' | 'allowAutoMerge' | 'allowUnattendedCeremonies' | 'allowAgentReassignment' | 'agentReassignIdleHours' | 'agentReassignMaxPerSession'>>,
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
      // Default TRUE on insert, like its grooming siblings (0364): scheduling only ever
      // fills tickets with NO dates and never overwrites a human's, so a newly-configured
      // project gains a timeline rather than another empty column.
      autoSchedule: patch.autoSchedule ?? true,
      managerType: normalizeManagerType(patch.managerType),
      // Default TRUE on insert: a newly-configured project must not silently gain
      // unreviewed auto-merge authority just because the caller omitted the field.
      requireSignoffToComplete: patch.requireSignoffToComplete ?? true,
      // Default NULL on insert = "inherit the workspace tier" (0363). Writing `false`
      // here would pin a brand-new project against a workspace-wide grant it should have
      // received; writing `true` would grant authority nobody asked for.
      allowAutoMerge: patch.allowAutoMerge ?? null,
      // Ceremony autonomy (0364) — NULL on insert for the same reason as allowAutoMerge:
      // a brand-new project has never had an opinion about whether its standups may run
      // without its people, and an ADD COLUMN default would invent one.
      allowUnattendedCeremonies: patch.allowUnattendedCeremonies ?? null,
      allowAgentReassignment: patch.allowAgentReassignment ?? null,
      agentReassignIdleHours: patch.agentReassignIdleHours ?? null,
      agentReassignMaxPerSession: patch.agentReassignMaxPerSession ?? null,
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
        ...(patch.autoSchedule !== undefined ? { autoSchedule: patch.autoSchedule } : {}),
        ...(patch.managerType !== undefined ? { managerType: normalizeManagerType(patch.managerType) } : {}),
        ...(patch.requireSignoffToComplete !== undefined ? { requireSignoffToComplete: patch.requireSignoffToComplete } : {}),
        ...(patch.allowAutoMerge !== undefined ? { allowAutoMerge: patch.allowAutoMerge } : {}),
        ...(patch.allowUnattendedCeremonies !== undefined ? { allowUnattendedCeremonies: patch.allowUnattendedCeremonies } : {}),
        ...(patch.allowAgentReassignment !== undefined ? { allowAgentReassignment: patch.allowAgentReassignment } : {}),
        ...(patch.agentReassignIdleHours !== undefined ? { agentReassignIdleHours: patch.agentReassignIdleHours } : {}),
        ...(patch.agentReassignMaxPerSession !== undefined ? { agentReassignMaxPerSession: patch.agentReassignMaxPerSession } : {}),
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
  } catch (error) {
    /* the audit feed is best-effort — a write miss must not fail the pass */
  
    reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "recordManagerAction" });
  }
}

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
    }).where(and(
      eq(tasks.projectId, args.projectId),
      eq(tasks.source, 'manager'),
      inArray(tasks.status, OPEN_RUN_TASK_STATUSES),
      ...(args.olderThanMs > 0
        ? [sql`${tasks.updatedAt} < ${new Date(now.getTime() - args.olderThanMs)}`]
        : []),
    )).returning({ id: tasks.id });
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
  args: { taskId: number; summary: ManagerRunSummary; ok: boolean },
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
  } catch (error) {
    /* best-effort */
  
    reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "finalizeManagerRunTask" });
  }
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
     * The SYSTEMIC-FINDINGS path passes false, deliberately. A platform-defect ticket is
     * the output of one model call over a stall census: it names a defect, it does not
     * specify work an agent should start unsupervised the instant it exists. Firing the
     * trigger at creation is also what made the measured failure so loud — task 1032 was
     * dispatched, refused and recorded as an error within two seconds of being filed.
     * Skipping it does NOT make the ticket inert: it is a normal high-priority ticket, so
     * the manager's ranked, budgeted dispatch stage (or a human) picks it up on the next
     * pass, with all the backpressure that path applies.
     */
    autoDispatch?: boolean;
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

    // Immediacy: if the manager is an agent and the lane is staffed, start now — else the
    // manager's next pass (step 5 dispatch) picks up the assigned runnable ticket anyway.
    if (args.autoDispatch !== false) {
      try {
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
    })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL),
      // The manager never grooms/ranks/audits its OWN run tasks (source = 'manager').
      notSystemTask,
    ))
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
    projectId, skipped: false, scored: 0, ranked: 0, scheduled: 0, assigned: 0, prsConducted: 0, prsMerged: 0, dispatched: 0,
    audited: 0, flagged: 0, remediated: 0, remediationDeferred: 0,
    stalled: 0, unstuck: 0, escalated: 0, stallsResolved: 0, staleRunTasksClosed: 0,
    censusStalled: 0, censusTopCause: null, systemicFindings: 0, systemicTicketsCreated: 0,
    truncated: [],
  };

  const policy = await getEffectiveManagerPolicy(db, tenantId, projectId, env);
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
      } catch (error) { /* skip this ticket */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
      }
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
    // Ranking reorders `managed` for the SCHEDULE pass below, which places work in
    // rank order — the manager's own judgement of what comes first is what decides
    // what gets the earliest window.
    const rankOf = new Map(ranked.map((r) => [r.taskId, r.rank]));
    managed = [...managed].sort(
      (a, b) => (rankOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

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
        const items = managed.map((t) => ({
          key: String(t.id),
          estimateDays: estimateDaysFromStoryPoints(t.storyPoints),
          afterKeys: edges
            .filter((e) => e.successorTaskId === t.id && anchorById.has(e.predecessorTaskId))
            .map((e) => String(e.predecessorTaskId)),
        }));
        const plan = scheduleItems(items, { anchor: new Date(now) });
        const writes: unknown[] = [];
        const stampedAt = new Date();
        for (const t of unscheduled) {
          const window = plan.windows.get(String(t.id));
          if (!window) continue;
          writes.push(
            db.update(tasks)
              .set({ startDate: window.startDate, dueDate: window.endDate, updatedAt: stampedAt })
              .where(eq(tasks.id, t.id)),
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
              // A cycle in the project's dependency graph degrades scheduling (those
              // tickets start at the anchor instead of after their predecessor), so it
              // is reported rather than silently absorbed.
              cyclic: plan.cyclic.length,
            },
          });
        }
      } catch (error) { /* scheduling is best-effort; the rest of the pass stands */ 
        reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
      }
    }
  }

  // 3. ASSIGN — give unowned runnable tickets to the best-fit teammate/agent. ----
  if (policy.autoAssign) {
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
        tenantId, projectId, tasks: managed, shared: censusSignals,
      }).catch(() => null)
      : null;

    if (census) {
      summary.censusStalled = census.stalled;
      summary.censusTopCause = census.cohorts[0]?.cause ?? null;

      // The census itself is set-based arithmetic and always runs — measurement is the
      // one thing a truncated pass must not lose. The DIAGNOSIS below spends up to
      // MAX_FINDINGS_PER_PASS model calls, so it is shed like any other optional work;
      // the cohorts are still recorded, and the next pass raises the finding.
      const systemic = budget.over()
        ? (budget.shed('systemic'), { findings: [], ticketsCreated: 0, resolved: 0, journal: [] })
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
          // NEVER dispatched at creation — see `autoDispatch`. A platform-defect ticket
          // is a diagnosis, not a work order, and the measured failure was exactly this
          // ticket being dispatched, refused and recorded as an error on arrival.
          autoDispatch: false,
          submittedBy: `manager:systemic:${policy.managerRef ?? 'system'}`,
        }),
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

  // 4. PR — conduct (open) PRs for finished work, then merge/close per policy. ---
  // Records which tickets it acted on so the TRIAGE stage below can diagnose them
  // without re-applying a remedy the review pass just applied.
  // This is the stage that evicts the pass: each PR does provider round-trips, and 354
  // of them will not fit in one invocation however high MAX_PR_ACTIONS_PER_RUN is set.
  // It now stops at the budget instead of running until the isolate dies.
  const conductedTaskIds = new Set<number>();
  await coordinatePullRequests(env, db, runtimeService, { tenantId, projectId, policy, managed, summary, runTaskId, conductedTaskIds, budget });

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
    if (budget.over()) { budget.shed('dispatch'); break; }
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
    } catch (error) { /* skip */ 
      reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "runManagerForProject" });
    }
  }
  }

  // 6. AUDIT + REMEDIATE — check each managed ticket for role/diagnostic coverage
  // (pillar 1), then CLOSE what it finds. A flagged ticket is one missing a required
  // role owner or reviewer, so the manager drives the Coordinator over it: the tick
  // rewinds to the earliest unmet stage, resolves the role-capable participant and
  // dispatches them. Detecting the gap and only journalling it strands the ticket —
  // the flag feed was a dead end, and staffing the gap is exactly the manager's job.
  {
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

        const outcome = await coordinateTicket(env, db, runtimeService, { tenantId, taskId: t.id });
        // Only journal a coordination that CHANGED something (rewound the lane or
        // started the missing role's run). A no-op tick on an already-staffed ticket
        // must stay silent, or the feed refills with noise every pass.
        const moved = outcome.ok && (outcome.dispatched || outcome.status !== t.status);
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
              + 'nothing was dispatched and the ticket has no owner yet.',
          detail: {
            roles, missing: result.missing.length, fromStatus: t.status,
            toStatus: outcome.status, dispatched: outcome.dispatched,
            requiredOutstanding: outcome.requiredOutstanding,
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
  if (budget.exhausted()) {
    // Triage is the most valuable stage AND the most expensive, so it is the one that
    // must never be silently dropped. Say so explicitly on the register rather than
    // letting a truncated pass read as "nothing was stuck". Reaching here means even the
    // reserved slice was gone before the stage started — a genuinely overrun pass, not
    // the routine starvation the reserve exists to prevent.
    budget.shed('triage');
    await recordManagerAction(db, {
      tenantId, projectId, runTaskId, actionType: 'triage',
      summary: `Stall triage skipped this pass — the whole ${Math.round(MANAGER_PASS_BUDGET_MS / 1000)}s pass budget, including the ${Math.round(MANAGER_TRIAGE_RESERVE_MS / 1000)}s reserved for triage, was already spent when it was reached.`,
      detail: {
        budgetMs: MANAGER_PASS_BUDGET_MS, reserveMs: MANAGER_TRIAGE_RESERVE_MS,
        elapsedMs: budget.elapsedMs(), truncated: budget.truncated,
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
      // Say so when a cap bit. A bounded pass that reports nothing reads as "the
      // manager looked and everything was fine", which is exactly the false clean
      // bill of health this whole stage exists to stop. One row per pass, not per
      // deferred ticket — the register already carries the per-ticket state.
      if (triage.deferred > 0) {
        await recordManagerAction(db, {
          tenantId, projectId, runTaskId, actionType: 'triage',
          summary:
            `Unstuck ${triage.unstuck} of ${triage.stalled} stalled ${triage.stalled === 1 ? 'ticket' : 'tickets'} this pass — ` +
            `${triage.deferred} waiting for the next one (max ${MAX_TRIAGE_DISPATCHES_PER_RUN} new runs per pass).`,
          detail: {
            stalled: triage.stalled, unstuck: triage.unstuck, deferred: triage.deferred,
            escalated: triage.escalated, dispatched: triage.dispatched,
            dispatchCap: MAX_TRIAGE_DISPATCHES_PER_RUN, ownsDispatch: shouldDispatch,
          },
        });
      }
    }
  }

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
 * PR coordination for one project:
 *   • CONDUCT — a finished-but-parked ticket (in review, has a branch, no PR, no live
 *     run) gets advanced to Done under any non-'queue' policy, opening its PR through
 *     the shared finalize path.
 *   • MERGE   — open PRs are merged + closed per policy: 'immediate' merges now,
 *     'on_green' merges only once CI is green, 'queue' leaves them for a human.
 */
/** Narrow the free-form `pull_requests.build_status` column to the readiness vocabulary. */
function normalizeBuildStatus(v: string | null | undefined): 'success' | 'failure' | 'pending' | null {
  return v === 'success' || v === 'failure' || v === 'pending' ? v : null;
}

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
  },
): Promise<void> {
  const { tenantId, projectId, policy, managed, summary, runTaskId, conductedTaskIds, budget } = ctx;

  // CONDUCT: complete review-ready tickets and open their PRs (skip under 'queue').
  //
  // SELF-GOVERNANCE (0362): this step is where the manager exercises completion
  // authority, so it is where unanimous sign-off is enforced. Previously it force-wrote
  // `status = DONE` for ANY in-review ticket with a branch, with no manifest check —
  // agent work was merged unreviewed. Now `requireSignoffToComplete` (default true)
  // demands every REQUIRED participation slot be satisfied first, and a ticket whose
  // manifest has no required slots never qualifies (signoffGate fails closed).
  //
  // The eligibility filter also no longer requires `gitBranch`: a ticket can be real
  // work with nothing to merge (a decision, a doc, a non-code chore). Those used to sit
  // in review forever because only branch-bearing tickets were ever conducted. A
  // fully-signed-off ticket with no branch is now closed directly — there is simply no
  // PR to open for it.
  if (policy.prMergePolicy !== 'queue') {
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
      : [];
    const buildByTask = new Map<number, string | null>();
    for (const r of reviewPrBuild) if (r.taskId != null) buildByTask.set(r.taskId, r.buildStatus);

    for (const t of reviewReady) {
      // BETWEEN tickets, never mid-ticket: a conduct/merge already begun always
      // completes, so shedding work can never leave a half-applied action.
      if (budget.over()) { budget.shed('pr_conduct'); break; }
      try {
        // THE EVALUATION. Four questions, one verdict, one recorded action — see
        // `evaluateTicketReadiness`. Every outcome is journalled, including the ones
        // that do nothing, because the old silent `continue` is precisely how 280
        // tickets sat in review for up to 19 days with no explanation anywhere.
        const signoff = await resolveSignoffGate(env, db, { tenantId, taskId: t.id });
        const readiness = decideTicketReadiness({
          taskType: t.taskType,
          actionType: t.actionType,
          hasBranch: !!t.gitBranch,
          hasPr: !!t.githubPrUrl,
          buildStatus: normalizeBuildStatus(buildByTask.get(t.id)),
          hasLiveRun: liveTaskIds.has(t.id),
          signoff,
          requireSignoff: policy.requireSignoffToComplete,
          requireGreenBuild: policy.prMergePolicy === 'on_green',
        });

        if (readiness.action === 'wait_for_run' || readiness.action === 'wait_for_build') {
          continue; // transient by definition — re-evaluated next pass, no noise
        }
        // Past the transient checks this pass WILL act on the ticket, so claim it:
        // TRIAGE still diagnoses and registers it (the stuck list must be complete)
        // but must not re-apply a remedy on top of the one about to run here.
        conductedTaskIds.add(t.id);

        // Expected a deliverable and there is none, or the build is red: this ticket is
        // not reviewable, it is unfinished. Send it BACK to implementation and start its
        // agent — the behaviour whose absence let implementable work rot in review.
        if (readiness.action === 'return_to_implementation' || readiness.action === 'return_build_failed') {
          await db.update(tasks)
            .set({ status: TaskStatus.IN_PROGRESS, completedAt: null, updatedAt: new Date() })
            .where(and(eq(tasks.id, t.id), eq(tasks.status, TaskStatus.IN_REVIEW)));
          const restarted = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
            tenantId, projectId, taskId: t.id, status: TaskStatus.IN_PROGRESS,
            submittedBy: `manager:review-return:${policy.managerRef ?? 'system'}`,
          }).catch(() => false);
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
          const drive = await driveOutstandingSignoffs(env, db, runtimeService, {
            tenantId, projectId, task: t, signoff, managerRef: policy.managerRef,
          });
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
              dispatchedTo: drive.asked,
            },
          });
          continue;
        }

        // readiness.action === 'complete' — every check passed.
        const canOpenPr = !!t.gitBranch && !t.githubPrUrl && (!!t.assignedAgentRef || t.assignedAgentHostId != null);
        await db.update(tasks)
          .set({ status: TaskStatus.DONE, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
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
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
          summary: canOpenPr
            ? `${readiness.detail} Opened PR for "${t.title}".`
            : `${readiness.detail} Closed "${t.title}" (no branch to merge).`,
          detail: {
            action: readiness.action,
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

  // ── THE SYNC CEILING ────────────────────────────────────────────────────────────
  // How many times each open PR has ALREADY been synced with its base without ever
  // merging. Syncing a stale branch is a correct action; syncing the same branch
  // forever is the platform's largest measured livelock — 40,580 `sync_pr` actions
  // against 10 merges all-time, and re-measured on 2026-07-26 still running at
  // 13,549/week with ZERO merges in the window. The remedy was never wrong; nothing
  // ever asked whether it worked.
  //
  // So the sync obeys the SAME exhaustion rule every stall remedy obeys
  // ({@link isActionExhausted}), read from the action log the loop already writes —
  // no new table, one extra grouped SELECT for the whole project. Past the ceiling the
  // PR is reported once as blocked and left alone for a human, instead of being
  // re-synced every five minutes indefinitely.
  const syncAttempts = new Map<number, number>();
  {
    const syncTaskIds = openPrs.flatMap((pr) => (pr.taskId == null ? [] : [pr.taskId]));
    if (syncTaskIds.length) {
      const rows = await db
        .select({ taskId: managerActions.taskId, n: sql<number>`count(*)::int` })
        .from(managerActions)
        .where(and(
          eq(managerActions.tenantId, tenantId),
          eq(managerActions.actionType, 'sync_pr'),
          inArray(managerActions.taskId, syncTaskIds),
        ))
        .groupBy(managerActions.taskId)
        .catch(() => []);
      for (const r of rows) if (r.taskId != null) syncAttempts.set(r.taskId, Number(r.n) || 0);
    }
  }

  // MERGE AUTHORITY (0363) is withheld by default, so "this PR is ready but I may not
  // merge it" is a STATE that persists across passes, not an event. Journalling it every
  // five minutes for every open PR would bury the feed and inflate a table that is
  // already a storage concern, so — same reasoning as the 0344 flag dedupe — load the
  // PRs already reported and write once per PR. One extra SELECT, and zero writes on the
  // steady-state pass where nothing changed.
  //
  // Loaded UNCONDITIONALLY (it used to be gated on `!allowAutoMerge`): the sync ceiling
  // above reports through the same action type and needs the same dedupe, and a
  // workspace WITH auto-merge enabled is exactly where a PR that never merges is worth
  // reporting once rather than every pass.
  const alreadyReportedBlocked = new Set<number>();
  {
    const blockedTaskIds = openPrs.flatMap((pr) => (pr.taskId == null ? [] : [pr.taskId]));
    if (blockedTaskIds.length) {
      const prior = await db
        .select({ taskId: managerActions.taskId })
        .from(managerActions)
        .where(and(
          eq(managerActions.tenantId, tenantId),
          eq(managerActions.actionType, MERGE_BLOCKED_ACTION),
          inArray(managerActions.taskId, blockedTaskIds),
        ))
        .catch(() => []);
      for (const row of prior) if (row.taskId != null) alreadyReportedBlocked.add(row.taskId);
    }
  }

  for (const pr of openPrs) {
    // The eviction point. Each iteration does provider round-trips (sync, poll, merge),
    // so this loop is where the pass dies on a project with hundreds of open PRs. Stop
    // at the budget, between PRs, and let the closing journal say so.
    if (budget.over()) { budget.shed('pr_merge'); break; }
    try {
      // A previous conflict-resolution run owns this branch until it finishes.
      if (pr.taskId != null && activePrTaskIds.has(pr.taskId)) continue;

      // Exhausted sync: this PR has been brought up to date with its base
      // MAX_REMEDY_ATTEMPTS times and still has not merged, so a further sync is not a
      // fix in progress — it is the livelock. Report it once (the `merge_blocked` dedupe
      // below is the same "state, not event" rule) and leave it for a human.
      if (pr.taskId != null && isActionExhausted(syncAttempts.get(pr.taskId) ?? 0)) {
        if (!alreadyReportedBlocked.has(pr.taskId)) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: MERGE_BLOCKED_ACTION,
            summary: `PR #${pr.number ?? '?'} has been synced with its base ${syncAttempts.get(pr.taskId)} times without merging — stopping the sync loop and handing it to a human.`,
            detail: { reason: 'sync_exhausted', syncAttempts: syncAttempts.get(pr.taskId) },
          });
          alreadyReportedBlocked.add(pr.taskId);
        }
        continue;
      }

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

      // SELF-GOVERNANCE (0362), enforced again at the merge itself. CONDUCT above is not
      // the only way a PR reaches this loop — the inline run-end finalize, the Done-drag
      // finalize and board-sync can all record one — so gating only the completion step
      // would leave an unreviewed back door straight to a squash-merge. Re-checking here
      // costs one cached manifest read and makes "merged ⇒ signed off" an invariant
      // rather than a property of the path taken.
      if (policy.requireSignoffToComplete && pr.taskId != null) {
        const gate = await resolveSignoffGate(env, db, { tenantId, taskId: pr.taskId });
        if (!gate.satisfied) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: 'flag',
            summary: `Did not merge PR #${pr.number ?? '?'} — ${gate.detail}`,
            detail: {
              signoffGate: gate.reason,
              requiredCount: gate.requiredCount,
              satisfiedCount: gate.satisfiedCount,
              outstanding: gate.outstanding.map((o) => ({ roleKey: o.roleKey, roleName: o.roleName, state: o.state })),
            },
          });
          continue;
        }
      }
      // MERGE AUTHORITY (0363) — the last gate, and a different question from every check
      // above it. Those ask "is this change ready?"; this asks "may the manager act on
      // that answer unattended?". It used to be inferred from `prMergePolicy !== 'queue'`,
      // conflating HOW a merge happens with WHETHER one is permitted, and the inferred
      // answer for a default-configured project was yes. It is now granted explicitly at
      // the workspace or project tier, defaults to withheld, and — because a withheld
      // grant on a ready PR is a decision — it is journalled rather than skipped, so the
      // surface shows "waiting on a human to merge" instead of a PR that quietly never
      // moves. Both this and the sign-off gate above must pass.
      if (!policy.allowAutoMerge) {
        if (pr.taskId == null || !alreadyReportedBlocked.has(pr.taskId)) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, runTaskId, actionType: MERGE_BLOCKED_ACTION,
            summary: `PR #${pr.number ?? '?'} is ready to merge, but autonomous merge authority is not granted — a human needs to approve & merge it.`,
            detail: {
              gate: 'allow_auto_merge',
              allowAutoMerge: false,
              prMergePolicy: policy.prMergePolicy,
              requireSignoffToComplete: policy.requireSignoffToComplete,
              grantAt: 'workspace manager defaults, or this project’s manager policy',
            },
          });
          if (pr.taskId != null) alreadyReportedBlocked.add(pr.taskId);
        }
        continue;
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
    } catch (error) { /* skip */ 
      reportCaughtError(error, { source: "application/manager/ManagerService.ts", operation: "coordinatePullRequests" });
    }
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
