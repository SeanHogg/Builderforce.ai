/**
 * Progress breakdown object: derived from a task based on its basis.
 *
 * Fields:
 * - basis: how we compute progress (literal from parent epic).
 * - subtasksDone: number of direct child tasks that are DONE/IN_REVIEW (or 0 for non-Epic).
 * - subtasksTotal: number of child tasks (0 if not Epic).
 * - codeDelivered: true when prState is 'open' or 'pull_request'.
 * - testsPassing: derived from tests detection (or null if tests info unavailable).
 * - prState: 'open' | 'not_open' | null.
 * - lastUpdated: integer timestamp (milliseconds) tracking the last modification time.
 */
export interface ProgressBreakdown {
  basis: "subtasks" | "pr" | "status" | "manual";
  subtasksDone: number;
  subtasksTotal: number;
  codeDelivered: boolean;
  testsPassing: boolean | null;
  prState: "open" | "not_open" | null;
  lastUpdated?: number; // Optional timestamp for test fixtures and visualization
}