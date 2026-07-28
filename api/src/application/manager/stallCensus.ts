/**
 * stallCensus — the AI Manager's FULL-COVERAGE reading of what is stuck.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `triageStage` diagnoses in depth, and depth is expensive: `evaluateTaskAutoRun`
 * resolves lanes, staffing, capabilities and live runs per ticket, so the stage is
 * bounded to {@link MAX_TRIAGE_PER_RUN} tickets per project per pass. That bound is
 * correct for ACTING — starting work is costly and must be deliberate — but it was
 * also, silently, the bound on KNOWING. Measured on tenant 1 (2026-07-26): 755 stalled
 * tickets, and `manager_stall_watch` held 44 rows. The manager was reasoning about
 * 5.8% of its own problem, and the register's `byCause` summary — the one number a
 * human reads to decide what to fix — was a sample of twelve-at-a-time, not a census.
 *
 * The consequence was not merely incomplete: it was MISLEADING IN RANK. The true
 * distribution across all 767 tickets is 313 `unassigned`, 149 owed a sign-off, 116
 * behind the failure breaker. The register's top cause was `unknown` (12 rows). Eight
 * successive rounds of remediation were aimed using that sample.
 *
 * ── HOW IT STAYS CHEAP ───────────────────────────────────────────────────────────
 * By deriving the dispatch verdict in BULK. Every input the fast ladder needs — the
 * board's lanes, which lanes are staffed, whether a ticket ever ran, its trailing
 * failure streak, its open manifest slots — is a set-based query over the whole
 * project, so the census costs a fixed handful of round-trips regardless of ticket
 * count. It reuses the signals `triageStage` already loads, so on the manager pass it
 * adds two queries, not N.
 *
 * ── WHY IT CANNOT DISAGREE WITH TRIAGE ───────────────────────────────────────────
 * It does not re-implement the diagnosis. {@link classifyBulkAutoRunReason} produces an
 * {@link AutoRunReason} in the SAME priority order `evaluateTaskAutoRun` applies, and
 * that reason is fed to the SAME pure {@link diagnoseStall} the deep stage uses. Census
 * and triage therefore agree on any ticket both look at, by construction rather than by
 * convention.
 *
 * ── WHAT IT DELIBERATELY CANNOT SEE ──────────────────────────────────────────────
 * The fast ladder is a strict SUBSET of the real evaluator. It cannot resolve
 * capability requirements (they need per-agent artifact resolution), the re-run
 * cooldown, same-lane re-entry, the workspace token gate, or the lane REQUIREMENT gate.
 * Tickets it cannot place land on `will_run`, and the deep stage — which does see those
 * — remains authoritative for the tickets it reaches. So the census is honest about
 * being a floor: {@link StallCensus.deepDiagnosed} reports how much of it has been
 * confirmed in depth, and a reader is never invited to mistake breadth for certainty.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  executions, managerStallWatch, swimlaneAgentAssignments, swimlanes, tasks, ticketParticipants,
} from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskStatus, ExecutionStatus } from '../../domain/shared/types';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { isUnapprovedFeedbackTask } from '../feedback/feedbackSpec';
import { isReviewLane } from '../task/taskLifecycle';
import { isParticipantOpen } from '../kanban/participantStates';
import {
  decideManagedLaneAuthority, loadBoardLaneAuthorities, pickManagedProducer,
  type LaneAuthorityInputs, type ManagedProducerSlot,
} from '../kanban/managedLaneRoles';
import { MAX_CONSECUTIVE_AUTORUN_FAILURES, type AutoRunReason } from '../swimlane/evaluateAutoRun';
import { diagnoseStall, STALL_AFTER_MS, type StallCause } from './stallTriage';
import { getEffectiveManagerPolicy } from './managerPolicyStore';

const CENSUS_TTL_SECONDS = 120;

const censusKey = (tenantId: number, projectId: number) => `manager:census:${tenantId}:${projectId}`;

/** Per-ticket facts the fast ladder reads. All bulk-loaded — see {@link loadCensusFacts}. */
export interface CensusTicketFacts {
  taskId: number;
  status: string;
  /** `tasks.source` — distinguishes a manager chore and unapproved feedback. */
  source: string | null;
  assignedAgentRef: string | null;
  /** Milliseconds since the last lane move, or since creation when it never moved. */
  idleMs: number;
  everRan: boolean;
  hasLiveRun: boolean;
  /** Most-recent consecutive FAILED runs (the breaker's input). */
  consecutiveFailures: number;
  /** This ticket's lane, when its status matches one on the board. */
  lane: { gate: string; isTerminal: boolean; staffed: boolean } | null;
  /**
   * LIFECYCLE-MANAGED board: whether this ticket's current stage resolves a
   * role-attributed producer.
   *
   * Null on an unmanaged board (the question does not apply). FALSE is the census's
   * reading of `managed_no_role` — the stage authorizes roles nobody can act as, so no
   * dispatch is possible however well staffed the lane looks. Without it the census
   * classified a managed lane WITH staffing as `will_run` and the cohort surfaced as a
   * generic staffing problem, which is precisely the misdiagnosis that let the defect
   * run: the census must model the same gate the dispatcher enforces.
   */
  managedProducerResolvable: boolean | null;
  /**
   * Required manifest roles for the CURRENT stage that still owe work.
   *
   * The role KEYS are carried, not just a boolean, because `diagnoseStall` only reaches
   * its `awaiting_signoff` branch when it can name who owes the work — an owed sign-off
   * with no nameable role is indistinguishable from no gate at all, and the ticket falls
   * through to `never_started`. Naming them is what makes the measured 149-ticket
   * sign-off cohort classify as itself rather than as a dispatch problem.
   */
  stageOwedRoles: string[];
}

/**
 * The slice of the effective manager policy the census must honour.
 *
 * A REQUIRED parameter rather than an optional flag, and that is the whole point. The
 * platform has two diagnosis paths over the same taxonomy — the deep stall triage and
 * this census — and when `requireSignoffToComplete` became a project setting (0380) only
 * the first was taught to consult it. The census went on reporting an `awaiting_signoff`
 * cohort for a project whose gate was switched OFF, and `systemicDiagnosis` promoted that
 * cohort to a platform finding ("a defect in the sign-off recording mechanism"), sending
 * an operator after a gate that was not holding anything. Measured on project 11 at api
 * 2026.7.175, hours after the gate was disabled: 135 tickets still counted, 76 of them
 * raised as an open finding.
 *
 * Making it non-optional means a third path cannot be added without answering the
 * question, which is the only guard that would have caught this one.
 */
export interface CensusPolicy {
  /** The project's effective `requireSignoffToComplete`. */
  requireSignoff: boolean;
}

/** One cause bucket of the census. */
export interface CensusCohort {
  cause: StallCause;
  count: number;
  /** The longest-idle members, for a human (and the LLM) to see concrete instances. */
  sampleTaskIds: number[];
  /** Longest idle time in this cohort, ms. */
  maxIdleMs: number;
}

export interface StallCensus {
  projectId: number;
  /** Non-terminal, non-archived tickets the manager is accountable for. */
  managed: number;
  stalled: number;
  moving: number;
  cohorts: CensusCohort[];
  /** How many of the stalled set the DEEP stage has confirmed (open register rows). */
  deepDiagnosed: number;
  computedAt: string;
}

/**
 * The dispatch verdict, derived from bulk facts alone. PURE.
 *
 * The order is `evaluateTaskAutoRun`'s order, including the part that lives in
 * `classifyResolvedAutoRun` — the human gate outranks staffing, which outranks a live
 * run, which outranks the breaker. Reordering these would make the census disagree with
 * the gate a ticket is actually held by, which is the whole failure this module exists
 * to end, so the sequence is load-bearing and mirrors the evaluator deliberately.
 *
 * Returns `will_run` for anything the fast ladder cannot place — never a guess.
 */
export function classifyBulkAutoRunReason(f: CensusTicketFacts): AutoRunReason {
  // Pre-lane guards, in the evaluator's order.
  if (f.source === 'manager') return 'not_executable';
  if (isUnapprovedFeedbackTask(f.source)) return 'pending_approval';
  if (f.status === TaskStatus.DONE) return 'terminal_lane';
  if (!f.lane) return 'no_lane';
  if (f.lane.isTerminal) return 'terminal_lane';

  // Resolved-lane ladder (classifyResolvedAutoRun's order).
  if (f.lane.gate === 'human') return 'human_gate';
  // MANAGED BOARD, ranked exactly where the evaluator ranks it: under the human gate and
  // above staffing. A managed dispatch must be role-attributed, so "is the lane staffed"
  // is the wrong question — the right one is whether an authorized role resolves to an
  // agent, which is what this fact answers.
  if (f.managedProducerResolvable === false) return 'managed_no_role';
  // Staffing. The owner fallback is suppressed on a review-class lane exactly as the
  // evaluator suppresses it — otherwise the census would report a review lane as
  // staffed by the very agent that authored the work.
  const ownerCanRun = !!f.assignedAgentRef && !isReviewLane(f.status);
  if (!f.lane.staffed && !ownerCanRun) return 'no_agent';
  if (f.hasLiveRun) return 'already_running';
  if (f.consecutiveFailures >= MAX_CONSECUTIVE_AUTORUN_FAILURES) return 'run_cap_exhausted';
  return 'will_run';
}

/**
 * Diagnose one ticket from bulk facts, through the SAME pure classifier the deep stage
 * uses. PURE.
 *
 * `pr` and `readiness` are deliberately null: both need per-ticket provider and gate
 * round-trips, which is precisely what the deep stage is for. Passing null means the
 * census never claims a PR-side verdict it has not earned — it reports the dispatch-side
 * truth, which is where 578 of the 755 measured stalls actually sit.
 */
export function censusDiagnose(f: CensusTicketFacts, policy: CensusPolicy, stallAfterMs = STALL_AFTER_MS) {
  return diagnoseStall({
    status: f.status,
    isTerminal: f.lane?.isTerminal ?? f.status === TaskStatus.DONE,
    idleMs: f.idleMs,
    everRan: f.everRan,
    autoRunReason: classifyBulkAutoRunReason(f),
    hasLiveRun: f.hasLiveRun,
    readiness: null,
    // The stage's own owed roles ARE bulk-knowable (one query over the manifest), and
    // they are what turns a generic `will_run` into the real `awaiting_signoff` answer
    // for the measured 149-ticket cohort.
    //
    // ONLY WHEN THE PROJECT ASKS FOR SIGN-OFF (0380). An open manifest slot on a project
    // that does not require sign-off owes nothing and holds nothing — naming it as the
    // stall cause hides the ticket's real blocker behind a gate that is switched off.
    // `loadCensusFacts` additionally skips the manifest query entirely in that case, so
    // this is the second of two independent stops, not the only one.
    //
    // `dispatchable: true` is deliberate and is the CONSERVATIVE choice: false would
    // escalate the whole cohort to a human on the census's word alone, and whether the
    // owing role actually has a runnable agent needs the per-agent resolution only the
    // deep stage performs. So the census reports the cohort and lets the deep stage
    // decide who can be asked.
    stageSignoff: policy.requireSignoff && f.stageOwedRoles.length > 0
      ? { roleNames: f.stageOwedRoles, dispatchable: true }
      : null,
    signoffDispatchable: null,
    pr: null,
    mergeWithheld: false,
    stallAfterMs,
  });
}

/** Roll per-ticket diagnoses into cohorts. PURE — unit-tested without a database. */
export function summarizeCensus(
  projectId: number,
  rows: ReadonlyArray<{ taskId: number; idleMs: number; stalled: boolean; cause: StallCause }>,
  deepDiagnosed: number,
  computedAt = new Date(),
): StallCensus {
  const buckets = new Map<StallCause, { count: number; worst: Array<{ id: number; idleMs: number }>; maxIdleMs: number }>();
  let stalled = 0;
  for (const r of rows) {
    if (!r.stalled) continue;
    stalled += 1;
    const b = buckets.get(r.cause) ?? { count: 0, worst: [], maxIdleMs: 0 };
    b.count += 1;
    b.maxIdleMs = Math.max(b.maxIdleMs, r.idleMs);
    b.worst.push({ id: r.taskId, idleMs: r.idleMs });
    buckets.set(r.cause, b);
  }
  const cohorts: CensusCohort[] = [...buckets.entries()]
    .map(([cause, b]) => ({
      cause,
      count: b.count,
      maxIdleMs: b.maxIdleMs,
      sampleTaskIds: b.worst.sort((x, y) => y.idleMs - x.idleMs).slice(0, 5).map((s) => s.id),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    projectId,
    managed: rows.length,
    stalled,
    moving: rows.length - stalled,
    cohorts,
    deepDiagnosed,
    computedAt: computedAt.toISOString(),
  };
}

/** The ticket shape the census reads — structurally satisfied by the manager's rows. */
export interface CensusTask {
  id: number;
  status: string;
  source?: string | null;
  createdAt: Date;
  assignedAgentRef: string | null;
  /** Scope for a managed stage's requirement applicability (see `managedLaneRoles`). */
  taskType?: string | null;
  actionType?: string | null;
}

/** Signals `triageStage` has already loaded, reused rather than re-queried. */
export interface SharedCensusSignals {
  lastMovedAt: Map<number, Date>;
  everRan: Set<number>;
  liveTaskIds: Set<number>;
}

/**
 * Bulk-load every fact the ladder needs. Set-based throughout: one query for the
 * lanes, one for lane staffing, one for the failure streaks, one for the manifest —
 * plus the caller's shared signals when it has them (the manager pass always does).
 */
export async function loadCensusFacts(
  db: Db,
  args: {
    tenantId: number; projectId: number; tasks: CensusTask[]; policy: CensusPolicy;
    shared?: SharedCensusSignals; now?: number; env?: Env;
  },
): Promise<CensusTicketFacts[]> {
  const now = args.now ?? Date.now();
  const taskIds = args.tasks.map((t) => t.id);
  if (taskIds.length === 0) return [];

  const board = await findCanonicalBoard(db, args.projectId, args.tenantId);

  const [laneRows, staffRows, streakRows, owedRoles, shared, laneAuthorities, producerSlots] = await Promise.all([
    board
      ? db.select({ id: swimlanes.id, key: swimlanes.key, gate: swimlanes.gate, isTerminal: swimlanes.isTerminal })
        .from(swimlanes).where(scopedToTenant(swimlanes, args.tenantId, eq(swimlanes.boardId, board.id))).catch(() => [])
      : Promise.resolve([] as Array<{ id: string; key: string; gate: string; isTerminal: boolean }>),
    board
      ? db.selectDistinct({ swimlaneId: swimlaneAgentAssignments.swimlaneId })
        .from(swimlaneAgentAssignments)
        .innerJoin(swimlanes, eq(swimlanes.id, swimlaneAgentAssignments.swimlaneId))
        .where(scopedToTenant(swimlaneAgentAssignments, args.tenantId, eq(swimlanes.boardId, board.id))).catch(() => [])
      : Promise.resolve([] as Array<{ swimlaneId: string }>),
    // Trailing failure streak per ticket, in ONE window query: the count of leading
    // `failed` rows before the first run that is not a failure. Doing this per ticket
    // would be the N+1 the caching rules forbid, and the streak is what the breaker
    // cohort (116 tickets) is entirely made of.
    db.execute(sql`
      WITH ranked AS (
        SELECT task_id, status,
               row_number() OVER (PARTITION BY task_id ORDER BY created_at DESC) AS rn
        FROM executions
        WHERE task_id IN (${sql.join(taskIds.map((id) => sql`${id}`), sql`, `)})
      )
      SELECT task_id,
             COALESCE(MIN(rn) FILTER (WHERE status <> ${ExecutionStatus.FAILED}) - 1, COUNT(*)) AS streak
      FROM ranked GROUP BY task_id
    `).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
    // Not merely unused when the project does not require sign-off — NOT ASKED FOR. This
    // is a full scan of `ticket_participants` for every managed ticket on the board, on a
    // path the dashboard polls, and on such a project its every row is irrelevant by
    // definition (see {@link CensusPolicy}).
    args.policy.requireSignoff
      ? loadOwedRoles(db, args.tenantId, taskIds).catch(() => new Map<string, string[]>())
      : Promise.resolve(new Map<string, string[]>()),
    args.shared ? Promise.resolve(args.shared) : loadFallbackSignals(db, args.tenantId, taskIds),
    // MANAGED AUTHORITY, board-wide and per-ticket, in a fixed number of queries: the
    // lane authorities are loaded ONCE for the whole board and the per-ticket decision is
    // made in memory, and the manifest slots come from the same single read `loadOwedRoles`
    // already performs. Resolving this per ticket would be the N+1 the caching rules
    // forbid on a 675-ticket census.
    board?.lifecycleManaged
      ? loadBoardLaneAuthorities(db, { tenantId: args.tenantId, projectId: args.projectId, boardId: board.id, ...(args.env ? { env: args.env } : {}) }).catch(() => new Map())
      : Promise.resolve(new Map()),
    board?.lifecycleManaged
      ? loadProducerSlots(db, args.tenantId, taskIds).catch(() => new Map<string, ManagedProducerSlot[]>())
      : Promise.resolve(new Map<string, ManagedProducerSlot[]>()),
  ]);

  const laneByKey = new Map<string, { id: string; gate: string; isTerminal: boolean; staffed: boolean }>();
  const staffedLaneIds = new Set((staffRows as Array<{ swimlaneId: string }>).map((s) => s.swimlaneId));
  for (const l of laneRows as Array<{ id: string; key: string; gate: string; isTerminal: boolean }>) {
    laneByKey.set(l.key, { id: l.id, gate: l.gate, isTerminal: l.isTerminal, staffed: staffedLaneIds.has(l.id) });
  }

  const streakByTask = new Map<number, number>();
  for (const r of (streakRows as { rows?: Array<Record<string, unknown>> }).rows ?? []) {
    const id = Number(r.task_id);
    if (Number.isFinite(id)) streakByTask.set(id, Number(r.streak) || 0);
  }

  const managed = !!board?.lifecycleManaged;
  return args.tasks.map((t): CensusTicketFacts => {
    const last = shared.lastMovedAt.get(t.id) ?? t.createdAt;
    const lane = laneByKey.get(t.status) ?? null;
    // The SAME pure pick the evaluator and the guard use, applied to bulk-loaded inputs —
    // so the census cannot disagree with the dispatcher about whether a managed stage has
    // a runnable role.
    let managedProducerResolvable: boolean | null = null;
    if (managed && lane && !lane.isTerminal && !isReviewLane(t.status)) {
      const inputs = (laneAuthorities as Map<string, LaneAuthorityInputs>).get(lane.id);
      const authority = inputs
        ? decideManagedLaneAuthority(inputs, { taskType: t.taskType ?? null, actionType: t.actionType ?? null })
        : { roleKeys: [] as string[], approvers: [], tier: 'none' as const };
      const slots = (producerSlots as Map<string, ManagedProducerSlot[]>).get(`${t.id}:${t.status}`) ?? [];
      managedProducerResolvable = pickManagedProducer(authority, slots) != null;
    }
    return {
      taskId: t.id,
      status: t.status,
      source: t.source ?? null,
      assignedAgentRef: t.assignedAgentRef,
      idleMs: Math.max(0, now - new Date(last).getTime()),
      everRan: shared.everRan.has(t.id),
      hasLiveRun: shared.liveTaskIds.has(t.id),
      consecutiveFailures: streakByTask.get(t.id) ?? 0,
      lane: lane ? { gate: lane.gate, isTerminal: lane.isTerminal, staffed: lane.staffed } : null,
      managedProducerResolvable,
      stageOwedRoles: (owedRoles as Map<string, string[]>).get(`${t.id}:${t.status}`) ?? [],
    };
  });
}

/** Manifest producer slots for many tickets at once, keyed `taskId:stageKey`. */
async function loadProducerSlots(
  db: Db,
  tenantId: number,
  taskIds: number[],
): Promise<Map<string, ManagedProducerSlot[]>> {
  const rows = await db
    .select({
      taskId: ticketParticipants.taskId,
      stageKey: ticketParticipants.stageKey,
      roleKey: ticketParticipants.roleKey,
      responsibility: ticketParticipants.responsibility,
      state: ticketParticipants.state,
      assigneeKind: ticketParticipants.assigneeKind,
      assigneeRef: ticketParticipants.assigneeRef,
    })
    .from(ticketParticipants)
    .where(and(
      eq(ticketParticipants.tenantId, tenantId),
      inArray(ticketParticipants.taskId, taskIds),
      eq(ticketParticipants.required, true),
    ));
  const out = new Map<string, ManagedProducerSlot[]>();
  for (const r of rows) {
    if (!r.stageKey) continue;
    const key = `${r.taskId}:${r.stageKey}`;
    const list = out.get(key) ?? [];
    list.push({
      roleKey: r.roleKey,
      responsibility: r.responsibility,
      state: r.state,
      assigneeKind: r.assigneeKind,
      assigneeRef: r.assigneeRef,
    });
    out.set(key, list);
  }
  return out;
}

/** Roles that still OWE work, keyed `taskId:stageKey` → role keys. */
async function loadOwedRoles(db: Db, tenantId: number, taskIds: number[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      taskId: ticketParticipants.taskId,
      stageKey: ticketParticipants.stageKey,
      state: ticketParticipants.state,
      roleKey: ticketParticipants.roleKey,
    })
    .from(ticketParticipants)
    .where(and(
      eq(ticketParticipants.tenantId, tenantId),
      inArray(ticketParticipants.taskId, taskIds),
      eq(ticketParticipants.required, true),
    ));
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.stageKey || !isParticipantOpen(r.state)) continue;
    const key = `${r.taskId}:${r.stageKey}`;
    const list = out.get(key) ?? [];
    if (r.roleKey && !list.includes(r.roleKey)) list.push(r.roleKey);
    out.set(key, list);
  }
  return out;
}

/** Signals the manager pass already has; loaded here only for the standalone read path. */
async function loadFallbackSignals(db: Db, tenantId: number, taskIds: number[]): Promise<SharedCensusSignals> {
  const [ran, live] = await Promise.all([
    db.selectDistinct({ taskId: executions.taskId }).from(executions)
      .where(scopedToTenant(executions, tenantId, inArray(executions.taskId, taskIds))).catch(() => []),
    db.selectDistinct({ taskId: executions.taskId }).from(executions)
      .where(scopedToTenant(executions, tenantId,
        inArray(executions.taskId, taskIds),
        inArray(executions.status, [
          ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED, ExecutionStatus.RUNNING, ExecutionStatus.PAUSED,
        ]),
      )).catch(() => []),
  ]);
  return {
    lastMovedAt: new Map(),
    everRan: new Set(ran.flatMap((r) => (r.taskId == null ? [] : [r.taskId]))),
    liveTaskIds: new Set(live.flatMap((r) => (r.taskId == null ? [] : [r.taskId]))),
  };
}

/**
 * Compute the census for a project. Used by the manager pass (passing its already-loaded
 * signals, so it costs a few extra set-based queries) and by the read endpoint below.
 */
export async function computeStallCensus(
  db: Db,
  args: {
    tenantId: number; projectId: number; tasks: CensusTask[]; policy: CensusPolicy;
    shared?: SharedCensusSignals; now?: number; env?: Env;
  },
): Promise<StallCensus> {
  const facts = await loadCensusFacts(db, args);
  const rows = facts.map((f) => {
    const d = censusDiagnose(f, args.policy);
    return { taskId: f.taskId, idleMs: f.idleMs, stalled: d.stalled, cause: d.cause };
  });
  const deepDiagnosed = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(managerStallWatch)
    .where(scopedToTenant(managerStallWatch, args.tenantId, eq(managerStallWatch.projectId, args.projectId), isNull(managerStallWatch.resolvedAt)))
    .then((r) => Number(r[0]?.n ?? 0))
    .catch(() => 0);
  return summarizeCensus(args.projectId, rows, deepDiagnosed, args.now ? new Date(args.now) : new Date());
}

/**
 * Read the census for a project, cached. The manager pass invalidates it, and the panel
 * that renders it polls — so a short TTL keeps a dashboard read off the database while
 * still reflecting the most recent pass.
 */
export async function getStallCensus(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number },
): Promise<StallCensus> {
  return getOrSetCached(
    env,
    censusKey(args.tenantId, args.projectId),
    async () => {
      // Resolved HERE rather than asked of the caller (0380). Both read paths — the
      // dashboard endpoint and the `manager.census` MCP tool — would otherwise each have
      // to remember to pass it, which is the same "one path consulted the policy and the
      // other did not" split that produced the cohort this fixes. Inside the cache
      // factory, so it costs one fold per miss and nothing per hit; the tenant tier is
      // itself read-through cached.
      const policy = await getEffectiveManagerPolicy(db, args.tenantId, args.projectId, env);
      const rows = await db
        .select({
          id: tasks.id, status: tasks.status, source: tasks.source,
          createdAt: tasks.createdAt, assignedAgentRef: tasks.assignedAgentRef,
          taskType: tasks.taskType, actionType: tasks.actionType,
        })
        .from(tasks)
        // `tasks` is scoped by project, not tenant (it carries no tenant_id column);
        // the caller has already established the project belongs to this tenant.
        .where(and(eq(tasks.projectId, args.projectId), eq(tasks.archived, false)))
        .catch(() => []);
      return computeStallCensus(db, {
        ...args,
        tasks: rows as CensusTask[],
        policy: { requireSignoff: policy.requireSignoffToComplete },
        env,
      });
    },
    { kvTtlSeconds: CENSUS_TTL_SECONDS },
  );
}

/** Call when a manager pass changes the picture so the cached census re-computes. */
export async function invalidateStallCensus(env: Env, tenantId: number, projectId: number): Promise<void> {
  await invalidateCached(env, censusKey(tenantId, projectId));
}
