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
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import { executions, pullRequests, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { evaluateTaskAutoRun } from '../swimlane/evaluateAutoRun';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { resolveSignoffGate } from '../kanban/signoffGate';
import { driveOutstandingSignoffs } from '../kanban/driveSignoffs';
import { decideTicketReadiness } from './evaluateTicketReadiness';
import { coordinateTicket } from './coordinateTicket';
import { assignTicketOwner } from './assignOwner';
import { reconcilePullRequestState } from '../repos/reconcilePullRequestState';
import { diagnoseStall, isManagerActionable, STALL_AFTER_MS, type StallInput } from './stallTriage';
import { loadOpenStalls, gradeStall, recordStall, resolveStalls } from './stallWatch';

/**
 * How many stalled tickets one pass diagnoses in depth. Each costs several reads
 * (`evaluateTaskAutoRun` resolves lanes, staffing and live runs), and the manager
 * sweep runs this for up to 200 projects per tick, so the cap is what keeps a tick
 * bounded. Worst-first ordering means the cap delays coverage, never denies it.
 */
export const MAX_TRIAGE_PER_RUN = 12;

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

/** The ticket shape triage needs — structurally satisfied by the manager's own rows. */
export interface TriageTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  taskType: string | null;
  actionType: string | null;
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

interface BulkSignals {
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
async function loadBulkSignals(
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; taskIds: number[] },
): Promise<BulkSignals> {
  const empty: BulkSignals = { lastMovedAt: new Map(), everRan: new Set(), prByTask: new Map(), liveTaskIds: new Set() };
  if (args.taskIds.length === 0) return empty;

  const [moves, ran, prs, live] = await Promise.all([
    db.select({ taskId: taskStatusTransitions.taskId, at: sql<Date>`max(${taskStatusTransitions.occurredAt})` })
      .from(taskStatusTransitions)
      .where(inArray(taskStatusTransitions.taskId, args.taskIds))
      .groupBy(taskStatusTransitions.taskId)
      .catch(() => []),
    db.selectDistinct({ taskId: executions.taskId })
      .from(executions)
      .where(inArray(executions.taskId, args.taskIds))
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
  },
): Promise<TriageOutcome> {
  const { tenantId, projectId, managed, policy } = ctx;
  const out: TriageOutcome = { stalled: 0, unstuck: 0, escalated: 0, resolved: 0, dispatched: 0, deferred: 0, journal: [] };
  if (managed.length === 0) return out;

  const now = Date.now();
  const taskIds = managed.map((t) => t.id);
  const [signals, openStalls] = await Promise.all([
    loadBulkSignals(db, runtimeService, { tenantId, projectId, taskIds }),
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
  const movingTaskIds: number[] = [];
  for (const t of managed) {
    const idleMs = idleMsOf(t);
    if (idleMs < STALL_AFTER_MS || signals.liveTaskIds.has(t.id)) {
      movingTaskIds.push(t.id);
      continue;
    }
    candidates.push({ task: t, idleMs });
  }

  // 2. RESOLVE — anything moving again closes its register row. One batched write.
  const toResolve = movingTaskIds.filter((id) => openStalls.has(id));
  if (toResolve.length) {
    out.resolved = await resolveStalls(env, db, { tenantId, projectId, taskIds: toResolve });
  }

  // Worst-first: the longest-stalled ticket is always diagnosed, whatever the cap.
  candidates.sort((a, b) => b.idleMs - a.idleMs);
  const batch = candidates.slice(0, MAX_TRIAGE_PER_RUN);

  for (const { task, idleMs } of batch) {
    try {
      // 3. DIAGNOSE — ask the canonical evaluators, never re-derive their verdicts.
      const autoRun = await evaluateTaskAutoRun(db, runtimeService, {
        tenantId, projectId, taskId: task.id, status: task.status,
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

      // The review question set applies only to a ticket in review.
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
      }

      const diagnosis = diagnoseStall({
        status: task.status,
        isTerminal: false, // `managed` is the non-terminal set by construction
        idleMs,
        everRan: signals.everRan.has(task.id),
        autoRunReason: autoRun.reason,
        hasLiveRun: signals.liveTaskIds.has(task.id) || autoRun.liveExecution != null,
        readiness,
        pr: prRow ? { open: prRow.status === 'open', providerClosed, conflicted } : null,
        mergeWithheld: !policy.allowAutoMerge && prRow?.status === 'open' && readiness === 'complete',
      });

      if (!diagnosis.stalled) {
        if (openStalls.has(task.id)) {
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
      let outcomeNote = '';
      let deferred = false;

      if (isManagerActionable(verdict.remedy) && !alreadyConducted) {
        // Two independent ceilings guard a remedy that STARTS work: this pass's own
        // billable-run cap, and (on the cron path) the rule that the autonomous
        // executor is the single dispatcher. Diagnosis and the register are never
        // gated by either — a ticket the manager cannot act on this pass is still
        // recorded as stuck, which is the whole point.
        const startsRun = DISPATCHING_REMEDIES.has(verdict.remedy);
        const budgetLeft = out.dispatched < MAX_TRIAGE_DISPATCHES_PER_RUN;
        if (startsRun && (!budgetLeft || (!ctx.ownsDispatch && verdict.remedy === 'dispatch'))) {
          deferred = true;
        } else {
          const acted = await applyRemedy(env, db, runtimeService, {
            tenantId, projectId, task, policy, remedy: verdict.remedy, signoff, prRow,
            // An `assign` that cannot also start the ticket still assigns: staffing is
            // exactly what unblocks the executor's next tick.
            mayStartRun: ctx.ownsDispatch && budgetLeft,
          });
          applied = acted.applied;
          outcomeNote = acted.note;
          if (acted.startedRun) out.dispatched += 1;
        }
      }
      if (deferred) out.deferred += 1;

      await recordStall(env, db, {
        tenantId, projectId, taskId: task.id, status: task.status, idleMs,
        verdict, priorAttempts, applied,
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
            attempts: applied ? priorAttempts + 1 : priorAttempts,
            idleDays: Math.floor(idleMs / 86_400_000),
            autoRunReason: autoRun.reason,
            readiness,
            applied,
          },
        });
      }
    } catch { /* one bad ticket must never abort the triage */ }
  }

  return out;
}

/**
 * Perform the remedy. Every branch delegates to the SAME function the rest of the
 * platform uses for that action — triage decides WHAT to do and never reimplements
 * HOW, so a ticket unstuck by the manager follows the identical path as one driven by
 * a human clicking the equivalent button.
 */
async function applyRemedy(
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
    /** False when this pass has no billable-run budget left, or does not own dispatch. */
    mayStartRun: boolean;
  },
): Promise<{ applied: boolean; startedRun: boolean; note: string }> {
  const { tenantId, projectId, task, policy } = args;
  const by = `manager:triage:${policy.managerRef ?? 'system'}`;
  const nothing = { applied: false, startedRun: false, note: '' };

  switch (args.remedy) {
    case 'assign': {
      if (!policy.autoAssign) return nothing;
      const pick = await assignTicketOwner(env, db, {
        projectId, taskId: task.id, actionType: task.actionType,
      });
      if (!pick.assigned) return nothing;
      // Staffing alone IS a fix: an owned ticket is what the autonomous executor
      // needs to pick it up on its next tick. Starting it here as well is an
      // optimisation, taken only when this pass owns dispatch and has budget.
      const started = args.mayStartRun
        ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: task.id, status: task.status, submittedBy: by,
        }).catch(() => false)
        : false;
      return { applied: true, startedRun: started, note: ` Assigned to ${pick.label}${started ? ' and started' : ''}.` };
    }

    case 'dispatch': {
      if (!args.mayStartRun) return nothing;
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId, projectId, taskId: task.id, status: task.status, submittedBy: by,
      }).catch(() => false);
      return { applied: started, startedRun: started, note: started ? ' Started.' : '' };
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
        tenantId, projectId, taskId: task.id, status: task.status,
      });
      if (!evaluation.candidate || evaluation.liveExecution) return nothing;
      const payload: { cloudAgentRef: string; model?: string; laneKey: string } = {
        cloudAgentRef: evaluation.candidate.agentRef,
        laneKey: task.status,
      };
      if (evaluation.candidate.model) payload.model = evaluation.candidate.model;
      const deferred: Promise<unknown>[] = [];
      const executionId = await dispatchCloudRunForTask(
        env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); },
        {
          taskId: task.id, tenantId, payload: JSON.stringify(payload),
          submittedBy: `${by}:breaker-reset`,
        },
      ).catch(() => null);
      await Promise.allSettled(deferred);
      return {
        applied: executionId != null,
        startedRun: executionId != null,
        note: executionId != null ? ' Allowed one fresh attempt past the failure breaker.' : '',
      };
    }

    case 'coordinate': {
      const outcome = await coordinateTicket(env, db, runtimeService, { tenantId, taskId: task.id });
      const moved = outcome.ok && (outcome.dispatched || outcome.status !== task.status);
      return {
        applied: moved,
        startedRun: outcome.dispatched,
        note: moved ? ` Coordinated${outcome.status !== task.status ? ` to ${outcome.status}` : ''}${outcome.dispatched ? ' and started' : ''}.` : '',
      };
    }

    case 'return_to_implementation': {
      await db.update(tasks)
        .set({ status: TaskStatus.IN_PROGRESS, completedAt: null, updatedAt: new Date() })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)));
      const restarted = args.mayStartRun
        ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: task.id, status: TaskStatus.IN_PROGRESS, submittedBy: by,
        }).catch(() => false)
        : false;
      return {
        applied: true, startedRun: restarted,
        note: restarted ? ' Returned to implementation and started.' : ' Returned to implementation.',
      };
    }

    case 'drive_signoff': {
      if (!args.signoff || !args.mayStartRun) return nothing;
      const asked = await driveOutstandingSignoffs(env, db, runtimeService, {
        tenantId, projectId, task, signoff: args.signoff, managerRef: policy.managerRef,
      });
      return {
        applied: asked.length > 0, startedRun: asked.length > 0,
        note: asked.length ? ` Asked ${asked.join(', ')} to sign off.` : '',
      };
    }

    case 'reconcile_pr':
      // The reconcile ALREADY ran during diagnosis (that is how the drift was detected
      // and corrected), so the remedy is complete by the time we get here.
      return { applied: true, startedRun: false, note: ' Corrected the recorded pull-request state.' };

    case 'resolve_conflict': {
      // Same recovery contract the merge loop uses for a conflicting PR: hand the
      // branch back to the ticket's own agent with an explicit resolution brief.
      if (!args.mayStartRun) return nothing;
      if (!task.assignedAgentRef && task.assignedAgentHostId == null) return nothing;
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
      return { applied: started, startedRun: started, note: started ? ' Started its agent to resolve the conflict.' : '' };
    }

    default:
      return nothing;
  }
}
