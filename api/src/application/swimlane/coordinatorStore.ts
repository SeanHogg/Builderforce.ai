/**
 * CoordinatorStore — the narrow persistence port the SwimlaneCoordinator needs.
 *
 * Mirrors the BoardSyncStore pattern (slice 2): the coordinator's orchestration
 * logic talks only to this port, so it is fully unit-testable with an in-memory
 * fake, while [DrizzleCoordinatorStore] provides the real tenant-scoped Drizzle
 * implementation. "Lite" row shapes expose only the columns the coordinator
 * reads, decoupling it from the full Drizzle row types.
 */

export interface BoardLite {
  id: string;
  tenantId: number;
  autonomous: boolean;
  maxConcurrentTickets: number;
  needsAttentionLane: string;
}

export interface LaneLite {
  id: string;
  boardId: string;
  key: string;
  position: number;
  isTerminal: boolean;
  gate: string;          // 'auto' | 'human'
  executionMode: string; // 'parallel' | 'sequential'
}

export interface AssignmentLite {
  id: string;
  role: string;
  runtime: string;       // 'local' | 'cloud' | 'remote' | 'browser'
  target: string | null;
  taskTemplate: string | null;
  model: string | null;
  position: number;
}

export interface TicketRunLite {
  id: string;
  tenantId: number;
  boardId: string;
  taskId: number;
  currentSwimlaneId: string | null;
  lifecycle: string;
  currentWorkflowId: string | null;
  stageHistory: string | null;
  error: string | null;
}

export interface DispatchLite {
  id: string;
  tenantId: number;
  ticketRunId: string;
  swimlaneId: string | null;
  assignmentId: string | null;
  taskId: number | null;
  agentId: number | null;
  stageSeq: number;
  role: string;
  runtime: string;
  target: string | null;
  model: string | null;
  input: string | null;
  status: string;
  output: string | null;
  error: string | null;
  dependsOn: string | null;
  externalRef: string | null;
  position: number;
}

export interface NewDispatch {
  tenantId: number;
  ticketRunId: string;
  swimlaneId: string | null;
  assignmentId: string | null;
  taskId: number | null;
  agentId: number | null;
  stageSeq: number;
  role: string;
  runtime: string;
  target: string | null;
  model: string | null;
  input: string | null;
  status: string;
  dependsOn: string;
  position: number;
}

export interface TransitionRecord {
  tenantId: number;
  ticketRunId: string;
  fromSwimlaneId: string | null;
  toSwimlaneId: string | null;
  reason: string;
  workflowStatus: string | null;
  detail: string;
}

export interface CoordinatorStore {
  getBoard(boardId: string, tenantId: number): Promise<BoardLite | null>;
  /** Count non-terminal ticket runs on a board (concurrency budget). */
  countActiveTickets(boardId: string, tenantId: number, activeLifecycles: string[]): Promise<number>;
  /** All lanes of a board, ordered by position ascending. */
  listLanes(boardId: string, tenantId: number): Promise<LaneLite[]>;
  getLane(swimlaneId: string, tenantId: number): Promise<LaneLite | null>;
  listAssignments(swimlaneId: string, tenantId: number): Promise<AssignmentLite[]>;

  createTicketRun(data: {
    tenantId: number;
    boardId: string;
    taskId: number;
    currentSwimlaneId: string | null;
    lifecycle: string;
    stageHistory: string;
  }): Promise<TicketRunLite>;
  getTicketRun(id: string): Promise<TicketRunLite | null>;
  updateTicketRun(
    id: string,
    tenantId: number,
    patch: { lifecycle: string; currentSwimlaneId: string | null; stageHistory: string; error: string | null },
  ): Promise<TicketRunLite | null>;
  recordTransition(t: TransitionRecord): Promise<void>;

  insertDispatch(data: NewDispatch): Promise<string>;
  updateDispatch(
    id: string,
    patch: Partial<{
      status: string;
      output: string | null;
      error: string | null;
      externalRef: string | null;
      dependsOn: string;
      completedAt: boolean; // true → set now, false → clear
    }>,
  ): Promise<void>;
  getDispatch(id: string, tenantId: number): Promise<DispatchLite | null>;
  listStageDispatches(ticketRunId: string, stageSeq: number, tenantId: number): Promise<DispatchLite[]>;
  maxStageSeq(ticketRunId: string): Promise<number>;
}
