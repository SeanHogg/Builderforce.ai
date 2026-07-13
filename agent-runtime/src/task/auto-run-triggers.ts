/**
 * Auto-Run Side-Effect Handlers
 * Provides pre-built side-effects for assignment. Tests in FR-3.1-6 expect exactly one fire per distinct logical assignment.
 */

import type { AssignmentContext, SideEffectHandler } from './assignment';
import { Logger } from '../embedded-helpers';

/**
 * Logger instance for assignment side-effect logging
 */
const assignmentLogger = new Logger('AssignmentSideEffect');

/**
 * Side-effect handler that logs assignment events.
 * Implements FR-4.3: emits a log entry at INFO level per fire including taskId and agentId.
 */
export const logAssignmentSideEffect: SideEffectHandler = async (context: AssignmentContext) => {
  const { taskId, agentId, timestamp } = context;
  assignmentLogger.info('Auto-run side-effect: Agent assignment fired', {
    taskId,
    agentId,
    timestamp,
  });
};

/**
 * Stats side-effect handler for observability during testing.
 * Maintains a static counter of invocations and returns call arguments.
 * This is separate from the production side-effect (logAssignmentSideEffect) and is primarily used in tests.
 */
export class StatsSideEffectHandler implements SideEffectHandler {
  private static invocationCount = 0;
  private static lastCallArgs: AssignmentContext | null = null;

  async handle(context: AssignmentContext): Promise<void> {
    StatsSideEffectHandler.invocationCount++;
    StatsSideEffectHandler.lastCallArgs = context;
  }

  reset(): void {
    StatsSideEffectHandler.invocationCount = 0;
    StatsSideEffectHandler.lastCallArgs = null;
  }

  getInvocationCount(): number {
    return StatsSideEffectHandler.invocationCount;
  }

  getLastCallArgs(): AssignmentContext | null {
    return StatsSideEffectHandler.lastCallArgs;
  }
}

export const statsSideEffect = new StatsSideEffectHandler();