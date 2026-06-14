/**
 * DrizzleCoordinatorStore — the real, tenant-scoped {@link CoordinatorStore}
 * backed by Drizzle/Neon. Thin: it only maps the port's "lite" shapes to the
 * schema tables. All orchestration lives in SwimlaneCoordinator (and its pure
 * helpers), which is why this file has no logic to test.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  boards,
  swimlanes,
  swimlaneAgentAssignments,
  ticketRuns,
  swimlaneTransitions,
  agentDispatches,
  tenants,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type {
  AssignmentLite,
  BoardLite,
  CoordinatorStore,
  DispatchLite,
  LaneLite,
  NewDispatch,
  TicketRunLite,
  TransitionRecord,
} from './coordinatorStore';

export class DrizzleCoordinatorStore implements CoordinatorStore {
  constructor(private readonly db: Db) {}

  async getBoard(boardId: string, tenantId: number): Promise<BoardLite | null> {
    const [b] = await this.db
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!b) return null;
    return {
      id: b.id,
      tenantId: b.tenantId,
      autonomous: b.autonomous,
      maxConcurrentTickets: b.maxConcurrentTickets,
      needsAttentionLane: b.needsAttentionLane,
    };
  }

  // Low-frequency: read once per ticket stage transition (not a per-request hot
  // path), a single PK lookup — so it is not run through the read-through cache.
  async getDefaultAgentHostId(tenantId: number): Promise<string | null> {
    const [t] = await this.db
      .select({ defaultAgentHostId: tenants.defaultAgentHostId })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return t?.defaultAgentHostId != null ? String(t.defaultAgentHostId) : null;
  }

  async countActiveTickets(boardId: string, tenantId: number, activeLifecycles: string[]): Promise<number> {
    const rows = await this.db
      .select({ lifecycle: ticketRuns.lifecycle })
      .from(ticketRuns)
      .where(and(eq(ticketRuns.boardId, boardId), eq(ticketRuns.tenantId, tenantId)));
    return rows.filter((r) => activeLifecycles.includes(r.lifecycle)).length;
  }

  async listLanes(boardId: string, tenantId: number): Promise<LaneLite[]> {
    const rows = await this.db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position));
    return rows.map(toLane);
  }

  async getLane(swimlaneId: string, tenantId: number): Promise<LaneLite | null> {
    const [l] = await this.db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.id, swimlaneId), eq(swimlanes.tenantId, tenantId)));
    return l ? toLane(l) : null;
  }

  async listAssignments(swimlaneId: string, tenantId: number): Promise<AssignmentLite[]> {
    const rows = await this.db
      .select()
      .from(swimlaneAgentAssignments)
      .where(
        and(
          eq(swimlaneAgentAssignments.swimlaneId, swimlaneId),
          eq(swimlaneAgentAssignments.tenantId, tenantId),
        ),
      )
      .orderBy(asc(swimlaneAgentAssignments.position));
    return rows.map((a) => ({
      id: a.id,
      role: a.role,
      runtime: a.runtime,
      target: a.target,
      taskTemplate: a.taskTemplate,
      model: a.model,
      position: a.position,
    }));
  }

  async createTicketRun(data: {
    tenantId: number;
    boardId: string;
    taskId: number;
    currentSwimlaneId: string | null;
    lifecycle: string;
    stageHistory: string;
  }): Promise<TicketRunLite> {
    const now = new Date();
    const [run] = await this.db
      .insert(ticketRuns)
      .values({
        tenantId: data.tenantId,
        boardId: data.boardId,
        taskId: data.taskId,
        currentSwimlaneId: data.currentSwimlaneId,
        lifecycle: data.lifecycle,
        stageHistory: data.stageHistory,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!run) throw new Error('Failed to create ticket run.');
    return toRun(run);
  }

  async getTicketRun(id: string): Promise<TicketRunLite | null> {
    const [run] = await this.db.select().from(ticketRuns).where(eq(ticketRuns.id, id));
    return run ? toRun(run) : null;
  }

  async updateTicketRun(
    id: string,
    tenantId: number,
    patch: {
      lifecycle: string;
      currentSwimlaneId: string | null;
      stageHistory: string;
      error: string | null;
      awaitingWorkflowId?: string | null;
    },
  ): Promise<TicketRunLite | null> {
    const [run] = await this.db
      .update(ticketRuns)
      .set({
        lifecycle: patch.lifecycle,
        currentSwimlaneId: patch.currentSwimlaneId,
        stageHistory: patch.stageHistory,
        error: patch.error,
        // Only touch the parked-on link when the caller explicitly set it.
        ...('awaitingWorkflowId' in patch ? { awaitingWorkflowId: patch.awaitingWorkflowId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(ticketRuns.id, id), eq(ticketRuns.tenantId, tenantId)))
      .returning();
    return run ? toRun(run) : null;
  }

  async findAwaitingWorkflowRun(workflowId: string): Promise<TicketRunLite | null> {
    const [run] = await this.db
      .select()
      .from(ticketRuns)
      .where(
        and(
          eq(ticketRuns.awaitingWorkflowId, workflowId),
          eq(ticketRuns.lifecycle, 'awaiting_workflow'),
        ),
      )
      .limit(1);
    return run ? toRun(run) : null;
  }

  async recordTransition(t: TransitionRecord): Promise<void> {
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

  async insertDispatch(data: NewDispatch): Promise<string> {
    const [row] = await this.db
      .insert(agentDispatches)
      .values({ ...data })
      .returning({ id: agentDispatches.id });
    if (!row) throw new Error('Failed to insert dispatch.');
    return row.id;
  }

  async updateDispatch(
    id: string,
    patch: Partial<{
      status: string;
      output: string | null;
      error: string | null;
      externalRef: string | null;
      dependsOn: string;
      completedAt: boolean;
    }>,
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.output !== undefined) set.output = patch.output;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.externalRef !== undefined) set.externalRef = patch.externalRef;
    if (patch.dependsOn !== undefined) set.dependsOn = patch.dependsOn;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt ? new Date() : null;
    if (patch.status === 'claimed') set.claimedAt = new Date();
    await this.db.update(agentDispatches).set(set).where(eq(agentDispatches.id, id));
  }

  async getDispatch(id: string, tenantId: number): Promise<DispatchLite | null> {
    const [d] = await this.db
      .select()
      .from(agentDispatches)
      .where(and(eq(agentDispatches.id, id), eq(agentDispatches.tenantId, tenantId)));
    return d ? toDispatch(d) : null;
  }

  async listStageDispatches(ticketRunId: string, stageSeq: number, tenantId: number): Promise<DispatchLite[]> {
    const rows = await this.db
      .select()
      .from(agentDispatches)
      .where(
        and(
          eq(agentDispatches.ticketRunId, ticketRunId),
          eq(agentDispatches.stageSeq, stageSeq),
          eq(agentDispatches.tenantId, tenantId),
        ),
      );
    return rows.map(toDispatch);
  }

  async maxStageSeq(ticketRunId: string): Promise<number> {
    const [row] = await this.db
      .select({ stageSeq: agentDispatches.stageSeq })
      .from(agentDispatches)
      .where(eq(agentDispatches.ticketRunId, ticketRunId))
      .orderBy(desc(agentDispatches.stageSeq))
      .limit(1);
    return row?.stageSeq ?? 0;
  }
}

type LaneRow = typeof swimlanes.$inferSelect;
type RunRow = typeof ticketRuns.$inferSelect;
type DispatchRow = typeof agentDispatches.$inferSelect;

function toLane(l: LaneRow): LaneLite {
  return {
    id: l.id,
    boardId: l.boardId,
    key: l.key,
    position: l.position,
    isTerminal: l.isTerminal,
    gate: l.gate,
    executionMode: l.executionMode,
    actionType: l.actionType,
    actionTarget: l.actionTarget,
    successPolicy: l.successPolicy,
    successThreshold: l.successThreshold,
    failurePolicy: l.failurePolicy,
  };
}

function toRun(r: RunRow): TicketRunLite {
  return {
    id: r.id,
    tenantId: r.tenantId,
    boardId: r.boardId,
    taskId: r.taskId,
    currentSwimlaneId: r.currentSwimlaneId,
    lifecycle: r.lifecycle,
    currentWorkflowId: r.currentWorkflowId,
    awaitingWorkflowId: r.awaitingWorkflowId,
    stageHistory: r.stageHistory,
    error: r.error,
  };
}

function toDispatch(d: DispatchRow): DispatchLite {
  return {
    id: d.id,
    tenantId: d.tenantId,
    ticketRunId: d.ticketRunId,
    swimlaneId: d.swimlaneId,
    assignmentId: d.assignmentId,
    taskId: d.taskId,
    agentId: d.agentId,
    stageSeq: d.stageSeq,
    role: d.role,
    runtime: d.runtime,
    target: d.target,
    model: d.model,
    input: d.input,
    status: d.status,
    output: d.output,
    error: d.error,
    dependsOn: d.dependsOn,
    externalRef: d.externalRef,
    position: d.position,
  };
}
