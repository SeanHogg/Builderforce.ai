/**
 * terminalStatus — "is this run / this ticket finished", spelled ONCE.
 *
 * The 2026-09-05 review found the execution answer written as six literal sets and
 * the task answer as three, with three different memberships between them. A run
 * that one reader thinks is over and another thinks is live is a ticket that can
 * neither auto-run nor be reaped, so the membership is a domain rule, not a local
 * constant — every reader takes it from here, and the non-terminal list is DERIVED
 * as the complement rather than maintained beside it.
 *
 * Executions, workflows and dispatches share the same three terminal words
 * (`completed`, `failed`, `cancelled`) because they share a lifecycle; the sets are
 * typed as `string` so a `WorkflowStatus` or a `DispatchStatus` column can be tested
 * without a cast, and the typed `ExecutionStatus[]` is kept for `inArray` on the
 * executions table.
 */
import { ExecutionStatus } from './types';
import { DONE_CLASS } from './doneClass';

/** A run that will never change status again. */
export const EXECUTION_TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
];

export const EXECUTION_TERMINAL_SET: ReadonlySet<string> = new Set<string>(EXECUTION_TERMINAL_STATUSES);

/** Everything else — the complement, so the two lists cannot disagree. */
export const EXECUTION_NON_TERMINAL_STATUSES: readonly ExecutionStatus[] = Object.values(ExecutionStatus)
  .filter((s) => !EXECUTION_TERMINAL_SET.has(s));

export function isTerminalExecutionStatus(status: string | null | undefined): boolean {
  return !!status && EXECUTION_TERMINAL_SET.has(status);
}

/**
 * A ticket that is off the board for good: the DONE class plus `cancelled` (closed
 * without being done — a lane key, not a TaskStatus member, which is why it is a
 * literal here). Readers that tolerate imported vocabularies (`closed`,
 * `merged`, `resolved` from a synced tracker) widen this set; they do not replace it.
 */
export const TASK_TERMINAL_SET: ReadonlySet<string> = new Set<string>([...DONE_CLASS, 'cancelled']);

export function isTerminalTaskStatus(status: string | null | undefined): boolean {
  return !!status && TASK_TERMINAL_SET.has(status);
}
