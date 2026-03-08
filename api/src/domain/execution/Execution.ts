import { ExecutionId, TaskId, AgentId, TenantId, ClawId, ExecutionStatus } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface ExecutionProps {
  id:           ExecutionId;
  taskId:       TaskId;
  agentId:      AgentId | null;
  clawId:       ClawId | null;
  tenantId:     TenantId;
  submittedBy:  string;           // userId
  sessionId:    string | null;
  status:       ExecutionStatus;
  /** JSON payload sent to the agent. */
  payload:      string | null;
  /** JSON result returned by the agent. */
  result:       string | null;
  errorMessage: string | null;
  startedAt:    Date | null;
  completedAt:  Date | null;
  createdAt:    Date;
  updatedAt:    Date;
}

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
    clawId:      ClawId | null;
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
      result:       null,
      errorMessage: null,
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
  get clawId():       ClawId | null    { return this.props.clawId; }
  get tenantId():     TenantId         { return this.props.tenantId; }
  get submittedBy():  string           { return this.props.submittedBy; }
  get sessionId():    string | null    { return this.props.sessionId; }
  get status():       ExecutionStatus  { return this.props.status; }
  get payload():      string | null    { return this.props.payload; }
  get result():       string | null    { return this.props.result; }
  get errorMessage(): string | null    { return this.props.errorMessage; }
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
    const terminal: ExecutionStatus[] = [
      ExecutionStatus.COMPLETED,
      ExecutionStatus.FAILED,
      ExecutionStatus.CANCELLED,
    ];
    if (terminal.includes(this.props.status)) {
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
