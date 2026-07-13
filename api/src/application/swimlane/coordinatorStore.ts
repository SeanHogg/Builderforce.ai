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
  /** Lane action fired once the stage settles (migration 0084). */
  actionType: string | null;       // null|'advance' | 'move_ticket' | 'run_workflow'
  actionTarget: string | null;     // target lane key (move_ticket) | workflow id (run_workflow)
  successPolicy: string;           // 'all' | 'any' | 'n_of_m'
  successThreshold: number | null; // required when successPolicy='n_of_m'
  /** What a FAILED/unmet-quorum stage does (migration 0084): 'needs_attention'
   *  (default — park for a human), 'skip' (tolerate + advance past the lane), or
   *  'retry' (re-run — currently falls back to needs_attention, see Gap Register). */
  failurePolicy: string;
  /** How strictly this lane's requirements gate entry (migration 0274): 'off' | 'soft'
   *  | 'hard'. The coordinator blocks a 'hard' lane's stage launch while a required
   *  reviewer sign-off is missing. */
  requirementGate: string;
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
  /** When lifecycle='awaiting_workflow': the spawned run_workflow id being awaited. */
  awaitingWorkflowId: string | null;
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
  /** True when this lane declares a REQUIRED reviewer check (review, or role with
   *  responsibility='reviewer') that the ticket has NOT satisfied with an approved
   *  sign-off. Drives the coordinator's 'hard'-gate block. */
  hasUnmetRequiredReviewers(taskId: number, swimlaneId: string, tenantId: number): Promise<boolean>;
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
    patch: {
      lifecycle: string;
      currentSwimlaneId: string | null;
      stageHistory: string;
      error: string | null;
      /** Set/clear the parked-on workflow id. Omit to leave it unchanged. */
      awaitingWorkflowId?: string | null;
    },
  ): Promise<TicketRunLite | null>;
  recordTransition(t: TransitionRecord): Promise<void>;
  /**
   * Find the ticket run currently parked on (awaiting) the given spawned
   * workflow id, if any. Used by the parked-workflow sweep to resume a ticket
   * once its run_workflow side-effect settles. Optional — in-memory test stores
   * that don't exercise the gate may omit it.
   */
  findAwaitingWorkflowRun?(workflowId: string): Promise<TicketRunLite | null>;

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
  /**
   * The tenant's default agentHost id (as a string), used to route non-browser
   * dispatches whose assignment did not pin an explicit `target`. Optional —
   * in-memory test stores omit it (the coordinator falls back to no default).
   */
  getDefaultAgentHostId?(tenantId: number): Promise<string | null>;
}
