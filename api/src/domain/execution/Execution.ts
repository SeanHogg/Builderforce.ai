import { ExecutionId, TaskId, AgentId, TenantId, AgentHostId, ExecutionStatus } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface ExecutionProps {
  id:           ExecutionId;
  taskId:       TaskId;
  agentId:      AgentId | null;
  agentHostId:       AgentHostId | null;
  tenantId:     TenantId;
  submittedBy:  string;           // userId
  sessionId:    string | null;
  status:       ExecutionStatus;
  /** JSON payload sent to the agent. */
  payload:      string | null;
  /** Cloud agent (ide_agents.id) that ran this execution; null for host/default runs. */
  cloudAgentRef: string | null;
  /** JSON result returned by the agent. */
  result:       string | null;
  errorMessage: string | null;
  /**
   * Did this finished run leave anything behind — a commit, a PR, a merge, or a lane
   * move (0385)? `null` = not judged (a legacy row, a cancelled run, or a surface that
   * does not route through `finalizeCloudRun`), which the autonomy breaker reads as
   * PRODUCTIVE so an unknown can never halt a board. See `runProducedOutput`.
   */
  produced:     boolean | null;
  startedAt:    Date | null;
  completedAt:  Date | null;
  createdAt:    Date;
  updatedAt:    Date;
}

/**
 * The statuses from which no further transition is legal. Declared once so the
 * transition guards, `cancel()` and callers deciding whether a run is already
 * concluded all agree on what "terminal" means.
 */
export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
];

/**
 * Execution aggregate root.
 *
 * Tracks the lifecycle of a single Task being executed by an Agent.
 *
 * State machine:
 *   PENDING → SUBMITTED → RUNNING → COMPLETED
 *                                  └→ FAILED
 *   PENDING/SUBMITTED/RUNNING → CANCELLED
 */
export class Execution {
  private constructor(private readonly props: ExecutionProps) {}

  // -----------------------------------------------------------------------
  // Factory
  // -----------------------------------------------------------------------

  static create(props: {
    taskId:      TaskId;
    agentId:     AgentId | null;
    agentHostId:      AgentHostId | null;
    tenantId:    TenantId;
    submittedBy: string;
    sessionId:   string | null;
    payload:     string | null;
  }): Execution {
    const now = new Date();
    return new Execution({
      ...props,
      id:           0 as ExecutionId,
      status:       ExecutionStatus.PENDING,
      cloudAgentRef: null, // set at dispatch once the cloud agent is resolved
      result:       null,
      errorMessage: null,
      // Not judged until the run finishes and finalize stamps it (0385).
      produced:     null,
      startedAt:    null,
      completedAt:  null,
      createdAt:    now,
      updatedAt:    now,
    });
  }

  static reconstitute(props: ExecutionProps): Execution {
    return new Execution(props);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  get id():           ExecutionId      { return this.props.id; }
  get taskId():       TaskId           { return this.props.taskId; }
  get agentId():      AgentId | null   { return this.props.agentId; }
  get agentHostId():       AgentHostId | null    { return this.props.agentHostId; }
  get tenantId():     TenantId         { return this.props.tenantId; }
  get submittedBy():  string           { return this.props.submittedBy; }
  get sessionId():    string | null    { return this.props.sessionId; }
  get status():       ExecutionStatus  { return this.props.status; }
  get payload():      string | null    { return this.props.payload; }
  get cloudAgentRef(): string | null   { return this.props.cloudAgentRef; }
  get result():       string | null    { return this.props.result; }
  get errorMessage(): string | null    { return this.props.errorMessage; }
  get produced():     boolean | null   { return this.props.produced; }
  get startedAt():    Date | null      { return this.props.startedAt; }
  get completedAt():  Date | null      { return this.props.completedAt; }
  get createdAt():    Date             { return this.props.createdAt; }
  get updatedAt():    Date             { return this.props.updatedAt; }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  /** Marks the execution as dispatched to the agent. */
  markSubmitted(): Execution {
    this.assertNotTerminal('submit');
    return this.transition(ExecutionStatus.SUBMITTED, {});
  }

  /** Called when the agent acknowledges and begins working. */
  markRunning(): Execution {
    this.assertNotTerminal('start');
    return this.transition(ExecutionStatus.RUNNING, { startedAt: new Date() });
  }

  /** Called when the agent reports successful completion. */
  markCompleted(result: string): Execution {
    this.assertNotTerminal('complete');
    return this.transition(ExecutionStatus.COMPLETED, {
      result,
      completedAt: new Date(),
    });
  }

  /** Called when the agent reports a failure. */
  markFailed(errorMessage: string): Execution {
    this.assertNotTerminal('fail');
    return this.transition(ExecutionStatus.FAILED, {
      errorMessage,
      completedAt: new Date(),
    });
  }

  /**
   * Record that terminal lifecycle orchestration itself produced durable progress
   * (for example, advancing the ticket to its next lane). This is intentionally
   * monotonic: a previously recorded artifact can never be erased by a later signal.
   */
  markProduced(produced: boolean): Execution {
    return new Execution({
      ...this.props,
      produced: this.props.produced === true || produced,
      updatedAt: new Date(),
    });
  }

  /**
   * True once the run has concluded. A caller holding a stale view of the run
   * (a retried Durable Object alarm, an at-least-once agent report, the orphan
   * sweep) should check this and skip rather than attempt a transition that can
   * only fail — re-asserting a terminal state would also clobber a cancellation.
   */
  get isTerminal(): boolean {
    return TERMINAL_EXECUTION_STATUSES.includes(this.props.status);
  }

  /** Cancels the execution if it has not yet finished. */
  cancel(): Execution {
    if (
      this.props.status === ExecutionStatus.COMPLETED ||
      this.props.status === ExecutionStatus.FAILED
    ) {
      throw new ValidationError('Cannot cancel a completed or failed execution');
    }
    if (this.props.status === ExecutionStatus.CANCELLED) {
      throw new ValidationError('Execution is already cancelled');
    }
    return this.transition(ExecutionStatus.CANCELLED, { completedAt: new Date() });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private assertNotTerminal(action: string): void {
    if (this.isTerminal) {
      throw new ValidationError(
        `Cannot ${action} an execution in status '${this.props.status}'`,
      );
    }
  }

  private transition(
    status: ExecutionStatus,
    extra: Partial<ExecutionProps>,
  ): Execution {
    return new Execution({ ...this.props, ...extra, status, updatedAt: new Date() });
  }

  toPlain(): ExecutionProps { return { ...this.props }; }
}
