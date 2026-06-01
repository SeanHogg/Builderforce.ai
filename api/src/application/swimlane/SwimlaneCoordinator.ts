/**
 * SwimlaneCoordinator — application service that drives the per-ticket
 * lifecycle state machine across a board's swimlanes.
 *
 * All decisions (advance vs. gate vs. needs_attention) are delegated to the
 * PURE helpers in ./transitions; this class only does IO (Drizzle) and records
 * an audit row in swimlane_transitions for EVERY lifecycle move (or refusal to
 * advance).
 */
import { and, asc, eq, gt } from 'drizzle-orm';
import {
  boards,
  swimlanes,
  ticketRuns,
  swimlaneTransitions,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import {
  canTransitionTicket,
  mapWorkflowStatusToTicketEvent,
  resolveSuccessfulStageTarget,
  type TicketLifecycle,
  type WorkflowStatus,
} from './transitions';

type TicketRunRow = typeof ticketRuns.$inferSelect;
type SwimlaneRow = typeof swimlanes.$inferSelect;

export interface StageHistoryEntry {
  swimlaneId: string | null;
  workflowId: string | null;
  status: string;
  at: string;
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

export class SwimlaneCoordinator {
  constructor(private readonly db: Db) {}

  /**
   * Start a ticket on a board: create a ticket_runs row at the first lane.
   * Respects board.maxConcurrentTickets (counts non-terminal runs).
   */
  async startTicket(boardId: string, taskId: number, tenantId: number): Promise<TicketRunRow> {
    const [board] = await this.db
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!board) throw new TicketRunNotFoundError();

    // Concurrency gate: count only non-terminal runs against the budget.
    const active = await this.countActiveTickets(boardId, tenantId);
    if (active >= board.maxConcurrentTickets) {
      throw new TicketCapacityError(board.maxConcurrentTickets);
    }

    const firstLane = await this.firstLane(boardId, tenantId);

    const now = new Date();
    const history: StageHistoryEntry[] = [
      {
        swimlaneId: firstLane?.id ?? null,
        workflowId: null,
        status: 'queued',
        at: now.toISOString(),
      },
    ];

    const [run] = await this.db
      .insert(ticketRuns)
      .values({
        tenantId,
        boardId,
        taskId,
        currentSwimlaneId: firstLane?.id ?? null,
        lifecycle: 'queued',
        stageHistory: JSON.stringify(history),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!run) throw new Error('Failed to create ticket run.');

    await this.recordTransition({
      tenantId,
      ticketRunId: run.id,
      fromSwimlaneId: null,
      toSwimlaneId: firstLane?.id ?? null,
      reason: 'manual',
      workflowStatus: null,
      detail: 'ticket started',
    });

    return run;
  }

  /**
   * A stage's workflow finished. Decide the next lifecycle using the pure
   * mapper, advance/route accordingly, and ALWAYS record a transition row.
   */
  async onStageComplete(ticketRunId: string, workflowStatus: WorkflowStatus): Promise<TicketRunRow> {
    const run = await this.loadRun(ticketRunId);
    const board = await this.loadBoard(run.boardId, run.tenantId);

    const event = mapWorkflowStatusToTicketEvent(workflowStatus);

    // Failure path: NEVER auto-advance — route to needs_attention.
    if (!event.canAutoAdvance) {
      const next = event.next;
      return this.applyLifecycle(run, {
        next,
        currentSwimlaneId: run.currentSwimlaneId,
        reason: event.reason,
        workflowStatus,
        historyStatus: workflowStatus,
        toSwimlaneId: run.currentSwimlaneId,
        error: workflowStatus === 'failed' ? 'stage workflow failed' : null,
      });
    }

    // Success path: stage_completed first (record success), then resolve where
    // a successful stage should land.
    const currentLane = await this.loadLane(run.currentSwimlaneId, run.tenantId);
    const target = resolveSuccessfulStageTarget({
      isTerminalLane: currentLane?.isTerminal ?? false,
      gate: currentLane?.gate ?? 'auto',
      boardAutonomous: board.autonomous,
    });

    if (target === 'advancing') {
      const nextLane = await this.nextLane(run.boardId, run.tenantId, currentLane?.position ?? 0);
      return this.applyLifecycle(run, {
        next: nextLane ? 'stage_running' : 'done',
        currentSwimlaneId: nextLane?.id ?? run.currentSwimlaneId,
        reason: 'autonomous',
        workflowStatus,
        historyStatus: 'completed',
        toSwimlaneId: nextLane?.id ?? run.currentSwimlaneId,
        intermediate: 'stage_completed',
      });
    }

    // 'done' or 'awaiting_gate'
    return this.applyLifecycle(run, {
      next: target,
      currentSwimlaneId: run.currentSwimlaneId,
      reason: target === 'done' ? 'autonomous' : 'gate_approved',
      workflowStatus,
      historyStatus: 'completed',
      toSwimlaneId: run.currentSwimlaneId,
      intermediate: 'stage_completed',
    });
  }

  /** A human approved a gate; advance the awaiting_gate ticket to the next lane. */
  async approveGate(ticketRunId: string): Promise<TicketRunRow> {
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
      intermediate: 'advancing',
    });
  }

  /** Retry a failed (needs_attention) stage: re-run the SAME lane. */
  async retryStage(ticketRunId: string): Promise<TicketRunRow> {
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

  // ── internals ────────────────────────────────────────────────────────────

  private async countActiveTickets(boardId: string, tenantId: number): Promise<number> {
    const rows = await this.db
      .select({ lifecycle: ticketRuns.lifecycle })
      .from(ticketRuns)
      .where(and(eq(ticketRuns.boardId, boardId), eq(ticketRuns.tenantId, tenantId)));
    return rows.filter((r) => (ACTIVE_LIFECYCLES as string[]).includes(r.lifecycle)).length;
  }

  private async firstLane(boardId: string, tenantId: number): Promise<SwimlaneRow | undefined> {
    const [lane] = await this.db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position))
      .limit(1);
    return lane;
  }

  private async nextLane(
    boardId: string,
    tenantId: number,
    afterPosition: number,
  ): Promise<SwimlaneRow | undefined> {
    const [lane] = await this.db
      .select()
      .from(swimlanes)
      .where(
        and(
          eq(swimlanes.boardId, boardId),
          eq(swimlanes.tenantId, tenantId),
          gt(swimlanes.position, afterPosition),
        ),
      )
      .orderBy(asc(swimlanes.position))
      .limit(1);
    return lane;
  }

  private async loadLane(
    swimlaneId: string | null,
    tenantId: number,
  ): Promise<SwimlaneRow | undefined> {
    if (!swimlaneId) return undefined;
    const [lane] = await this.db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.id, swimlaneId), eq(swimlanes.tenantId, tenantId)));
    return lane;
  }

  private async loadRun(ticketRunId: string): Promise<TicketRunRow> {
    const [run] = await this.db.select().from(ticketRuns).where(eq(ticketRuns.id, ticketRunId));
    if (!run) throw new TicketRunNotFoundError();
    return run;
  }

  private async loadBoard(boardId: string, tenantId: number) {
    const [board] = await this.db
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!board) throw new TicketRunNotFoundError();
    return board;
  }

  /**
   * Apply a lifecycle change with validation, persistence, history append, and
   * a transition audit row. When `intermediate` is provided, the run passes
   * through that state first (e.g. stage_completed -> advancing) so the
   * transition graph stays legal.
   */
  private async applyLifecycle(
    run: TicketRunRow,
    opts: {
      next: TicketLifecycle;
      currentSwimlaneId: string | null;
      reason: 'autonomous' | 'gate_approved' | 'failed' | 'retry' | 'manual' | 'pending';
      workflowStatus: WorkflowStatus | null;
      historyStatus: string;
      toSwimlaneId: string | null;
      intermediate?: TicketLifecycle;
      error?: string | null;
      clearError?: boolean;
    },
  ): Promise<TicketRunRow> {
    const from = run.lifecycle as TicketLifecycle;

    // Validate the (possibly two-hop) path.
    if (opts.intermediate) {
      if (!canTransitionTicket(from, opts.intermediate)) {
        throw new InvalidTicketTransitionError(from, opts.intermediate);
      }
      if (!canTransitionTicket(opts.intermediate, opts.next)) {
        throw new InvalidTicketTransitionError(opts.intermediate, opts.next);
      }
    } else if (!canTransitionTicket(from, opts.next)) {
      throw new InvalidTicketTransitionError(from, opts.next);
    }

    const now = new Date();
    const history = parseHistory(run.stageHistory);
    history.push({
      swimlaneId: opts.toSwimlaneId,
      workflowId: run.currentWorkflowId ?? null,
      status: opts.historyStatus,
      at: now.toISOString(),
    });

    const [updated] = await this.db
      .update(ticketRuns)
      .set({
        lifecycle: opts.next,
        currentSwimlaneId: opts.currentSwimlaneId,
        stageHistory: JSON.stringify(history),
        error: opts.clearError ? null : opts.error ?? run.error,
        updatedAt: now,
      })
      .where(and(eq(ticketRuns.id, run.id), eq(ticketRuns.tenantId, run.tenantId)))
      .returning();
    if (!updated) throw new TicketRunNotFoundError();

    await this.recordTransition({
      tenantId: run.tenantId,
      ticketRunId: run.id,
      fromSwimlaneId: run.currentSwimlaneId,
      toSwimlaneId: opts.toSwimlaneId,
      reason: opts.reason,
      workflowStatus: opts.workflowStatus,
      detail: `${from} -> ${opts.next}`,
    });

    return updated;
  }

  private async recordTransition(t: {
    tenantId: number;
    ticketRunId: string;
    fromSwimlaneId: string | null;
    toSwimlaneId: string | null;
    reason: string;
    workflowStatus: WorkflowStatus | null;
    detail: string;
  }): Promise<void> {
    await this.db.insert(swimlaneTransitions).values({
      tenantId: t.tenantId,
      ticketRunId: t.ticketRunId,
      fromSwimlaneId: t.fromSwimlaneId,
      toSwimlaneId: t.toSwimlaneId,
      reason: t.reason,
      workflowStatus: t.workflowStatus,
      detail: t.detail,
      at: new Date(),
    });
  }
}
