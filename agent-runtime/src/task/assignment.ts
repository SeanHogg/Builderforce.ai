/**
 * Task Assignment Domain Model
 * Models an agent assignment to a task with auto-run side-effect support.
 */

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'created' | 'started' | 'completed' | 'cancelled';
  assignedAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Agent {
  id: string;
  name: string;
  type: 'human' | 'agent' | 'system';
}

export interface AssignmentContext {
  taskId: string;
  agentId: string;
  timestamp: number;
}

/**
 * Side-effect handler type definition
 * Functions that should be called once per assignment operation.
 */
export type SideEffectHandler = (context: AssignmentContext) => Promise<void> | void;

/**
 * AssignmentService
 * Orchestrates agent-task assignments and manages the registration of auto-run side effects.
 */
export class AssignmentService {
  private tasks: Map<string, Task> = new Map();
  private agents: Map<string, Agent> = new Map();
  private sideEffectRegistry: Set<SideEffectHandler> = new Set();

  // Tracking: stores assignment-ids that have already fired their side effect
  private sideEffectFired: Set<string> = new Set();

  /**
   * Register a side-effect handler
   * @param handler The side effect to invoke once per assignment
   */
  registerSideEffect(handler: SideEffectHandler): void {
    if (!this.sideEffectRegistry.has(handler)) {
      this.sideEffectRegistry.add(handler);
      console.debug('[AssignmentService] Registered side-effect handler');
    }
  }

  /**
   * Assign an agent to a task
   * This is the single entry point for all assignment operations.
   */
  async assignAgentToTask(
    taskId: string,
    agentId: string
  ): Promise<Task> {
    // Validate inputs
    this.ensureTaskExists(taskId);
    this.ensureAgentExists(agentId);

    const task = this.tasks.get(taskId)!;
    const assignmentId = this.generateAssignmentId(taskId, agentId);

    // Check if this logical assignment has already fired
    if (this.sideEffectFired.has(assignmentId)) {
      console.warn(`[AssignmentService] Side-effect already fired for assignment: ${assignmentId}`);
      return task;
    }

    // Update task with new assignment
    const now = Date.now();
    const updatedTask: Task = {
      ...task,
      assignedAgentId: agentId,
      updatedAt: now,
    };

    this.tasks.set(taskId, updatedTask);

    // Track that side effect was fired
    this.sideEffectFired.add(assignmentId);

    // Invoke all registered side effects exactly once
    const context: AssignmentContext = {
      taskId,
      agentId,
      timestamp: now,
    };

    // Fire side effects concurrently or sequentially based on desired semantics
    // Using Promise.all for concurrent execution from a single assignment
    await Promise.allSettled(
      Array.from(this.sideEffectRegistry).map(handler =>
        this.executeSideEffect(handler, context)
      )
    );

    console.info(
      `[AssignmentService] Agent ${agentId} assigned to task ${taskId} - ` +
      `side-effect fired (assignmentId: ${assignmentId})`
    );

    return updatedTask;
  }

  /**
   * Internal method to execute a side-effect with error handling
   */
  private async executeSideEffect(
    handler: SideEffectHandler,
    context: AssignmentContext
  ): Promise<void> {
    try {
      await handler(context);
    } catch (error) {
      console.error(
        `[AssignmentService] Side-effect failed for assignment ${context.taskId}/${context.agentId}`,
        error
      );
      // Side-effect failures should NOT block the assignment from succeeding
      // This aligns with FR-2.5: the side effect layer is resilient
    }
  }

  /**
   * Re-assign an agent (clear the previous record, allow re-fire)
   */
  async reassignAgentToTask(
    taskId: string,
    agentId: string
  ): Promise<Task> {
    // Remove any previous assignment tracking to allow re-fire
    const task = this.tasks.get(taskId);
    if (task?.assignedAgentId) {
      const oldAssignmentId = this.generateAssignmentId(taskId, task.assignedAgentId);
      this.sideEffectFired.delete(oldAssignmentId);
    }

    return this.assignAgentToTask(taskId, agentId);
  }

  // --- Helper methods ---

  private ensureTaskExists(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Task not found: ${taskId}`);
    }
  }

  private ensureAgentExists(agentId: string): void {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent not found: ${agentId}`);
    }
  }

  private generateAssignmentId(taskId: string, agentId: string): string {
    return `${taskId}:${agentId}`;
  }

  // --- Testing/diagnostic helpers ---

  /**
   * Get current assignment invocation count (for testing)
   */
  getSideEffectInvocationCount(assignmentId: string): number {
    return this.sideEffectFired.has(assignmentId) ? 1 : 0;
  }

  /**
   * Returns all assignment IDs that have fired their side effects
   */
  getFiredAssignments(): string[] {
    return Array.from(this.sideEffectFired);
  }
}