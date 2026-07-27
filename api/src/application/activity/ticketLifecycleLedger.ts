/**
 * ticketLifecycleLedger — the AUDIT ANSWER to "did this ticket actually go through
 * its full lifecycle autonomously, or did a human push it every hop?"
 *
 * WHY THIS EXISTS
 * The platform already emits every fact needed to answer that question, but the
 * facts live in FOUR unjoined tables, so nobody could ever actually answer it:
 *
 *   1. `activity_log`            — `task.created` (+ role.assigned / ticket.signed_off),
 *                                  carrying the ACTOR TYPE that says whether a human,
 *                                  an agent (the AI Manager), or automation opened it.
 *   2. `task_status_transitions` — EVERY lane move (0117/0118), each stamped
 *                                  `actor_kind` = 'human' | 'system'. This column is
 *                                  the crux: a lane hop written by an agent/automation
 *                                  is 'system', a board drag by a person is 'human'.
 *   3. `executions`              — the runs themselves (dispatched / completed / failed).
 *   4. `tool_audit_events`       — the auto-run DECISIONS, keyed `session_key = 'task:<id>'`
 *                                  with the exact refusal reason in `args`
 *                                  (`auto_run_skipped` / `_error` / `_awaiting_approval`
 *                                  / `_dispatched`), i.e. WHY autonomy declined a hop.
 *
 * Joining them yields a chain of custody per ticket — created → dispatched → lane
 * moved → … → done — where every row names the table it came from, so the timeline
 * is evidence rather than narration. Crucially this is RETROACTIVE: it reads history
 * that already accumulated, so a tenant can audit tickets closed weeks ago without
 * having enabled anything.
 *
 * THE VERDICT
 * {@link classifyTicketAutonomy} is a pure function over those counts and answers the
 * question in terms that cannot be fudged:
 *   • `autonomousHops` — lane moves written by agents/automation ('system')
 *   • `humanHops`      — lane moves a person made
 *   • `fullyAutonomous`— reached a terminal lane with ZERO human hops
 *   • `stalled` + `stallReason` — sitting short of Done with no live run, and the gate
 *     (`no_agent`, `human_gate`, `run_cap_exhausted`, …) that is holding it
 *
 * A ticket whose every hop is 'human' is PROOF autonomy never drove it. A ticket that
 * reached Done on 'system' hops alone is PROOF that it did. That distinction is the
 * whole point of this module.
 *
 * Pure classifiers are exported separately from the IO so the verdict is unit-testable
 * without a database.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  activityLog, executions, taskStatusTransitions, tasks, toolAuditEvents,
} from '../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { ExecutionStatus } from '../../domain/shared/types';
import { liveExecution } from '../rehearsal/executionMode';
import { isDoneStatus } from '../../domain/shared/doneClass';
import {
  autoRunReasonEvaluationText, EVALUATED_AUTO_RUN_REASONS,
  type AutoRunEvaluation, type AutoRunReason, type TenantTokenVerdict,
} from '../swimlane/evaluateAutoRun';
import { normalizeErrorMessage } from '../quality/errorSpec';
import { activityLogVersionKey } from './activityLog';

// ── Wire vocabulary ─────────────────────────────────────────────────────────

/**
 * The `tool_name` values the auto-run trigger writes for its own decisions. These
 * are the ONLY record of why autonomy declined (or took) a hop, so the ledger reads
 * them verbatim rather than re-deriving a reason it cannot know retroactively.
 * Kept in sync with `laneEntryTrigger`.
 */
export const AUTORUN_DECISION_TOOLS = [
  'auto_run_dispatched',
  'auto_run_skipped',
  'auto_run_error',
  'auto_run_awaiting_approval',
] as const;

/**
 * RUN-scoped telemetry that explains why a ticket sat still — read per execution,
 * not per task, because these events are keyed to `exec:<id>`.
 *
 * Everything here was ALREADY being written and the ledger simply never looked:
 * the reaper's abandoned-question timeout, the self-heal re-queue, a backplane
 * crash, a run queued behind an allowance. So a ticket held for hours by one
 * non-terminal run produced a chain of custody that just stopped — the reader saw
 * `already_running` repeating against an execution list where every row had
 * finished, with nothing to say WHY the live one was not progressing (measured on
 * task 683: two windows, ~4h and ~23h, of `already_running` and nothing else).
 *
 * Deliberately NOT including `run.failed`: the failure is already carried by the
 * `executions` row itself, and duplicating it would double every failure in the
 * timeline. These are the states an execution row cannot express.
 */
export const RUN_LIFECYCLE_TOOLS = [
  'run.paused_timeout',
  'runtime.requeue',
  'runtime.crash',
  'runtime.queued',
] as const;

/** Where a ledger event was READ FROM — the chain of custody for an audit. */
export type LifecycleEventSource = 'activity_log' | 'task_status_transitions' | 'executions' | 'tool_audit_events';

export type LifecycleEventKind =
  | 'created'
  | 'lane_moved'
  | 'run_dispatched'
  | 'run_completed'
  | 'run_failed'
  | 'autorun_dispatched'
  | 'autorun_skipped'
  | 'autorun_error'
  | 'autorun_awaiting_approval'
  /** A non-terminal RUN state that held the ticket — paused-timeout, re-queue,
   *  backplane crash, queued. See {@link RUN_LIFECYCLE_TOOLS}. */
  | 'run_lifecycle'
  | 'role_event';

/** Who drove one event. 'system' is identity-less automation only — an agent that can
 *  be named reports as 'cloud_agent'/'host_agent', including on lane moves, which the
 *  transitions table now attributes ({@link resolveTransitionActor}). */
export type LifecycleActorKind = 'human' | 'hire' | 'cloud_agent' | 'host_agent' | 'system' | 'unknown';

/** One ordered, provenance-tagged fact in a ticket's lifecycle. */
export interface LifecycleEvent {
  at: string;
  kind: LifecycleEventKind;
  actorKind: LifecycleActorKind;
  actorName: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  /** Backward lane move (a redo/iteration) — from `task_status_transitions.is_backward`. */
  isBackward?: boolean | null;
  /** The auto-run gate that fired, for the `autorun_*` kinds. */
  reason?: AutoRunReason | null;
  executionId?: number | null;
  agentRef?: string | null;
  detail?: string | null;
  /**
   * `executions.submitted_by` — WHICH DISPATCHER started this run.
   *
   * The single most load-bearing field in a stall report, and the one the ledger
   * used to drop. Every dispatch path stamps its own value (`system:lane-auto`,
   * `system:auto-exec`, `system:coordinator`, `manager:signoff-request:…`,
   * `…:lane-approver:<role>`, `user:<id>`), so it is the difference between "the
   * lane trigger is retrying" and "some other subsystem is dispatching past the
   * lane trigger's circuit breaker". Without it, a reader looking at 134 identical
   * failures cannot tell WHO to go and stop.
   */
  dispatchedBy?: string | null;
  /**
   * How long a run WAITED between being created and actually starting, ms — set on
   * `run_dispatched` only, and only when the wait is non-trivial.
   *
   * A queued run is not an idle ticket: it holds the live-run idempotency guard, so
   * every autonomy tick against that ticket correctly refuses with `already_running`
   * and the ticket does not move. Measured on task 683 — two windows of 4h and 23h
   * where the only rows written were `already_running` skips, while the run holding
   * the ticket had been created and not yet started.
   *
   * That was unreadable before, because the timeline dated each run by
   * `startedAt ?? createdAt`: a run created at 04:40 and started 23 hours later
   * rendered as a 13-second run the following day, with its entire queue wait
   * silently removed from the ticket's history. Dating by `createdAt` and reporting
   * the wait explicitly turns "an inexplicable day of skips" into "this run sat in
   * the queue for a day".
   */
  queuedMs?: number | null;
  /** Which table this row came from — so the timeline reads as evidence. */
  source: LifecycleEventSource;
}

/**
 * How a ticket came into existence. The user's question ("tickets created by the
 * manager or human") is answered by this axis, so it is derived from the strongest
 * available signal — the `task.created` actor type — and only falls back to the
 * `tasks.source` column when no creation activity row exists.
 */
export type TicketOrigin =
  | 'human'        // a person opened it (UI / API as a user)
  | 'agent'        // an agent opened it — includes the AI Manager via MCP `tasks.create`
  | 'system'       // automation (QA finding router, validator gap, board sync)
  | 'manager_card' // a `source='manager'` grooming card — NEVER executable by design
  | 'unknown';     // no creation attribution recorded

/** The counts a verdict is computed from — the unit-test seam. */
export interface TicketAutonomySignals {
  origin: TicketOrigin;
  currentStatus: string;
  /** The ticket sits in a done-class / terminal lane. */
  isTerminal: boolean;
  autonomousHops: number;
  humanHops: number;
  backwardHops: number;
  runsDispatched: number;
  runsCompleted: number;
  runsFailed: number;
  /** A pending/submitted/running/paused execution exists right now. */
  hasLiveRun: boolean;
  /** The most recent auto-run refusal recorded for the ticket, if any. */
  lastSkipReason: AutoRunReason | null;
  /**
   * Live re-evaluation of the gate — AUTHORITATIVE whenever the key is present, and
   * carrying `will_run` when the gate finds nothing blocking.
   *
   * DELIBERATELY NOT NULLABLE. It used to be `AutoRunReason | null`, where `null`
   * meant "evaluated, nothing is blocking" and absent meant "not evaluated" — two
   * different facts that `??` cannot tell apart. {@link classifyTicketAutonomy} read
   * it with `liveReason ?? lastSkipReason`, so a clean live verdict fell straight
   * through to a stale recorded skip: task 173 reported `stallReason: human_gate`,
   * quoting a refusal recorded eleven days earlier, in the same payload as a live gate
   * block reading `laneGate: auto, canRunNow: true`. Making the type two-state removes
   * the ambiguity at its source rather than guarding against it at each read.
   */
  liveReason?: AutoRunReason;
}

export interface TicketAutonomyVerdict extends TicketAutonomySignals {
  /** Reached a terminal lane. */
  reachedTerminal: boolean;
  /** Reached terminal AND no human ever moved a lane — autonomy did the whole thing. */
  fullyAutonomous: boolean;
  /** Autonomy moved it at least one hop (whether or not it finished). */
  progressedAutonomously: boolean;
  /** Short of terminal with nothing running — i.e. it is sitting there. */
  stalled: boolean;
  /** The gate holding it, preferring the live evaluation over the last recorded skip. */
  stallReason: AutoRunReason | null;
  /** One plain sentence a non-engineer can act on. */
  stallText: string | null;
}

// "Finished" is the shared lane class (domain/shared/doneClass); a swimlane flagged
// `is_terminal` is resolved by the caller and passed via `isTerminal`.

/**
 * Both spellings a ticket activity row may carry. The HTTP writer always used the
 * singular `'task'`; the MCP/agent writer derived a PLURAL `'tasks'` from the tool id
 * until that drift was fixed (see `MCP_TARGET_TYPE` in builtinMcpService). Historical
 * agent-created rows are still stored as `'tasks'`, so the ledger accepts both —
 * otherwise this audit would under-report exactly the AI-Manager-created tickets it
 * exists to scrutinise.
 */
const TASK_TARGET_TYPES = ['task', 'tasks'] as const;

const LIVE_EXEC_STATUSES = new Set<string>([
  ExecutionStatus.PENDING,
  ExecutionStatus.SUBMITTED,
  ExecutionStatus.RUNNING,
  ExecutionStatus.PAUSED,
]);

/**
 * Reconcile the LIVE gate verdict against the last RECORDED refusal, for a ticket that
 * is definitely sitting. PURE.
 *
 * Neither source alone is trustworthy, in opposite ways:
 *
 *  • A RECORDED skip is history. The lane may since have been staffed, or re-gated from
 *    'human' to 'auto' — which is exactly how task 173 came to report `human_gate`,
 *    quoting a refusal from eleven days earlier, against a lane the same payload showed
 *    as `laneGate: auto, canRunNow: true`.
 *  • A LIVE `will_run` is current but PARTIAL. `evaluateTaskAutoRun` models the lane gate,
 *    staffing and backpressure; it does not model the lane REQUIREMENT gate or the tenant
 *    run allowance, both applied later. Treating its "nothing blocks" as the final word
 *    would erase a recorded `lane_requirement_gate` — the very reason the ticket is stuck.
 *
 * So: a live BLOCKING reason always wins (it is current and decisive). A live `will_run`
 * wins only over recorded reasons the live gate ACTUALLY MODELS
 * ({@link EVALUATED_AUTO_RUN_REASONS}); a recorded reason outside that set describes a
 * gate the evaluator never looked at, so `will_run` does not refute it and the recorded
 * reason stands.
 */
export function reconcileStallReason(s: TicketAutonomySignals): AutoRunReason | null {
  const recorded = s.lastSkipReason ?? null;
  // No live evaluation ran (the batch/fleet caller) — history is all there is.
  if (s.liveReason === undefined) return recorded;
  // The live gate names a blocker: current, decisive, and it supersedes any history.
  if (s.liveReason !== 'will_run') return s.liveReason;
  // Live gate is clear. Keep a recorded reason it is blind to; otherwise report the
  // clean verdict, which is itself the finding — the holder is downstream of the gate.
  return recorded && !EVALUATED_AUTO_RUN_REASONS.has(recorded) ? recorded : 'will_run';
}

/**
 * Turn the raw counts into the verdict. PURE — no DB, no clock — so every branch is
 * unit-testable and the meaning of "autonomous" is pinned in exactly one place.
 *
 * `fullyAutonomous` deliberately requires `humanHops === 0`: if a person dragged the
 * ticket even once, the lifecycle was not autonomous end-to-end, however many agent
 * runs also happened. That strictness is what makes a "yes" trustworthy.
 */
export function classifyTicketAutonomy(s: TicketAutonomySignals): TicketAutonomyVerdict {
  const reachedTerminal = s.isTerminal || isDoneStatus(s.currentStatus);
  const progressedAutonomously = s.autonomousHops > 0;
  const fullyAutonomous = reachedTerminal && s.humanHops === 0 && progressedAutonomously;
  // Stalled = not finished and nothing is running. A ticket with a live run is
  // "working", not stalled, no matter how long it has been going.
  const stalled = !reachedTerminal && !s.hasLiveRun;
  const stallReason = stalled ? reconcileStallReason(s) : null;
  return {
    ...s,
    reachedTerminal,
    fullyAutonomous,
    progressedAutonomously,
    stalled,
    stallReason,
    // Evaluation tense: a verdict never dispatches anything, so `will_run` must not
    // claim a run was started (see {@link autoRunReasonEvaluationText}).
    stallText: stallReason ? autoRunReasonEvaluationText(stallReason) : null,
  };
}

/**
 * Classify a ticket's origin from the two available signals. `tasks.source` wins for
 * a manager grooming card because that value is precisely what makes the row
 * non-executable (`evaluateTaskAutoRun` returns `not_executable` for it) — an audit
 * must not count those as "autonomy failed to run them".
 */
export function classifyTicketOrigin(
  createdActorType: string | null | undefined,
  taskSource: string | null | undefined,
): TicketOrigin {
  if (taskSource === 'manager') return 'manager_card';
  switch (createdActorType) {
    case 'human':
    case 'hire':        return 'human';
    case 'cloud_agent':
    case 'host_agent':  return 'agent';
    case 'system':      return 'system';
    default:            return 'unknown';
  }
}

/**
 * Map a stored actor-kind column onto the ledger's vocabulary.
 *
 * ONE mapper for both writers, because they now use the same words: `activity_log
 * .actor_type` and `task_status_transitions.actor_kind` are both the (kind, ref)
 * convention. An unrecognised value degrades to 'unknown' rather than being asserted
 * into the union.
 */
function normalizeActorKind(actorType: string | null): LifecycleActorKind {
  switch (actorType) {
    case 'human':       return 'human';
    case 'hire':        return 'hire';
    case 'cloud_agent': return 'cloud_agent';
    case 'host_agent':  return 'host_agent';
    case 'system':      return 'system';
    default:            return 'unknown';
  }
}

/** Parse the JSON `tool_audit_events.args` blob the auto-run trigger writes. */
function parseDecisionArgs(raw: string | null): { reason?: AutoRunReason; lane?: string; agentRef?: string } {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return {};
    const o = v as Record<string, unknown>;
    return {
      ...(typeof o.reason === 'string' ? { reason: o.reason as AutoRunReason } : {}),
      ...(typeof o.lane === 'string' ? { lane: o.lane } : {}),
      ...(typeof o.agentRef === 'string' ? { agentRef: o.agentRef } : {}),
    };
  } catch {
    return {};
  }
}

/** `tool_audit_events.tool_name` → ledger event kind. */
function decisionKind(toolName: string): LifecycleEventKind {
  switch (toolName) {
    case 'auto_run_dispatched':        return 'autorun_dispatched';
    case 'auto_run_error':             return 'autorun_error';
    case 'auto_run_awaiting_approval': return 'autorun_awaiting_approval';
    default:                           return 'autorun_skipped';
  }
}

// ── Analysis blocks: the answer, not the raw rows ───────────────────────────
//
// WHY THESE EXIST. The ledger's first version emitted only `events` + `verdict`,
// and a real stalled ticket produced 752 events of which 268 were byte-identical
// run failures. Pasted anywhere with a size limit, the tail — the most RECENT
// events, i.e. the current state — was the part that got cut. The reader was left
// re-deriving, by hand, three facts the server already had: what the failures
// actually were, who kept dispatching them, and what the gate says right now.
//
// So the ledger now ships those three as computed blocks. They are derived from
// rows it ALREADY reads (no extra query), and each is a pure function over those
// rows so the derivation is unit-tested rather than trusted.

/** A run of executions that all failed the SAME way — the retry-storm rollup. */
export interface LifecycleFailureGroup {
  /**
   * The grouping key: the error message with its volatile parts stripped by the
   * shared {@link normalizeErrorMessage} (the Quality pillar's own fingerprint
   * basis), so `(30/25 on the free plan)` and `(31/25 …)` are ONE cause, not two.
   */
  signature: string;
  /** One verbatim message, so collapsing never loses the exact text. */
  sample: string;
  runs: number;
  firstAt: string;
  lastAt: string;
  /** Newest-first, capped — enough to pull logs without listing 134 ids. */
  exampleExecutionIds: number[];
  /** Distinct `submitted_by` values that produced these failures. */
  dispatchers: string[];
  /**
   * Median gap between consecutive failures in this group, ms — null for a single
   * run. A tight, regular interval across many runs is the signature of an
   * automated retry loop rather than a handful of unlucky attempts, which is a
   * different bug with a different fix.
   */
  medianIntervalMs: number | null;
}

/** What one dispatcher did to this ticket. Names the subsystem to go and stop. */
export interface LifecycleDispatcher {
  /** `executions.submitted_by` verbatim. */
  submittedBy: string;
  runs: number;
  completed: number;
  failed: number;
  firstAt: string;
  lastAt: string;
}

/**
 * The LIVE gate evaluation, folded into the ledger so "why is it stuck right now"
 * arrives with its evidence attached instead of as a bare one-word reason.
 *
 * Every field is already computed by `evaluateTaskAutoRun` on the same request; the
 * route used to keep `reason` and discard the rest, which is precisely why a report
 * could say `human_gate` while giving the reader no way to see that the lane was
 * ALSO unstaffed, or that the breaker streak was 60 runs deep.
 */
export interface LifecycleGateSnapshot {
  canRunNow: boolean;
  reason: AutoRunReason;
  reasonText: string;
  /** The lane's `gate` column — 'human' means a person must approve or Run now. */
  laneGate: 'auto' | 'human' | null;
  laneResolved: boolean;
  isTerminalLane: boolean;
  /** `tasks.assigned_agent_ref` — the ticket's owner agent. */
  assignedAgentRef: string | null;
  /** Agents staffed on the lane (before capability/role filtering). */
  staffedAgentRefs: string[];
  /** Who a manual "Run now" would dispatch as — null when nothing can run it. */
  candidateAgentRef: string | null;
  liveExecution: { id: number; status: string } | null;
  capabilityMismatches: Array<{ agentRef: string; missing: string[] }>;
  /** Trailing consecutive failed runs, and the threshold that halts autonomy. */
  consecutiveFailures: number;
  failureBreakerAt: number;
  cooldownRemainingMs: number;
  /**
   * The WORKSPACE token verdict — the gate that pauses every ticket a tenant owns.
   *
   * Null means the evaluator never got to it (an earlier gate decided), not that the
   * workspace has budget. This is the block that leaves NO trace on the ticket: the
   * autonomous sweep skips a token-blocked tenant above the trigger, so the chain of
   * custody simply stops, and every other field here keeps saying the ticket is ready.
   */
  tenantTokens: TenantTokenVerdict | null;
  /**
   * LIFECYCLE-MANAGED board — the fact that changes what every field above MEANS.
   *
   * On a managed board a run must be attributed to a role the stage authorizes, so
   * `staffedAgentRefs` and `assignedAgentRef` do not answer "can this run": a lane can be
   * staffed and an owner assigned while no dispatch is possible at all. A gate snapshot
   * that omitted this printed "canRunNow: yes / nothing is gating this ticket" for a
   * ticket the dispatcher had been refusing every five minutes for weeks.
   */
  lifecycleManaged: boolean;
  /** Roles this stage authorizes for THIS ticket. Empty on a managed board = nothing can run. */
  authorizedRoleKeys: string[];
  /** The role-attributed run that WOULD go out: the role, its agent, and where it came from. */
  managedRole: { roleKey: string; agentRef: string; source: 'manifest' | 'lane_agent' } | null;
}

/** Cap on the execution ids listed per failure group — an id list is a pointer,
 *  not the evidence, so a few beat all 134. */
const MAX_GROUP_EXAMPLE_IDS = 5;

/**
 * Below this, the gap between a run being created and starting is ordinary dispatch
 * latency and reporting it would be noise. Above it, the run spent real time queued
 * while holding the ticket's live-run guard — which is a finding, because for that
 * whole window autonomy was correctly refusing to start anything else.
 */
export const QUEUE_WAIT_REPORTING_FLOOR_MS = 60_000;

/** One failed execution, as far as the rollup cares. */
export interface FailedRunRow {
  id: number;
  errorMessage: string | null;
  submittedBy: string | null;
  at: string;
}

/** Median of a numeric list (even lengths take the lower-middle mean). Pure. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : Math.round((((s[mid - 1] as number) + (s[mid] as number)) / 2));
}

/**
 * Group failed runs by CAUSE, newest cause first. PURE — unit-tested directly.
 *
 * The ordering is by run count (then recency) because the point of the block is to
 * put the dominant failure first: on a stalled ticket one cause is usually
 * responsible for nearly every run, and reading it should not require scanning.
 */
export function groupRunFailures(rows: readonly FailedRunRow[]): LifecycleFailureGroup[] {
  const byCause = new Map<string, { rows: FailedRunRow[] }>();
  for (const r of rows) {
    // A failure with no message still groups — as the distinct cause "no message
    // recorded", which is itself a finding (a run died without saying why).
    const signature = r.errorMessage ? normalizeErrorMessage(r.errorMessage) : '(no error message recorded)';
    const bucket = byCause.get(signature) ?? { rows: [] };
    bucket.rows.push(r);
    byCause.set(signature, bucket);
  }

  return [...byCause.entries()]
    .map(([signature, { rows: group }]) => {
      const ordered = [...group].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const times = ordered.map((r) => Date.parse(r.at)).filter((n) => Number.isFinite(n));
      const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
      const newestFirst = [...ordered].reverse();
      return {
        signature,
        sample: newestFirst.find((r) => !!r.errorMessage)?.errorMessage ?? signature,
        runs: ordered.length,
        firstAt: (ordered[0] as FailedRunRow).at,
        lastAt: (newestFirst[0] as FailedRunRow).at,
        exampleExecutionIds: newestFirst.slice(0, MAX_GROUP_EXAMPLE_IDS).map((r) => r.id),
        dispatchers: [...new Set(ordered.flatMap((r) => (r.submittedBy ? [r.submittedBy] : [])))],
        medianIntervalMs: median(gaps),
      };
    })
    .sort((a, b) => b.runs - a.runs || (a.lastAt < b.lastAt ? 1 : -1));
}

/** One execution, as far as dispatcher attribution cares. */
export interface DispatchedRunRow {
  status: string;
  submittedBy: string | null;
  at: string;
}

/**
 * Who dispatched this ticket's runs, busiest first. PURE.
 *
 * A ticket whose runs all carry ONE `submitted_by` that is not `system:lane-auto`
 * is being driven by a path that never consulted the lane trigger — so the lane
 * trigger's circuit breaker and cooldown never applied to it. That inference is
 * the whole reason the column is surfaced.
 */
export function summarizeDispatchers(rows: readonly DispatchedRunRow[]): LifecycleDispatcher[] {
  const by = new Map<string, LifecycleDispatcher>();
  for (const r of rows) {
    const submittedBy = r.submittedBy?.trim() || '(not recorded)';
    const cur = by.get(submittedBy) ?? {
      submittedBy, runs: 0, completed: 0, failed: 0, firstAt: r.at, lastAt: r.at,
    };
    cur.runs += 1;
    if (r.status === ExecutionStatus.COMPLETED) cur.completed += 1;
    if (r.status === ExecutionStatus.FAILED) cur.failed += 1;
    if (r.at < cur.firstAt) cur.firstAt = r.at;
    if (r.at > cur.lastAt) cur.lastAt = r.at;
    by.set(submittedBy, cur);
  }
  return [...by.values()].sort((a, b) => b.runs - a.runs || a.submittedBy.localeCompare(b.submittedBy));
}

/** Project a live {@link AutoRunEvaluation} onto the wire snapshot. PURE. */
export function toGateSnapshot(e: AutoRunEvaluation): LifecycleGateSnapshot {
  return {
    canRunNow: e.canRunNow,
    reason: e.reason,
    // This snapshot is a read-only evaluation — it dispatches nothing, so `will_run`
    // reads in the conditional tense rather than reporting a run that never happened.
    reasonText: autoRunReasonEvaluationText(e.reason),
    laneGate: e.laneGate,
    laneResolved: e.laneResolved,
    isTerminalLane: e.isTerminalLane,
    assignedAgentRef: e.assignedAgentRef,
    staffedAgentRefs: e.staffedAgentRefs,
    candidateAgentRef: e.candidate?.agentRef ?? null,
    liveExecution: e.liveExecution,
    capabilityMismatches: e.decision.capabilityMismatches ?? [],
    consecutiveFailures: e.consecutiveFailures,
    failureBreakerAt: e.failureBreakerAt,
    cooldownRemainingMs: e.cooldownRemainingMs,
    tenantTokens: e.tenantTokens,
    lifecycleManaged: e.lifecycleManaged,
    authorizedRoleKeys: e.managedRole?.authorizedRoleKeys ?? [],
    managedRole: e.managedRole
      ? { roleKey: e.managedRole.roleKey, agentRef: e.managedRole.agentRef, source: e.managedRole.source }
      : null,
  };
}

// ── Per-ticket ledger ───────────────────────────────────────────────────────

export interface TicketLifecycle {
  taskId: number;
  projectId: number;
  title: string;
  key: string;
  createdAt: string;
  events: LifecycleEvent[];
  verdict: TicketAutonomyVerdict;
  /** Failed runs collapsed by cause, dominant cause first. */
  failures: LifecycleFailureGroup[];
  /** Which subsystem dispatched the runs, busiest first. */
  dispatchers: LifecycleDispatcher[];
  /** The live gate evaluation, when the caller supplied one. */
  gate: LifecycleGateSnapshot | null;
}

/**
 * Build one ticket's full lifecycle ledger. Five bounded reads (no N+1), merged and
 * ordered by timestamp.
 *
 * `live` is a fresh `evaluateTaskAutoRun` result. It supplies BOTH the authoritative
 * stall reason (a recorded skip may be stale — the lane may have been staffed since)
 * and the {@link LifecycleGateSnapshot} that shows the reader the facts behind that
 * reason. The route supplies it; a batch caller may omit it.
 */
export async function buildTicketLifecycle(
  db: Db,
  args: { tenantId: number; taskId: number; live?: AutoRunEvaluation | null },
): Promise<TicketLifecycle | null> {
  // The live evaluation already resolved the lane and re-derived the gate, so it —
  // not a second query — decides terminality AND the stall reason.
  //
  // The gate's verdict is forwarded VERBATIM, including `will_run`. Suppressing it (the
  // previous `canRunNow ? null : reason`) looked like "no stall reason to report", but
  // the classifier's `??` then fell through to the last recorded skip — so a ticket the
  // gate had just cleared was reported as blocked by a gate that no longer applied.
  // "Nothing is gating it" is itself the finding, and it is the one that points a reader
  // downstream of the gate instead of at a phantom approval.
  const gate = args.live ? toGateSnapshot(args.live) : null;
  const liveReason = gate ? gate.reason : undefined;
  const [task] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      key: tasks.key,
      status: tasks.status,
      source: tasks.source,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(eq(tasks.id, args.taskId))
    .limit(1);
  if (!task) return null;

  const sessionKey = `task:${args.taskId}`;
  const [activityRows, transitionRows, execRows, decisionRows] = await Promise.all([
    db
      .select({
        id: activityLog.id,
        verb: activityLog.verb,
        actorType: activityLog.actorType,
        actorName: activityLog.actorName,
        summary: activityLog.summary,
        occurredAt: activityLog.occurredAt,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.tenantId, args.tenantId),
        inArray(activityLog.targetType, [...TASK_TARGET_TYPES]),
        eq(activityLog.targetId, String(args.taskId)),
      )),
    db
      .select({
        fromStatus: taskStatusTransitions.fromStatus,
        toStatus: taskStatusTransitions.toStatus,
        actorKind: taskStatusTransitions.actorKind,
        actorRef: taskStatusTransitions.actorRef,
        isBackward: taskStatusTransitions.isBackward,
        occurredAt: taskStatusTransitions.occurredAt,
      })
      .from(taskStatusTransitions)
      .where(eq(taskStatusTransitions.taskId, args.taskId)),
    db
      .select({
        id: executions.id,
        status: executions.status,
        cloudAgentRef: executions.cloudAgentRef,
        // WHICH dispatcher started the run. Already on the row; never read until now.
        submittedBy: executions.submittedBy,
        errorMessage: executions.errorMessage,
        createdAt: executions.createdAt,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
      })
      .from(executions)
      .where(and(eq(executions.taskId, args.taskId), liveExecution())),
    db
      .select({
        toolName: toolAuditEvents.toolName,
        args: toolAuditEvents.args,
        result: toolAuditEvents.result,
        cloudAgentRef: toolAuditEvents.cloudAgentRef,
        ts: toolAuditEvents.ts,
      })
      .from(toolAuditEvents)
      .where(and(
        eq(toolAuditEvents.tenantId, args.tenantId),
        eq(toolAuditEvents.sessionKey, sessionKey),
        inArray(toolAuditEvents.toolName, [...AUTORUN_DECISION_TOOLS]),
      )),
  ]);

  // Run-scoped telemetry ({@link RUN_LIFECYCLE_TOOLS}) — keyed to the ticket's OWN
  // executions, so it needs their ids and cannot join the batch above. One extra
  // round trip on a human-triggered audit read, served by the existing
  // `idx_tool_audit_execution (execution_id)` index and bounded by the ticket's run
  // count. Skipped entirely for a ticket that never ran.
  const execIds = execRows.map((r) => Number(r.id));
  const runLifecycleRows = execIds.length === 0 ? [] : await db
    .select({
      toolName: toolAuditEvents.toolName,
      result: toolAuditEvents.result,
      cloudAgentRef: toolAuditEvents.cloudAgentRef,
      executionId: toolAuditEvents.executionId,
      ts: toolAuditEvents.ts,
    })
    .from(toolAuditEvents)
    .where(and(
      eq(toolAuditEvents.tenantId, args.tenantId),
      inArray(toolAuditEvents.executionId, execIds),
      inArray(toolAuditEvents.toolName, [...RUN_LIFECYCLE_TOOLS]),
    ));

  const events: LifecycleEvent[] = [];

  // 1. Creation + role events (activity_log).
  let createdActorType: string | null = null;
  for (const r of activityRows) {
    const isCreate = r.verb === 'task.created';
    if (isCreate) createdActorType = r.actorType;
    events.push({
      at: (r.occurredAt as Date).toISOString(),
      kind: isCreate ? 'created' : 'role_event',
      actorKind: normalizeActorKind(r.actorType),
      actorName: r.actorName,
      detail: r.summary ?? r.verb,
      source: 'activity_log',
    });
  }

  // 2. Lane moves — the autonomy evidence (`actor_kind`).
  //
  // The kind is carried through verbatim rather than collapsed to human/system: a hop
  // now names the agent that made it, and "an agent advanced this" is a different fact
  // from "a cron did", which is the distinction a stall report is read for. The
  // human/autonomous split below is unchanged — every agent kind is still not-human.
  let autonomousHops = 0;
  let humanHops = 0;
  let backwardHops = 0;
  for (const r of transitionRows) {
    const human = r.actorKind === 'human';
    if (human) humanHops += 1; else autonomousHops += 1;
    if (r.isBackward === true) backwardHops += 1;
    events.push({
      at: (r.occurredAt as Date).toISOString(),
      kind: 'lane_moved',
      actorKind: normalizeActorKind(r.actorKind),
      actorName: r.actorRef ?? null,
      agentRef: human ? null : r.actorRef ?? null,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      isBackward: r.isBackward,
      source: 'task_status_transitions',
    });
  }

  // 3. Runs — plus the two rollups that make a retry storm readable at a glance.
  let runsCompleted = 0;
  let runsFailed = 0;
  let hasLiveRun = false;
  const failedRows: FailedRunRow[] = [];
  const dispatchedRows: DispatchedRunRow[] = [];
  for (const r of execRows) {
    if (r.status === ExecutionStatus.COMPLETED) runsCompleted += 1;
    if (r.status === ExecutionStatus.FAILED) runsFailed += 1;
    if (LIVE_EXEC_STATUSES.has(r.status)) hasLiveRun = true;
    // DISPATCH TIME IS `created_at`, never `started_at` — see `queuedMs` on
    // {@link LifecycleEvent} for the day of history the old fallback erased.
    const createdAt = r.createdAt as Date;
    const dispatchedAt = createdAt.toISOString();
    const queuedMs = r.startedAt ? Math.max(0, (r.startedAt as Date).getTime() - createdAt.getTime()) : null;
    dispatchedRows.push({ status: r.status, submittedBy: r.submittedBy, at: dispatchedAt });
    events.push({
      at: dispatchedAt,
      kind: 'run_dispatched',
      actorKind: 'system',
      actorName: r.cloudAgentRef,
      executionId: Number(r.id),
      agentRef: r.cloudAgentRef,
      dispatchedBy: r.submittedBy,
      detail: `Run #${r.id} (${r.status})`,
      ...(queuedMs != null && queuedMs >= QUEUE_WAIT_REPORTING_FLOOR_MS ? { queuedMs } : {}),
      source: 'executions',
    });
    if (r.completedAt && (r.status === ExecutionStatus.COMPLETED || r.status === ExecutionStatus.FAILED)) {
      const endedAt = (r.completedAt as Date).toISOString();
      if (r.status === ExecutionStatus.FAILED) {
        failedRows.push({ id: Number(r.id), errorMessage: r.errorMessage, submittedBy: r.submittedBy, at: endedAt });
      }
      events.push({
        at: endedAt,
        kind: r.status === ExecutionStatus.COMPLETED ? 'run_completed' : 'run_failed',
        actorKind: 'system',
        actorName: r.cloudAgentRef,
        executionId: Number(r.id),
        agentRef: r.cloudAgentRef,
        dispatchedBy: r.submittedBy,
        detail: r.status === ExecutionStatus.FAILED ? r.errorMessage : null,
        source: 'executions',
      });
    }
  }

  // 4. Auto-run decisions — WHY autonomy took or declined each hop.
  let lastSkipReason: AutoRunReason | null = null;
  let lastSkipAt = 0;
  for (const r of decisionRows) {
    const parsed = parseDecisionArgs(r.args);
    const kind = decisionKind(r.toolName);
    const ts = (r.ts as Date).getTime();
    if (kind !== 'autorun_dispatched' && parsed.reason && ts >= lastSkipAt) {
      lastSkipAt = ts;
      lastSkipReason = parsed.reason;
    }
    events.push({
      at: (r.ts as Date).toISOString(),
      kind,
      actorKind: 'system',
      actorName: r.cloudAgentRef ?? parsed.agentRef ?? null,
      toStatus: parsed.lane ?? null,
      reason: parsed.reason ?? null,
      agentRef: parsed.agentRef ?? r.cloudAgentRef ?? null,
      detail: r.result,
      source: 'tool_audit_events',
    });
  }

  // 5. Run-scoped lifecycle states — what a non-terminal run was DOING while the
  //    ticket sat still. The tool name leads the detail because it is the
  //    classification (`runtime.requeue` vs `run.paused_timeout` are different
  //    findings), and the message follows as the evidence.
  for (const r of runLifecycleRows) {
    events.push({
      at: (r.ts as Date).toISOString(),
      kind: 'run_lifecycle',
      actorKind: 'system',
      actorName: r.cloudAgentRef,
      executionId: r.executionId == null ? null : Number(r.executionId),
      agentRef: r.cloudAgentRef,
      detail: `${r.toolName}: ${r.result ?? '(no detail recorded)'}`,
      source: 'tool_audit_events',
    });
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const verdict = classifyTicketAutonomy({
    origin: classifyTicketOrigin(createdActorType, task.source),
    currentStatus: task.status,
    isTerminal: gate?.isTerminalLane === true || task.completedAt != null,
    autonomousHops,
    humanHops,
    backwardHops,
    runsDispatched: execRows.length,
    runsCompleted,
    runsFailed,
    hasLiveRun,
    lastSkipReason,
    ...(liveReason !== undefined ? { liveReason } : {}),
  });

  return {
    taskId: Number(task.id),
    projectId: Number(task.projectId),
    title: task.title,
    key: task.key,
    createdAt: (task.createdAt as Date).toISOString(),
    events,
    verdict,
    failures: groupRunFailures(failedRows),
    dispatchers: summarizeDispatchers(dispatchedRows),
    gate,
  };
}

// ── Fleet aggregate: the proof at scale ─────────────────────────────────────

/** One origin bucket's autonomy funnel. */
export interface AutonomyOriginStats {
  origin: TicketOrigin;
  tickets: number;
  /** Got at least one run dispatched. */
  everDispatched: number;
  /** Autonomy moved it at least one lane. */
  progressedAutonomously: number;
  /** Reached a terminal lane. */
  reachedTerminal: number;
  /** Reached terminal with ZERO human lane moves. */
  fullyAutonomous: number;
  /** Short of terminal with nothing running. */
  stalled: number;
  /** Never had a single run AND never moved autonomously — inert from birth. */
  neverStarted: number;
  autonomousHops: number;
  humanHops: number;
}

export interface AutonomySummary {
  windowDays: number;
  generatedAt: string;
  totals: AutonomyOriginStats;
  byOrigin: AutonomyOriginStats[];
  /** Stall gates ranked by how many tickets each is holding — where autonomy dies. */
  stallReasons: Array<{ reason: AutoRunReason | 'unrecorded'; text: string; tickets: number }>;
  /** True when the ticket set hit {@link MAX_AUDIT_TICKETS} and was truncated. */
  truncated: boolean;
  ticketsScanned: number;
}

/**
 * Hard ceiling on the audited ticket set. The aggregate is 5 set-based queries
 * regardless of size, but an unbounded `IN (...)` list is its own problem — so the
 * newest N tickets in the window are audited and `truncated` reports the cut rather
 * than silently implying full coverage.
 */
export const MAX_AUDIT_TICKETS = 2000;

function emptyStats(origin: TicketOrigin): AutonomyOriginStats {
  return {
    origin, tickets: 0, everDispatched: 0, progressedAutonomously: 0, reachedTerminal: 0,
    fullyAutonomous: 0, stalled: 0, neverStarted: 0, autonomousHops: 0, humanHops: 0,
  };
}

function foldStats(into: AutonomyOriginStats, v: TicketAutonomyVerdict): void {
  into.tickets += 1;
  if (v.runsDispatched > 0) into.everDispatched += 1;
  if (v.progressedAutonomously) into.progressedAutonomously += 1;
  if (v.reachedTerminal) into.reachedTerminal += 1;
  if (v.fullyAutonomous) into.fullyAutonomous += 1;
  if (v.stalled) into.stalled += 1;
  if (v.runsDispatched === 0 && v.autonomousHops === 0) into.neverStarted += 1;
  into.autonomousHops += v.autonomousHops;
  into.humanHops += v.humanHops;
}

/**
 * The fleet-wide answer: of the tickets opened in the window, how many actually ran
 * their lifecycle autonomously — broken down by WHO opened them (manager/agent vs
 * human) — and for those that did not, which gate is holding them.
 *
 * Five set-based queries total (tickets, creation attribution, transition counts,
 * execution counts, latest skip per ticket) — no per-ticket fan-out. `DISTINCT ON`
 * does the latest-per-ticket picks in the database rather than pulling every row.
 */
export async function summarizeAutonomy(
  db: Db,
  args: { tenantId: number; projectId?: number | null; windowDays?: number },
): Promise<AutonomySummary> {
  const windowDays = Math.min(365, Math.max(1, args.windowDays ?? 30));
  const since = new Date(Date.now() - windowDays * 86_400_000);

  // Tickets opened in the window, tenant-scoped through their project.
  const ticketRows = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      source: tasks.source,
      completedAt: tasks.completedAt,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(and(
      sql`${tasks.projectId} IN (SELECT id FROM projects WHERE tenant_id = ${args.tenantId})`,
      sql`${tasks.createdAt} >= ${since.toISOString()}`,
      ...(args.projectId != null ? [eq(tasks.projectId, args.projectId)] : []),
    ))
    .orderBy(sql`${tasks.id} DESC`)
    .limit(MAX_AUDIT_TICKETS + 1);

  const truncated = ticketRows.length > MAX_AUDIT_TICKETS;
  const scoped = truncated ? ticketRows.slice(0, MAX_AUDIT_TICKETS) : ticketRows;
  const ids = scoped.map((t) => Number(t.id));

  const empty: AutonomySummary = {
    windowDays,
    generatedAt: new Date().toISOString(),
    totals: emptyStats('unknown'),
    byOrigin: [],
    stallReasons: [],
    truncated: false,
    ticketsScanned: 0,
  };
  if (ids.length === 0) return empty;

  // Every id came from `Number(row.id)` on a serial PK, so these are plain integers.
  // The guard makes that an invariant rather than an assumption, because the ids are
  // interpolated into the one raw `DISTINCT ON` below (which cannot be expressed in
  // the query builder) — an unexpected value must never reach SQL text.
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 0)) return empty;
  const sessionKeyList = ids.map((id) => `'task:${id}'`).join(',');

  const [createdRows, transitionRows, execRows, skipRows] = await Promise.all([
    // `task.created` per ticket → the creating actor type. At most one row per ticket,
    // so this stays in the query builder; the earliest wins if a backfill duplicated it.
    db
      .select({
        targetId: activityLog.targetId,
        actorType: activityLog.actorType,
        id: activityLog.id,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.tenantId, args.tenantId),
        inArray(activityLog.targetType, [...TASK_TARGET_TYPES]),
        eq(activityLog.verb, 'task.created'),
        inArray(activityLog.targetId, ids.map(String)),
      )),
    db
      .select({
        taskId: taskStatusTransitions.taskId,
        actorKind: taskStatusTransitions.actorKind,
        isBackward: taskStatusTransitions.isBackward,
        n: sql<number>`count(*)::int`,
      })
      .from(taskStatusTransitions)
      .where(inArray(taskStatusTransitions.taskId, ids))
      .groupBy(taskStatusTransitions.taskId, taskStatusTransitions.actorKind, taskStatusTransitions.isBackward),
    db
      .select({
        taskId: executions.taskId,
        status: executions.status,
        n: sql<number>`count(*)::int`,
      })
      .from(executions)
      .where(and(inArray(executions.taskId, ids), liveExecution()))
      .groupBy(executions.taskId, executions.status),
    // Latest auto-run refusal per ticket → the gate holding it.
    db.execute(sql`
      SELECT DISTINCT ON (session_key) session_key, tool_name, args
      FROM tool_audit_events
      WHERE tenant_id = ${args.tenantId}
        AND tool_name IN ('auto_run_skipped', 'auto_run_error', 'auto_run_awaiting_approval')
        AND session_key IN ${sql.raw(`(${sessionKeyList})`)}
      ORDER BY session_key, ts DESC
    `),
  ]);

  // Earliest creation row wins (a backfill could have written more than one).
  const createdBy = new Map<number, string>();
  for (const r of [...createdRows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = Number(r.targetId);
    if (!createdBy.has(id)) createdBy.set(id, r.actorType);
  }

  const hops = new Map<number, { auto: number; human: number; backward: number }>();
  for (const r of transitionRows) {
    const id = Number(r.taskId);
    const cur = hops.get(id) ?? { auto: 0, human: 0, backward: 0 };
    const n = Number(r.n);
    if (r.actorKind === 'human') cur.human += n; else cur.auto += n;
    if (r.isBackward === true) cur.backward += n;
    hops.set(id, cur);
  }

  const runs = new Map<number, { total: number; completed: number; failed: number; live: boolean }>();
  for (const r of execRows) {
    const id = Number(r.taskId);
    const cur = runs.get(id) ?? { total: 0, completed: 0, failed: 0, live: false };
    const n = Number(r.n);
    cur.total += n;
    if (r.status === ExecutionStatus.COMPLETED) cur.completed += n;
    if (r.status === ExecutionStatus.FAILED) cur.failed += n;
    if (LIVE_EXEC_STATUSES.has(r.status)) cur.live = true;
    runs.set(id, cur);
  }

  const skips = new Map<number, AutoRunReason>();
  for (const r of (skipRows.rows as unknown as Array<{ session_key: string; tool_name: string; args: string | null }>)) {
    const id = Number(r.session_key.replace('task:', ''));
    const parsed = parseDecisionArgs(r.args);
    const reason = parsed.reason ?? (r.tool_name === 'auto_run_awaiting_approval' ? 'pending_approval' : null);
    if (reason) skips.set(id, reason);
  }

  const totals = emptyStats('unknown');
  const buckets = new Map<TicketOrigin, AutonomyOriginStats>();
  const stallTally = new Map<AutoRunReason | 'unrecorded', number>();

  for (const t of scoped) {
    const id = Number(t.id);
    const h = hops.get(id) ?? { auto: 0, human: 0, backward: 0 };
    const r = runs.get(id) ?? { total: 0, completed: 0, failed: 0, live: false };
    const origin = classifyTicketOrigin(createdBy.get(id), t.source);
    const verdict = classifyTicketAutonomy({
      origin,
      currentStatus: t.status,
      isTerminal: t.completedAt != null,
      autonomousHops: h.auto,
      humanHops: h.human,
      backwardHops: h.backward,
      runsDispatched: r.total,
      runsCompleted: r.completed,
      runsFailed: r.failed,
      hasLiveRun: r.live,
      lastSkipReason: skips.get(id) ?? null,
    });

    foldStats(totals, verdict);
    const bucket = buckets.get(origin) ?? emptyStats(origin);
    foldStats(bucket, verdict);
    buckets.set(origin, bucket);

    if (verdict.stalled) {
      const key = verdict.stallReason ?? 'unrecorded';
      stallTally.set(key, (stallTally.get(key) ?? 0) + 1);
    }
  }

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    totals,
    byOrigin: [...buckets.values()].sort((a, b) => b.tickets - a.tickets),
    stallReasons: [...stallTally.entries()]
      .map(([reason, tickets]) => ({
        reason,
        text: reason === 'unrecorded'
          ? 'No auto-run decision was ever recorded for this ticket — autonomy never evaluated it.'
          // A funnel is an assessment, never a dispatch record — same tense rule as the
          // per-ticket verdict, so the two surfaces cannot describe one gate differently.
          : autoRunReasonEvaluationText(reason),
        tickets,
      }))
      .sort((a, b) => b.tickets - a.tickets),
    truncated,
    ticketsScanned: scoped.length,
  };
}

/**
 * Cached read of {@link summarizeAutonomy}. Version-token keyed off the activity-log
 * version (which every `recordActivity` write bumps) so a newly created/moved ticket
 * invalidates the audit rather than serving a stale funnel for the whole TTL.
 */
export async function getAutonomySummary(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId?: number | null; windowDays?: number },
): Promise<AutonomySummary> {
  const version = await getCacheVersion(env, activityLogVersionKey(args.tenantId));
  const key = `autonomy-summary:tenant:${args.tenantId}:v:${version}:${args.projectId ?? 'all'}:${args.windowDays ?? 30}`;
  return getOrSetCached(env, key, () => summarizeAutonomy(db, args), { kvTtlSeconds: 120 });
}
