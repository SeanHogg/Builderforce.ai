/**
 * SwimlaneCoordinator — drives the per-ticket lifecycle state machine across a
 * board's swimlanes AND the runtime-agnostic dispatch engine that actually runs
 * each stage's agents.
 *
 * All decisions (advance vs. gate vs. needs_attention; which dispatches are
 * ready; whether a stage is done/failed) are delegated to the PURE helpers in
 * ./transitions and ./stageScheduling. This class only orchestrates IO through
 * the {@link CoordinatorStore} port — so the whole launch → dispatch → result →
 * autonomous-advance loop is unit-testable with an in-memory fake.
 *
 * A stage is the set of agent dispatches sharing (ticketRunId, stageSeq). Each
 * dispatch runs on a agentHost (pushed via the injected dispatcher) or in the BROWSER
 * (left `pending` for a pull worker to claim). When the stage settles the ticket
 * advances (autonomous) or routes to needs_attention — never a silent advance.
 */
import {
  canTransitionTicket,
  countLaneFailures,
  mapWorkflowStatusToTicketEvent,
  MAX_AUTO_RETRIES,
  resolveStageAction,
  shouldSkipFailedStage,
  type TicketLifecycle,
  type WorkflowStatus,
} from './transitions';
import { compileStage, type StageAssignment, type ExecutionMode } from './compileStage';
import {
  aggregateStageOutcome,
  computeDeadBlocked,
  computeReadyDispatches,
  type DispatchStatus,
  type SchedulableDispatch,
  type SuccessPolicy,
} from './stageScheduling';
import type {
  AssignmentLite,
  CoordinatorStore,
  DispatchLite,
  LaneLite,
  TicketRunLite,
} from './coordinatorStore';

export interface StageHistoryEntry {
  swimlaneId: string | null;
  workflowId: string | null;
  status: string;
  at: string;
}

/**
 * A agentHost-reachable executor (local/cloud/remote). Browser dispatches are NOT
 * sent here — they stay `pending` for a browser pull worker. Injected so the
 * coordinator is unit-testable with a fake.
 */
export interface StageDispatcher {
  dispatch(d: DispatchLite): Promise<{ accepted: boolean; externalRef?: string; error?: string }>;
}

/** Outcome of starting a lane's `run_workflow` action. */
export type StageWorkflowRunResult =
  | { ok: true; workflowId: string }
  | { ok: false; error: string };

/**
 * Runs a workflow definition as the side-effect of a lane's `run_workflow`
 * action. Injected so the coordinator stays IO-free and unit-testable with a
 * fake; the Drizzle-backed implementation loads the definition and calls
 * instantiateWorkflowRun, returning the spawned workflow id. Optional — when
 * absent, a run_workflow action simply advances the ticket without firing the
 * workflow. When present, the ticket PARKS at 'awaiting_workflow' until that
 * workflow settles (see {@link SwimlaneCoordinator.onSpawnedWorkflowSettled}).
 */
export interface StageWorkflowRunner {
  run(
    workflowDefId: string,
    ctx: { tenantId: number; ticketRunId: string; taskId: number },
  ): Promise<StageWorkflowRunResult>;
}

/**
 * Ensures a task has a PRD before its first agent stage runs. Injected so the
 * coordinator stays IO-free; the Drizzle implementation drafts + links a PRD when
 * the task has none. Idempotent — safe to call on every agent stage (it no-ops
 * once the task already has a PRD). Optional — when absent, no auto-PRD gate runs.
 */
export interface TaskPrdEnsurer {
  ensureTaskPrd(taskId: number, tenantId: number): Promise<void>;
}

export class TicketCapacityError extends Error {
  constructor(public readonly limit: number) {
    super(`Board has reached its max concurrent ticket limit (${limit}).`);
    this.name = 'TicketCapacityError';
  }
}

export class TicketRunNotFoundError extends Error {
  constructor() {
    super('Ticket run not found.');
    this.name = 'TicketRunNotFoundError';
  }
}

export class InvalidTicketTransitionError extends Error {
  constructor(from: TicketLifecycle, to: TicketLifecycle) {
    super(`Illegal ticket transition: ${from} -> ${to}.`);
    this.name = 'InvalidTicketTransitionError';
  }
}

/** Lifecycle states that still occupy a board "slot" for concurrency. */
const ACTIVE_LIFECYCLES: TicketLifecycle[] = [
  'queued',
  'awaiting_gate',
  'awaiting_workflow',
  'stage_running',
  'stage_completed',
  'advancing',
  'needs_attention',
];

function parseHistory(raw: string | null): StageHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StageHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function parseDeps(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export class SwimlaneCoordinator {
  constructor(
    private readonly store: CoordinatorStore,
    /** AgentHost-reachable executor for local/cloud/remote dispatches. Optional:
     *  when absent, only browser (pull) dispatches can run. */
    private readonly dispatcher?: StageDispatcher,
    /** Runs a lane's `run_workflow` action. Optional (see {@link StageWorkflowRunner}). */
    private readonly workflowRunner?: StageWorkflowRunner,
    /** Auto-PRD gate run before a task's first agent stage. Optional (see {@link TaskPrdEnsurer}). */
    private readonly prdEnsurer?: TaskPrdEnsurer,
  ) {}

  /**
   * Start a ticket on a board: create the run at the first lane, then enter it
   * (queued → stage_running), which compiles + routes that lane's agents.
   * Respects board.maxConcurrentTickets (counts non-terminal runs).
   */
  async startTicket(boardId: string, taskId: number, tenantId: number): Promise<TicketRunLite> {
    const board = await this.store.getBoard(boardId, tenantId);
    if (!board) throw new TicketRunNotFoundError();

    const active = await this.store.countActiveTickets(boardId, tenantId, ACTIVE_LIFECYCLES);
    if (active >= board.maxConcurrentTickets) {
      throw new TicketCapacityError(board.maxConcurrentTickets);
    }

    const lanes = await this.store.listLanes(boardId, tenantId);
    const firstLane = lanes[0];

    const now = new Date();
    const history: StageHistoryEntry[] = [
      { swimlaneId: firstLane?.id ?? null, workflowId: null, status: 'queued', at: now.toISOString() },
    ];

    const run = await this.store.createTicketRun({
      tenantId,
      boardId,
      taskId,
      currentSwimlaneId: firstLane?.id ?? null,
      lifecycle: 'queued',
      stageHistory: JSON.stringify(history),
    });

    await this.store.recordTransition({
      tenantId,
      ticketRunId: run.id,
      fromSwimlaneId: null,
      toSwimlaneId: firstLane?.id ?? null,
      reason: 'manual',
      workflowStatus: null,
      detail: 'ticket started',
    });

    if (firstLane) {
      return this.applyLifecycle(run, {
        next: 'stage_running',
        currentSwimlaneId: firstLane.id,
        reason: 'manual',
        workflowStatus: null,
        historyStatus: 'stage_running',
        toSwimlaneId: firstLane.id,
      });
    }
    return run;
  }

  /**
   * A stage finished. Decide the next lifecycle via the pure mapper, advance/
   * route accordingly, and ALWAYS record a transition. Failure → needs_attention
   * (never auto-advance).
   */
  async onStageComplete(ticketRunId: string, workflowStatus: WorkflowStatus): Promise<TicketRunLite> {
    const run = await this.loadRun(ticketRunId);
    const event = mapWorkflowStatusToTicketEvent(workflowStatus);

    if (!event.canAutoAdvance) {
      // A failed stage normally parks at needs_attention — UNLESS the lane's
      // failure_policy is 'skip', which tolerates the failure and advances past
      // the lane (reusing the success-advance path). [1316]
      if (workflowStatus === 'failed') {
        const failedLane = await this.loadLane(run.currentSwimlaneId, run.tenantId);
        if (failedLane && shouldSkipFailedStage(failedLane.failurePolicy, failedLane.isTerminal)) {
          const destLane = await this.nextLane(run.boardId, run.tenantId, failedLane.position);
          return this.applyLifecycle(run, {
            next: destLane ? 'stage_running' : 'done',
            currentSwimlaneId: destLane?.id ?? run.currentSwimlaneId,
            reason: 'autonomous',
            workflowStatus,
            historyStatus: workflowStatus,
            toSwimlaneId: destLane?.id ?? run.currentSwimlaneId,
            intermediate: destLane ? ['stage_completed', 'advancing'] : 'stage_completed',
            error: 'stage failed — skipped per lane failure_policy',
          });
        }
        // failure_policy='retry': re-run the SAME lane up to MAX_AUTO_RETRIES
        // times before parking. The cap is derived from the persisted, structured
        // stage_history (count of prior 'failed' entries for this lane) — no new
        // state/column. Record THIS failure (→needs_attention), then re-dispatch. [1316]
        if (failedLane?.failurePolicy === 'retry'
            && countLaneFailures(run.stageHistory, run.currentSwimlaneId) < MAX_AUTO_RETRIES) {
          const parked = await this.applyLifecycle(run, {
            next: 'needs_attention',
            currentSwimlaneId: run.currentSwimlaneId,
            reason: 'failed',
            workflowStatus,
            historyStatus: 'failed',
            toSwimlaneId: run.currentSwimlaneId,
            error: 'stage failed — auto-retrying',
          });
          return this.retryStage(parked.id);
        }
      }
      return this.applyLifecycle(run, {
        next: event.next,
        currentSwimlaneId: run.currentSwimlaneId,
        reason: event.reason,
        workflowStatus,
        historyStatus: workflowStatus,
        toSwimlaneId: run.currentSwimlaneId,
        error: workflowStatus === 'failed' ? 'stage workflow failed' : null,
      });
    }

    const currentLane = await this.loadLane(run.currentSwimlaneId, run.tenantId);
    const plan = resolveStageAction({
      isTerminalLane: currentLane?.isTerminal ?? false,
      gate: currentLane?.gate ?? 'auto',
      actionType: currentLane?.actionType ?? null,
      actionTarget: currentLane?.actionTarget ?? null,
    });

    // run_workflow action: start the workflow, then PARK the ticket on it. The
    // ticket does NOT advance here — it waits at 'awaiting_workflow' until the
    // spawned workflow settles (onSpawnedWorkflowSettled maps its outcome onto
    // the ticket). A human gate already pre-empted this (plan.lifecycle would be
    // 'awaiting_gate', not reached here). Without an injected runner we fall
    // through to the legacy fire-nothing/advance behaviour.
    if (plan.runWorkflowId && this.workflowRunner) {
      const wfResult = await this.workflowRunner.run(plan.runWorkflowId, {
        tenantId: run.tenantId,
        ticketRunId: run.id,
        taskId: run.taskId,
      });
      if (!wfResult.ok) {
        // The action could not start (e.g. definition deleted/renamed since
        // assignment) — surface it instead of silently advancing.
        return this.applyLifecycle(run, {
          next: 'needs_attention',
          currentSwimlaneId: run.currentSwimlaneId,
          reason: 'failed',
          workflowStatus: 'failed',
          historyStatus: 'failed',
          toSwimlaneId: run.currentSwimlaneId,
          error: `run_workflow action failed: ${wfResult.error}`,
        });
      }
      return this.applyLifecycle(run, {
        next: 'awaiting_workflow',
        currentSwimlaneId: run.currentSwimlaneId,
        reason: 'pending',
        workflowStatus,
        historyStatus: 'awaiting_workflow',
        toSwimlaneId: run.currentSwimlaneId,
        intermediate: 'stage_completed',
        setAwaitingWorkflowId: wfResult.workflowId,
      });
    }

    if (plan.lifecycle === 'advancing') {
      // move_ticket action routes to a named lane; otherwise the next lane.
      const destLane = plan.moveToLaneKey
        ? await this.laneByKey(run.boardId, run.tenantId, plan.moveToLaneKey)
        : await this.nextLane(run.boardId, run.tenantId, currentLane?.position ?? 0);

      return this.applyLifecycle(run, {
        next: destLane ? 'stage_running' : 'done',
        currentSwimlaneId: destLane?.id ?? run.currentSwimlaneId,
        reason: 'autonomous',
        workflowStatus,
        historyStatus: 'completed',
        toSwimlaneId: destLane?.id ?? run.currentSwimlaneId,
        intermediate: destLane ? ['stage_completed', 'advancing'] : 'stage_completed',
      });
    }

    // do_nothing action: the stage finished, the ticket simply rests in its lane
    // (no advance/move/workflow). next IS 'stage_completed', so we must NOT also
    // pass it as an intermediate — that would chain stage_completed -> stage_completed.
    if (plan.lifecycle === 'stage_completed') {
      return this.applyLifecycle(run, {
        next: 'stage_completed',
        currentSwimlaneId: run.currentSwimlaneId,
        reason: 'autonomous',
        workflowStatus,
        historyStatus: 'completed',
        toSwimlaneId: run.currentSwimlaneId,
      });
    }

    return this.applyLifecycle(run, {
      next: plan.lifecycle,
      currentSwimlaneId: run.currentSwimlaneId,
      reason: plan.lifecycle === 'done' ? 'autonomous' : 'gate_approved',
      workflowStatus,
      historyStatus: 'completed',
      toSwimlaneId: run.currentSwimlaneId,
      intermediate: 'stage_completed',
    });
  }

  /**
   * A spawned `run_workflow` side-effect settled. Resume the ticket parked on it:
   * success → advance (next lane, or done on a terminal lane); failure/cancel →
   * needs_attention (never a silent advance). No-op when no ticket is parked on
   * the workflow or the store can't resolve it (browser/test stores). This is the
   * back-edge that makes a `run_workflow` lane action genuinely GATE on its
   * downstream workflow's outcome rather than fire-and-forget.
   */
  async onSpawnedWorkflowSettled(
    workflowId: string,
    status: WorkflowStatus,
  ): Promise<TicketRunLite | null> {
    if (!this.store.findAwaitingWorkflowRun) return null;
    const run = await this.store.findAwaitingWorkflowRun(workflowId);
    if (!run || run.lifecycle !== 'awaiting_workflow') return null;

    if (status === 'completed') {
      const currentLane = await this.loadLane(run.currentSwimlaneId, run.tenantId);
      const destLane = currentLane?.isTerminal
        ? undefined
        : await this.nextLane(run.boardId, run.tenantId, currentLane?.position ?? 0);
      return this.applyLifecycle(run, {
        next: destLane ? 'stage_running' : 'done',
        currentSwimlaneId: destLane?.id ?? run.currentSwimlaneId,
        reason: 'autonomous',
        workflowStatus: status,
        historyStatus: 'completed',
        toSwimlaneId: destLane?.id ?? run.currentSwimlaneId,
        intermediate: destLane ? 'advancing' : undefined,
        setAwaitingWorkflowId: null,
      });
    }

    // failed | cancelled | (defensive) anything non-success → park for a human.
    return this.applyLifecycle(run, {
      next: 'needs_attention',
      currentSwimlaneId: run.currentSwimlaneId,
      reason: 'failed',
      workflowStatus: status,
      historyStatus: status === 'cancelled' ? 'cancelled' : 'failed',
      toSwimlaneId: run.currentSwimlaneId,
      error: `run_workflow side-effect ${status}`,
      setAwaitingWorkflowId: null,
    });
  }

  /** A human approved a gate; advance the awaiting_gate ticket to the next lane. */
  async approveGate(ticketRunId: string): Promise<TicketRunLite> {
    const run = await this.loadRun(ticketRunId);
    if (run.lifecycle !== 'awaiting_gate' && run.lifecycle !== 'needs_attention') {
      throw new InvalidTicketTransitionError(run.lifecycle as TicketLifecycle, 'advancing');
    }
    const currentLane = await this.loadLane(run.currentSwimlaneId, run.tenantId);
    const nextLane = await this.nextLane(run.boardId, run.tenantId, currentLane?.position ?? 0);

    return this.applyLifecycle(run, {
      next: nextLane ? 'stage_running' : 'done',
      currentSwimlaneId: nextLane?.id ?? run.currentSwimlaneId,
      reason: 'gate_approved',
      workflowStatus: null,
      historyStatus: 'gate_approved',
      toSwimlaneId: nextLane?.id ?? run.currentSwimlaneId,
      intermediate: nextLane ? 'advancing' : undefined,
    });
  }

  /** Retry a failed (needs_attention) stage: re-run the SAME lane. */
  async retryStage(ticketRunId: string): Promise<TicketRunLite> {
    const run = await this.loadRun(ticketRunId);
    if (run.lifecycle !== 'needs_attention') {
      throw new InvalidTicketTransitionError(run.lifecycle as TicketLifecycle, 'stage_running');
    }
    return this.applyLifecycle(run, {
      next: 'stage_running',
      currentSwimlaneId: run.currentSwimlaneId,
      reason: 'retry',
      workflowStatus: null,
      historyStatus: 'retry',
      toSwimlaneId: run.currentSwimlaneId,
      clearError: true,
    });
  }

  // ── stage execution (the runtime-agnostic dispatch engine) ─────────────────

  /**
   * Report a single dispatch's terminal result (agentHost callback or browser pull
   * worker), then re-evaluate the stage — scheduling newly-unblocked siblings
   * and, once the stage settles, advancing the ticket.
   */
  async reportDispatchResult(
    dispatchId: string,
    tenantId: number,
    result: { status: 'completed' | 'failed' | 'cancelled'; output?: string | null; error?: string | null },
  ): Promise<void> {
    const dispatch = await this.store.getDispatch(dispatchId, tenantId);
    if (!dispatch) throw new TicketRunNotFoundError();

    await this.store.updateDispatch(dispatchId, {
      status: result.status,
      output: result.output ?? dispatch.output,
      error: result.error ?? dispatch.error,
      completedAt: true,
    });

    await this.evaluateStage(dispatch.ticketRunId, dispatch.stageSeq, tenantId);
  }

  private async launchStage(run: TicketRunLite): Promise<void> {
    const lane = await this.loadLane(run.currentSwimlaneId, run.tenantId);
    if (!lane) {
      await this.onStageComplete(run.id, 'completed');
      return;
    }

    const assignments = await this.store.listAssignments(lane.id, run.tenantId);
    if (assignments.length === 0) {
      await this.onStageComplete(run.id, 'completed');
      return;
    }

    // Honor the lane's requirement gate: a 'hard' lane cannot launch its normal agents
    // while a REQUIRED reviewer sign-off is still missing — park the ticket for review
    // instead. A subsequent kanban.signoff (approved) clears it, and approveGate/retry
    // resumes the stage. 'off'/'soft' gates do not block here (soft is the System-A
    // reviewer round-trip; the coordinator just proceeds).
    if (lane.requirementGate === 'hard'
        && (await this.store.hasUnmetRequiredReviewers(run.taskId, lane.id, run.tenantId))) {
      await this.applyLifecycle(run, {
        next: 'needs_attention',
        currentSwimlaneId: lane.id,
        reason: 'failed',
        workflowStatus: null,
        historyStatus: 'blocked_requirements',
        toSwimlaneId: lane.id,
        error: 'Blocked: required reviewer sign-off missing (hard requirement gate).',
      });
      return;
    }

    // Auto-PRD gate: this lane has agents, so ensure the task has a PRD before
    // they run. Idempotent — fires once, on the first agent stage with no PRD.
    if (this.prdEnsurer) {
      await this.prdEnsurer.ensureTaskPrd(run.taskId, run.tenantId);
    }

    const stageSeq = (await this.store.maxStageSeq(run.id)) + 1;

    const stageAssignments: StageAssignment[] = assignments.map((a) => ({
      id: a.id,
      role: a.role,
      runtime: (a.runtime as StageAssignment['runtime']) ?? 'cloud',
      target: a.target,
      taskTemplate: a.taskTemplate,
      position: a.position,
    }));
    const specs = compileStage(
      stageAssignments,
      (lane.executionMode as ExecutionMode) ?? 'sequential',
      lane.key,
    );

    // Non-browser dispatches route to a agentHost via the relay, keyed by the
    // dispatch `target` (= the agentHost id). When an assignment did not pin one,
    // fall back to the tenant's default agentHost so a single registered claw
    // "just works" without the user wiring a target per lane.
    const defaultTarget = this.store.getDefaultAgentHostId
      ? await this.store.getDefaultAgentHostId(run.tenantId)
      : null;

    const assignmentById = new Map<string, AssignmentLite>(assignments.map((a) => [a.id, a]));
    const dispatchIdByAssignment = new Map<string, string>();
    for (const spec of specs) {
      const a = assignmentById.get(spec.id);
      const id = await this.store.insertDispatch({
        tenantId: run.tenantId,
        ticketRunId: run.id,
        swimlaneId: lane.id,
        assignmentId: spec.id,
        taskId: run.taskId,
        agentId: null,
        stageSeq,
        role: spec.agentRole,
        runtime: a?.runtime ?? 'cloud',
        target: a?.target ?? defaultTarget,
        model: a?.model ?? null,
        input: spec.description,
        status: 'blocked',
        dependsOn: '[]',
        position: a?.position ?? 0,
      });
      dispatchIdByAssignment.set(spec.id, id);
    }

    // Translate compiled dependsOn (assignment ids) → sibling dispatch ids.
    for (const spec of specs) {
      const dispatchId = dispatchIdByAssignment.get(spec.id);
      if (!dispatchId) continue;
      const depDispatchIds = spec.dependsOn
        .map((aid) => dispatchIdByAssignment.get(aid))
        .filter((x): x is string => !!x);
      await this.store.updateDispatch(dispatchId, { dependsOn: JSON.stringify(depDispatchIds) });
    }

    await this.evaluateStage(run.id, stageSeq, run.tenantId);
  }

  private async evaluateStage(ticketRunId: string, stageSeq: number, tenantId: number): Promise<void> {
    let siblings = await this.store.listStageDispatches(ticketRunId, stageSeq, tenantId);

    const ready = computeReadyDispatches(this.toSchedulable(siblings));
    if (ready.length > 0) {
      const readyIds = new Set(ready.map((r) => r.id));
      for (const d of siblings.filter((s) => readyIds.has(s.id))) {
        await this.dispatchOne(d);
      }
      siblings = await this.store.listStageDispatches(ticketRunId, stageSeq, tenantId);
    }

    // Cancel blocked dispatches that can never run (a dependency already failed),
    // so a sequential stage whose first agent fails settles instead of hanging.
    const dead = computeDeadBlocked(this.toSchedulable(siblings));
    if (dead.length > 0) {
      for (const d of dead) {
        await this.store.updateDispatch(d.id, {
          status: 'cancelled',
          error: 'dependency failed; dispatch cannot run',
          completedAt: true,
        });
      }
      siblings = await this.store.listStageDispatches(ticketRunId, stageSeq, tenantId);
    }

    // The stage's success quorum comes from the lane (all | any | n_of_m).
    const lane = siblings[0]?.swimlaneId
      ? await this.loadLane(siblings[0].swimlaneId, tenantId)
      : undefined;
    const outcome = aggregateStageOutcome(
      siblings.map((s) => s.status as DispatchStatus),
      (lane?.successPolicy as SuccessPolicy) ?? 'all',
      lane?.successThreshold ?? null,
    );
    if (outcome === 'completed') {
      await this.onStageComplete(ticketRunId, 'completed');
    } else if (outcome === 'failed') {
      await this.onStageComplete(ticketRunId, 'failed');
    }
    // 'running': a pull worker / agentHost callback re-enters via reportDispatchResult.
  }

  /** Route one ready dispatch: browser → claimable `pending`; agentHost → push. */
  private async dispatchOne(d: DispatchLite): Promise<void> {
    if (d.runtime === 'browser') {
      await this.store.updateDispatch(d.id, { status: 'pending' });
      return;
    }
    if (!this.dispatcher) {
      await this.store.updateDispatch(d.id, {
        status: 'failed',
        error: `No agentHost dispatcher configured for runtime '${d.runtime}'.`,
        completedAt: true,
      });
      return;
    }
    try {
      const res = await this.dispatcher.dispatch(d);
      await this.store.updateDispatch(d.id, {
        status: res.accepted ? 'running' : 'failed',
        externalRef: res.externalRef ?? d.externalRef,
        error: res.accepted ? d.error : res.error ?? 'dispatch rejected',
        completedAt: res.accepted ? false : true,
      });
    } catch (err) {
      await this.store.updateDispatch(d.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: true,
      });
    }
  }

  private toSchedulable(rows: DispatchLite[]): SchedulableDispatch[] {
    return rows.map((r) => ({
      id: r.id,
      status: r.status as DispatchStatus,
      dependsOn: parseDeps(r.dependsOn),
    }));
  }

  // ── lane / run helpers ─────────────────────────────────────────────────────

  private async nextLane(boardId: string, tenantId: number, afterPosition: number): Promise<LaneLite | undefined> {
    const lanes = await this.store.listLanes(boardId, tenantId);
    return lanes.find((l) => l.position > afterPosition);
  }

  /** Resolve a lane by its key within a board (for the move_ticket action). */
  private async laneByKey(boardId: string, tenantId: number, key: string): Promise<LaneLite | undefined> {
    const lanes = await this.store.listLanes(boardId, tenantId);
    return lanes.find((l) => l.key === key);
  }

  private async loadLane(swimlaneId: string | null, tenantId: number): Promise<LaneLite | undefined> {
    if (!swimlaneId) return undefined;
    return (await this.store.getLane(swimlaneId, tenantId)) ?? undefined;
  }

  private async loadRun(ticketRunId: string): Promise<TicketRunLite> {
    const run = await this.store.getTicketRun(ticketRunId);
    if (!run) throw new TicketRunNotFoundError();
    return run;
  }

  /**
   * Apply a lifecycle change with chain validation, persistence, history append,
   * a transition audit row, and — when landing in stage_running — launching the
   * stage's dispatches. `intermediate` may be a single state or an ordered chain.
   */
  private async applyLifecycle(
    run: TicketRunLite,
    opts: {
      next: TicketLifecycle;
      currentSwimlaneId: string | null;
      reason: 'autonomous' | 'gate_approved' | 'failed' | 'retry' | 'manual' | 'pending';
      workflowStatus: WorkflowStatus | null;
      historyStatus: string;
      toSwimlaneId: string | null;
      intermediate?: TicketLifecycle | TicketLifecycle[];
      error?: string | null;
      clearError?: boolean;
      /** Set/clear the parked-on workflow id (omit to leave unchanged). */
      setAwaitingWorkflowId?: string | null;
    },
  ): Promise<TicketRunLite> {
    const from = run.lifecycle as TicketLifecycle;
    const intermediates = opts.intermediate
      ? Array.isArray(opts.intermediate) ? opts.intermediate : [opts.intermediate]
      : [];
    const chain: TicketLifecycle[] = [from, ...intermediates, opts.next];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a && b && !canTransitionTicket(a, b)) {
        throw new InvalidTicketTransitionError(a, b);
      }
    }

    const now = new Date();
    const history = parseHistory(run.stageHistory);
    history.push({
      swimlaneId: opts.toSwimlaneId,
      workflowId: run.currentWorkflowId ?? null,
      status: opts.historyStatus,
      at: now.toISOString(),
    });

    const updated = await this.store.updateTicketRun(run.id, run.tenantId, {
      lifecycle: opts.next,
      currentSwimlaneId: opts.currentSwimlaneId,
      stageHistory: JSON.stringify(history),
      error: opts.clearError ? null : opts.error ?? run.error,
      ...(opts.setAwaitingWorkflowId !== undefined
        ? { awaitingWorkflowId: opts.setAwaitingWorkflowId }
        : {}),
    });
    if (!updated) throw new TicketRunNotFoundError();

    await this.store.recordTransition({
      tenantId: run.tenantId,
      ticketRunId: run.id,
      fromSwimlaneId: run.currentSwimlaneId,
      toSwimlaneId: opts.toSwimlaneId,
      reason: opts.reason,
      workflowStatus: opts.workflowStatus,
      detail: `${from} -> ${opts.next}`,
    });

    if (opts.next === 'stage_running') {
      await this.launchStage(updated);
    }

    return updated;
  }
}
