/**
 * laneEntryTrigger — the ONE funnel every writer that lands a ticket in a lane
 * goes through.
 *
 * Two exports, one behind the other:
 *
 *  • {@link maybeAutoRunOnLaneEntry} — the board "autonomous trigger" itself (moved
 *    here from `presentation/routes/taskRoutes`, which now re-exports it so every
 *    existing import path keeps working). It lives in the APPLICATION layer because
 *    non-HTTP writers (the board-sync inbound reconcile, the QA finding router, the
 *    cron sweeps, the MCP tools) must be able to reach it without importing a route
 *    module.
 *
 *  • {@link onTaskLandedInLane} — the writer-facing funnel. A writer that creates or
 *    moves a ticket often knows only `taskId` (board-sync knows the project but not
 *    the resolved lane; a finding router knows neither), so this resolves the missing
 *    `projectId` / `status` from the row in ONE query and then fires the trigger.
 *    It never throws and never needs the caller to build a RuntimeService.
 *
 * Before this funnel existed, four writers landed tasks in lanes with a raw insert /
 * `createTask` and never fired the trigger — a Jira/Linear ticket synced into a
 * staffed auto-gated lane, a QA finding's fix ticket, an architecture-analysis
 * ticket and a quality "fix with agent" ticket were all rescued only by the ≤5-minute
 * cron sweep (autonomousExecutionSweep), if at all. Every one of those call sites now
 * routes through here instead of re-implementing the trigger call ad hoc.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks, projects } from '../../infrastructure/database/schema';
import { RuntimeService } from '../runtime/RuntimeService';
import { buildRuntimeService } from '../../buildRuntimeService';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { recordCloudToolEvent } from '../runtime/cloudAgentEngine';
import { evaluateExecutionApprovalGate } from '../runtime/executionApprovalGate';
import { evaluateTaskAutoRun } from './evaluateAutoRun';
import { enforceLaneRequirements } from './laneRequirementGate';
import { TicketAuditService } from '../audit/ticketAuditService';
import { signalPendingWork } from '../runtime/cronWorkSignal';

/**
 * Board "autonomous trigger" — the SERVER-SIDE source of truth. When a ticket
 * enters a lane (created into it, or its status PATCHed into it by ANY client —
 * board drag, the status dropdown, the brain, a raw API call) and that lane has
 * a configured agent with a non-human gate, auto-start the run AS that agent.
 * This used to live only in the board frontend, so brain-created / API / non-
 * board status changes silently skipped the run (the reported bug).
 *
 * There is ONE agent engine (the V2 Agent) behind ONE surface-aware dispatcher
 * ({@link dispatchCloudRunForTask}): the agent's backplane — Durable Object,
 * Container, or an on-prem machine (a long-lived runtime, equivalent to a
 * container) — is resolved inside the dispatcher, not here. So this trigger just
 * hands the lane's agent ref + model to that single dispatcher, the same one the
 * manual run and CI auto-fix use.
 *
 * Best-effort: a dispatch failure must never block or fail the status change — but
 * it is no longer SILENT. An actual throw (a DB blip, a dispatcher error) emits an
 * `auto_run_error` tool-audit event before returning false, so it is distinguishable
 * from an ordinary "lane not staffed" skip. That blindness is exactly what hid the
 * original dropped-dispatch bug described below.
 *
 * The caller keeps THIS promise alive (the board-drag path wraps the whole call in
 * one `c.executionCtx.waitUntil(...)` registered while the request is still being
 * handled; the execution-completion path awaits it). Crucially, the executor
 * kickoff is AWAITED inside here rather than re-scheduled on the request's
 * `executionCtx`: this handler runs AFTER the Worker response has already returned,
 * and registering a fresh `executionCtx.waitUntil()` from a closed request context
 * throws ("I/O on behalf of a different request") — which this function's
 * `try/catch` would silently swallow, leaving the execution row created but never
 * dispatched. That was the reported "drag into a staffed lane never fires the
 * agent" bug: the run was submitted but its `orchestrate()` kickoff was dropped.
 *
 * Exported (and re-exported from taskRoutes) so the execution-completion path
 * (RuntimeService.onLaneEntry, wired at the composition root) reuses this exact
 * trigger when an AGENT advances a ticket into the next lane — without it,
 * agent-moved tickets wrote `tasks.status` directly and never started the next
 * lane's configured agent.
 */
export async function maybeAutoRunOnLaneEntry(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; taskId: number; status: string; submittedBy: string; originLaneKey?: string },
): Promise<boolean> {
  try {
    // ONE read-only evaluation answers "should this run, as which agent, and if
    // not why" — shared verbatim with the triage diagnostic + Run-now endpoints so
    // the trigger and the UI can never disagree. It already applies the terminal/
    // board/lane/gate resolution, the owner-fallback, the capability guardrail, the
    // same-lane loop guard, the per-ticket re-run cooldown and the live-run
    // idempotency check.
    const evaln = await evaluateTaskAutoRun(db, runtimeService, {
      tenantId:     args.tenantId,
      projectId:    args.projectId,
      taskId:       args.taskId,
      status:       args.status,
      originLaneKey: args.originLaneKey,
    });

    // Pillar 2 — lane requirement gating: entering a lane recomputes the ticket's
    // role/diagnostic audit and, when a required reviewer (e.g. the Architect) has
    // not signed off, flags the ticket and dispatches that reviewer for a round-trip
    // back to the Developer. When a reviewer run is owed this hop (or a 'hard' gate
    // is unmet), the lane's NORMAL agent is suppressed until the review clears.
    const gate = await enforceLaneRequirements(env, db, runtimeService, new TicketAuditService(db), {
      tenantId:    args.tenantId,
      projectId:   args.projectId,
      taskId:      args.taskId,
      status:      args.status,
      submittedBy: args.submittedBy,
    });
    if (gate.blocked) return false;

    // A lane whose every candidate agent lacks its required capabilities is a
    // configuration error, not a silent no-op. Emit a `capability_mismatch` warning
    // so a mis-staffed lane is diagnosable (the triage diagnostic surfaces the same).
    if (evaln.decision.capabilityMismatches?.length) {
      for (const m of evaln.decision.capabilityMismatches) {
        console.warn(
          `[capability_mismatch] task ${args.taskId} lane '${args.status}': agent '${m.agentRef}' lacks required capabilities [${m.missing.join(', ')}] — skipped for auto-run`,
        );
        // Surface the skip as a first-class Observability event, not just a server
        // log: a mis-staffed lane whose candidate agent lacks its required
        // capabilities is a diagnosable configuration error that the Triage control
        // otherwise only shows on-demand. Task-scoped (no execution was created — the
        // run was skipped) + keyed to the agent ref so it lands in that agent's
        // tool-audit timeline alongside its runs. Best-effort (recordCloudToolEvent
        // swallows its own errors) so telemetry never blocks the trigger.
        await recordCloudToolEvent(db, {
          tenantId:      args.tenantId,
          cloudAgentRef: m.agentRef,
          executionId:   null,
          sessionKey:    `task:${args.taskId}`,
          toolName:      'auto_run_skipped',
          category:      'planning',
          detail:        { taskId: args.taskId, lane: args.status, reason: 'capability_mismatch', agentRef: m.agentRef, missing: m.missing },
          result:        `Auto-run skipped: agent '${m.agentRef}' lacks required capabilities [${m.missing.join(', ')}] for lane '${args.status}'.`.slice(0, 300),
        });
      }
    }
    // For every OTHER non-run reason (no_agent, human_gate, terminal_lane, no_lane,
    // no_board, already_running, cooldown_active, not_executable) the trigger
    // previously returned false with no surfaced event, leaving a stuck ticket
    // undiagnosable from the agent timeline. Emit one best-effort Observability event
    // for any skip reason NOT already covered by the capability_mismatch loop above.
    if (!evaln.canRunNow && evaln.reason !== 'capability_mismatch') {
      const skipAgentRef =
        evaln.decision.agentRef ??
        evaln.staffedAgentRefs[0] ??
        evaln.assignedAgentRef ??
        args.submittedBy;
      await recordCloudToolEvent(db, {
        tenantId:      args.tenantId,
        cloudAgentRef: skipAgentRef,
        executionId:   null,
        sessionKey:    `task:${args.taskId}`,
        toolName:      'auto_run_skipped',
        category:      'planning',
        detail:        { taskId: args.taskId, lane: args.status, reason: evaln.reason, ...(evaln.cooldownRemainingMs ? { cooldownRemainingMs: evaln.cooldownRemainingMs } : {}) },
        result:        `Auto-run skipped (${evaln.reason}) for task ${args.taskId} on lane '${args.status}'.`.slice(0, 300),
      }).catch(() => { /* best-effort telemetry — never block the trigger */ });
    }
    if (!evaln.canRunNow) return false;

    // This ticket SHOULD run. Signal the KV work-gate so the next frequent cron
    // tick runs the backstop fan-out (dispatch within 5 min) even if the live
    // kickoff below is dropped by an evicted isolate — the exact stranded-run
    // case autonomousExecutionSweep exists to rescue. Best-effort KV put; the
    // 30-min floor sweep backstops a lost signal. See cronWorkSignal.ts.
    await signalPendingWork(env);

    // Hand the lane's agent + model to the single surface-aware dispatcher (the
    // `cloudAgentRef` payload key is the existing dispatch contract — the V2 agent
    // ref the dispatcher resolves + attributes the run to). `laneKey` records which
    // lane this run serves so a completion that re-enters the SAME lane (a loop) is
    // suppressed by the same-lane guard above on the next hop.
    const payloadObj: { cloudAgentRef?: string; model?: string; laneKey?: string } = { laneKey: args.status };
    if (evaln.decision.agentRef) payloadObj.cloudAgentRef = evaln.decision.agentRef;
    if (evaln.decision.model) payloadObj.model = evaln.decision.model;

    // Collect the dispatcher's deferred executor kickoff (`orchestrate()`) and AWAIT
    // it here instead of letting it re-register on the (already-closed) request
    // `executionCtx`. We are off the response path, so awaiting the kickoff costs
    // nothing the user waits on — but it guarantees the run is actually started
    // rather than created-then-dropped. See this function's header for the why.
    const payload = Object.keys(payloadObj).length > 0 ? JSON.stringify(payloadObj) : undefined;

    // GOVERNANCE APPROVAL GATE — the autonomous path used to bypass this entirely.
    // The gate was route-private in `runtimeRoutes`, so only HTTP submits were held
    // for manager sign-off: a high/urgent ticket dragged into a staffed lane (or
    // swept up by cron) started a billable run with no approval at all, which is the
    // exact control the /api/approvals queue exists to enforce. It is idempotent —
    // an outstanding pending row is reused rather than stacked on every sweep tick —
    // and it persists `payload` so a manager's later approval replays THIS run, not
    // a differently-shaped one. Hence gating AFTER `payloadObj` is built.
    const [gateTask] = await db.select({
      id:                   tasks.id,
      title:                tasks.title,
      priority:             tasks.priority,
      projectId:            tasks.projectId,
      assignedAgentHostId:  tasks.assignedAgentHostId,
    }).from(tasks).where(eq(tasks.id, args.taskId)).limit(1);

    if (gateTask) {
      const gate = await evaluateExecutionApprovalGate(
        db, args.tenantId, args.submittedBy, gateTask, null, { payload },
      );
      if (!gate.allowed) {
        // Not a failure: the approval row is created and the manager notified. Same
        // `false` every other "didn't run" path returns — but it gets its own event
        // so the board can distinguish "awaiting sign-off" from "lane not staffed".
        await recordCloudToolEvent(db, {
          tenantId:      args.tenantId,
          cloudAgentRef: evaln.decision.agentRef ?? args.submittedBy,
          executionId:   null,
          sessionKey:    `task:${args.taskId}`,
          toolName:      'auto_run_awaiting_approval',
          category:      'planning',
          detail:        { taskId: args.taskId, lane: args.status, approvalId: gate.approvalId, reason: gate.reason },
          result:        `Auto-run held for approval (${gate.reason}) on task ${args.taskId}, lane '${args.status}'.`.slice(0, 300),
        }).catch(() => { /* best-effort telemetry — never block the trigger */ });
        return false;
      }
    }

    const deferred: Promise<unknown>[] = [];
    await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
      taskId: args.taskId,
      tenantId: args.tenantId,
      payload,
      submittedBy: args.submittedBy,
    });
    await Promise.allSettled(deferred);
    return true;
  } catch (err) {
    // Best-effort: the status change already succeeded; an autonomous-run failure
    // must not surface as a failed PATCH/create — so we still return false.
    //
    // But a THROW is not a decision. Every non-run REASON above is instrumented via
    // `auto_run_skipped`; without this event an exception (DB blip, dispatcher throw,
    // "I/O on behalf of a different request") is indistinguishable from "lane not
    // staffed" and leaves no trace at all. That blindness is precisely what hid the
    // original dropped-dispatch bug, so the error gets its own distinct event.
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? null : null;
    console.error(`[auto_run_error] task ${args.taskId} lane '${args.status}':`, err);
    await recordCloudToolEvent(db, {
      tenantId:      args.tenantId,
      cloudAgentRef: args.submittedBy,
      executionId:   null,
      sessionKey:    `task:${args.taskId}`,
      toolName:      'auto_run_error',
      category:      'error',
      detail:        { taskId: args.taskId, lane: args.status, error: message, stack },
      result:        `Auto-run failed with an error for task ${args.taskId} on lane '${args.status}': ${message}`.slice(0, 300),
    }).catch(() => { /* telemetry is best-effort — never rethrow out of the trigger */ });
    return false;
  }
}

/** What a writer knows when it lands a ticket in a lane. `projectId` / `status` are
 *  optional: whatever is missing is resolved from the task row in one query. */
export interface LaneEntrySignal {
  tenantId: number;
  taskId: number;
  /** The ticket's project, when the writer already has it (skips a lookup). */
  projectId?: number | null;
  /** The lane the ticket now sits in, when the writer already has it. */
  status?: string | null;
  /** Attribution for the dispatched run (e.g. 'system:board-sync'). */
  submittedBy: string;
  /** The lane the ticket came FROM, for the same-lane re-entry loop guard. */
  originLaneKey?: string;
  /** Reuse the caller's RuntimeService instead of building one. */
  runtimeService?: RuntimeService;
}

/**
 * THE funnel: fire the canonical lane trigger for a ticket that a writer just
 * landed in a lane. Resolves any missing `projectId` / `status` from the row,
 * builds a RuntimeService if the caller has none, and never throws (a telemetry
 * or dispatch failure must never fail the write that produced the ticket).
 *
 * Callers: board-sync inbound (`boardsync/drizzleStore.upsertTask`), the QA finding
 * router, the repo-analysis run route and the quality "fix with agent" route.
 * The trigger itself is idempotent (it dedupes on a live execution), so calling it
 * after a writer has already started its own run is a safe no-op — the evaluation
 * returns `already_running`.
 */
export async function onTaskLandedInLane(env: Env, db: Db, signal: LaneEntrySignal): Promise<boolean> {
  try {
    let projectId = signal.projectId ?? null;
    let status = signal.status ?? null;
    if (projectId == null || status == null) {
      const [row] = await db
        .select({ projectId: tasks.projectId, status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, signal.taskId))
        .limit(1);
      if (!row) return false;
      projectId ??= row.projectId;
      status ??= row.status;
    }
    if (projectId == null || !status) return false;

    const runtimeService = signal.runtimeService ?? buildRuntimeService(env, db);
    return await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
      tenantId:  signal.tenantId,
      projectId,
      taskId:    signal.taskId,
      status,
      submittedBy: signal.submittedBy,
      ...(signal.originLaneKey ? { originLaneKey: signal.originLaneKey } : {}),
    });
  } catch (err) {
    // The trigger instruments its OWN throws; this catch only covers the resolution
    // step above, which must never break the writer that produced the ticket.
    console.error(`[lane-entry] resolve failed for task ${signal.taskId}`, err);
    return false;
  }
}

/** Tenant that owns a task's project — the one lookup a writer without a tenantId
 *  needs before it can call {@link onTaskLandedInLane}. Null when unresolvable. */
export async function resolveTaskTenantId(db: Db, taskId: number): Promise<number | null> {
  const [row] = await db
    .select({ tenantId: projects.tenantId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.tenantId ?? null;
}
