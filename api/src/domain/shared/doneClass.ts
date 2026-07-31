/**
 * The ONE definition of "this ticket is finished".
 *
 * `tasks.status` is free-form text (a board lane key), so "done" is not a type —
 * it is a CLASS of lane keys, plus any swimlane a board explicitly flags
 * `is_terminal`. That rule was copy-pasted into four modules (taskLifecycle, the
 * lifecycle ledger, the assignee recommender, reportRoutes), each with a comment
 * pointing at one of the others as the source of truth. It now lives here, and
 * every consumer imports it — so a tenant that adds a `released` terminal lane is
 * folded in once rather than in four places that can silently drift apart.
 *
 * A board-aware caller (one that has loaded swimlane ordinals) should use
 * {@link isDoneLane}, which also honours the per-board `isTerminal` flag. A caller
 * with only a status string uses {@link isDoneStatus}.
 *
 * IMPORTANT: The done-class set was EXPANDED to include Jira/Linear/ADO imports
 * ('completed', 'closed', 'resolved', 'shipped') to ensure FR1's
 * unassigned-high-priority endpoint correctly excludes finished work from any board.
 */
import { TaskStatus } from './types';

/**
 * Lane keys that mean "finished" regardless of board configuration.
 * Expanded to cover imported boards (Jira/Linear/ADO) which may spell
 * their terminal lane as 'completed', 'closed', 'resolved', 'shipped'.
 */
export const DONE_CLASS: ReadonlySet<string> = new Set<string>([
  TaskStatus.DONE,
  'completed',
  'complete',
  'closed',
  'resolved',
  'shipped',
]);

/** Array form, for SQL `inArray(...)` predicates. */
export const DONE_CLASS_STATUSES: readonly string[] = [...DONE_CLASS];

/**
 * True when a lane key is done-class.
 *
 * Comparison is case-insensitive and trims surrounding whitespace, because
 * imported boards frequently carry lane keys like 'Done' or 'Closed '.
 */
export function isDoneStatus(status: string | null | undefined): boolean {
  if (status == null) return false;
  return DONE_CLASS.has(status.trim().toLowerCase());
}

/** Inverse of {@link isDoneStatus} — convenience for `.filter(isNotDoneStatus)`. */
export function isNotDoneStatus(status: string | null | undefined): boolean {
  return !isDoneStatus(status);
}

/** A board lane's terminality, as loaded from `swimlanes` (position + is_terminal). */
export interface LaneTerminality {
  isTerminal: boolean;
}

/**
 * True when the status is done-class OR the project's board flags that lane
 * terminal. Use wherever the board's own lane config is available — a tenant that
 * renamed `done` to `shipped` and flagged it terminal is then counted correctly.
 */
export function isDoneLane(
  status: string | null | undefined,
  lanes: Record<string, LaneTerminality | undefined>,
): boolean {
  if (status == null) return false;
  return DONE_CLASS.has(status) || lanes[status]?.isTerminal === true;
}
