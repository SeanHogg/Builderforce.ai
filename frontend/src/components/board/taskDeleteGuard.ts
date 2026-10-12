/**
 * Checks whether a task has a running execution that must be stopped before deletion.
 * Returns true if the task has an active (running/submitted/pending) execution.
 */
import { ACTIVE_EXECUTION_STATUSES } from './AgentChip';

export interface AgentRun {
  status: string;
}

/**
 * Checks if any of the runs for a task are currently active (running, submitted, or pending).
 * @param runs - Array of agent runs for the task
 * @returns true if any run is active and deletion should be blocked
 */
export function hasActiveExecution(runs: AgentRun[] | undefined): boolean {
  return (runs ?? []).some((r) => ACTIVE_EXECUTION_STATUSES.has(r.status));
}
