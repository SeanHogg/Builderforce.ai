import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runStallTriage — the AI Manager's pass over tickets that have STOPPED MOVING.
 *
 * The manager's other stages each act on a ticket for a reason of their own: score it,
 * rank it, staff it, merge its PR, audit its roles. None of them asks the question a
 * human PM asks first — *what is stuck, and why?* Measured on tenant 1 across 90 days:
 * 821 tickets, 809 stalled, 466 of those never executed even once. Nothing was
 * accountable for noticing, so nothing did.
 *
 * This stage is that accountability, in four steps:
 *
 *   1. MEASURE   — how long has each managed ticket been idle, and has it ever run?
 *                  Three bulk queries for the whole project, never per ticket.
 *   2. RESOLVE   — tickets that are moving again close their register row.
 *   3. DIAGNOSE  — for the stalled ones, ask the canonical evaluators why
 *                  (`evaluateTaskAutoRun`, `decideTicketReadiness`, the provider's own
 *                  view of the PR) and turn the answer into a remedy (`stallTriage`).
 *   4. ACT       — apply the remedy, and RECORD that it was applied, so the next pass
 *                  can grade whether it worked.
 *
 * STEP 4 IS WHY THIS EXISTS RATHER THAN A DASHBOARD. The merge livelock this work
 * uncovered (40,580 `sync_pr` actions against 10 merges) was not a wrong remedy — it
 * was a correct remedy applied forever with nothing checking whether it moved
 * anything. `stallWatch` grades every attempt, and a remedy that has failed three
 * times becomes an escalation instead of a fourth attempt.
 *
 * COST. Steps 1–2 are three queries regardless of project size. Step 3 costs a handful
 * of reads per DIAGNOSED ticket, so it is bounded ({@link MAX_TRIAGE_PER_RUN}) and
 * ordered worst-first — the longest-stalled ticket in a project is always looked at,
 * and a project with more stalls than the cap works through them across passes rather
 * than spending a whole tick on one project.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { liveExecution } from '../rehearsal/executionMode';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import { executions, pullRequests, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';
import { TaskStatus, isTerminalTaskStatus } from '../../domain/shared/types';
import { evaluateTaskAutoRun } from '../swimlane/evaluateAutoRun';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { classifySignoffOwnership, resolveSignoffGate } from '../kanban/signoffGate';
import { driveOutstandingSignoffs } from '../kanban/driveSignoffs';
import { decideTicketReadiness } from './evaluateTicketReadiness';
import { coordinateTicket } from './coordinateTicket';
import { staffUnfilledRole } from './staffUnfilledRole';
import { assignTicketOwner } from './assignOwner';
import { reconcilePullRequestState } from '../repos/reconcilePullRequestState';
import {
  diagnoseStall, isActionExhausted, isManagerActionable, isStallResolved,
  stageSignoffFor, STALL_AFTER_MS, type StallInput,
} from './stallTriage';
import { loadOpenStalls, gradeStall, recordStall, resolveStalls, type OpenStall } from './stallWatch';

/**
 * How many stalled tickets one pass diagnoses in depth. Each costs several reads
 * (`evaluateTaskAutoRun` resolves lanes, staffing and live runs), and the manager
 * sweep runs this for up to 200 projects per tick, so the cap is what keeps a tick
 * bounded. Worst-first ordering means the cap delays coverage, never denies it.
 */
export const MAX_TRIAGE_PER_RUN = 12;

/**
 * How much of each batch is RESERVED for tickets that have never been deep-triaged.
 *
 * Without a reserve, coverage freezes. Open register rows outrank new discoveries, so
 * once the register holds more rows than the batch size, the same rows recirculate every
 * pass and no new ticket is ever diagnosed — however many passes run. Measured on project
 * 11: 678 stalled tickets, 50 in the register, "confirmed by deep triage: 50 of 678 (7%)"
 * unchanged pass after pass, because the batch of 12 was drawn entirely from those 50.
 *
 * A third is enough to keep discovery moving without starving accountability: the
 * register still gets two-thirds of every batch to grade and escalate what it already
 * knows about. The reserve is only an upper bound — when there are no new candidates the
 * whole batch goes to the register, so a healthy project loses nothing.
 */
export const TRIAGE_DISCOVERY_SHARE = 1 / 3;

/**
 * Select the bounded deep-triage batch while preserving accountability and fairness.
 *
 * Ordering within the already-registered set, most urgent first:
 *   0. EXHAUSTED — at or past the remedy ceiling but not yet escalated. These must be
 *      re-diagnosed FIRST, because escalation only happens inside the batch loop: a row
 *      that never gets picked can never be handed to a human. Sorting by fewest-attempts
 *      put them dead last, so the rows most in need of a human were the least likely to
 *      reach one. Measured on project 11: 3 rows sat at attempts=3 with `escalated: 0`.
 *      Escalating costs no dispatch, so promoting them is nearly free.
 *   1. WORKING — open rows with budget left, fewest attempts first so the billable
 *      dispatch cap rotates across remedies rather than re-spending on one ticket.
 *   2. ESCALATED — already handed over; observation only.
 *
 * New discoveries are interleaved separately (see {@link TRIAGE_DISCOVERY_SHARE}) rather
 * than ranked against registered rows, because they lose that comparison every time.
 */
export function selectTriageBatch<T extends { task: { id: number }; idleMs: number }>(
  candidates: T[],
  openStalls: ReadonlyMap<number, OpenStall>,
  limit = MAX_TRIAGE_PER_RUN,
): T[] {
  const cap = Math.max(0, limit);
  if (cap === 0) return [];
  const time = (d: Date | null | undefined) => d ? new Date(d).getTime() : 0;

  const registered: T[] = [];
  const discovered: T[] = [];
  const escalated: T[] = [];
  for (const c of candidates) {
    const openStall = openStalls.get(c.task.id);
    if (!openStall) discovered.push(c);
    else if (openStall.escalatedAt) escalated.push(c);
    else registered.push(c);
  }

  registered.sort((a, b) => {
    const ao = openStalls.get(a.task.id);
    const bo = openStalls.get(b.task.id);
    // Exhausted rows first — see the doc comment: escalation only happens inside the
    // batch loop, so a row that never gets picked can never reach a human.
    const exhausted = (o: OpenStall | undefined): number => (o && isActionExhausted(o.attempts) ? 0 : 1);
    const ar = exhausted(ao);
    const br = exhausted(bo);
    if (ar !== br) return ar - br;
    if (ar === 1) {
      if ((ao?.attempts ?? 0) !== (bo?.attempts ?? 0)) {
        return (ao?.attempts ?? 0) - (bo?.attempts ?? 0);
      }
      // A refused remedy is deliberately not counted as an attempt, but it WAS
      // examined this pass. Fall back to lastSeenAt so the same zero-attempt rows
      // cannot permanently monopolize the bounded batch.
      const actionAge = time(ao?.lastAttemptAt ?? ao?.lastSeenAt)
        - time(bo?.lastAttemptAt ?? bo?.lastSeenAt);
      if (actionAge !== 0) return actionAge;
    }
    return b.idleMs - a.idleMs;
  });
  discovered.sort((a, b) => b.idleMs - a.idleMs);
  escalated.sort((a, b) => b.idleMs - a.idleMs);

  // Fill in priority order — accountable open rows, then discovery's reserved share,
  // then already-escalated rows, which are observation-only and must yield to a ticket
  // nobody has looked at yet. Each stage takes only what the previous left, so the cap is
  // a budget and never a quota left unspent.
  const discoveryQuota = Math.min(discovered.length, Math.floor(cap * TRIAGE_DISCOVERY_SHARE));
  const fromRegistered = registered.slice(0, cap - discoveryQuota);
  const fromDiscovered = discovered.slice(0, cap - fromRegistered.length);
  const fromEscalated = escalated.slice(0, cap - fromRegistered.length - fromDiscovered.length);
  return [...fromRegistered, ...fromDiscovered, ...fromEscalated];
}

/**
 * How many BILLABLE runs one triage pass may start, whatever it diagnoses.
 *
 * This cap is not cosmetic. Measured live: project 11 alone holds 662 stalled
 * tickets, 459 of them never executed. Without a ceiling, a remedy that starts a run
 * would fire {@link MAX_TRIAGE_PER_RUN} times per project per five-minute tick —
 * thousands of paid runs a day, spent re-attempting work that is stuck for reasons a
 * fresh run does not fix. Diagnosis is cheap and should be thorough; STARTING work is
 * expensive and must be deliberate, so the two are capped separately.
 *
 * Every run started here is also counted into the pass summary's `dispatched`, which
 * is what the sweep reserves against the tenant's shared per-tick dispatch budget —
 * so triage cannot quietly spend budget the autonomous executor is also drawing on.
 */
export const MAX_TRIAGE_DISPATCHES_PER_RUN = 3;

/** Remedies whose whole effect is to START a run — the ones the dispatch cap governs. */
const DISPATCHING_REMEDIES = new Set(['dispatch', 'reset_breaker', 'drive_signoff', 'resolve_conflict']);

/**
 * Remedies that start work the AUTONOMOUS EXECUTOR would start anyway, and which the
 * manager therefore must not race on the cron path.
 *
 * This is a strictly smaller set than {@link DISPATCHING_REMEDIES}, and conflating the
 * two was the bug. `reset_breaker`, `drive_signoff` and `resolve_conflict` all start a
 * run, but each is a MANAGER-OWNED recovery the executor will never perform: the
 * executor does not clear a tripped breaker, does not ask a reviewer for a verdict, and
 * does not hand a conflicting branch back with a resolution brief. Suppressing them
 * because "the executor owns dispatch" meant that on the cron path — i.e. on every
 * scheduled pass — those three remedies silently returned `nothing`. And because an
 * un-run remedy correctly does not count as an attempt, the affected tickets never
 * advanced toward the escalation ceiling either. Measured on project 11: 8 of 13
 * register rows sat at attempts=0 for 24+ days, re-diagnosed every five minutes,
 * remedied never.
 */
const EXECUTOR_OWNED_REMEDIES = new Set(['dispatch']);

/** What this pass may do about one diagnosed remedy. PURE — see {@link decideRemedyExecution}. */
export interface RemedyExecution {
  /** Run the remedy now. */
  act: boolean;
  /** Counted as "waiting for the next pass" rather than acted on or ignored. */
  deferred: boolean;
  /** The remedy may start a manager-owned recovery run (billable-cap permitting). */
  mayStartRun: boolean;
  /** The remedy may additionally start ordinary work the executor also dispatches. */
  mayRaceExecutor: boolean;
}

/**
 * Decide whether this pass performs a remedy, defers it, or leaves it alone. PURE.
 *
 * TWO INDEPENDENT CEILINGS, applied to different things:
 *   • the billable-run cap ({@link MAX_TRIAGE_DISPATCHES_PER_RUN}) governs every remedy
 *     that starts a run, manager-owned or not;
 *   • dispatch OWNERSHIP governs only {@link EXECUTOR_OWNED_REMEDIES} — plain work the
 *     autonomous executor is the single dispatcher for.
 *
 * A remedy blocked by either is DEFERRED (counted, surfaced) rather than attempted and
 * silently no-op'd, so the pass summary can never claim it looked at a ticket it did
 * nothing about.
 */
export function decideRemedyExecution(input: {
  remedy: string;
  actionable: boolean;
  alreadyConducted: boolean;
  ownsDispatch: boolean;
  budgetLeft: boolean;
}): RemedyExecution {
  const idle: RemedyExecution = { act: false, deferred: false, mayStartRun: false, mayRaceExecutor: false };
  if (!input.actionable || input.alreadyConducted) return idle;
  if (!DISPATCHING_REMEDIES.has(input.remedy)) {
    // Costs no run — `coordinate`, `assign`, `return_to_implementation`, `reconcile_pr`.
    // These still take the optional "and start it" step only when nothing owns dispatch.
    return { act: true, deferred: false, mayStartRun: false, mayRaceExecutor: input.ownsDispatch && input.budgetLeft };
  }
  if (!input.budgetLeft) return { ...idle, deferred: true };
  if (EXECUTOR_OWNED_REMEDIES.has(input.remedy) && !input.ownsDispatch) return { ...idle, deferred: true };
  return { act: true, deferred: false, mayStartRun: true, mayRaceExecutor: input.ownsDispatch };
}

/**
 * What performing a remedy achieved.
 *
 * `attempted` and `applied` ARE DIFFERENT, and conflating them broke the escalation
 * ceiling for the largest stall cohort on the board. `applyRemedy` used to report only
 * whether the remedy MOVED the ticket, and that value drove the attempt counter — so a
 * `coordinate` that ran in full and changed nothing (the inevitable outcome when a stage
 * has no role-capable participant, all 447 of them) recorded no attempt at all. Never
 * accruing an attempt means never reaching `MAX_REMEDY_ATTEMPTS`, which means never
 * escalating: the ticket is re-diagnosed every five minutes, re-remedied every five
 * minutes, and handed to a human never.
 *
 * The ceiling exists to catch a remedy that RUNS AND DOES NOT WORK. That is exactly the
 * case the old flag could not express.
 */
export interface RemedyOutcome {
  /** The manager actually performed the remedy — whether or not it worked. */
  attempted: boolean;
  /** The remedy moved the ticket. Counted as "unstuck" in the pass summary. */
  applied: boolean;
  /** A billable run was started, drawing on the per-pass dispatch budget. */
  startedRun: boolean;
  note: string;
}

/** The ticket shape triage needs — structurally satisfied by the manager's own rows. */
export interface TriageTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  taskType: string | null;
  actionType: string | null;
  /** Read by the census to recognise a non-executable / unapproved-feedback ticket. */
  source?: string | null;
  gitBranch: string | null;
  githubPrUrl: string | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
}

export interface TriagePolicy {
  requireSignoffToComplete: boolean;
  prMergePolicy: string;
  allowAutoMerge: boolean;
  autoAssign: boolean;
  managerRef: string | null;
}

export interface TriageOutcome {
  /** Tickets diagnosed as stalled this pass. */
  stalled: number;
  /** Stalled tickets the manager applied its own remedy to. */
  unstuck: number;
  /** Stalled tickets escalated to a human. */
  escalated: number;
  /** Previously-stalled tickets that started moving again. */
  resolved: number;
  /** BILLABLE runs this stage started — folded into the pass's dispatch accounting. */
  dispatched: number;
  /** Stalled tickets whose remedy was deferred because a per-pass cap bit. */
  deferred: number;
  /** Journal lines for the manager feed — one per ticket ACTED ON, never per observation. */
  journal: Array<{ taskId: number; summary: string; detail: Record<string, unknown> }>;
}

export interface BulkSignals {
  lastMovedAt: Map<number, Date>;
  everRan: Set<number>;
  prByTask: Map<number, { id: string; number: number | null; repoId: string | null; status: string | null; buildStatus: string | null; updatedAt: Date }>;
  liveTaskIds: Set<number>;
}

/**
 * Three queries for the whole project — the signals every diagnosis needs, gathered
 * once. Doing this per ticket would be the N+1 the caching rules forbid, and at 200
 * projects a tick it would dominate the sweep.
 */
export async function loadBulkSignals(
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; taskIds: number[] },
): Promise<BulkSignals> {
  const empty: BulkSignals = { lastMovedAt: new Map(), everRan: new Set(), prByTask: new Map(), liveTaskIds: new Set() };
  if (args.taskIds.length === 0) return empty;

  // `liveExecution()` on the "has this ticket ever run?" probe: a rehearsal (0372)
  // must not count, or the manager treats a never-attempted ticket as already tried.
  const [moves, ran, prs, live] = await Promise.all([
    db.select({ taskId: taskStatusTransitions.taskId, at: sql<Date>`max(${taskStatusTransitions.occurredAt})` })
      .from(taskStatusTransitions)
      .where(inArray(taskStatusTransitions.taskId, args.taskIds))
      .groupBy(taskStatusTransitions.taskId)
      .catch(() => []),
    db.selectDistinct({ taskId: executions.taskId })
      .from(executions)
      .where(and(inArray(executions.taskId, args.taskIds), liveExecution()))
      .catch(() => []),
    db.select({
      taskId: pullRequests.taskId, id: pullRequests.id, number: pullRequests.number,
      repoId: pullRequests.repoId, status: pullRequests.status,
      buildStatus: pullRequests.buildStatus, updatedAt: pullRequests.updatedAt,
    })
      .from(pullRequests)
      .where(and(eq(pullRequests.tenantId, args.tenantId), inArray(pullRequests.taskId, args.taskIds)))
      .orderBy(desc(pullRequests.updatedAt))
      .catch(() => []),
    runtimeService.listActiveByTasks(args.taskIds).catch(() => []),
  ]);

  const lastMovedAt = new Map<number, Date>();
  for (const m of moves) if (m.taskId != null && m.at) lastMovedAt.set(m.taskId, new Date(m.at as unknown as string));

  const everRan = new Set<number>();
  for (const r of ran) if (r.taskId != null) everRan.add(r.taskId);

  // Newest PR per task wins (the query is already ordered), so a task that had an
  // earlier closed PR is judged on its CURRENT one.
  const prByTask = new Map<number, BulkSignals['prByTask'] extends Map<number, infer V> ? V : never>();
  for (const p of prs) {
    if (p.taskId == null || prByTask.has(p.taskId)) continue;
    prByTask.set(p.taskId, {
      id: p.id, number: p.number, repoId: p.repoId, status: p.status,
      buildStatus: p.buildStatus, updatedAt: p.updatedAt as Date,
    });
  }

  const liveTaskIds = new Set<number>((live as Array<{ taskId: unknown }>).map((e) => e.taskId as number));
  return { lastMovedAt, everRan, prByTask, liveTaskIds };
}

/** Normalize the free-form `pull_requests.build_status` to the readiness vocabulary. */
function normalizeBuildStatus(v: string | null | undefined): 'success' | 'failure' | 'pending' | null {
  return v === 'success' || v === 'failure' || v === 'pending' ? v : null;
}

/**
 * Diagnose and unstick. See the module header for the four steps.
 *
 * `conductedTaskIds` are tickets the PR/review stage ALREADY acted on this pass. They
 * are still diagnosed and recorded (the register must be complete, or "what is stuck"
 * silently omits everything in review), but their remedy is not re-applied — that
 * would double-dispatch the very agent the review stage just asked to sign off.
 */
export async function runStallTriage(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  ctx: {
    tenantId: number;
    projectId: number;
    managed: TriageTask[];
    policy: TriagePolicy;
    conductedTaskIds: ReadonlySet<number>;
    /**
     * Whether THIS pass owns dispatch. False on the cron path, where the always-on
     * autonomous executor is the single dispatcher for runnable work (the same rule
     * the manager's own DISPATCH stage follows). When false, triage still diagnoses,
     * staffs, coordinates, returns and escalates — it simply does not race the
     * executor to start a run that the executor will start anyway.
     */
    ownsDispatch: boolean;
    /**
     * Bulk signals the CENSUS stage already loaded this pass. Reused rather than
     * re-queried: both need the same last-move / ever-ran / live-run sets for the whole
     * project, and the census now runs EARLIER in the pass (ManagerService stage 3.5), so
     * loading them twice would double the cost on every project on every tick.
     */
    signals?: BulkSignals;
  },
): Promise<TriageOutcome> {
  const { tenantId, projectId, managed, policy } = ctx;
  const out: TriageOutcome = {
    stalled: 0, unstuck: 0, escalated: 0, resolved: 0, dispatched: 0, deferred: 0, journal: [],
  };
  if (managed.length === 0) return out;

  const now = Date.now();
  const taskIds = managed.map((t) => t.id);
  const [signals, openStalls] = await Promise.all([
    ctx.signals ?? loadBulkSignals(db, runtimeService, { tenantId, projectId, taskIds }),
    loadOpenStalls(db, projectId).catch(() => new Map()),
  ]);

  // 1. MEASURE. A ticket that has never transitioned is idle since it was CREATED —
  //    which is exactly the inert-from-birth population, and treating it as "no data"
  //    is how 466 tickets stayed invisible.
  const idleMsOf = (t: TriageTask): number => {
    const last = signals.lastMovedAt.get(t.id) ?? t.createdAt;
    return Math.max(0, now - new Date(last).getTime());
  };

  const candidates: Array<{ task: TriageTask; idleMs: number }> = [];
  const movedTaskIds: number[] = [];
  for (const t of managed) {
    const idleMs = idleMsOf(t);
    // A ticket whose idle clock RESET genuinely moved — that closes its row. A ticket
    // that is merely mid-run has NOT recovered: it is the same stuck ticket with a
    // remedy in flight, and closing its row here is what erased the attempt history
    // every time a remedy started a run. See `isStallResolved`.
    if (idleMs < STALL_AFTER_MS) {
      movedTaskIds.push(t.id);
      continue;
    }
    // Still stalled, but something is running on it — skip it this pass WITHOUT
    // resolving, so its register row (and its attempt count) survives.
    if (signals.liveTaskIds.has(t.id)) continue;
    candidates.push({ task: t, idleMs });
  }

  // 2. RESOLVE — anything that actually moved closes its register row. One batched write.
  const toResolve = movedTaskIds.filter((id) => openStalls.has(id));
  if (toResolve.length) {
    out.resolved = await resolveStalls(env, db, { tenantId, projectId, taskIds: toResolve });
  }

  // 2b. CLOSE THE ROWS OF TICKETS THAT LEFT THE BOARD.
  //
  // `managed` is the non-terminal set AND it is capped (`MAX_RANKED`), so "absent from
  // this pass's ticket list" does NOT mean finished — it may simply be beyond the cap.
  // The register row of a ticket that genuinely reached Done would otherwise never close,
  // because triage only ever looks at non-terminal tickets: the row would sit open
  // forever, inflating "what is stuck" with work that is finished.
  //
  // This matters more now that a live run no longer resolves a row. Previously a ticket
  // was (accidentally) resolved while its final run was in flight, which masked the leak
  // on the happy path; correctly keeping the row open until the ticket MOVES means
  // something has to close it when the move is all the way to Done.
  //
  // One bounded query — the register is capped at `MAX_REGISTER_ROWS` — and only for rows
  // this pass did not otherwise account for.
  const seenThisPass = new Set(taskIds);
  const unaccounted = [...openStalls.keys()].filter((id) => !seenThisPass.has(id));
  if (unaccounted.length) {
    const rows = await db
      .select({ id: tasks.id, status: tasks.status, archived: tasks.archived })
      .from(tasks)
      // `tasks` is scoped by project, not tenant (it carries no tenant_id) — and the
      // project filter is the meaningful one here anyway: these ids came from THIS
      // project's register, so a row naming any other project is stale by definition.
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, unaccounted)))
      .catch(() => [] as Array<{ id: number; status: string; archived: boolean }>);
    const alive = new Set(rows.map((r) => r.id));
    const departed = [
      ...rows.filter((r) => r.archived || isTerminalTaskStatus(r.status)).map((r) => r.id),
      // A row whose task no longer exists at all — deleted out from under the register.
      ...unaccounted.filter((id) => !alive.has(id)),
    ];
    if (departed.length) {
      out.resolved += await resolveStalls(env, db, { tenantId, projectId, taskIds: departed });
    }
  }

  const batch = selectTriageBatch(candidates, openStalls);
  // Hiring budget for the whole pass, shared across every ticket it looks at — a stage
  // gap is a per-BOARD defect, so one hire typically unblocks a large cohort at once and
  // a per-ticket budget would provision the same role many times over.
  let hiresUsed = 0;

  for (const { task, idleMs } of batch) {
    try {
      // 3. DIAGNOSE — ask the canonical evaluators, never re-derive their verdicts.
      // `env` serves the evaluator's workspace-token lookup through the read-through
      // cache — this loop runs per ticket, so an uncached tenant read here is an N+1.
      const autoRun = await evaluateTaskAutoRun(db, runtimeService, {
        tenantId, projectId, taskId: task.id, status: task.status, env,
      });

      const prRow = signals.prByTask.get(task.id) ?? null;
      // Only reconcile against the provider for a PR we believe is OPEN and whose
      // ticket is already stalled — that is precisely the population where our row
      // being wrong matters, and it keeps the provider round-trip off the hot path.
      let providerClosed = false;
      let conflicted = false;
      if (prRow?.status === 'open') {
        const state = await reconcilePullRequestState(env, db, tenantId, prRow);
        providerClosed = state.corrected && state.providerState !== 'open';
        conflicted = state.conflicted;
      }

      // The review question set applies only to a ticket in review. Off the review lane
      // the gate is still evaluated, SCOPED TO THE CURRENT STAGE, because the manager is
      // the documented retry owner for a stage whose role was asked once and never
      // answered — and it could not be that on any lane but this one.
      let readiness: StallInput['readiness'] = null;
      let signoff = null;
      if (task.status === TaskStatus.IN_REVIEW) {
        signoff = await resolveSignoffGate(env, db, { tenantId, taskId: task.id });
        readiness = decideTicketReadiness({
          taskType: task.taskType,
          actionType: task.actionType,
          hasBranch: !!task.gitBranch,
          hasPr: !!task.githubPrUrl,
          buildStatus: normalizeBuildStatus(prRow?.buildStatus),
          hasLiveRun: signals.liveTaskIds.has(task.id),
          signoff,
          requireSignoff: policy.requireSignoffToComplete,
          requireGreenBuild: policy.prMergePolicy === 'on_green',
        }).action;
      } else {
        signoff = await resolveSignoffGate(env, db, { tenantId, taskId: task.id, stageKey: task.status });
      }
      // Off the review lane the gate IS the stage's own owed roles, so it doubles as the
      // diagnosis input and as what `drive_signoff` asks — one resolution, no second read.
      const stageOwnership = signoff ? classifySignoffOwnership(signoff.outstanding) : null;

      const diagnosis = diagnoseStall({
        status: task.status,
        isTerminal: false, // `managed` is the non-terminal set by construction
        idleMs,
        everRan: signals.everRan.has(task.id),
        autoRunReason: autoRun.reason,
        hasLiveRun: signals.liveTaskIds.has(task.id) || autoRun.liveExecution != null,
        readiness,
        // Null (not false) when no gate was evaluated — "unknown" must never read as
        // "no agent can sign off", which escalates.
        signoffDispatchable: stageOwnership ? stageOwnership.dispatchable.length > 0 : null,
        // The non-review half of the same question: this stage's owed roles.
        stageSignoff: stageSignoffFor(task.status, signoff, stageOwnership, TaskStatus.IN_REVIEW),
        pr: prRow ? { open: prRow.status === 'open', providerClosed, conflicted } : null,
        mergeWithheld: !policy.allowAutoMerge && prRow?.status === 'open' && readiness === 'complete',
      });

      if (!diagnosis.stalled) {
        // Same rule as the bulk pass above: `live` and `cooling_down` are the states a
        // remedy CREATES, not evidence the ticket recovered. Closing the row on them
        // resets `attempts` to zero and makes the escalation ceiling unreachable.
        if (openStalls.has(task.id) && isStallResolved(diagnosis.cause)) {
          out.resolved += await resolveStalls(env, db, { tenantId, projectId, taskIds: [task.id] });
        }
        continue;
      }
      out.stalled += 1;

      // Grade the PREVIOUS attempt before choosing this one. An ineffective remedy
      // becomes an escalation here rather than a fourth identical retry.
      const { verdict, priorAttempts } = gradeStall(openStalls.get(task.id), task.status, diagnosis);

      // 4. ACT.
      const alreadyConducted = ctx.conductedTaskIds.has(task.id);
      let applied = false;
      let attempted = false;
      let outcomeNote = '';

      // Diagnosis and the register are never gated — a ticket the manager cannot act
      // on this pass is still recorded as stuck, which is the whole point.
      const plan = decideRemedyExecution({
        remedy: verdict.remedy,
        actionable: isManagerActionable(verdict.remedy),
        alreadyConducted,
        ownsDispatch: ctx.ownsDispatch,
        budgetLeft: out.dispatched < MAX_TRIAGE_DISPATCHES_PER_RUN,
      });
      if (plan.act) {
        const acted = await applyRemedy(env, db, runtimeService, {
          tenantId, projectId, task, policy, remedy: verdict.remedy, signoff, prRow,
          mayStartRun: plan.mayStartRun,
          // An `assign` that cannot also start the ticket still assigns: staffing is
          // exactly what unblocks the executor's next tick.
          mayRaceExecutor: plan.mayRaceExecutor,
          // The role the stage authorises but cannot fill — what `coordinate` must staff
          // before re-running a gate that will otherwise refuse for the same reason.
          unfilledRoleKey: autoRun.unfilledRoleKeys[0] ?? null,
          hiresUsed,
          onHire: () => { hiresUsed += 1; },
        });
        applied = acted.applied;
        attempted = acted.attempted;
        outcomeNote = acted.note;
        if (acted.startedRun) out.dispatched += 1;
      }
      if (plan.deferred) out.deferred += 1;

      // `attempted`, NOT `applied`, drives the counter: the ceiling exists to catch a
      // remedy that RUNS AND DOES NOT WORK, and grading it on whether it worked meant
      // exactly that remedy never accrued an attempt. See {@link RemedyOutcome}.
      await recordStall(env, db, {
        tenantId, projectId, taskId: task.id, status: task.status, idleMs,
        verdict, priorAttempts, attempted,
      });

      if (verdict.escalated) out.escalated += 1;
      if (applied) out.unstuck += 1;

      // Journal only a state CHANGE or an action — never a silent re-observation of a
      // ticket already in the register with the same verdict. Writing one row per
      // stalled ticket per five-minute pass is the write amplification the gap
      // register already flags on `auto_run_skipped`; the register itself carries the
      // standing state, and `last_seen_at` proves it is still being watched.
      const prior = openStalls.get(task.id);
      const changed = !prior || prior.cause !== verdict.cause || prior.remedy !== verdict.remedy;
      if (applied || (verdict.escalated && !prior?.escalatedAt) || changed) {
        out.journal.push({
          taskId: task.id,
          summary: applied
            ? `Unsticking "${task.title}" — ${verdict.detail}${outcomeNote}`
            : `"${task.title}" is stuck — ${verdict.detail}`,
          detail: {
            cause: verdict.cause,
            remedy: verdict.remedy,
            escalated: verdict.escalated,
            attempts: attempted ? priorAttempts + 1 : priorAttempts,
            idleDays: Math.floor(idleMs / 86_400_000),
            autoRunReason: autoRun.reason,
            readiness,
            applied,
          },
        });
      }
    } catch (error) { /* one bad ticket must never abort the triage */ 
      reportCaughtError(error, { source: "application/manager/triageStage.ts", operation: "runStallTriage" });
    }
  }

  return out;
}

/**
 * Perform the remedy. Every branch delegates to the SAME function the rest of the
 * platform uses for that action — triage decides WHAT to do and never reimplements
 * HOW, so a ticket unstuck by the manager follows the identical path as one driven by
 * a human clicking the equivalent button.
 *
 * Exported for `triageStage.remedy.test.ts`: which dispatcher each remedy calls, and
 * WITH WHAT — `reset_breaker` passing `force` is the whole difference between a breaker
 * that resets and one the dispatcher refuses — is behaviour a caller cannot observe from
 * `runStallTriage`'s aggregate counters.
 */
export async function applyRemedy(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: {
    tenantId: number;
    projectId: number;
    task: TriageTask;
    policy: TriagePolicy;
    remedy: string;
    signoff: Awaited<ReturnType<typeof resolveSignoffGate>> | null;
    prRow: { id: string; number: number | null } | null;
    /** May start a MANAGER-OWNED recovery run (billable budget remains). */
    mayStartRun: boolean;
    /** May additionally start ordinary work the autonomous executor also dispatches. */
    mayRaceExecutor: boolean;
    /**
     * The role this stage authorises but cannot fill, when the diagnosis found one.
     * Present only for `managed_no_role`, which is the sole cause staffing can fix.
     */
    unfilledRoleKey?: string | null;
    /** Hires already made this pass, so the budget spans the whole sweep. */
    hiresUsed?: number;
    maxHires?: number;
    /** Called when a hire is made, so the caller can debit the shared budget. */
    onHire?: () => void;
  },
): Promise<RemedyOutcome> {
  const { tenantId, projectId, task, policy } = args;
  const by = `manager:triage:${policy.managerRef ?? 'system'}`;
  /**
   * The remedy never ran — a cap, a quota or a policy refused it before it could act.
   *
   * A refusal by the cloud-run allowance, the token meter or the re-run cooldown is
   * INFRASTRUCTURE DEFERRING the remedy, not the remedy failing. Counting it would burn
   * the escalation ceiling on transient conditions and hand a human a ticket whose
   * reviewer was never actually asked.
   */
  const nothing: RemedyOutcome = { attempted: false, applied: false, startedRun: false, note: '' };
  /**
   * The remedy RAN, against the real state of the world, and changed nothing — no agent
   * is capable, no owner exists, the stage has no participant. That is a failed attempt
   * and it must count: re-running it next pass meets the identical world and fails
   * identically, which is exactly what the ceiling exists to stop.
   */
  const ineffective: RemedyOutcome = { attempted: true, applied: false, startedRun: false, note: '' };

  switch (args.remedy) {
    case 'assign': {
      if (!policy.autoAssign) return nothing;
      const pick = await assignTicketOwner(env, db, {
        projectId, taskId: task.id, actionType: task.actionType,
      });
      // Staffing RAN and found nobody. That is a failed attempt, not a skipped one —
      // re-running it next pass will find the same nobody.
      if (!pick.assigned) return ineffective;
      // Staffing alone IS a fix: an owned ticket is what the autonomous executor
      // needs to pick it up on its next tick. Starting it here as well is an
      // optimisation, taken only when this pass owns dispatch and has budget.
      const started = args.mayRaceExecutor
        ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: task.id, status: task.status, submittedBy: by,
        }).catch(() => false)
        : false;
      return { attempted: true, applied: true, startedRun: started, note: ` Assigned to ${pick.label}${started ? ' and started' : ''}.` };
    }

    case 'dispatch': {
      if (!args.mayStartRun) return nothing;
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId, projectId, taskId: task.id, status: task.status, submittedBy: by,
      }).catch(() => false);
      // Starting IS the remedy — a trigger that declined has not attempted it.
      return { attempted: started, applied: started, startedRun: started, note: started ? ' Started.' : '' };
    }

    case 'reset_breaker': {
      // The breaker halts AUTONOMY, not the ticket, so the remedy is ONE deliberate
      // fresh attempt — dispatched off the resolved candidate exactly as a human's
      // "Run now" does, since that is the same override for the same reason.
      //
      // This does NOT recreate the retry storm the breaker exists to stop: the
      // attempt is tracked like every other remedy, so at most MAX_REMEDY_ATTEMPTS
      // fresh runs are granted across as many passes before the ticket escalates to
      // a human. Bounded retries with an escalation ceiling is the whole difference
      // between recovery and a livelock.
      if (!args.mayStartRun) return nothing;
      const evaluation = await evaluateTaskAutoRun(db, runtimeService, {
        tenantId, projectId, taskId: task.id, status: task.status, env,
      });
      // A breaker reset with no candidate to run is a remedy that ran and could not
      // work — the ticket's real blocker is staffing, and only a counted attempt will
      // ever surface that to a human.
      if (!evaluation.candidate) return ineffective;
      if (evaluation.liveExecution) return nothing;
      const payload: { cloudAgentRef: string; model?: string; laneKey: string; actAsRole?: string } = {
        cloudAgentRef: evaluation.candidate.agentRef,
        laneKey: task.status,
      };
      if (evaluation.candidate.model) payload.model = evaluation.candidate.model;
      // Managed dispatch is fail-closed unless the payload states which lifecycle
      // role is being performed. Breaker recovery must preserve the evaluator's role
      // just like the ordinary lane trigger does.
      if (evaluation.managedRole) payload.actAsRole = evaluation.managedRole.roleKey;
      const deferred: Promise<unknown>[] = [];
      const executionId = await dispatchCloudRunForTask(
        env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); },
        {
          taskId: task.id, tenantId, payload: JSON.stringify(payload),
          submittedBy: `${by}:breaker-reset`,
          // THE OVERRIDE, without which this remedy is a no-op: `dispatchCloudRunForTask`
          // enforces the very breaker being reset, so an unforced call was refused every
          // time and returned null. `applied` then stayed false, the attempt counter never
          // advanced off zero, and the escalation ceiling that hands the ticket to a human
          // was therefore unreachable — measured: 11 tickets halted 25+ days at "0 of 3
          // tries", none escalated. Bounded exactly like the human Run-now it mirrors:
          // MAX_REMEDY_ATTEMPTS fresh runs across as many passes, then escalation.
          force: true,
        },
      ).catch(() => null);
      await Promise.allSettled(deferred);
      // A refusal here is a QUOTA refusal, not a failed recovery: `force: true` already
      // overrode the breaker and the cooldown, so a null id means the cloud-run allowance
      // or the token meter said no. That is deferral, so it is not an attempt.
      return {
        attempted: executionId != null,
        applied: executionId != null,
        startedRun: executionId != null,
        note: executionId != null ? ' Allowed one fresh attempt past the failure breaker.' : '',
      };
    }

    case 'coordinate': {
      // STAFF THE STAGE BEFORE RE-COORDINATING IT. `coordinate` re-runs the lane gate,
      // and on a `managed_no_role` ticket that gate refuses for one reason: the stage
      // authorises a role no agent can perform. Re-running it against the same empty
      // roster is the definition of the livelock — 447 tickets, every five minutes, for
      // weeks. Filling the role is the only thing that changes the answer, so the manager
      // fills it (pinning a capable teammate, or hiring one) and only then coordinates.
      let staffingNote = '';
      if (args.unfilledRoleKey) {
        const staffed = await staffUnfilledRole(env, db, {
          tenantId, projectId, roleKey: args.unfilledRoleKey,
          hiresUsed: args.hiresUsed ?? 0,
          ...(args.maxHires != null ? { maxHires: args.maxHires } : {}),
        });
        if (staffed.action !== 'escalate') staffingNote = ` ${staffed.detail}`;
        if (staffed.action === 'hired') args.onHire?.();
      }
      const outcome = await coordinateTicket(env, db, runtimeService, { tenantId, taskId: task.id });
      const moved = outcome.ok && (outcome.dispatched || outcome.status !== task.status);
      // ALWAYS attempted. Coordination on a stage with no role-capable participant runs
      // to completion and moves nothing, every pass, forever — the 447-ticket
      // `managed_no_role` cohort. Counting it is what eventually escalates it.
      // Staffing a role the stage could not fill IS progress even when this pass's
      // coordination does not move the ticket: the next dispatch can now be
      // role-attributed, which is the whole blocker.
      return {
        attempted: true,
        applied: moved || staffingNote !== '',
        startedRun: outcome.dispatched,
        note: `${staffingNote}${moved ? ` Coordinated${outcome.status !== task.status ? ` to ${outcome.status}` : ''}${outcome.dispatched ? ' and started' : ''}.` : ''}`,
      };
    }

    case 'return_to_implementation': {
      await db.update(tasks)
        .set({ status: TaskStatus.IN_PROGRESS, completedAt: null, updatedAt: new Date() })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)));
      const restarted = args.mayRaceExecutor
        ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: task.id, status: TaskStatus.IN_PROGRESS, submittedBy: by,
        }).catch(() => false)
        : false;
      return {
        attempted: true, applied: true, startedRun: restarted,
        note: restarted ? ' Returned to implementation and started.' : ' Returned to implementation.',
      };
    }

    case 'drive_signoff': {
      if (!args.signoff || !args.mayStartRun) return nothing;
      const drive = await driveOutstandingSignoffs(env, db, runtimeService, {
        tenantId, projectId, task, signoff: args.signoff, managerRef: policy.managerRef,
      });
      // Asking IS the remedy, so an ask that never went out is not an attempt — the
      // dispatcher's refusal (cap / cooldown / breaker) is transient and would escalate a
      // ticket nobody was ever asked about. The case this used to leave uncountable — a
      // reviewer that IS asked and never answers — is now counted at the right layer, on
      // the slot itself, by `attestRoleRun`.
      return {
        attempted: drive.asked.length > 0,
        applied: drive.asked.length > 0, startedRun: drive.asked.length > 0,
        note: drive.asked.length ? ` Asked ${drive.asked.join(', ')} to sign off.` : ` ${drive.blockedDetail}`.trimEnd(),
      };
    }

    case 'reconcile_pr':
      // The reconcile ALREADY ran during diagnosis (that is how the drift was detected
      // and corrected), so the remedy is complete by the time we get here.
      return { attempted: true, applied: true, startedRun: false, note: ' Corrected the recorded pull-request state.' };

    case 'resolve_conflict': {
      // Same recovery contract the merge loop uses for a conflicting PR: hand the
      // branch back to the ticket's own agent with an explicit resolution brief.
      if (!args.mayStartRun) return nothing;
      // No agent to hand the branch back to — the remedy is inapplicable and will stay
      // so until someone staffs the ticket. Counted, so it escalates rather than looping.
      if (!task.assignedAgentRef && task.assignedAgentHostId == null) return ineffective;
      const note = `\n\n[Manager recovery] PR #${args.prRow?.number ?? '?'} conflicts with the latest base branch. Sync the latest base, resolve every conflict while preserving both sets of intended changes, run the relevant checks, and update the existing PR.`;
      await db.update(tasks).set({
        status: TaskStatus.IN_PROGRESS,
        completedAt: null,
        description: task.description?.includes('[Manager recovery]')
          ? task.description
          : `${task.description ?? ''}${note}`.trim(),
        updatedAt: new Date(),
      }).where(eq(tasks.id, task.id));
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId, projectId, taskId: task.id, status: TaskStatus.IN_PROGRESS,
        submittedBy: `${by}:conflict-resolution`,
      }).catch(() => false);
      return { attempted: started, applied: started, startedRun: started, note: started ? ' Started its agent to resolve the conflict.' : '' };
    }

    default:
      return nothing;
  }
}
