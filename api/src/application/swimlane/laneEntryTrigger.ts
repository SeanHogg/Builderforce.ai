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
import {
  autoRunSkipState, claimAutoRunSkipState, clearAutoRunSkip, emitAutoRunSkip, recordAutoRunSkip,
} from '../runtime/autoRunSkipLedger';
import { evaluateExecutionApprovalGate } from '../runtime/executionApprovalGate';
import { evaluateTaskAutoRun, type TenantTokenVerdict } from './evaluateAutoRun';
import { enforceLaneRequirements } from './laneRequirementGate';
import { TicketAuditService } from '../audit/ticketAuditService';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { buildRoleRunPayload, requestRoleRun, type RoleRunRequest } from '../kanban/requestRoleRun';
import { composeDispatcherLabel } from '../runtime/dispatcherLabel';
import { roleDisplayName } from '../kanban/roleCatalog';
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
  args: {
    tenantId: number; projectId: number; taskId: number; status: string; submittedBy: string;
    originLaneKey?: string;
    /** Pre-resolved workspace token verdict (the sweep resolves one per tenant). */
    tenantTokens?: TenantTokenVerdict;
    /**
     * A HUMAN asked for this tick. Passed to the lane requirement gate so an explicitly
     * requested ROLE dispatch overrides the failure breaker / re-run cooldown, exactly as
     * "Run now" does. It deliberately does NOT relax the lane's own auto-run decision
     * below — that stays the evaluator's call.
     */
    force?: boolean;
  },
): Promise<boolean> {
  try {
    // ONE read-only evaluation answers "should this run, as which agent, and if
    // not why" — shared verbatim with the triage diagnostic + Run-now endpoints so
    // the trigger and the UI can never disagree. It already applies the terminal/
    // board/lane/gate resolution, the owner-fallback, the capability guardrail, the
    // same-lane loop guard, the per-ticket re-run cooldown, the live-run idempotency
    // check and the workspace token gate.
    const evaln = await evaluateTaskAutoRun(db, runtimeService, {
      tenantId:     args.tenantId,
      projectId:    args.projectId,
      taskId:       args.taskId,
      status:       args.status,
      originLaneKey: args.originLaneKey,
      ...(args.tenantTokens ? { tenantTokens: args.tenantTokens } : {}),
      env,
    });

    // THE LANE, as the evaluator resolved it live from the row — NOT `args.status`.
    // A caller working from a stale snapshot (the sweep scans hundreds of tickets and
    // dispatches them one at a time) would otherwise gate against one lane and then
    // stamp the run, the telemetry and the loop-guard `laneKey` with another. Every
    // use below is deliberately `lane`, so a ticket that moved between the caller's
    // read and this evaluation is handled as the lane it is actually IN.
    const lane = evaln.status;

    // Pillar 2 — lane requirement gating: entering a lane recomputes the ticket's
    // role/diagnostic audit and, when a required reviewer (e.g. the Architect) has
    // not signed off, flags the ticket and dispatches that reviewer for a round-trip
    // back to the Developer. When a reviewer run is owed this hop (or a 'hard' gate
    // is unmet), the lane's NORMAL agent is suppressed until the review clears.
    const gate = await enforceLaneRequirements(env, db, runtimeService, new TicketAuditService(db), {
      tenantId:    args.tenantId,
      projectId:   args.projectId,
      taskId:      args.taskId,
      status:      lane,
      submittedBy: args.submittedBy,
      ...(args.force ? { force: true } : {}),
    });
    if (gate.blocked) {
      // INSTRUMENT THE BLOCK. This was the one non-run path in the whole trigger that
      // returned silently: every other refusal below emits `auto_run_skipped`, so a
      // ticket held here left NO row in `tool_audit_events` at all. Measured on task
      // 173 — held in `in_review` awaiting a `code-reviewer` sign-off, swept every few
      // minutes for eleven days, and its chain of custody showed an unbroken gap over
      // exactly that period. The lifecycle report could then only fall back to a stale
      // `human_gate` from before the lane was re-gated, because the condition actually
      // holding the ticket had never been written down.
      //
      // `evaluateTaskAutoRun` cannot supply this reason (it does not model the
      // requirement gate — see EVALUATED_AUTO_RUN_REASONS), so this recorded skip is
      // the ONLY evidence of it, and the ledger deliberately keeps it even when the
      // live gate answers `will_run`.
      await recordAutoRunSkip(env, db, {
        tenantId:      args.tenantId,
        taskId:        args.taskId,
        cloudAgentRef: evaln.candidate?.agentRef ?? evaln.assignedAgentRef ?? args.submittedBy,
        lane,
        reason:        'lane_requirement_gate',
        detail:        {
          taskId: args.taskId,
          lane,
          reason: 'lane_requirement_gate',
          ...(gate.dispatchedReviewers.length ? { dispatchedReviewers: gate.dispatchedReviewers } : {}),
          ...(gate.dispatchedProducers.length ? { dispatchedProducers: gate.dispatchedProducers } : {}),
        },
        result: `Auto-run skipped (lane_requirement_gate) for task ${args.taskId} on lane '${lane}': `
          + `awaiting role sign-off${gate.dispatchedReviewers.length ? ` — dispatched reviewer(s): ${gate.dispatchedReviewers.join(', ')}` : ''}`
          + `${gate.dispatchedProducers.length ? ` — dispatched producer(s): ${gate.dispatchedProducers.join(', ')}` : ''}.`,
      });
      return false;
    }

    // A lane whose every candidate agent lacks its required capabilities is a
    // configuration error, not a silent no-op. Emit a `capability_mismatch` warning
    // so a mis-staffed lane is diagnosable (the triage diagnostic surfaces the same).
    if (evaln.decision.capabilityMismatches?.length) {
      // ONE claim for the whole mismatch SET (re-staffing the lane with a different
      // wrong-role agent IS a state change worth re-recording), then a row per agent so
      // each lands on that agent's own tool-audit timeline.
      const mismatchState = autoRunSkipState(
        lane,
        `capability_mismatch:${evaln.decision.capabilityMismatches.map((m) => m.agentRef).sort().join(',')}`,
      );
      const mismatchIsNew = await claimAutoRunSkipState(env, args.tenantId, args.taskId, mismatchState);
      for (const m of evaln.decision.capabilityMismatches) {
        if (!mismatchIsNew) continue;
        console.warn(
          `[capability_mismatch] task ${args.taskId} lane '${lane}': agent '${m.agentRef}' lacks required capabilities [${m.missing.join(', ')}] — skipped for auto-run`,
        );
        // Surface the skip as a first-class Observability event, not just a server
        // log: a mis-staffed lane whose candidate agent lacks its required
        // capabilities is a diagnosable configuration error that the Triage control
        // otherwise only shows on-demand. Task-scoped (no execution was created — the
        // run was skipped) + keyed to the agent ref so it lands in that agent's
        // tool-audit timeline alongside its runs. Best-effort (recordCloudToolEvent
        // swallows its own errors) so telemetry never blocks the trigger.
        await emitAutoRunSkip(db, {
          tenantId:      args.tenantId,
          taskId:        args.taskId,
          cloudAgentRef: m.agentRef,
          detail:        { taskId: args.taskId, lane, reason: 'capability_mismatch', agentRef: m.agentRef, missing: m.missing },
          result:        `Auto-run skipped: agent '${m.agentRef}' lacks required capabilities [${m.missing.join(', ')}] for lane '${lane}'.`,
        });
      }
    }
    // For every OTHER non-run reason (no_agent, human_gate, terminal_lane, no_lane,
    // no_board, already_running, same_lane_reentry, cooldown_active, not_executable,
    // tenant_token_limit) the trigger previously returned false with no surfaced
    // event, leaving a stuck ticket undiagnosable from the agent timeline. Emit one
    // best-effort Observability event for any skip reason NOT already covered by the
    // capability_mismatch loop above.
    if (!evaln.canRunNow && evaln.reason !== 'capability_mismatch') {
      const skipAgentRef =
        evaln.decision.agentRef ??
        evaln.staffedAgentRefs[0] ??
        evaln.assignedAgentRef ??
        args.submittedBy;
      await recordAutoRunSkip(env, db, {
        tenantId:      args.tenantId,
        taskId:        args.taskId,
        cloudAgentRef: skipAgentRef,
        lane,
        // `already_running` names the LIVE RUN in its state so a ticket that moves from
        // one blocking run to the next is re-recorded rather than suppressed as "same".
        reason:        evaln.liveExecution ? `${evaln.reason}:${evaln.liveExecution.id}` : evaln.reason,
        // NAME THE LIVE RUN. `already_running` on its own reads as "busy", which is
        // wrong for the case that actually freezes tickets: a run PAUSED on an
        // `ask_human` question counts as live and holds the ticket for up to the
        // 72-hour paused deadline. Recording the id + status turns a wall of
        // identical skips into "run #4413 has been waiting for a human since 04:40".
        detail: {
          taskId: args.taskId, lane, reason: evaln.reason,
          ...(evaln.cooldownRemainingMs ? { cooldownRemainingMs: evaln.cooldownRemainingMs } : {}),
          ...(evaln.liveExecution ? { liveExecutionId: evaln.liveExecution.id, liveExecutionStatus: evaln.liveExecution.status } : {}),
        },
        result: `Auto-run skipped (${evaln.reason}) for task ${args.taskId} on lane '${lane}'`
          + `${evaln.liveExecution ? ` — run #${evaln.liveExecution.id} is ${evaln.liveExecution.status}` : ''}.`,
      });
    }
    if (!evaln.canRunNow) return false;

    // The ticket is about to RUN, so drop its skip-suppression marker: a stall that
    // recurs after a real run is new information, and must not be swallowed as a
    // repeat of the state recorded before the run.
    await clearAutoRunSkip(env, args.tenantId, args.taskId);

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
    const payloadObj: { cloudAgentRef?: string; model?: string; laneKey?: string } = { laneKey: lane };
    if (evaln.decision.agentRef) payloadObj.cloudAgentRef = evaln.decision.agentRef;
    if (evaln.decision.model) payloadObj.model = evaln.decision.model;

    // ── ROLE ATTRIBUTION ON A LIFECYCLE-MANAGED BOARD ────────────────────────────
    // A managed board refuses any dispatch whose payload carries no role
    // (`authorizeManagedTaskExecution`), and the bare payload above never carried one —
    // so on a managed board this trigger could never dispatch AT ALL. It threw at the
    // dispatcher, the catch below wrote `auto_run_error`, and because the throw preceded
    // the execution row there was no failure to count: the breaker and the cooldown never
    // engaged and the refusal repeated every sweep forever. See `managedLaneRoles.ts`.
    //
    // The evaluator now resolves the role AND the agent together from the SAME authority
    // the guard enforces, so the payload built here is accepted by construction. The run
    // goes out through `requestRoleRun`, which additionally marks the manifest slot
    // `in_progress` — the record that this stage was asked, and what lets the lane's
    // sign-off round-trip proceed on the next hop.
    const roleRun: RoleRunRequest | null = evaln.managedRole
      ? {
        tenantId: args.tenantId,
        projectId: args.projectId,
        taskId: args.taskId,
        roleKey: evaln.managedRole.roleKey,
        roleName: roleDisplayName(evaln.managedRole.roleKey),
        agentRef: evaln.managedRole.agentRef,
        model: evaln.decision.model ?? null,
        laneKey: lane,
        kind: 'producer',
        submittedBy: composeDispatcherLabel(args.submittedBy, 'producer', evaln.managedRole.roleKey),
      }
      : null;

    // Collect the dispatcher's deferred executor kickoff (`orchestrate()`) and AWAIT
    // it here instead of letting it re-register on the (already-closed) request
    // `executionCtx`. We are off the response path, so awaiting the kickoff costs
    // nothing the user waits on — but it guarantees the run is actually started
    // rather than created-then-dropped. See this function's header for the why.
    const payload = roleRun
      ? buildRoleRunPayload(roleRun)
      : (Object.keys(payloadObj).length > 0 ? JSON.stringify(payloadObj) : undefined);

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
          detail:        { taskId: args.taskId, lane, approvalId: gate.approvalId, reason: gate.reason },
          result:        `Auto-run held for approval (${gate.reason}) on task ${args.taskId}, lane '${lane}'.`.slice(0, 300),
        }).catch(() => { /* best-effort telemetry — never block the trigger */ });
        return false;
      }
    }

    if (roleRun) {
      // `requestRoleRun` owns dispatch + slot attribution + the activity row, and returns
      // null when the dispatcher refused (cap, breaker, cooldown) — which it has already
      // recorded as a skip. A refusal is NOT a dispatch, so say so and return false
      // rather than reporting a run that never started.
      const executionId = await requestRoleRun(env, db, runtimeService, new TicketParticipantsService(db), roleRun);
      if (executionId == null) return false;
    } else {
      const deferred: Promise<unknown>[] = [];
      await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
        taskId: args.taskId,
        tenantId: args.tenantId,
        payload,
        submittedBy: args.submittedBy,
      });
      await Promise.allSettled(deferred);
    }

    // Autonomy TOOK this hop. Every REFUSAL above is recorded, but a success used to
    // leave only an `executions` row — so "did autonomy advance this ticket, or did a
    // human?" could only ever be inferred, never read. Recording the positive decision
    // alongside the negatives makes the ticket's lifecycle ledger a complete chain:
    // the auditor sees the decision AND the run it produced, on the same lane, in order.
    // Same task-scoped session key the skip events use, so one query returns them all.
    // Best-effort — telemetry must never turn a dispatched run into a reported failure.
    await recordCloudToolEvent(db, {
      tenantId:      args.tenantId,
      cloudAgentRef: evaln.decision.agentRef ?? args.submittedBy,
      executionId:   null,
      sessionKey:    `task:${args.taskId}`,
      toolName:      'auto_run_dispatched',
      category:      'planning',
      detail:        {
        taskId: args.taskId, lane, reason: 'will_run',
        agentRef: evaln.decision.agentRef ?? null, submittedBy: args.submittedBy,
        // The ROLE the run was attributed to, on a managed board. Without it the ledger
        // cannot tell a Coordinator-issued stage run from a generic lane dispatch.
        ...(evaln.managedRole ? { roleKey: evaln.managedRole.roleKey, roleSource: evaln.managedRole.source } : {}),
      },
      result:        (`Auto-run dispatched for task ${args.taskId} on lane '${lane}'`
        + `${evaln.decision.agentRef ? ` as ${evaln.decision.agentRef}` : ''}`
        + `${evaln.managedRole ? ` acting as '${evaln.managedRole.roleKey}'` : ''}.`).slice(0, 300),
    }).catch(() => { /* best-effort telemetry — never block the trigger */ });
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
    // STATE-GATED, like every skip beside it. An error is not exempt from the write
    // amplification rule: the sweep re-evaluates a broken ticket every few minutes, and
    // a recurring exception (a managed refusal before it became a first-class skip, a
    // persistent DB blip) wrote the identical row forever — after the skip paths were
    // gated this was the LAST unbounded writer in the trigger. The state includes the
    // message, so a DIFFERENT error is still recorded immediately, and the ledger's
    // `DISTINCT ON (session_key) ORDER BY ts DESC` read is unaffected either way.
    if (await claimAutoRunSkipState(env, args.tenantId, args.taskId, autoRunSkipState(args.status, `error:${message}`))) {
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
    }
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
