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
  mapWorkflowStatusToTicketEvent,
  resolveStageAction,
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

/**
 * Runs a workflow definition as the side-effect of a lane's `run_workflow`
 * action. Injected so the coordinator stays IO-free and unit-testable with a
 * fake; the Drizzle-backed implementation loads the definition and calls
 * instantiateWorkflowRun. Optional — when absent, a run_workflow action simply
 * advances the ticket without firing the workflow.
 */
export interface StageWorkflowRunner {
  run(
    workflowDefId: string,
    ctx: { tenantId: number; ticketRunId: string; taskId: number },
  ): Promise<void>;
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

    // run_workflow action: fire the workflow as a side-effect wherever the
    // ticket lands (advancing or done — never on a human gate, which pauses).
    if (plan.runWorkflowId && this.workflowRunner) {
      await this.workflowRunner.run(plan.runWorkflowId, {
        tenantId: run.tenantId,
        ticketRunId: run.id,
        taskId: run.taskId,
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
