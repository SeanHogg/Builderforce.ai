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
import { ExecutionStatus, TaskStatus } from '../../domain/shared/types';
import { AUTO_RUN_REASON_TEXT, type AutoRunReason } from '../swimlane/evaluateAutoRun';
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
  | 'role_event';

/** Who drove one event. 'system' covers agents + automation (the `actor_kind` the
 *  transitions table records for every non-human lane write). */
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
  /** Live re-evaluation of the gate (authoritative when supplied by the caller). */
  liveReason?: AutoRunReason | null;
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

/** Lane keys that mean "finished". Mirrors taskLifecycle.DONE_CLASS; a swimlane
 *  flagged `is_terminal` is resolved by the caller and passed via `isTerminal`. */
const DONE_CLASS = new Set<string>([TaskStatus.DONE]);

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
 * Turn the raw counts into the verdict. PURE — no DB, no clock — so every branch is
 * unit-testable and the meaning of "autonomous" is pinned in exactly one place.
 *
 * `fullyAutonomous` deliberately requires `humanHops === 0`: if a person dragged the
 * ticket even once, the lifecycle was not autonomous end-to-end, however many agent
 * runs also happened. That strictness is what makes a "yes" trustworthy.
 */
export function classifyTicketAutonomy(s: TicketAutonomySignals): TicketAutonomyVerdict {
  const reachedTerminal = s.isTerminal || DONE_CLASS.has(s.currentStatus);
  const progressedAutonomously = s.autonomousHops > 0;
  const fullyAutonomous = reachedTerminal && s.humanHops === 0 && progressedAutonomously;
  // Stalled = not finished and nothing is running. A ticket with a live run is
  // "working", not stalled, no matter how long it has been going.
  const stalled = !reachedTerminal && !s.hasLiveRun;
  // The live evaluation wins when present: a recorded skip may be stale (the lane was
  // staffed since), whereas the live gate is what autonomy would decide right now.
  const stallReason = stalled ? (s.liveReason ?? s.lastSkipReason ?? null) : null;
  return {
    ...s,
    reachedTerminal,
    fullyAutonomous,
    progressedAutonomously,
    stalled,
    stallReason,
    stallText: stallReason ? AUTO_RUN_REASON_TEXT[stallReason] ?? null : null,
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

/** Map an `activity_log.actor_type` onto the ledger's actor vocabulary. */
function actorKindFromActivity(actorType: string | null): LifecycleActorKind {
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

// ── Per-ticket ledger ───────────────────────────────────────────────────────

export interface TicketLifecycle {
  taskId: number;
  projectId: number;
  title: string;
  key: string;
  createdAt: string;
  events: LifecycleEvent[];
  verdict: TicketAutonomyVerdict;
}

/**
 * Build one ticket's full lifecycle ledger. Five bounded reads (no N+1), merged and
 * ordered by timestamp.
 *
 * `liveReason` lets the caller inject a fresh {@link evaluateTaskAutoRun} verdict so
 * the "why is it stuck RIGHT NOW" answer reflects current configuration rather than a
 * possibly-stale recorded skip. The route supplies it; a batch caller may omit it.
 */
export async function buildTicketLifecycle(
  db: Db,
  args: { tenantId: number; taskId: number; isTerminalLane?: boolean; liveReason?: AutoRunReason | null },
): Promise<TicketLifecycle | null> {
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
        errorMessage: executions.errorMessage,
        createdAt: executions.createdAt,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
      })
      .from(executions)
      .where(eq(executions.taskId, args.taskId)),
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

  const events: LifecycleEvent[] = [];

  // 1. Creation + role events (activity_log).
  let createdActorType: string | null = null;
  for (const r of activityRows) {
    const isCreate = r.verb === 'task.created';
    if (isCreate) createdActorType = r.actorType;
    events.push({
      at: (r.occurredAt as Date).toISOString(),
      kind: isCreate ? 'created' : 'role_event',
      actorKind: actorKindFromActivity(r.actorType),
      actorName: r.actorName,
      detail: r.summary ?? r.verb,
      source: 'activity_log',
    });
  }

  // 2. Lane moves — the autonomy evidence (`actor_kind`).
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
      actorKind: human ? 'human' : 'system',
      actorName: r.actorRef ?? null,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      isBackward: r.isBackward,
      source: 'task_status_transitions',
    });
  }

  // 3. Runs.
  let runsCompleted = 0;
  let runsFailed = 0;
  let hasLiveRun = false;
  for (const r of execRows) {
    if (r.status === ExecutionStatus.COMPLETED) runsCompleted += 1;
    if (r.status === ExecutionStatus.FAILED) runsFailed += 1;
    if (LIVE_EXEC_STATUSES.has(r.status)) hasLiveRun = true;
    events.push({
      at: ((r.startedAt ?? r.createdAt) as Date).toISOString(),
      kind: 'run_dispatched',
      actorKind: 'system',
      actorName: r.cloudAgentRef,
      executionId: Number(r.id),
      agentRef: r.cloudAgentRef,
      detail: `Run #${r.id} (${r.status})`,
      source: 'executions',
    });
    if (r.completedAt && (r.status === ExecutionStatus.COMPLETED || r.status === ExecutionStatus.FAILED)) {
      events.push({
        at: (r.completedAt as Date).toISOString(),
        kind: r.status === ExecutionStatus.COMPLETED ? 'run_completed' : 'run_failed',
        actorKind: 'system',
        actorName: r.cloudAgentRef,
        executionId: Number(r.id),
        agentRef: r.cloudAgentRef,
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

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const verdict = classifyTicketAutonomy({
    origin: classifyTicketOrigin(createdActorType, task.source),
    currentStatus: task.status,
    isTerminal: args.isTerminalLane === true || task.completedAt != null,
    autonomousHops,
    humanHops,
    backwardHops,
    runsDispatched: execRows.length,
    runsCompleted,
    runsFailed,
    hasLiveRun,
    lastSkipReason,
    ...(args.liveReason !== undefined ? { liveReason: args.liveReason } : {}),
  });

  return {
    taskId: Number(task.id),
    projectId: Number(task.projectId),
    title: task.title,
    key: task.key,
    createdAt: (task.createdAt as Date).toISOString(),
    events,
    verdict,
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
      .where(inArray(executions.taskId, ids))
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
          : AUTO_RUN_REASON_TEXT[reason],
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
